import { dirFromVector, isSide, type Dir } from '../art/geom.ts';
import { TILE } from '../content/terrain.ts';
import type { CommandStep, LineStep, Step } from '../content/screenplay.ts';
import type { GameContext } from '../game/context.ts';
import { noteUnnuked } from '../game/achievements.ts';
import { requirementsMet } from '../game/state.ts';
import type { Actor } from '../world/actor.ts';
import { formationSpots, wideBattle } from '../battle/formation.ts';
import { kujiKiri } from '../world/kujiKiri.ts';

/**
 * A townsperson a scene moved or turned stays so: where they now stand and face becomes where they
 * stand at rest, so their idle moves do not take them back. Turned up or down, they rest facing their
 * side, which they turn to a moment after the scene.
 */
function settle(a: Actor): void {
  if (a.kind !== 'npc') return;
  a.homeX = a.x;
  a.homeY = a.y;
  a.homeFacing = isSide(a.facing) ? a.facing : a.side;
}

/** Stage directions that move or turn people, or take them into a fight or another map. */
const MOVES = new Set(['walk', 'walk_on', 'place', 'face', 'gather', 'line_up', 'formation', 'battle', 'warp', 'drop']);

// The owner's ending mix: Berlin fades now; the ending starts at full level during its last half second.
const ENDING_MUSIC_TIMING = { fadeOut: 2.5, startAfter: 2.0 };
/** A little longer than a natural blink, as a scripted one is there to be seen. */
const SCRIPTED_BLINK = 0.18;

export interface SceneOptions {
  auto?: number;
  /** Stage the opening immediately, but hold its dialogue until the covering page has left. */
  beforeDialogue?: Promise<void>;
}

/**
 * Runs scenes from the script, one step at a time. Lines go to the dialogue;
 * commands move people, set flags, start fights, and so on. While a scene runs,
 * the player cannot walk.
 */
export class Story {
  private readonly game: GameContext;
  private depth = 0;
  /** Each run gets a number; skip() abandons the runs numbered up to this. */
  private runCounter = 0;
  private skipUpTo = 0;
  current: string | null = null;
  /**
   * For each scene running, whoever its [face] or [formation] commands turned; they keep that facing while
   * others speak in that scene. A scene run inside another (a fight's after scene) starts with none.
   */
  private readonly faced: Array<Set<Actor>> = [];
  /** For each scene running, whoever its [shake_head] set shaking; they stop at its next spoken line, or its end. */
  private readonly shakers: Array<Set<Actor>> = [];
  /** Scene-owned celebrants; narration continues the gag until a picture covers them or their scene ends. */
  private readonly celebrants: Array<Set<Actor>> = [];
  /**
   * For each scene running, whoever its [walk_on] set walking, with that walk; a [face], [walk] or [place] of them, or the
   * scene's end, stops them where they are, or a step or two on if they stand on a flower just then.
   */
  private readonly strolling: Array<Map<Actor, { done: Promise<void> }>> = [];

  constructor(game: GameContext) {
    this.game = game;
  }

  get busy(): boolean {
    return this.depth > 0;
  }

  /** Abandons the scenes running now. Scenes that start afterwards, such as the one after a fight, still play. */
  skip(): void {
    if (this.busy) {
      this.skipUpTo = this.runCounter;
      this.stopCelebrating();
      this.game.dialogue.clear();
    }
  }

  /** Whether every scene running now is being abandoned, so a step under way (a rest) can end at once. */
  get skipping(): boolean {
    return this.busy && this.skipUpTo >= this.runCounter;
  }

  /** Stops every head shake in the scenes running now, each turning back the way they faced. */
  private stopShaking(): void {
    for (const set of this.shakers) {
      for (const a of set) a.stopShaking();
      set.clear();
    }
  }

  private stopCelebrating(sets = this.celebrants): void {
    for (const set of sets) {
      for (const a of set) a.stopCelebrating();
      set.clear();
    }
  }

  /** Stops `a` if a [walk_on] has them walking, and waits until they stand still. */
  private async halt(a: Actor): Promise<void> {
    for (const walks of this.strolling) {
      const walk = walks.get(a);
      walks.delete(a);
      await walk?.done;
    }
  }

  async run(id: string, opts: SceneOptions = {}): Promise<void> {
    const scene = this.game.content.scenes.get(id);
    if (!scene) {
      console.warn(`No scene "${id}"`);
      return;
    }
    const runId = ++this.runCounter;
    this.depth++;
    this.faced.push(new Set());
    this.shakers.push(new Set());
    this.celebrants.push(new Set());
    this.strolling.push(new Map());
    const outer = this.current;
    this.current = id;
    const world = this.game.world;
    if (world && !world.leader.scripted) world.leader.moving = false;
    try {
      const walker = (s: Step | undefined) => (s?.kind === 'command' && s.name === 'walk' ? s.args[0]!.toLowerCase() : null);
      for (let i = 0; i < scene.steps.length; i++) {
        const step = scene.steps[i]!;
        if (step.kind === 'line' && opts.beforeDialogue) await opts.beforeDialogue;
        if (runId <= this.skipUpTo) break;
        // Walks of different people written one after another start together, as stage directions do; the scene
        // goes on once all have arrived.
        let last = i;
        const walkers = new Set([walker(step)]);
        while (!walkers.has(null) && !walkers.has('party')) {
          const next = walker(scene.steps[last + 1]);
          if (!next || next === 'party' || walkers.has(next)) break;
          walkers.add(next);
          last++;
        }
        await Promise.all(scene.steps.slice(i, last + 1).map((s) => this.exec(s, opts)));
        i = last;
      }
    } catch (err) {
      console.error(`Scene "${id}" stopped with an error:`, err);
    } finally {
      // Whoever still walks on stops before the scene lets the party go.
      const walks = this.strolling.at(-1)!, left = [...walks.values()].map((walk) => walk.done);
      walks.clear();
      await Promise.all(left);
      this.strolling.pop();
      this.depth--;
      this.faced.pop();
      for (const a of this.shakers.pop() ?? []) a.stopShaking();
      const celebrants = this.celebrants.pop();
      if (celebrants) this.stopCelebrating([celebrants]);
      this.current = outer;
      if (this.depth === 0) {
        const w = this.game.world;
        if (w && !w.following && !this.game.battleActive()) w.lineUp();
        // A camera following everyone goes back to the leader with the scene's end, skipped or not.
        if (w && w.cameraTarget === w.everyone) w.cameraTarget = null;
      }
    }
  }

  private async exec(step: Step, opts: { auto?: number }): Promise<void> {
    const g = this.game;
    if (step.kind === 'line') {
      // Heads shaken at what was said stop when someone speaks, in this scene or one inside it; narration lets them go on.
      if (step.speaker !== null) { this.stopShaking(); this.stopCelebrating(); }
      this.turnToSpeaker(step);
      await g.dialogue.say(step, opts.auto !== undefined ? { auto: opts.auto } : {});
      return;
    }
    // So do directions that move or turn people, or start a fight, so the facing they set is the one kept.
    if (MOVES.has(step.name)) this.stopShaking();
    if (MOVES.has(step.name) || ['fin', 'title'].includes(step.name)) this.stopCelebrating();
    await this.command(step);
  }

  /**
   * The party turns to whoever speaks, sideways only, as people do in a conversation: on the map, not in
   * a fight, and not anyone a [face] or [formation] command placed, anyone walking, or anyone more above
   * or below the speaker than beside them. A speaker out of sight (the boss before its fight) is turned
   * to all the same, as a voice is. Narration turns no one.
   */
  private turnToSpeaker(line: LineStep): void {
    const g = this.game;
    const w = g.world;
    if (!w || line.speaker === null || g.battleActive()) return;
    const ref = g.content.characters[line.speaker]?.actor;
    const speaker = ref ? w.actor(ref) : undefined;
    if (!speaker) return;
    for (const a of w.party) {
      if (a === speaker || this.faced.at(-1)?.has(a) || a.scripted > 0) continue;
      if (line.tags.includes('offscreen_right')) {
        a.facing = 'right';
        continue;
      }
      const dx = speaker.x - a.x;
      if (Math.abs(dx) >= Math.max(8, Math.abs(speaker.y - a.y))) a.facing = dx < 0 ? 'left' : 'right';
    }
  }

  private async command(c: CommandStep): Promise<void> {
    const g = this.game;
    const w = g.world;
    const [a0, a1, a2, a3] = c.args;
    switch (c.name) {
      case 'wait':
        await g.delay(Number(a0));
        return;
      case 'blink': {
        const who = w?.actor(a0!);
        if (!who) return;
        who.blinkNow = true;
        await g.delay(SCRIPTED_BLINK);
        who.blinkNow = false;
        return;
      }
      case 'walk': {
        if (!w) return;
        const who = a0!.toLowerCase() === 'party' ? w.party : [w.actor(a0!)].filter((x) => x !== undefined);
        await Promise.all(who.map((a) => this.halt(a!)));
        const speed = a1 === 'to' ? Number(a3 ?? 0) : Number(c.args[4] ?? 0);
        if (a1 === 'to') {
          const o = w.object(a2!);
          if (!o) return;
          const tx = o.x + o.w / 2;
          const ty = o.y + o.h / 2;
          w.following = false;
          await Promise.all(who.map((a, i) => w.walk(a!, tx - i * 4, ty, speed || a!.speed)));
        } else {
          const dx = Number(a2) * TILE;
          const dy = Number(a3) * TILE;
          w.following = false;
          await Promise.all(who.map((a) => w.walk(a!, a!.x + dx, a!.y + dy, speed || a!.speed)));
        }
        for (const a of who) settle(a!);
        return;
      }
      case 'walk_together': {
        if (!w) return;
        w.following = false;
        const walks: Array<Promise<unknown>> = [];
        const walkers: Actor[] = [];
        for (let i = 0; i + 1 < c.args.length; i += 2) {
          const a = w.actor(c.args[i]!), o = w.object(c.args[i + 1]!);
          if (!a || !o) continue;
          await this.halt(a);
          walkers.push(a);
          walks.push(w.walk(a, o.x + o.w / 2, o.y + o.h / 2, a.speed));
        }
        await Promise.all(walks);
        for (const a of walkers) settle(a);
        return;
      }
      case 'walk_on': {
        // Someone sets off and the scene goes on at once: they walk on under what follows until a [face] turns them, they
        // get there, or the scene ends (after the giant ghost, Olli and Ronnie walk on as Gorbie goes up to the flower, and
        // stop to turn back to him as he asks about it; the owner, 14 Nov).
        const a = w?.actor(a0!), o = w?.object(a2!), walks = this.strolling.at(-1);
        if (!w || !a || !o || !walks) return;
        await this.halt(a);
        w.following = false;
        const walk = { done: Promise.resolve() };
        walks.set(a, walk);
        walk.done = w.walk(a, o.x + o.w / 2, o.y + o.h / 2, a.speed, () => walks.get(a) === walk).then(() => {
          if (walks.get(a) === walk) walks.delete(a);
          settle(a);
        });
        return;
      }
      case 'place': {
        if (!w) return;
        const a = w.actor(a0!);
        const o = w.object(a1!);
        if (a) await this.halt(a);
        if (a && o) {
          w.following = false;
          a.x = o.x + o.w / 2;
          a.y = o.y + o.h / 2;
          settle(a);
        }
        return;
      }
      case 'face': {
        if (!w) return;
        const a = w.actor(a0!);
        if (!a) return;
        await this.halt(a);
        this.faced.at(-1)?.add(a);
        // The party holds still to be turned: still following, they would walk on to their places in line and turn with
        // the walk (after the giant ghost, as Gorbie asked about the flower, 14 Nov). The scene's end lines them up again.
        if (w.party.includes(a)) w.following = false;
        if (['up', 'down', 'left', 'right'].includes(a1!)) a.facing = a1 as Dir;
        else {
          // Toward someone, or else toward a thing on the map by its name (the maze's flowers).
          const someone = w.actor(a1!), o = someone ? undefined : w.object(a1!);
          const b = someone ?? (o && { x: o.x + o.w / 2, y: o.y + o.h / 2 });
          if (b) {
            const dx = b.x - a.x;
            // NPC conversations stay upright, including a scripted gift after a fight.
            a.facing = a2 === 'sideways'
              ? Math.abs(dx) >= 2 ? dx < 0 ? 'left' : 'right' : isSide(a.facing) ? a.facing : a.side
              : dirFromVector(dx, b.y - a.y, a.facing);
          }
        }
        settle(a);
        return;
      }
      case 'shake_head': {
        if (!w) return;
        const who = c.args.flatMap((n) => (n.toLowerCase() === 'party' ? w.party : [w.actor(n)].filter((a) => a !== undefined)));
        for (const a of who) {
          a.startShaking();
          this.shakers.at(-1)?.add(a);
        }
        return;
      }
      case 'celebrate': {
        if (a0 === 'stop') { this.stopCelebrating(); return; }
        if (!w) return;
        const who = c.args.flatMap(n => n.toLowerCase() === 'party' ? w.party : [w.actor(n)].filter(a => a !== undefined));
        for (const a of who) {
          a.startCelebrating();
          this.celebrants.at(-1)?.add(a);
        }
        return;
      }
      case 'gather':
        if (w) await w.gather();
        return;
      case 'line_up': {
        if (!w) return;
        // With `wait`, the scene goes on once the other two stand in line, at places off the flowers (after the flower they
        // fall in behind Olli before the player has him again; the owner, 14 Nov). Followers walk straight to their places,
        // so it is soon; a cap all the same.
        w.lineUp(a0 === 'wait');
        let waited = 0;
        if (a0 !== 'wait') return;
        await new Promise<void>((resolve) => w.addTask({ step: (dt) => w.inLine || (waited += dt) > 3, resolve }));
        // In line, they look the way the leader does, as they did before falling in, not up or down with their last step.
        if (isSide(w.leader.facing)) for (const a of w.party.slice(1)) a.facing = w.leader.facing;
        return;
      }
      case 'step_clear': {
        const o = w?.object(a0!);
        if (o) w!.stepClearAbove(o, (a1 ?? 'right') as 'left' | 'right' | 'up' | 'down');
        return;
      }
      case 'formation': {
        if (!w) return;
        const dir = (a0 as Dir) ?? w.leader.facing;
        w.following = false;
        // [formation dir at point] forms up at a map point: each member walks there along a path, all together,
        // straight to their own place, rather than the party first bunching on the point.
        const o = a1 === 'at' ? w.object(a2!) : undefined;
        const spots = formationSpots(w, o ? o.x + o.w / 2 : w.leader.x, o ? o.y + o.h / 2 : w.leader.y, dir, wideBattle(g.layout.panel));
        for (const a of w.party) this.faced.at(-1)?.add(a);
        await Promise.all(w.party.map((a, i) => (o ? w.walk(a, spots[i]![0], spots[i]![1]) : w.walkStraight(a, spots[i]![0], spots[i]![1], 150))
          .then(() => (a.facing = dir))));
        return;
      }
      case 'camera': {
        if (!w) return;
        if (a0 === 'party' || a0 === 'leader') w.releaseFightCamera(a0 === 'party');
        else if (a0 === 'everyone') w.cameraTarget = w.everyone;
        else {
          const a = w.actor(a0!);
          const o = w.object(a0!);
          w.cameraTarget = a ?? (o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : null);
        }
        return;
      }
      case 'shake':
        if (w) w.shakeTime = Number(a0 ?? 0.4);
        return;
      case 'flag':
        g.state.flags[a0!] = a1 !== 'off';
        return;
      case 'give':
        g.state.items[a0!] = (g.state.items[a0!] ?? 0) + Number(a1 ?? 1);
        return;
      case 'dots':
        g.state.dots = Math.max(0, g.state.dots + Number(a0));
        return;
      case 'heal':
        void g.rest();
        return;
      case 'rest':
        await g.rest({ show: true });
        return;
      case 'save':
        g.saveNow();
        return;
      case 'battle': {
        if (!w) return;
        const enemies = w.enemies.filter((e) => String(e.obj?.props.encounter) === a0);
        for (const e of enemies) w.reveal(e.id);
        const outcome = await g.startBattle(a0!, enemies);
        if (outcome === 'won' && g.world === w) w.defeatEncounter(a0!);
        return;
      }
      case 'warp':
        await g.changeMap(a0!, a1!);
        return;
      case 'reveal':
        w?.reveal(a0!);
        return;
      case 'drop': {
        if (!w) return;
        const key = `${w.map.id}:${a0}`;
        // A gift's introduction belongs to its first toss, including when collected later.
        if (a2 && !g.state.revealed.includes(key) && !g.state.taken.includes(key)) await this.run(a2);
        await w.drop(a0!, a1!);
        return;
      }
      case 'hide':
        w?.hide(a0!);
        return;
      case 'explode':
        if (w) await w.explode(a0!, () => this.skipping, a1);
        return;
      case 'warning_shot':
        if (w) await w.warningShot(a0!, () => this.skipping);
        return;
      case 'achieve':
        g.noteProgress?.((p) => noteUnnuked(p, g.state.flags));
        return;
      case 'sound':
        g.audio.play(a0!);
        return;
      case 'music':
        if (a0 === 'ending' && g.audio.currentMusic === 'berlin') {
          g.audio.music(a0, ENDING_MUSIC_TIMING);
          // As the ending music comes in, the view slowly narrows back to the arcade's (the owner, 2026-10-19).
          g.narrowForEnding(ENDING_MUSIC_TIMING.startAfter);
        } else g.audio.music(a0 === 'stop' ? null : a0!);
        return;
      case 'frontpage':
        await g.showFrontPage(a0!);
        return;
      case 'shop':
        await g.openShop(a0);
        return;
      case 'run':
        if (requirementsMet(g.state, a1)) await this.run(a0!);
        return;
      case 'kuji_kiri': {
        // [kuji_kiri pupil teacher teacher pile_point after_scene]: the ninjas' lesson (src/world/kujiKiri.ts), and the scene
        // once they have gone, before the pupil takes what they left.
        const [pupil, first, second, o] = [w?.actor(a0!), w?.actor(a1!), w?.actor(a2!), w?.object(a3!)];
        if (!w || !pupil || !first || !second || !o) return;
        const after = c.args[4];
        await kujiKiri(g, w, { pupil, teachers: [first, second], pile: { x: o.x + o.w / 2, y: o.y + o.h / 2 } }, () => this.skipping,
          after ? () => this.run(after) : undefined);
        return;
      }
      case 'ask':
        // [ask "Question?" yes_scene no_scene]: the yes/no card, then the scene for the answer, if any.
        if (await g.ask(a0!)) { if (a1) await this.run(a1); }
        else if (a2) await this.run(a2);
        return;
      case 'picture': {
        // A nested epilogue keeps the closing scene's celebrants until the first picture covers the map.
        // Capture their owning sets so a late callback cannot stop a later scene's celebration.
        const celebrants = [...this.celebrants];
        await g.showPicture(a0!, () => this.stopCelebrating(celebrants));
        return;
      }
      case 'fin':
        await g.fin();
        return;
      case 'arcade':
        await g.returnToArcade({ wait: false });
        return;
      case 'sunlight':
        w?.sunlight();
        return;
      case 'credits':
        await g.creditsGround();
        return;
      case 'title':
        g.toTitle();
        return;
      default:
        console.warn(`Unknown command [${c.name}] at ${c.file}:${c.line}`);
    }
  }
}
