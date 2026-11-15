import { hundredList, noteWin } from '../game/achievements.ts';
import { hiddenArea, nearestClearPosition } from './clearance.ts';
import { trillionsInWords } from '../game/bigNumbers.ts';
import { frameBackdropBelow } from '../world/framing.ts';
import { LOOK } from '../render/look.ts';
import { motion } from '../render/motion.ts';
import { dirFromVector, dirVector } from '../art/geom.ts';
import { wholeBox } from '../art/lookArt.ts';
import { GHOST_TINTS } from '../art/ghostTints.ts';
import { foilClock } from '../art/ghostFoil.ts';
import type { LookId } from '../art/characters.ts';
import type { EnemyData, SpecialData } from '../content/schemas.ts';
import { TILE } from '../content/terrain.ts';
import { shortPhoneFight, thumbReach } from '../engine/layout.ts';
import type { BattleOutcome, GameContext } from '../game/context.ts';
import { canHelp } from '../game/items.ts';
import { gainXp, type MemberState } from '../game/state.ts';
import type { Actor } from '../world/actor.ts';
import { HURT_TIME } from '../world/actor.ts';
import { POP_YELLOW } from '../render/palette.ts';
import { REVIVAL_NUMBER_HEADROOM } from '../render/revival.ts';
import type { World } from '../world/world.ts';
import { BattleUi } from './battleUi.ts';
import { battleMusic } from './fightMusic.ts';
import type { VictoryLine } from './battleUi.ts';
import { TurnQueue } from './turnQueue.ts';
import { WarsawFinale } from './warsawFinale.ts';
import { battleLayout, columnLayout, FIGHTER_APART, formationBounds, freeSpot, groundFrom, wideBattle, type BattleLayout, type FighterShape } from './formation.ts';
import { attackDamage, fillRate, hits, specialDamage, type Rng } from './formula.ts';
import { BLAST_THEN_MEMBER, BLAST_TURNS_ALONE, memberSpecials, TARGET_STICKY } from './rules.ts';

export { memberSpecials };

export interface Fighter {
  side: 'party' | 'enemy';
  actor: Actor;
  name: string;
  member: MemberState | null;
  enemy: EnemyData | null;
  hp: number;
  maxHp: number;
  /** Party: remaining decision allowance, scaled to the legacy bar width. */
  bar: number;
  /** Enemy: logical recovery interval (retained for dev snapshots). */
  timer: number;
  /** Boss: seconds until its one big attack. */
  countdown: number | null;
  countdownMax: number;
  home: [number, number];
  /** An action is queued or running for this fighter. */
  busy: boolean;
  lastTarget: Fighter | null;
  /** Party: logical time at the start of its current decision. */
  readyAt: number | null;
  /** Under Revival's light, standing still for its halo to land on them. */
  reviving?: boolean;
}

export type Choice =
  | { kind: 'attack'; target: Fighter }
  | { kind: 'special'; id: string; target: Fighter | null }
  | { kind: 'item'; id: string; target: Fighter };

type Job = {
  who: Fighter;
  run: () => Promise<void>;
  /** Gives back anything reserved when the action was chosen, if it never happens. */
  refund?: () => void;
};

/** World units a second for attack dashes. */
const DASH_SPEED = 520;
/** Seconds for each of the five strokes of A-star Maneuver's star. */
const A_STAR_STROKE = 0.15;
/** Screen pixels of breathing room when an edge forces a formation inward. */
const EDGE_FIGHT_MARGIN_PX = 2;
const EDGE_FIGHT_LAYOUT_PASSES = 16;

/** Where those called for help stand from the one who called, in tiles: towards the party, and to its side. */
const HELPER_SPOTS = [[1.5, -0.75], [1.5, 0.75], [-1.5, 0]] as const;

/** The giant ghost is drawn smaller as it is hurt: this much of its full size at no Health left, about a regular ghost's. */
const BLAST_LEAST_GROW = 0.42;

/** How far a point is from the segment between two others. */
/**
 * The names a fight's enemies go by in the target list and the log: two or more of one name are lettered in order (Ghost A,
 * Ghost B); one alone, or a boss on a countdown, keeps its name.
 */
export function enemyNames(enemies: readonly { name: string; countdown?: number | null }[]): string[] {
  const seen = new Map<string, number>();
  return enemies.map((e) => {
    const n = (seen.get(e.name) ?? 0) + 1;
    seen.set(e.name, n);
    const shared = !e.countdown && enemies.filter((x) => x.name === e.name).length > 1;
    return shared ? `${e.name} ${String.fromCharCode(64 + n)}` : e.name;
  });
}

function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const k = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x0 + dx * k), py - (y0 + dy * k));
}


/**
 * A speed-based logical turn queue on the map. Decisions have a real-time limit;
 * the Warsaw Pac's separate finale fuse also charges animations and interrupts at zero.
 */
export class Battle {
  readonly game: GameContext;
  readonly world: World;
  readonly encounter: string;
  readonly fighters: Fighter[] = [];
  readonly ui: BattleUi;
  readonly rng: Rng;
  phase: 'intro' | 'active' | 'won' | 'lost' | 'fled' = 'intro';
  private queue: Job[] = [];
  private running = false;
  readonly turns = new TurnQueue<Fighter>();
  decisionLeft = 0;
  private turnCost = 0;
  private actionEpoch = 0;
  private interrupting = false;
  private bossAt: number | null = null;
  readonly finale: WarsawFinale | null;
  private finaleActor: Fighter | null = null;
  private finaleCursor = 0;
  /** Dev/test observations, also useful for a future balance simulator. */
  readonly turnLog: Array<{ name: string; event: 'start' | 'commit' | 'timeout' | 'interrupt'; time: number }> = [];

  get decisionSeconds(): number {
    const c = this.game.content;
    return c.encounters[this.encounter]?.decision_seconds ?? c.battle.decision_seconds;
  }
  /** The queue's meter and portrait warn through the final 40% of each decision. */
  get decisionUrgent(): boolean {
    return !this.finale && this.deciding && !this.ui.holdsClock && this.decisionLeft <= this.decisionSeconds * 0.4;
  }
  get currentTurn(): Fighter | null { return this.finale ? this.finaleActor : this.turns.current; }
  get bossInterrupting(): boolean { return this.interrupting; }
  get deciding(): boolean {
    const f = this.currentTurn;
    return this.phase === 'active' && !this.joiningTankBackups && !this.interrupting && !!f && f.side === 'party' && f.hp > 0 && !f.busy && (!!this.finale || this.decisionLeft > 0);
  }

  recovery(f: Fighter, cost = this.game.content.battle.costs.attack): number {
    return f.member ? cost / fillRate(this.game.content.battle, f.member.speed) : (f.enemy!.timer[0] + f.enemy!.timer[1]) / 2;
  }

  turnPreview(count = 7): Fighter[] {
    return this.turnForecast(count).map(entry => entry.who);
  }

  turnForecast(count = 7): Array<{ who: Fighter; at: number }> {
    return this.finale ? [] : this.turns.forecast(count, f => this.recovery(f, f === this.currentTurn && f.busy ? this.turnCost : undefined));
  }

  private nextFinaleActor(): Fighter | null {
    for (let i = 0; i < this.party.length; i++) {
      const f = this.party[this.finaleCursor % this.party.length]!;
      this.finaleCursor++;
      if (f.hp > 0) return this.finaleActor = f;
    }
    return null;
  }

  private finishTurn(f: Fighter): void {
    if (this.finale) this.finaleActor = null;
    else {
      this.turns.finish(this.recovery(f, this.turnCost));
      this.lineUpBlast(f);
    }
  }

  /**
   * After its turn, an enemy with a `blast` gets ready to land it right before the named member's next turn, once they have
   * had a turn since the last one and the next comes soon enough to wait for. While they are down, it goes on its own count,
   * before whichever member comes next. That member's turn is moved up to follow the blast at once, ahead of anyone due at the
   * same moment: the blast leaves everyone low, and someone must get to answer it before another enemy hits (the owner, 2026-11-01).
   */
  private lineUpBlast(f: Fighter): void {
    const blast = f.enemy?.blast;
    if (!blast || f.hp <= 0 || this.blastDue === f) return;
    const named = this.party[this.game.state.order.indexOf(blast.before)];
    const alone = !named || named.hp <= 0;
    if (alone && ++this.blastWaited < BLAST_TURNS_ALONE) return;
    if (!alone && this.blastTurns < 1) return;
    const soonest = (m: Fighter) => this.turns.dueAt(m) ?? Infinity;
    const member = alone ? [...this.livingParty()].sort((a, b) => soonest(a) - soonest(b))[0] : named;
    const at = member ? this.turns.dueAt(member) : null;
    if (!member || at === null) return;
    const wait = at - this.turns.time;
    if (wait <= 0.002 || wait > this.recovery(f) * 1.5) return;
    this.blastDue = f;
    this.blastFor = member;
    this.turns.schedule(f, wait - 0.001);
    this.turns.schedule(member, wait - 0.001 + BLAST_THEN_MEMBER);
  }

  /** The blow on everyone, under the name it shouts; the turn after it is the member it was timed for. */
  private async landBlast(f: Fighter): Promise<void> {
    const g = this.game;
    const blast = f.enemy!.blast!;
    const epoch = this.actionEpoch;
    await this.ui.cutIn(f, blast.name, () => this.actionValid(epoch));
    this.blastDue = this.blastFor = null;
    this.blastTurns = 0;
    this.blastWaited = 0;
    if (!this.actionValid(epoch)) return;
    const hit = this.livingParty();
    for (const p of hit) this.hurtMember(p, blast.damage, f);
    this.ui.message(g.msg('battle', 'enemy_hit', { actor: f.name, target: g.msg('battle', 'everyone'), amount: blast.damage }));
    for (const p of hit) if (p.hp <= 0) this.ui.message(g.msg('battle', 'knocked_out', { name: p.name }));
    this.world.shakeTime = 0.5;
    this.ui.flash(0.6, 0.3);
    g.audio.play('blast');
    this.ui.blastRings(f.actor);
    await g.delay(0.6);
  }

  /** Wall time including blocked gaps: the Warsaw finale's fuse burns every second, animations and pages included. */
  updateAbsolute(now: number): void {
    if (this.phase !== 'active') { this.bossAt = null; return; }
    const dt = this.bossAt === null ? 0 : Math.max(0, now - this.bossAt);
    this.bossAt = Math.max(this.bossAt ?? now, now);
    if (!this.finale?.timed) return;
    for (const f of this.livingEnemies()) {
      if (f.countdown === null) continue;
      f.countdown = Math.max(0, f.countdown - dt);
      if (f.countdown <= 0 && !this.interrupting) this.interruptWithBoss(f);
    }
  }

  private interruptWithBoss(boss: Fighter): void {
    this.interrupting = true;
    this.actionEpoch++;
    this.game.interruptBattle();
    const current = this.currentTurn;
    if (current) {
      this.turnLog.push({ name: current.name, event: 'interrupt', time: this.turns.time });
      current.bar = 0;
    }
    this.finaleActor = boss;
    this.turnLog.push({ name: boss.name, event: 'start', time: this.turns.time });
    this.decisionLeft = 0;
    this.ui.interrupt();
    for (const job of this.queue.splice(0)) { job.refund?.(); job.who.busy = false; }
    for (const f of this.fighters) this.stopWalk(f);
    boss.busy = true;
    void this.bossBlast(boss).finally(() => {
      boss.busy = false;
      this.interrupting = false;
      this.checkEnd();
    });
  }

  private actionValid(epoch: number): boolean { return this.phase === 'active' && this.actionEpoch === epoch; }

  private resolveOutcome: ((o: BattleOutcome) => void) | null = null;
  readonly isBoss: boolean;
  /** Laid out side to side on every screen, the party in a column (the encounter's `column`). */
  readonly column: boolean;
  private xpEarned = 0;
  partyFacing: import('../art/geom.ts').Dir = 'right';
  enemyFacing: import('../art/geom.ts').Dir = 'left';
  private dotsEarned = 0;
  /** Battle clock seconds, for tests and dev display. */
  clock = 0;
  /** Whether the fight is laid out side to side, and the point the camera frames. */
  private laidWide = false;
  private laidPhone = false;
  private laidFor = '';
  /** Starting positions keep repeated phone relayouts from drifting the fight across the map. */
  private formationOrigin: Actor[] = [];
  /** Do not retry a bounded edge layout until its homes, screen or framing constraints change. */
  private framedFor = '';
  /** How many times the fight has been laid out afresh for a turned screen, so a move under way can follow. */
  layouts = 0;
  /** Each fighter's current walk to their place; a newer one, a dash, or the fight's end stops the old. */
  private readonly walks = new Map<Fighter, number>();
  /** Set once the fight has ended, so no walk it started goes on pulling at anyone afterwards. */
  private over = false;
  private centre: [number, number] = [0, 0];
  private readonly tankBackups = new Set<Actor>();
  private tankBackupsPending = false;
  private tankBackupArrival: Promise<void> | null = null;
  /** True only while the ordinary action queue waits for the reinforcement entrance. */
  joiningTankBackups = false;
  /** The enemy whose next turn is its `blast`, for the turn strip's warning, and the member whose turn follows it. */
  blastDue: Fighter | null = null;
  private blastFor: Fighter | null = null;
  /** Turns the blast's member has had since the last blast, and the enemy's turns while that member is down. */
  private blastTurns = 0;
  private blastWaited = 0;
  /** The encounter's call for help: whether it is due, once its enemy is hurt enough, and whether it has happened. */
  private helpDue = false;
  private helpCalled = false;
  /** Who came to help, as the map's names of who left to do so. */
  private readonly helpers = new Map<Actor, string>();
  private usedSpecial = false;

  constructor(game: GameContext, world: World, encounter: string, enemyActors: Actor[], rng: Rng) {
    this.game = game;
    this.world = world;
    this.encounter = encounter;
    this.rng = rng;
    const c = game.content;
    this.isBoss = Boolean(c.encounters[encounter]?.boss);
    this.column = Boolean(c.encounters[encounter]?.column);
    const s = game.state;

    for (const [i, id] of s.order.entries()) {
      const m = s.members[id]!;
      world.party[i]!.ko = m.hp <= 0;
      this.fighters.push({
        side: 'party',
        actor: world.party[i]!,
        name: c.party.members[id]!.name,
        member: m,
        enemy: null,
        hp: m.hp,
        maxHp: m.maxHp,
        bar: 0,
        timer: 0,
        countdown: null,
        countdownMax: 0,
        home: [0, 0],
        busy: false,
        lastTarget: null,
        readyAt: null,
      });
    }
    const names = enemyNames(enemyActors.map((a) => c.enemies[String(a.obj?.props.kind)]!));
    for (const [i, a] of enemyActors.entries()) this.fighters.push(this.enemyFighter(a, names[i]!));
    // Each a little out of step with the others as they hop, waiting their turns.
    this.fighters.forEach((f, i) => { f.actor.hopPhase = (i * 0.37) % 1; });
    const finaleRules = this.isBoss && this.enemies.length === 1 ? this.enemies[0]!.enemy?.finale : null;
    this.finale = finaleRules ? new WarsawFinale(s, finaleRules) : null;
    const pelletCountdown = this.finale?.route === 'pellet' ? finaleRules?.pellet_countdown : undefined;
    if (pelletCountdown !== undefined) {
      const boss = this.enemies[0]!;
      boss.countdown = boss.countdownMax = pelletCountdown;
    }
    for (const f of this.fighters) {
      if (!this.finale && f.hp > 0) this.turns.schedule(f, this.recovery(f));
    }
    this.ui = new BattleUi(this);
  }

  /** Build every enemy, including late arrivals, with the same production combat fields. */
  private enemyFighter(actor: Actor, name: string): Fighter {
    const enemy = this.game.content.enemies[String(actor.obj?.props.kind)]!;
    return { side: 'enemy', actor, name, member: null, enemy, hp: enemy.hp, maxHp: enemy.hp,
      bar: 0, timer: enemy.countdown ? 0 : (enemy.timer[0] + enemy.timer[1]) / 2,
      countdown: enemy.countdown ?? null, countdownMax: enemy.countdown ?? 0,
      home: [actor.x, actor.y], busy: false, lastTarget: null, readyAt: null };
  }

  private createTankBackups(tank: Actor): Actor[] {
    if (this.tankBackups.size) return [];
    return [1, 2].map((i) => {
      const actor = this.world.addBattleEnemy('tank_soldier', `tank_backup_${i}`, 'tank', tank.x + (i === 1 ? -48 : 48), tank.y);
      this.tankBackups.add(actor);
      return actor;
    });
  }

  /** Tank-only production arrival, shared by combat and measurement tools. The hit's original
   * action finishes first. New soldiers receive their full 3.65 logical seconds of recovery
   * after the entrance, rather than an immediate shot or a turn during the run-in. */
  joinTankBackups(): Promise<void> {
    if (this.tankBackupArrival) return this.tankBackupArrival;
    const tank = this.enemies.find(f => f.actor.obj?.props.kind === 'tank');
    if (this.encounter !== 'tank' || this.phase !== 'active' || this.tankBackups.size ||
        !tank || (!this.tankBackupsPending && tank.hp > tank.maxHp * 0.5) || !this.livingParty().length) return Promise.resolve();
    this.tankBackupsPending = false;
    this.joiningTankBackups = true;
    this.tankBackupArrival = (async () => {
      try {
        const incoming = this.createTankBackups(tank.actor).map(actor => this.enemyFighter(actor, ''));
        this.fighters.push(...incoming);
        const names = enemyNames(this.enemies.map(f => f.enemy!));
        this.enemies.forEach((f, i) => { f.name = names[i]!; });
        incoming.forEach((f, i) => {
          f.actor.hopPhase = ((this.fighters.length - incoming.length + i) * 0.37) % 1;
          this.formationOrigin.push({ x: f.actor.x, y: f.actor.y, size: f.actor.size } as Actor);
        });
        this.applyFormation();
        this.frame();
        this.layouts++;
        this.ui.interrupt();
        this.ui.hudAway(true);
        const slides = this.fighters.map(f => incoming.includes(f) ? this.enterTankBackup(f) : this.settle(f));
        const cry = this.game.content.encounters[this.encounter]?.reinforcement_cry;
        this.game.dialogue.encounterActors = incoming.map(f => f.actor);
        try {
          await Promise.all([...slides, cry ? this.game.runScene(cry, { auto: this.game.content.battle.cry_time }) : Promise.resolve()]);
        } finally {
          this.game.dialogue.encounterActors = this.phase === 'active' ? this.enemies.map(f => f.actor) : [];
        }
        if (this.phase === 'active') {
          for (const f of incoming) if (f.hp > 0) this.turns.schedule(f, this.recovery(f));
        }
      } finally {
        this.ui.hudAway(false);
        this.joiningTankBackups = false;
      }
    })();
    return this.tankBackupArrival;
  }

  /**
   * The encounter's `calls_for_help`, at the end of the caller's first turn after it is hurt enough, so it attacks and then
   * calls (the owner, 2026-11-01): while the fight waits, one enemy picked from each of the named groups still standing leaves its place on the map. The band says who answered; once it has closed they
   * run in, from the side of the fight their groups lie on, as the caller speaks, and each takes its first turn after a full
   * recovery. With every group cleared, nobody comes.
   */
  private async callForHelp(): Promise<void> {
    const help = this.game.content.encounters[this.encounter]?.calls_for_help;
    if (!this.helpDue || !help) return;
    this.helpDue = false;
    if (this.phase !== 'active' || !this.livingParty().length) return;
    this.joiningTankBackups = true;
    try {
      const w = this.world, caller = this.enemies[0]!;
      const answers = help.groups.map((group) => {
        const standing = w.enemies.filter((e) => String(e.obj?.props.encounter) === group && !e.hidden);
        const kinds = w.map.objects.filter((o) => o.type === 'enemy' && o.props.encounter === group).map((o) => String(o.props.kind));
        return { kinds, on: standing.length > 0, from: standing.length ? standing[Math.floor(this.rng() * standing.length)]! : null };
      });
      const incoming = answers.flatMap(({ from }) => {
        if (!from) return [];
        const origin: [number, number] = [from.x, from.y];
        const kind = String(from.obj!.props.kind), name = from.obj!.name;
        w.removeEnemy(from);
        const actor = w.addBattleEnemy(kind, `${this.encounter}_help_${name}`, this.encounter, caller.actor.x, caller.actor.y);
        this.helpers.set(actor, name);
        actor.hidden = true;
        return [{ fighter: this.enemyFighter(actor, ''), origin }];
      });
      const arriving = incoming.map((i) => i.fighter);
      this.fighters.push(...arriving);
      const names = enemyNames(this.enemies.map(f => f.enemy!));
      this.enemies.forEach((f, i) => { f.name = names[i]!; });
      arriving.forEach((f, i) => {
        f.actor.hopPhase = ((this.fighters.length - arriving.length + i) * 0.37) % 1;
        this.formationOrigin.push({ x: f.actor.x, y: f.actor.y, size: f.actor.size } as Actor);
      });
      if (arriving.length) {
        this.applyFormation();
        this.frame();
        this.layouts++;
      }
      this.ui.interrupt();
      this.ui.hudAway(true);
      const epoch = this.actionEpoch;
      const settling = this.fighters.filter((f) => f.hp > 0 && !arriving.includes(f)).map((f) => this.settle(f));
      const cry = arriving.length ? help.cry : help.nobody;
      this.game.dialogue.encounterActors = [caller.actor];
      try {
        await this.ui.cutIn(caller, help.words, () => this.actionValid(epoch), answers);
        await Promise.all([...settling, ...incoming.map((i) => this.enterFrom(i.fighter, i.origin)),
          this.game.runScene(cry, { auto: this.game.content.battle.cry_time })]);
      } finally {
        this.game.dialogue.encounterActors = this.phase === 'active' ? this.enemies.map(f => f.actor) : [];
      }
      if (this.phase === 'active') for (const f of arriving) if (f.hp > 0) this.turns.schedule(f, this.recovery(f));
    } finally {
      this.ui.hudAway(false);
      this.joiningTankBackups = false;
    }
  }

  /** A run in from the edge of the fight's band that lies towards `origin`, the place on the map it left. */
  private enterFrom(f: Fighter, origin: [number, number]): Promise<void> {
    const w = this.world, band = this.ui.fightBand();
    const [x0, y0] = w.panelToWorldSettled(band.left - 24, band.top - 24);
    const [x1, y1] = w.panelToWorldSettled(band.right + 24, band.bottom + 24);
    const [hx, hy] = f.home;
    const dx = origin[0] - hx, dy = origin[1] - hy;
    const reach = Math.min(dx > 0 ? (x1 - hx) / dx : dx < 0 ? (x0 - hx) / dx : Infinity, dy > 0 ? (y1 - hy) / dy : dy < 0 ? (y0 - hy) / dy : Infinity);
    f.actor.x = hx + dx * reach;
    f.actor.y = hy + dy * reach;
    f.actor.hidden = false;
    const speed = Math.max(1, Math.hypot(f.actor.x - hx, f.actor.y - hy) / this.game.content.battle.backup_run_time);
    return w.walkStraight(f.actor, hx, hy, speed, () => !this.over && this.phase === 'active')
      .then(() => { if (!this.over) f.actor.facing = this.enemyFacing; });
  }

  /** Who got the party away (Battle.escape), once the fight is 'fled', and what they may say back on the map. */
  getaway: { by: string; quips: { items_back?: string; got_away?: string } } | null = null;

  /** The line after Try Again from this fight, if it was lost: on specials if none were used, or on those who came to help. */
  get retryLine(): string | null {
    const enc = this.game.content.encounters[this.encounter];
    if (!this.usedSpecial && enc?.retry_no_specials) return enc.retry_no_specials;
    return this.helpers.size ? enc?.retry_helpers ?? null : null;
  }

  /** Short run from the nearest side of the unobstructed fight band, at the normal final framing. */
  private enterTankBackup(f: Fighter): Promise<void> {
    const w = this.world, p = this.game.layout.panel, band = this.ui.fightBand();
    const [left] = w.panelToWorldSettled(band.left - 24, p.h / 2);
    const [right] = w.panelToWorldSettled(band.right + 24, p.h / 2);
    f.actor.x = Math.abs(f.home[0] - left) < Math.abs(f.home[0] - right) ? left : right;
    f.actor.y = f.home[1];
    f.actor.hidden = false;
    const speed = Math.max(1, Math.abs(f.actor.x - f.home[0]) / this.game.content.battle.backup_run_time);
    return w.walkStraight(f.actor, ...f.home, speed, () => !this.over && (this.phase === 'intro' || this.phase === 'active'))
      .then(() => { if (!this.over) f.actor.facing = this.enemyFacing; });
  }

  get party(): Fighter[] {
    return this.fighters.filter((f) => f.side === 'party');
  }

  get enemies(): Fighter[] {
    return this.fighters.filter((f) => f.side === 'enemy');
  }

  livingEnemies(): Fighter[] {
    return this.enemies.filter((f) => f.hp > 0);
  }

  livingParty(): Fighter[] {
    return this.party.filter((f) => f.hp > 0);
  }

  isReady(f: Fighter): boolean {
    return this.deciding && this.currentTurn === f;
  }

  readyMembers(): Fighter[] { return this.party.filter(f => this.isReady(f)); }
  get clockRunning(): boolean { return this.deciding; }
  get mode(): 'queue' | 'finale' { return this.finale ? 'finale' : 'queue'; }
  get waitingForChoice(): boolean { return this.deciding; }

  // ---------------------------------------------------------------------------------------------

  async run(keepVictoryStage = false): Promise<BattleOutcome> {
    const g = this.game;
    const w = this.world;
    const c = g.content;
    const enc = c.encounters[this.encounter];
    w.control = false;
    w.following = false;
    // Listen for the result from the start, so a fight can end even during its intro.
    const outcomePromise = new Promise<BattleOutcome>((resolve) => (this.resolveOutcome = resolve));
    g.dialogue.encounterActors = this.enemies.map((e) => e.actor);
    g.audio.play('battle_start');
    const prevMusic = g.audio.currentMusic;
    g.audio.music(battleMusic(enc));
    if (this.encounter === 'boss') g.noteProgress?.((p) => { p.warsawMet = true; });

    // The battle cry is shouted while everyone gets into position, the boss's too: Warsaw yells as he comes into
    // frame, not before (the owner, 2026-10-24: as in other fights).
    const cry = enc?.cry;

    // Form up where the party stands.
    const wide = wideBattle(g.layout.panel);
    this.formationOrigin = this.fighters.map(f => ({ x: f.actor.x, y: f.actor.y, size: f.actor.size }) as Actor);
    this.applyFormation();
    this.laidWide = wide;
    // Framed from where everyone will stand, set just above; framing before that measured the party
    // from the map's corner, so the camera headed for the middle of the map, zoomed out, until the intro ended.
    this.frame();
    const slides = [
      ...this.party.map((f) => w.walkStraight(f.actor, f.home[0], f.home[1], 260).then(() => (f.actor.facing = this.partyFacing))),
      ...this.enemies.map((f) => {
        if (this.tankBackups.has(f.actor)) return this.enterTankBackup(f);
        const entry = this.isBoss ? w.object(`${this.encounter}_entry`) : undefined;
        if (entry?.type === 'point') {
          // Berlin's tower covers the arrival point. Warsaw steps out from behind it while shouting,
          // then takes the same charge to his formation spot as the party gets into position.
          f.actor.x = entry.x;
          f.actor.y = entry.y;
          f.actor.facing = this.enemyFacing;
          // Keep the waiting pose concealed until movement begins. The cover may hide the body but leave
          // a weapon or animated edge exposed for one frame before the entrance task advances.
          f.actor.hidden = true;
        } else if (this.isBoss && this.column) {
          // A boss facing a column walks in from the right, level with where he will stand, starting past the right
          // edge both of the screen as it is and of the fight's framing, so he walks the whole way in.
          const [ex] = w.panelToWorld(g.layout.panel.w + 40, g.layout.panel.h / 2);
          f.actor.x = Math.max(ex, (w.cameraTarget?.x ?? w.camX) + (g.layout.panel.w / 2 + 60) / w.zoom);
          f.actor.y = f.home[1];
          f.actor.hidden = false;
        } else if (this.isBoss) {
          // The boss slides in from the edge of the screen.
          const [ex, ey] = w.panelToWorld(wide ? g.layout.panel.w + 40 : g.layout.panel.w / 2, wide ? g.layout.panel.h / 2 : -40);
          f.actor.x = wide ? ex : f.home[0];
          f.actor.y = wide ? f.home[1] : ey;
          f.actor.hidden = false;
        }
        // Warsaw charges in at half as fast again as he used to walk (the owner, 2026-10-24).
        let out = false;
        return w.walkStraight(f.actor, f.home[0], f.home[1], this.isBoss ? 300 : 220, entry?.type === 'point' ? () => {
          if (this.over || this.phase !== 'intro') return false;
          if (f.actor.moving) f.actor.hidden = false;
          // Bystanders scatter as he steps out, not when he arrives: in the Berlin tile sketch he comes from the guard
          // building's door down the strip, past the planners by the Wall (the owner, 30 Oct: he yelled from off-screen
          // but stepped out from the tower beside the party).
          if (f.actor.moving && !out) {
            out = true;
            w.openArrivalDoor();
            w.fleeFromArrival(this.encounter, f.actor);
          }
          return true;
        } : undefined).then(() => {
          if (entry?.type === 'point' && (this.over || this.phase !== 'intro')) return;
          if (entry?.type === 'point') f.actor.hidden = false;
          f.actor.facing = this.enemyFacing;
          if (this.isBoss && !out && !this.over && this.phase === 'intro') w.fleeFromArrival(this.encounter, f.actor);
        });
      }),
    ];
    this.ui.show();
    await Promise.all([...slides, cry ? g.runScene(cry, { auto: c.battle.cry_time }) : Promise.resolve()]);
    for (const f of this.party) f.actor.facing = this.partyFacing;
    if (this.phase === 'intro') this.phase = 'active';
    // The screen may have turned while everyone walked in.
    this.reshape();

    const outcome = await outcomePromise;
    // Actions chosen but never carried out give back what they reserved.
    for (const job of this.queue.splice(0)) job.refund?.();

    if (outcome === 'won') await this.victory();
    this.over = true;
    for (const f of this.fighters) f.actor.hopping = false;
    if (outcome === 'lost') this.ui.settleLost();
    else this.ui.destroy();
    g.dialogue.encounterActors = [];
    // Write back party HP and MP.
    for (const f of this.party) f.member!.hp = Math.max(0, f.hp);
    const stagedVictory = outcome === 'won' && keepVictoryStage;
    // A lost fight keeps its framing, and the world stays still, while the defeat page comes in and goes: every way
    // on from that page enters a map afresh or leaves for the title (the owner, 2026-10-20: the camera moving back as
    // the paper came in after the nuke was odd). An escape holds too: the map is entered afresh under its blocks.
    const hold = stagedVictory || outcome !== 'won';
    if (!hold) w.releaseFightCamera(false, outcome === 'won' ? this.encounter : undefined);
    w.control = !hold;
    if (outcome === 'won') {
      // A staged finale moves straight from these positions into its ending dialogue.
      if (!stagedVictory) w.lineUp();
      g.audio.music(prevMusic, { resume: true });
    }
    return outcome;
  }

  /**
   * Frames the fight in the part of the panel its interface leaves clear: on tall screens the
   * controls fill the bottom, so the fight sits higher up; on wide ones the status box and the
   * turn strip sit low.
   */
  private frame(): void {
    if (this.framedFor === this.framingKey()) {
      this.world.confineCamera();
      return;
    }
    // Always frame master's layout from the real starting spots, even after a
    // resize. Edge corrections never become the next layout's starting point.
    const origin = this.formationOrigin;
    this.applyFormation();
    const { scale } = this.frameTarget();
    const snapshot = () => ({
      homes: this.fighters.map(f => f.home),
      centre: this.centre, partyFacing: this.partyFacing, enemyFacing: this.enemyFacing,
    });
    const restore = (last: ReturnType<typeof snapshot>) => {
      this.fighters.forEach((f, i) => { f.home = last.homes[i]!; });
      this.centre = last.centre;
      this.partyFacing = last.partyFacing;
      this.enemyFacing = last.enemyFacing;
    };
    const originalHomes = this.fighters.map(f => f.home);
    let safe = this.fighters.every(f => !this.world.collision.blocked(...f.home)) ? snapshot() : null;
    let best = safe;
    let leastOverflow = best ? this.clearanceOverflow() : Infinity;
    // The camera and zoom stay fixed while terrain-aware layouts seek screen/UI clearance.
    for (let pass = 0; pass < EDGE_FIGHT_LAYOUT_PASSES; pass++) {
      const { dx, dy } = this.clearanceCorrection();
      if (!dx && !dy) break;
      // Move the starting spots, then let the normal layout find open ground again.
      // Moving homes directly can put feet in a wall or prop.
      this.formationOrigin = this.formationOrigin.map(a => ({ ...a, x: a.x + dx, y: a.y + dy }) as Actor);
      this.applyFormation({ centre: [this.centre[0] + dx, this.centre[1] + dy],
        party: this.party.map(f => [f.home[0] + dx, f.home[1] + dy]),
        enemies: this.enemies.map(f => [f.home[0] + dx, f.home[1] + dy]),
        partyFacing: this.partyFacing, enemyFacing: this.enemyFacing }, originalHomes);
      this.world.setFightScale(scale);
      if (this.fighters.every(f => !this.world.collision.blocked(...f.home))) {
        safe = snapshot();
        const overflow = this.clearanceOverflow();
        if (overflow < leastOverflow) { best = safe; leastOverflow = overflow; }
      }
      else if (safe) {
        restore(safe);
        break;
      }
    }
    if (best) restore(best);
    this.formationOrigin = origin;
    this.framedFor = this.framingKey();
    this.world.confineCamera();
  }

  /** Master's frame from the original layout, with the map's fight camera limits applied once. */
  private frameTarget(): { band: ReturnType<BattleUi['fightBand']>; scale: number } {
    const p = this.game.layout.panel;
    const w = this.world;
    w.fightFloor = this.ui.statusTop;
    // Tall phones retain the chosen size, except the reinforced tank group; short phones may shrink too.
    w.setFightScale(1, this.reinforced);
    const baseZoom = w.zoom;
    // The fight on screen, from the top of the tallest head (with room for the cursor) to the lowest feet, and side to side.
    const phone = thumbReach(this.game.layout);
    const bounds = formationBounds(this.fighters.map(f => f.home), this.fighterShapes(), w.ground);
    const top = phone ? bounds.top / w.ground : Math.min(...this.fighters.map((f) => f.home[1] - (f.actor.size * 2.7) / w.ground));
    const bottom = phone ? bounds.bottom / w.ground : Math.max(...this.fighters.map((f) => f.home[1])) + 8;
    const xs = this.fighters.map((f) => f.home[0]);
    const side = Math.max(...this.fighters.map((f) => f.actor.size)) * 1.5;
    const fw = (phone ? bounds.right - bounds.left : Math.max(...xs) - Math.min(...xs) + side * 2) * w.zoom;
    const fh = (bottom - top) * w.zoom * w.ground;
    // The band it fits: the first when it fits there, or else whichever it overlaps least.
    const bands = this.ui.fightBands();
    const fit = (b: { top: number; bottom: number; left: number; right: number }) => Math.min((b.right - b.left) / fw, (b.bottom - b.top) / fh);
    const band = fit(bands[0]!) >= 1 ? bands[0]! : bands.reduce((a, b) => (fit(b) > fit(a) ? b : a));
    // Desktop/tablet, short-phone fights and the reinforced tank group may shrink to fit.
    const small = shortPhoneFight(this.game.layout);
    const scale = Math.max(small && !this.reinforced ? 0.7 : 0.5, Math.min(1, fit(band) * 0.98));
    if ((!phone || small || this.reinforced) && scale < 1) w.setFightScale(scale);
    const k = w.zoom * w.ground;
    // The middle of the fight goes to the middle of the band across. Down, on a phone a fight shorter than its band stands at
    // the band's foot by the menu, its spare height above it (the owner, 2026-11-06: the space was between the fighters and
    // the menu); elsewhere it goes to the middle. A fight too big for its band overlaps both ends alike.
    const mid = (top + bottom) / 2;
    const tall = (bottom - top) * k;
    const bandMid = phone && tall < band.bottom - band.top ? band.bottom - tall / 2 : (band.top + band.bottom) / 2;
    const midX = phone ? (bounds.left + bounds.right) / 2 : (Math.min(...xs) + Math.max(...xs)) / 2;
    const bandMidX = (band.left + band.right) / 2;
    w.cameraTarget = { x: midX - (bandMidX - p.w / 2) / w.zoom, y: mid - (bandMid - p.h / 2) / k };
    const backdrop = w.map.objects.find(o => o.type === 'area' && o.props.frame_encounter === this.encounter);
    if (backdrop) w.cameraTarget.y = frameBackdropBelow(w.cameraTarget.y, bounds.top / w.ground,
      bounds.bottom / w.ground, backdrop.y + backdrop.h, p.h, band, k);
    // Fix this target before any formation correction. Do not frame moved homes.
    const [cx, cy] = w.panelToWorldSettled(p.w / 2, p.h / 2);
    w.cameraTarget = { x: cx, y: cy };
    return { band, scale: w.zoom / baseZoom };
  }

  /** Whether others have joined mid-fight, so the group may shrink to fit where a fight otherwise keeps its size. */
  private get reinforced(): boolean { return this.tankBackups.size > 0 || this.helpers.size > 0; }

  private screenBoxes() {
    const w = this.world, p = this.game.layout.panel, t = w.cameraTarget!;
    return formationBounds(this.fighters.map(f => f.home), this.fighterShapes(), w.ground).boxes.map(b => ({
      left: p.w / 2 + (b.left - t.x) * w.zoom, right: p.w / 2 + (b.right - t.x) * w.zoom,
      top: p.h / 2 + (b.top - t.y * w.ground) * w.zoom, bottom: p.h / 2 + (b.bottom - t.y * w.ground) * w.zoom,
    }));
  }

  private clearanceCorrection(): { dx: number; dy: number } {
    const w = this.world, panel = this.game.layout.panel, obstacles = this.ui.fightObstacles();
    const boxes = this.screenBoxes();
    if (hiddenArea(boxes, panel, obstacles, EDGE_FIGHT_MARGIN_PX) < 1e-6) return { dx: 0, dy: 0 };
    let best = { x: 0, y: 0 }, distance = Infinity;
    for (const b of boxes) {
      if (hiddenArea([b], panel, obstacles, EDGE_FIGHT_MARGIN_PX) < 1e-6) continue;
      const move = nearestClearPosition(b, panel, obstacles, w.ground, EDGE_FIGHT_MARGIN_PX);
      if (move && move.distance < distance) {
        // A corner can need two cardinal steps. Take the shorter component first;
        // the terrain placement also checks all UI rectangles on this pass.
        const horizontal = !move.y || (move.x !== 0 && Math.abs(move.x) <= Math.abs(move.y / w.ground));
        best = horizontal ? { x: move.x, y: 0 } : { x: 0, y: move.y };
        distance = move.distance;
      }
    }
    return { dx: best.x / w.zoom, dy: best.y / (w.zoom * w.ground) };
  }

  private clearanceOverflow(): number {
    return hiddenArea(this.screenBoxes(), this.game.layout.panel, this.ui.fightObstacles(), EDGE_FIGHT_MARGIN_PX);
  }

  private formationKey(): string {
    const p = this.game.layout.panel;
    return `${p.w}x${p.h}@${this.game.layout.unit}`;
  }

  private framingKey(): string {
    return JSON.stringify([this.formationKey(), this.world.ground, this.ui.fightBands(), this.ui.fightObstacles(),
      this.fighterShapes(), this.fighters.map(f => f.home)]);
  }

  private fighterShapes(): FighterShape[] {
    return this.fighters.map(({ actor: a }) => {
      const art = wholeBox(a.look, a.size);
      const above = Math.max(a.size * 2.7, (art?.depth ?? 0) + a.size * 0.7);
      // Reinforcements arrive as the tank starts smoking: reserve that visible headroom too.
      return { halfW: Math.max(a.size * 1.5, art?.halfW ?? 0),
        above: this.tankBackups.size && a.look === 'tank' ? above * 1.35 : above, below: 8 * this.world.ground };
    });
  }

  /** Keep escorts close to the tank, toward the party, and visible through terrain/menu corrections. */
  private backupArtClear(index: number, x: number, y: number, spots: Array<[number, number] | undefined>, shapes: FighterShape[]): boolean {
    if (!this.tankBackups.has(this.fighters[index]!.actor)) return true;
    const tankIndex = this.fighters.findIndex(f => f.actor.look === 'tank');
    const tank = spots[tankIndex];
    const party = spots.slice(0, this.party.length).filter((p): p is [number, number] => !!p);
    if (tank && party.length) {
      const nearest = Math.min(...party.map(p => Math.hypot(p[0] - tank[0], p[1] - tank[1])));
      if (Math.hypot(x - tank[0], y - tank[1]) > nearest + 1e-6) return false;
      const dx = party.reduce((sum, p) => sum + p[0] - tank[0], 0);
      const dy = party.reduce((sum, p) => sum + p[1] - tank[1], 0);
      if ((x - tank[0]) * dx + (y - tank[1]) * dy <= 0) return false;
    }
    const shape = shapes[index]!, ground = this.world.ground;
    const box = { left: x - shape.halfW, right: x + shape.halfW,
      top: y * ground - shape.above, bottom: y * ground + shape.below };
    // Townspeople remain in the square during the fight; escorts must not cover them either.
    if (this.world.npcs.some(a => {
      if (a.hidden) return false;
      const art = wholeBox(a.look, a.size), halfW = Math.max(a.size * 1.5, art?.halfW ?? 0);
      const above = Math.max(a.size * 2.7, (art?.depth ?? 0) + a.size * 0.7);
      return box.right + 4 > a.x - halfW && box.left < a.x + halfW + 4
        && box.bottom + 4 > a.y * ground - above && box.top < (a.y + 8) * ground + 4;
    })) return false;
    return this.fighters.every((other, i) => {
      const spot = spots[i];
      if (!spot || i === index) return true;
      // A soldier in front may overlap the hull, but must sort above the tank, never behind its picture.
      if (other.actor.look === 'tank' && y >= spot[1] + 12) return true;
      const otherShape = shapes[i]!;
      return box.right + 4 <= spot[0] - otherShape.halfW || box.left >= spot[0] + otherShape.halfW + 4
        || box.bottom + 4 <= spot[1] * ground - otherShape.above || box.top >= spot[1] * ground + otherShape.below + 4;
    });
  }

  private arrange(starting?: BattleLayout, originalHomes?: Array<[number, number]>) {
    const w = this.world;
    // A column (the Warsaw Pac's fight, sideways on every screen for his rifle) moves whole. Placed member by member
    // to clear the menus, a small phone's column came apart: one member 36 px out of line, two 2 px apart (the full
    // e2e, 2026-10-21). The framing pass checks the moved homes for walls and keeps the last clear place.
    if (starting && this.column) return starting;
    if (starting) {
      // Keep the formation master already made at the wall. Rebuilding its ideal
      // triangle here would reopen the gap that terrain compressed at the edge.
      const shapes = this.fighterShapes(), target = w.cameraTarget!, panel = this.game.layout.panel;
      const obstacles = this.ui.fightObstacles();
      const placed: Array<[number, number] | undefined> = [];
      const apart = (i: number) => (x: number, y: number) => this.backupArtClear(i, x, y, placed, shapes);
      const screenBox = (i: number, x: number, y: number) => {
        const shape = shapes[i]!;
        return {
          left: panel.w / 2 + (x - shape.halfW - target.x) * w.zoom,
          right: panel.w / 2 + (x + shape.halfW - target.x) * w.zoom,
          top: panel.h / 2 + (y * w.ground - shape.above - target.y * w.ground) * w.zoom,
          bottom: panel.h / 2 + (y * w.ground + shape.below - target.y * w.ground) * w.zoom,
        };
      };
      const allowed = (i: number) => (x: number, y: number) =>
        hiddenArea([screenBox(i, x, y)], panel, obstacles, EDGE_FIGHT_MARGIN_PX) < 1e-6 && apart(i)(x, y);
      const place = (i: number, p: [number, number], ground: ReturnType<typeof groundFrom>) => {
        const clear = allowed(i), original = originalHomes?.[i];
        const remember = (spot: [number, number]) => (placed[i] = spot);
        const count = ground.taken.length;
        // Open, on the fight's own ground and as far from the others as any layout keeps them (freeSpot's best
        // level): its fallbacks would stand fighters on top of each other, which is worse than under a menu.
        const spaced = (spot: [number, number]) => !w.collision.blocked(...spot) && ground.ok(...spot)
          && ground.taken.slice(0, count).every(([x, y]) => Math.hypot(x - spot[0], y - spot[1]) >= FIGHTER_APART);
        const attempt = (spot: [number, number], ok: boolean) => {
          if (ok && spaced(spot)) return true;
          ground.taken.splice(count);
          return false;
        };
        if (original) {
          // Terrain can send an otherwise small correction much farther away.
          // Prefer a local open spot before accepting that unrestricted fallback.
          const local = (x: number, y: number) => clear(x, y) && Math.hypot(x - original[0], y - original[1]) <= TILE * 2;
          const spot = freeSpot(w, ...p, ground, local);
          if (attempt(spot, local(...spot))) return remember(spot);
        }
        // A genuine short-landscape conflict can put the nearest clear rectangle
        // beyond freeSpot's radial search. Aim there before searching its open ground.
        const nearest = nearestClearPosition(screenBox(i, ...p), panel, obstacles, w.ground, EDGE_FIGHT_MARGIN_PX);
        const desired: [number, number] = nearest
          ? [p[0] + nearest.x / w.zoom, p[1] + nearest.y / (w.zoom * w.ground)] : p;
        const spot = freeSpot(w, ...desired, ground, clear);
        if (attempt(spot, clear(...spot))) return remember(spot);
        // No spaced spot clears the menus: the layout's own spot, as before edge fights.
        return remember(freeSpot(w, ...p, ground, apart(i)));
      };
      // The fight's ground is what the party can reach from where it really stands, not from the moved start.
      const start = groundFrom(w, ...(originalHomes?.[0] ?? [this.formationOrigin[0]!.x, this.formationOrigin[0]!.y]));
      const lead = place(0, starting.party[0]!, start);
      const ground = groundFrom(w, ...lead);
      ground.taken.push(lead);
      return { ...starting, party: [lead, ...starting.party.slice(1).map((p, i) => place(i + 1, p, ground))],
        enemies: starting.enemies.map((p, i) => place(this.party.length + i, p, ground)) };
    }
    const phone = thumbReach(this.game.layout);
    w.setFightScale(1);
    const band = this.ui.fightBand();
    const room = phone ? { w: (band.right - band.left) / w.zoom - 4, h: (band.bottom - band.top) / w.zoom - 2, shapes: this.fighterShapes(), shrinks: shortPhoneFight(this.game.layout) } : undefined;
    const actors = this.formationOrigin;
    this.laidPhone = phone;
    this.laidFor = this.formationKey();
    const party = actors.slice(0, this.party.length);
    const enemies = actors.slice(this.party.length);
    if (this.column) return columnLayout(w, party, enemies, room);
    // The tank blocks the north end of its square. Swapping sides would send the
    // party walking through it during the approach, particularly on phones.
    const lay = battleLayout(w, party, this.helpers.size ? enemies.slice(0, 1) : enemies, wideBattle(this.game.layout.panel), room, this.encounter === 'tank' ? 'up' : undefined);
    if (this.helpers.size) {
      // Those who came stand close round the one who called, two in front of it and one behind, where the corridor holds them.
      const [cx, cy] = lay.enemies[0]!;
      const [fx, fy] = dirVector(lay.enemyFacing);
      const [sx, sy] = [-fy, fx];
      const ground = groundFrom(w, ...lay.party[0]!);
      ground.taken.push(...lay.party, lay.enemies[0]!);
      enemies.slice(1).forEach((_, i) => {
        const [along, across] = HELPER_SPOTS[i % HELPER_SPOTS.length]!;
        lay.enemies[i + 1] = freeSpot(w, cx + (fx * along + sx * across) * TILE, cy + (fy * along + sy * across) * TILE, ground);
      });
    }
    if (this.tankBackups.size) {
      // Escort the tank's front instead of sending soldiers beyond its smoke into a separate row.
      const tankIndex = this.enemies.findIndex(f => f.actor.obj?.props.kind === 'tank');
      let [tx, ty] = lay.enemies[tankIndex]!;
      const wide = lay.enemyFacing === 'left' || lay.enemyFacing === 'right';
      if (!wide) {
        // Compact phones can leave only forty units between the hull and the party.
        // Make room for the escort before framing the whole group into its clear band.
        const ground = groundFrom(w, ...lay.party[0]!);
        ground.taken.push(...lay.party);
        const front = Math.min(...lay.party.map(p => p[1]));
        if (front - ty < 88) [tx, ty] = lay.enemies[tankIndex] = freeSpot(w, tx, front - 88, ground);
      }
      const shapes = this.fighterShapes();
      const tankShape = shapes[this.party.length + tankIndex]!;
      const ground = groundFrom(w, ...lay.party[0]!);
      ground.taken.push(...lay.party, lay.enemies[tankIndex]!);
      const placed: Array<[number, number] | undefined> = [...lay.party];
      placed[this.party.length + tankIndex] = lay.enemies[tankIndex];
      let i = 0;
      for (const [n, f] of this.enemies.entries()) {
        if (!this.tankBackups.has(f.actor)) continue;
        const shape = shapes[this.party.length + n]!;
        const index = this.party.length + n;
        const flank = i++ ? 1 : -1;
        const x = wide ? tx + (lay.enemyFacing === 'left' ? -1 : 1) * (tankShape.halfW + shape.halfW + 6) : tx + flank * 28;
        const y = ty + (wide ? flank * 24 / w.ground : 44);
        lay.enemies[n] = freeSpot(w, x, y, ground,
          (x, y) => this.backupArtClear(index, x, y, placed, shapes));
        placed[index] = lay.enemies[n];
      }
    }
    return lay;
  }

  private applyFormation(starting?: BattleLayout, originalHomes?: Array<[number, number]>): void {
    this.framedFor = '';
    const lay = this.arrange(starting, originalHomes);
    this.centre = lay.centre;
    this.partyFacing = lay.partyFacing;
    this.enemyFacing = lay.enemyFacing;
    this.party.forEach((f, i) => (f.home = lay.party[i]!));
    this.enemies.forEach((f, i) => (f.home = lay.enemies[i]!));
  }


  /**
   * After the screen turns mid-fight: the two sides line up again along the new long side, and
   * the camera frames them afresh, so no one ends up under the messages or off the panel.
   */
  reshape(): void {
    if (!this.formationOrigin.length || !this.world.cameraTarget) return;
    // During the intro everyone is still walking to their places: only the camera follows the new screen, as it did
    // before edge fights. The reshape as the fight gets under way (run) lays them out again for it, once the walks
    // are done; walks begun now would race theirs.
    if (this.phase === 'intro') {
      this.frameTarget();
      this.world.confineCamera();
      return;
    }
    const wide = wideBattle(this.game.layout.panel);
    let changed = false;
    if ((wide !== this.laidWide || ((this.laidPhone || thumbReach(this.game.layout)) && this.laidFor !== this.formationKey())) && this.phase === 'active') {
      this.applyFormation();
      this.laidWide = wide;
      this.layouts++;
      changed = true;
    }
    const homes = this.fighters.map(f => f.home);
    this.frame();
    if (changed || this.fighters.some((f, i) => f.home[0] !== homes[i]![0] || f.home[1] !== homes[i]![1])) {
      // An A-star under way draws its star again round the new places.
      if (!changed) this.layouts++;
      for (const f of this.fighters) void this.settle(f);
    }
  }

  /**
   * Walks a fighter to their place, if they are not there, stopping any earlier walk of theirs.
   * Someone in the middle of an action is left alone (`force` is for an action's own walk
   * back); they are settled when it ends. Figures already defeated are simply moved.
   */
  private settle(f: Fighter, speed = 260, force = false): Promise<void> {
    const token = (this.walks.get(f) ?? 0) + 1;
    this.walks.set(f, token);
    const a = f.actor;
    const [hx, hy] = f.home;
    if (this.over || (f.busy && !force)) return Promise.resolve();
    if (a.hidden) {
      a.x = hx;
      a.y = hy;
      return Promise.resolve();
    }
    const facing = f.side === 'party' ? this.partyFacing : this.enemyFacing;
    if (a.x === hx && a.y === hy) {
      a.facing = facing;
      return Promise.resolve();
    }
    const current = () => this.walks.get(f) === token && !this.over;
    return this.world.walkStraight(a, hx, hy, speed, current).then(() => {
      if (current() && a.x === hx && a.y === hy) a.facing = facing;
    });
  }

  /** Stops any walk a fighter has to their place, before an action moves them. */
  private stopWalk(f: Fighter): void {
    this.walks.set(f, (this.walks.get(f) ?? 0) + 1);
  }

  update(dt: number): void {
    for (const e of this.enemies) e.actor.damage = e.maxHp > 0 ? Math.max(0, 1 - e.hp / e.maxHp) : 0;
    this.drawBlasters(dt);
    if (this.phase === 'active') {
      if (this.tankBackupsPending && !this.running && !this.queue.length && !this.joiningTankBackups) void this.joinTankBackups();
      if (this.joiningTankBackups) { this.ui.update(dt); return; }
      this.clock += dt;
      // Deadline wins over an input arriving on the same simulation step. The clock waits while the member looks
      // through the Item or Special list, so reading it costs no time.
      if (this.deciding && !this.finale && !this.ui.holdsClock) {
        this.decisionLeft = Math.max(0, this.decisionLeft - dt);
        const f = this.currentTurn!;
        f.bar = this.game.content.battle.bar * this.decisionLeft / this.decisionSeconds;
        if (this.decisionLeft <= 1e-8) {
          this.turnLog.push({ name: f.name, event: 'timeout', time: this.turns.time });
          f.bar = 0;
          this.ui.interrupt();
          // Do not apply the expiring turn's keypress to its successor.
          this.game.input.consume();
          const target = this.timeoutTarget(f);
          if (target) {
            this.ui.timeoutAction(f);
            this.commitChoice(f, { kind: 'attack', target });
          } else {
            this.finishTurn(f);
            this.checkEnd();
          }
        }
      }
      if (!this.running && !this.interrupting && !this.currentTurn && !this.queue.length) {
        this.checkEnd();
        if (this.phase === 'active') {
          const f = this.finale ? this.nextFinaleActor() : this.turns.next();
          if (f) {
            this.turnCost = this.game.content.battle.costs.attack;
            if (f.side === 'party') {
              this.turnLog.push({ name: f.name, event: 'start', time: this.turns.time });
              const blast = this.enemies[0]?.enemy?.blast;
              if (blast && f === this.party[this.game.state.order.indexOf(blast.before)]) this.blastTurns++;
              this.decisionLeft = this.finale ? 0 : this.decisionSeconds;
              f.bar = this.finale ? 0 : this.game.content.battle.bar;
              f.readyAt = this.turns.time;
            } else {
              this.turnLog.push({ name: f.name, event: 'start', time: this.turns.time });
              f.busy = true;
              f.actor.hopping = false;
              // The member it was timed for has fallen: no one is there to answer it, so it hits as usual.
              if (this.blastDue === f && this.blastFor && this.blastFor.hp <= 0) this.blastDue = this.blastFor = null;
              this.enqueue({ who: f, run: () => this.blastDue === f ? this.landBlast(f) : this.enemyAttack(f) });
            }
          }
        }
      }
      this.fireAtWill(dt);
    }
    // The balls hop on the spot while they wait (Actor.render draws it, for those that roll: not ghosts, the tank or
    // the Warsaw Pac); whoever is acting, down or being revived stands still, and so does everyone once it is decided.
    for (const f of this.fighters) f.actor.hopping = this.phase === 'active' && !f.busy && f.hp > 0 && !f.reviving;
    this.ui.update(dt);
    if (!this.running && !this.interrupting && this.queue.length) void this.pump();
  }

  /** An enemy with a `blast` shrinks towards a regular ghost's size as it is hurt, and swells and shrinks while one is coming. */
  private drawBlasters(dt: number): void {
    for (const e of this.enemies) {
      if (!e.enemy?.blast) continue;
      const want = BLAST_LEAST_GROW + (1 - BLAST_LEAST_GROW) * Math.max(0, e.hp / e.maxHp);
      this.blasterGrow = motion.reduced ? want : this.blasterGrow + (want - this.blasterGrow) * Math.min(1, dt * 6);
      e.actor.grow = this.blasterGrow * (this.blastDue === e && !motion.reduced ? 1 + 0.07 * Math.sin(this.clock * 14) : 1);
      // A foil giant shimmers harder and glitters more as its blast comes, and settles after.
      if (GHOST_TINTS[e.actor.look as LookId]?.foil) {
        this.foilCharge += ((this.blastDue === e ? 1 : 0) - this.foilCharge) * Math.min(1, dt * 4);
        foilClock.charge = this.foilCharge;
        foilClock.chargeAt = foilClock.t;
      }
    }
  }
  private blasterGrow = 1;
  private foilCharge = 0;

  /** Seconds to the Warsaw Pac's next burst, and how many it has fired (the look's `rifle`). */
  private burstIn = 1.2;
  private bursts = 0;

  /**
   * The look's `rifle`: while the clock runs, the Warsaw Pac fires its rifle in bursts every second or two that
   * never hit, kicking up the ground beside the party (the owner's video notes). Only looks: no HP changes, the clock
   * is not held, and the fight's own random numbers are not drawn on, so a fixed seed plays the same.
   */
  private fireAtWill(dt: number): void {
    if (!LOOK.has('rifle')) return;
    const boss = this.livingEnemies().find((e) => e.actor.look === 'boss' && !e.busy);
    if (!boss) return;
    this.burstIn -= dt;
    if (this.burstIn > 0) return;
    this.bursts++;
    this.burstIn = 1.1 + ((this.bursts * 0.618034) % 1) * 0.9;
    this.game.audio.play('burst');
    void this.ui.rifleBurst(boss.actor, this.livingParty().map((p) => p.actor), { rounds: 5, hit: false, seed: this.bursts * 7919 });
  }

  // ---------------------------------------------------------------------------------------------
  // Actions

  /** Called by the interface when the player picks a command for a ready member. */
  choose(who: Fighter, choice: Choice): void {
    if (!this.isReady(who)) return;
    this.commitChoice(who, choice);
  }

  /** A remembered Attack target, or the least current Health; only ties draw from combat RNG. */
  private timeoutTarget(who: Fighter): Fighter | null {
    const alive = this.livingEnemies();
    if (who.lastTarget && alive.includes(who.lastTarget)) return who.lastTarget;
    if (!alive.length) return null;
    const least = Math.min(...alive.map(f => f.hp));
    const tied = alive.filter(f => f.hp === least);
    return tied.length === 1 ? tied[0]! : tied[Math.floor(this.rng() * tied.length)]!;
  }

  /** Shared bookkeeping and action job for both a chosen move and an expiring decision's Attack. */
  private commitChoice(who: Fighter, choice: Choice): void {
    const c = this.game.content;
    if (choice.kind === 'attack' && (!this.enemies.includes(choice.target) || choice.target.hp <= 0)) return;
    if (choice.kind === 'special' && (!this.specialsOf(who).includes(choice.id) || who.member!.mp < c.specials[choice.id]!.mp)) return;
    if (choice.kind === 'item' && (!(this.game.state.items[choice.id]! > 0) || !this.party.includes(choice.target) ||
      !c.items[choice.id] || !canHelp(c.items[choice.id]!, { hp: choice.target.hp, maxHp: choice.target.maxHp, mp: choice.target.member!.mp, maxMp: choice.target.member!.maxMp }))) return;
    let cost = c.battle.costs.attack;
    if (choice.kind === 'item') cost = c.battle.costs.item;
    if (choice.kind === 'special') cost = c.specials[choice.id]!.cost;
    this.turnLog.push({ name: who.name, event: 'commit', time: this.turns.time });
    if (choice.kind !== 'item' && choice.target) who.lastTarget = choice.target;
    this.turnCost = cost;
    this.decisionLeft = 0;
    who.bar = 0;
    who.busy = true;
    // Stops hopping on this frame, not the next step's, so the action starts from the ground.
    who.actor.hopping = false;
    who.readyAt = null;
    // An item is taken from the bag when chosen, so two members cannot both pick the last one.
    let refund: (() => void) | undefined;
    if (choice.kind === 'item') {
      const items = this.game.state.items;
      items[choice.id] = (items[choice.id] ?? 0) - 1;
      let refunded = false;
      refund = () => {
        if (refunded) return;
        refunded = true;
        items[choice.id] = (items[choice.id] ?? 0) + 1;
      };
    }
    this.enqueue({
      who,
      run: async () => {
        if (who.hp <= 0) {
          refund?.();
          return;
        }
        if (choice.kind === 'attack') await this.partyAttack(who, choice.target);
        else if (choice.kind === 'special') await this.special(who, choice.id);
        else await this.useItem(who, choice.id, choice.target, refund!);
      },
      ...(refund ? { refund } : {}),
    });
  }

  private enqueue(job: Job): void {
    this.queue.push(job);
  }

  private async pump(): Promise<void> {
    this.running = true;
    while (this.queue.length && this.phase === 'active') {
      const job = this.queue.shift()!;
      const epoch = this.actionEpoch;
      try {
        await job.run();
      } catch (err) {
        console.error(`Battle action by ${job.who.name} failed:`, err);
      } finally {
        job.who.busy = false;
      }
      // If the screen turned during the action, the fighter's place has moved: unless a walk back is
      // already under way (after an attack), they walk to it now.
      const who = job.who;
      if (this.actionValid(epoch) && this.tankBackupsPending) await this.joinTankBackups();
      if (this.actionValid(epoch) && this.helpDue && who === this.enemies[0]) await this.callForHelp();
      if (this.actionValid(epoch) && who.hp > 0 && !who.actor.scripted && (who.actor.x !== who.home[0] || who.actor.y !== who.home[1])) void this.settle(who);
      if (this.actionValid(epoch) && this.currentTurn === who) {
        this.finishTurn(who);
      }
      if (!this.interrupting) this.checkEnd();
    }
    this.running = false;
  }

  private checkEnd(): void {
    if (this.phase !== 'active') return;
    // The pages close where the fight is decided, as the Warsaw fuse's do: a Pause opened on that very step stayed up over the
    // victory box or the defeat page (Fable review P14, 2026-11-09).
    if (!this.livingEnemies().length && !this.tankBackupsPending && !this.joiningTankBackups) {
      this.phase = 'won';
      this.game.interruptBattle();
      this.resolveOutcome?.('won');
    } else if (!this.livingParty().length) {
      this.phase = 'lost';
      this.game.interruptBattle();
      this.resolveOutcome?.('lost');
    }
  }

  /** The pellet speeds up offense; unboosted regular finale attacks feel labored. */
  private attackRate(f: Fighter, regular = false): number {
    if (f.side !== 'party') return 1;
    if (this.game.state.taken.includes('field:speed_pellet')) return 2 * 1.33;
    return this.finale && regular ? (2 / 3) * 0.8 : 1;
  }

  private async returnFromAttack(f: Fighter, epoch: number, rate: number): Promise<void> {
    if (!this.actionValid(epoch)) return;
    const lines = rate > 1 ? this.ui.speedLines(f.actor, true, () => this.actionValid(epoch)) : () => undefined;
    try {
      await this.settle(f, DASH_SPEED * 0.8 * rate, true);
    } finally {
      lines();
    }
  }

  /** Dashes at a target and returns before the next turn starts. */
  private async dash(f: Fighter, target: Fighter, onHit: () => void): Promise<void> {
    const w = this.world;
    const epoch = this.actionEpoch;
    const a = f.actor;
    const [tx, ty] = [target.actor.x, target.actor.y];
    const dx = tx - a.x;
    const dy = ty - a.y;
    const d = Math.hypot(dx, dy) || 1;
    // Stop at the same distance as drawn, whichever way the dash goes: up and down, the tilted ground is drawn shorter.
    const along = Math.hypot(dx / d, (dy / d) * w.ground) || 1;
    const stop = ((a.size * a.grow + target.actor.size * target.actor.grow) * 0.8) / along;
    a.facing = dirFromVector(dx, dy, a.facing);
    this.stopWalk(f);
    const rate = this.attackRate(f, true);
    const lines = this.ui.speedLines(a, rate > 1, () => this.actionValid(epoch));
    try {
      await w.walkStraight(a, tx - (dx / d) * stop, ty - (dy / d) * stop, DASH_SPEED * rate, () => this.actionValid(epoch));
      // The fight can be over by the time the blow arrives (the dev tools end fights at once).
      if (this.actionValid(epoch)) onHit();
    } finally {
      lines();
    }
    // Presentation finishes before the next decision begins; the boss can still cancel it.
    await this.returnFromAttack(f, epoch, rate);
  }

  private async partyAttack(f: Fighter, target: Fighter): Promise<void> {
    const g = this.game;
    if (target.hp <= 0) {
      const alive = this.livingEnemies();
      if (!alive.length) return;
      target = alive[0]!;
    }
    const m = f.member!;
    await this.dash(f, target, () => {
      const steady = this.finale || target.enemy?.steady_hits;
      if (!steady && !hits(m.accuracy, this.rng)) {
        g.audio.play('miss');
        this.ui.popup(target.actor, g.msg('battle', 'miss_word'), 'miss');
        this.ui.message(g.msg('battle', 'attack_miss', { actor: f.name }));
        return;
      }
      const dmg = steady ? Math.max(1, m.strength) : attackDamage(g.content.battle, m.strength, this.rng);
      this.damageEnemy(f, target, this.damageAgainst(target, dmg));
    });
  }

  /** One landed hit, with no extra accuracy/variance rolls. Missing specialPower means
   * ordinary Attack; only that move receives the earned pellet's boss-specific boost. */
  private damageAgainst(target: Fighter, base: number, specialPower?: number): number {
    if (base <= 0) return 0;
    const e = target.enemy;
    const power = specialPower === undefined && this.game.state.taken.includes('field:speed_pellet')
      ? e?.speed_pellet_power ?? 1 : 1;
    const armor = Math.ceil((e?.armor ?? 0) * (specialPower ?? 1));
    return Math.max(1, Math.round((base - armor) * power));
  }

  private damageEnemy(by: Fighter, target: Fighter, dmg: number, quiet = false): void {
    const g = this.game;
    if (this.phase !== 'active') return;
    const finale = target === this.enemies[0] ? this.finale : null;
    // Finale HP tracks the qualified hit challenge; popups still show the attack's ordinary strength.
    const before = target.hp;
    target.hp -= finale ? finale.damage(target.hp) : dmg;
    if (this.encounter === 'tank' && target.actor.obj?.props.kind === 'tank' && !this.tankBackups.size &&
        before > target.maxHp * 0.5 && target.hp <= target.maxHp * 0.5) this.tankBackupsPending = true;
    const help = g.content.encounters[this.encounter]?.calls_for_help;
    if (help && !this.helpCalled && target === this.enemies[0] && target.hp > 0 && target.hp <= target.maxHp * help.at) this.helpCalled = this.helpDue = true;
    finale?.landHit();
    target.actor.hurt = HURT_TIME;
    g.audio.play('hit');
    this.ui.impact(target.actor, by.actor);
    this.ui.popup(target.actor, String(dmg), 'enemy');
    if (target.hp <= 0) {
      target.hp = 0;
      this.defeat(by, target, quiet);
    } else if (!quiet) {
      this.ui.message(g.msg('battle', 'attack_hit', { actor: by.name, amount: dmg, target: target.name }));
    }
  }

  private defeat(by: Fighter, target: Fighter, quiet: boolean): void {
    const g = this.game;
    const e = target.enemy!;
    this.turns.remove(target);
    if (target === this.blastDue) this.blastDue = null;
    // Beaten before its turn came: it calls no one.
    if (target === this.enemies[0]) this.helpDue = false;
    const left = this.helpers?.get(target.actor);
    if (left) this.world.noteLeft(left);
    this.xpEarned += e.xp;
    this.dotsEarned += e.dots;
    g.audio.play('defeat');
    // A boss with words after the fight stays on its feet for them, shuddering; its scene hides it after.
    if (this.isBoss && g.content.encounters[this.encounter]?.after) target.actor.dying = true;
    // The look's `wreck`: the tank is left on the field a burning wreck, until the fight is over.
    else if (LOOK.has('wreck') && target.actor.look === 'tank') target.actor.ko = true;
    else {
      this.ui.poof(target.actor);
      target.actor.hidden = true;
    }
    // The blow that wins the fight is struck in.
    if (!this.livingEnemies().length && !this.tankBackupsPending) this.ui.finalBlow(target.actor);
    if (!quiet) {
      this.ui.message(e.xp > 0 ? g.msg('battle', 'defeat', { actor: by.name, target: target.name, xp: e.xp }) : g.msg('battle', 'defeat_no_xp', { actor: by.name, target: target.name }));
    }
  }

  /** The specials a member knows, in their list's order (memberSpecials). */
  specialsOf(f: Fighter): string[] {
    return memberSpecials(this.game.content.specials, this.game.state.flags, f.member?.id ?? '');
  }

  private async special(f: Fighter, id: string): Promise<void> {
    const g = this.game;
    const sp = g.content.specials[id]!;
    const epoch = this.actionEpoch;
    const m = f.member!;
    if (m.mp < sp.mp) {
      this.ui.message(g.msg('battle', 'not_enough_mp'));
      return;
    }
    m.mp -= sp.mp;
    this.usedSpecial = true;
    // A committed special spends MP, even if the boss interrupts its presentation.
    // Keep the name readable even when the pellet accelerates the move itself.
    await this.ui.cutIn(f, sp.shout ?? sp.name, () => this.actionValid(epoch));
    if (!this.actionValid(epoch)) return;
    if (sp.escape) await this.escape(f, sp.escape);
    else if (sp.target === 'all_enemies' && sp.power) await this.aStar(f, sp);
    else if (sp.target === 'party') await this.cherryChomp(f, sp);
  }

  /**
   * Where A-star Maneuver's star goes for the fight as it is laid out now: centred on the living enemies at their
   * places, with room for the figures, two to three and a half tiles out. Where the panel's effect area above the status
   * strip (where the camera is heading, should it still be moving to a fresh framing) has less room round them, it is
   * made smaller, but no smaller than a ring round all of them, and never moved off them: a fight by a map's edge can
   * stand its enemies at the edge of that area, in the command panel's slot, and a star moved in from there was drawn
   * away from them (the owner, 2026-10-20: "the A-Stars are not close to enemies, or they are off center from the
   * enemies"). Its five points, clockwise from the top.
   */
  starShape(): { cx: number; cy: number; r: number; points: Array<readonly [number, number]> } {
    const w = this.world;
    const homes = this.livingEnemies().map((e) => e.home);
    const cx = homes.reduce((s, h) => s + h[0], 0) / homes.length;
    const cy = homes.reduce((s, h) => s + h[1], 0) / homes.length;
    const spread = Math.max(...homes.map((h) => Math.hypot(h[0] - cx, h[1] - cy)));
    const band = this.ui.effectBand();
    const [x0, y0] = w.panelToWorldSettled(band.left, band.top);
    const [x1, y1] = w.panelToWorldSettled(band.right, band.bottom);
    const m = TILE * 0.4;
    // Room above the top point for the member drawn standing on it. Phone headroom follows
    // the body's fixed size, including the printed ground's projection.
    const headroom = thumbReach(this.game.layout) ? Math.max(...this.party.map(f => f.actor.size)) * 2.3 / w.ground : m * 2.5;
    const room = Math.min(cx - x0 - m, x1 - cx - m, cy - y0 - headroom, y1 - cy - m);
    const r = Math.max(Math.min(Math.max(TILE * 2, Math.min(TILE * 3.5, spread + TILE * 1.4)), room), spread + TILE * 0.6, TILE * 1.5);
    const points = [0, 1, 2, 3, 4].map((i): readonly [number, number] => {
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    });
    return { cx, cy, r, points };
  }

  /**
   * A-star Maneuver, played big and centred on the enemies: a ring of light opens on the ground round them, and
   * the member dashes the five strokes of a star through them in one line, each stroke lit as they go and the
   * enemies it passes flinching; on the fifth the star is whole and flares, light shoots up through every
   * enemy, the view shakes and flashes, and the damage lands. About as long as before, when the member dashed
   * into their own spot five times. They walk back to their place after.
   */
  private async aStar(f: Fighter, sp: SpecialData): Promise<void> {
    const g = this.game;
    const w = this.world;
    const epoch = this.actionEpoch;
    const a = f.actor;
    this.stopWalk(f);
    const foes = this.livingEnemies();
    if (!foes.length) {
      return;
    }
    let star = this.starShape();
    let laid = this.layouts;
    const rate = this.attackRate(f);
    const sigil = this.ui.starSigil(star.cx, star.cy, star.r, () => this.actionValid(epoch), rate);
    // The star in one line, as a pentagram is drawn: every second point, back to the first.
    const order = [0, 2, 4, 1, 3, 0];
    [a.x, a.y] = star.points[0]!;
    for (let k = 0; k < 5; k++) {
      // The screen turned and the fight was laid out afresh: the star moves to the enemies' new places, and the
      // member with it, to go on from the same point of it.
      if (this.layouts !== laid) {
        laid = this.layouts;
        star = this.starShape();
        const pts = star.points;
        sigil.move(star.cx, star.cy, star.r, order.slice(0, k).map((i, j) => [...pts[i]!, ...pts[order[j + 1]!]!] as [number, number, number, number]));
        [a.x, a.y] = star.points[order[k]!]!;
      }
      const points = star.points;
      const from = points[order[k]!]!;
      const [tx, ty] = points[order[k + 1]!]!;
      g.audio.play('a_star');
      sigil.stroke(from, a);
      const lines = rate > 1 ? this.ui.speedLines(a, true, () => this.actionValid(epoch)) : () => undefined;
      try {
        await w.walkStraight(a, tx, ty, Math.hypot(tx - from[0], ty - from[1]) / A_STAR_STROKE * rate, () => this.actionValid(epoch));
      } finally {
        lines();
      }
      // A fight given up meanwhile (Quit on the pause page) is torn down: the move stops here.
      if (!this.actionValid(epoch)) {
        sigil.end();
        return;
      }
      // Whoever the stroke passed close to flinches.
      for (const e of this.livingEnemies()) {
        if (segmentDistance(e.actor.x, e.actor.y, from[0], from[1], tx, ty) > e.actor.size * 2.4) continue;
        e.actor.hurt = HURT_TIME;
        this.ui.impact(e.actor, a);
      }
    }
    // Laid out afresh during the last stroke: the whole star moves to the enemies' new places for its flare.
    if (this.layouts !== laid) {
      star = this.starShape();
      const pts = star.points;
      sigil.move(star.cx, star.cy, star.r, order.slice(0, 5).map((i, j) => [...pts[i]!, ...pts[order[j + 1]!]!] as [number, number, number, number]));
    }
    const before = this.livingEnemies();
    sigil.flare(before.map((e) => e.actor));
    g.audio.play('a_star_flare');
    w.shakeTime = 0.3 / rate;
    this.ui.flash(0.45, 0.25 / rate);
    const base = specialDamage(f.member!.strength, sp.power!);
    const damage = before.map(e => this.damageAgainst(e, base, sp.power!));
    before.forEach((e, i) => this.damageEnemy(f, e, damage[i]!, true));
    const killed = before.filter((e) => e.hp <= 0);
    if (damage.every(amount => amount === damage[0])) {
      this.ui.message(sp.message.replace('{actor}', f.name).replace('{amount}', String(damage[0])));
    } else {
      before.forEach((e, i) => this.ui.message(g.msg('battle', 'special_hit', {
        actor: f.name, special: sp.name, target: e.name, amount: damage[i]!,
      })));
    }
    if (killed.length === 1) {
      const e = killed[0]!;
      this.ui.message(g.msg('battle', 'defeat', { actor: f.name, target: e.name, xp: e.enemy!.xp }));
    } else if (killed.length > 1) {
      this.ui.message(g.msg('battle', 'defeat_many', { actor: f.name, count: killed.length, xp: killed.reduce((s, e) => s + e.enemy!.xp, 0) }));
    }
    // Let the flare finish before returning and advancing the queue.
    await g.delay(0.15 / rate);
    await g.delay(0.2 / rate);
    await this.returnFromAttack(f, epoch, rate);
  }

  /**
   * Cherry Chomp: big shiny cherries fly in to every member, who gape at them and chomp them, and then the heal
   * rises through each of them in the save star's light, with green pluses and a bob, as the HP comes back.
   * The clock is held while the cherries fly; the light plays on as the fight goes on.
   */
  private async cherryChomp(f: Fighter, sp: SpecialData): Promise<void> {
    const g = this.game;
    const epoch = this.actionEpoch;
    g.audio.play('cherry');
    for (const p of this.livingParty()) p.actor.talking = true;
    await this.ui.cherries(this.livingParty().map((p) => p.actor), () => this.actionValid(epoch));
    if (this.actionValid(epoch)) {
      g.audio.play('heal');
      this.ui.healGlow(this.party.filter((p) => p.hp > 0 || sp.revive).map((p) => p.actor));
    }
    for (const p of this.party) {
      p.actor.talking = false;
      if (!this.actionValid(epoch)) continue;
      if (p.hp <= 0 && !sp.revive) continue;
      const target = sp.heal === 'full' ? p.maxHp : Math.min(p.maxHp, p.hp + Number(sp.heal ?? 0));
      const gain = target - p.hp;
      if (p.hp <= 0 && gain > 0) this.ui.sparkle(p.actor, POP_YELLOW);
      p.hp = target;
      p.actor.ko = false;
      if (gain > 0) this.ui.popup(p.actor, g.msg('battle', 'heal_hp', { amount: gain }), 'heal');
    }
    // A fight given up meanwhile is torn down, its messages with it.
    if (this.actionValid(epoch)) this.ui.message(sp.message.replace('{actor}', f.name));
  }

  /**
   * Ronnienomics!: the member throws a smoke bomb at the party's feet and the smoke swells over everyone. Got away: the
   * party vanishes under it, and once it has thinned enough to see there is no one there, the picture breaks into the
   * flashback's blocks while the smoke rolls on under them, the fight ends as 'fled', and the
   * game starts it again from its beginning as Retry does after a wipe, with no defeat page. Failed (one time in
   * `fails` once the party has got away with it before in the game, so a player first sees what it does (the owner,
   * 2026-11-07); and always where the encounter has `no_escape`): the smoke lifts off the party, still there, "FAILED" slams
   * across the fight to a mocking bar of mid-80s synth pop, and the member makes an excuse; the turn is spent. Drawn on the
   * fight's own seeded draws, before the smoke, so a seed plays the same every time.
   */
  private async escape(f: Fighter, how: { fails: number; excuses: string[]; quips: { items_back?: string; got_away?: string }; debt: { first: number; rise: number } }): Promise<void> {
    const g = this.game;
    const epoch = this.actionEpoch;
    const away = !g.content.encounters[this.encounter]?.no_escape && (!g.state.escapesMade || this.rng() >= how.fails);
    const party = this.party.map((p) => p.actor);
    const smoke = this.ui.smokeBomb(f.actor, party, () => this.actionValid(epoch));
    await smoke.thick;
    if (!this.actionValid(epoch)) return smoke.clear();
    if (away) {
      // Gone while the cloud is thickest, so once it has thinned enough to see through, there is no one there.
      const before = party.map((a) => a.hidden);
      for (const a of party) a.hidden = true;
      g.audio.play('smoke_vanish');
      await smoke.thin;
      const out = this.actionValid(epoch);
      if (out) await g.flashbackBlocks('out');
      if (this.actionValid(epoch)) {
        this.phase = 'fled';
        g.state.escapesMade = (g.state.escapesMade ?? 0) + 1;
        this.getaway = { by: f.actor.id, quips: how.quips };
        this.resolveOutcome?.('fled');
        return;
      }
      party.forEach((a, i) => (a.hidden = before[i]!));
      smoke.clear();
      if (out) await g.flashbackBlocks('in');
      return;
    }
    await smoke.gone;
    if (!this.actionValid(epoch)) return;
    this.ui.message(g.msg('battle', 'escape_failed'));
    // The national debt up more each time in a game: `first`, then `rise` more on top of the last each time.
    const failed = g.state.escapesFailed ?? 0;
    g.state.escapesFailed = failed + 1;
    const debt = g.msg('battle', 'escape_debt', { amount: trillionsInWords(how.debt.first * (1 + how.debt.rise) ** failed) });
    await this.ui.escapeFailed(debt, () => this.actionValid(epoch));
    if (this.actionValid(epoch)) await this.excuse(how.excuses, epoch);
  }

  /** Where the fight is in Ronnienomics!'s excuses: drawn the first time, then one after another. */
  private excuseAt = -1;

  /**
   * The member's excuse for a failed Ronnienomics!, spoken as in the fight's cries. The others no longer shake their
   * heads at it (the owner, 2026-11-07: "Those aren't very noticable, I think we can just have those not happen"). A
   * strike that cuts the move off closes the line.
   */
  private async excuse(scenes: string[], epoch: number): Promise<void> {
    const g = this.game;
    if (!scenes.length) return;
    if (this.excuseAt < 0) this.excuseAt = Math.floor(this.rng() * scenes.length);
    const scene = scenes[this.excuseAt++ % scenes.length]!;
    let talking = true;
    this.world.addTask({
      step: () => {
        if (talking && !this.actionValid(epoch)) g.dialogue.clear();
        return !talking || !this.actionValid(epoch);
      },
      resolve: () => {},
    });
    try {
      await g.runScene(scene, { auto: g.content.battle.cry_time });
    } finally {
      talking = false;
    }
  }

  /** Uses an item that choose() already took from the bag; `refund` puts it back if nothing happens. */
  private async useItem(f: Fighter, id: string, target: Fighter, refund: () => void): Promise<void> {
    const g = this.game;
    const item = g.content.items[id]!;
    const epoch = this.actionEpoch;
    await g.delay(0.25);
    // The item is kept if the fight is over, or if it would now do nothing (someone healed them first, or they went down).
    if (!this.actionValid(epoch) || !canHelp(item, { hp: target.hp, maxHp: target.maxHp, mp: target.member!.mp, maxMp: target.member!.maxMp })) {
      refund();
      return;
    }
    g.audio.play(item.revive && target.hp <= 0 ? 'revival' : 'heal');
    let revival: Promise<void> | null = null;
    if (item.hp && (target.hp > 0 || item.revive)) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + item.hp);
      // Brought back from DOWN.
      if (before <= 0 && target.hp > 0) {
        revival = this.ui.revivalGlow(target.actor, () => this.actionValid(epoch) && target.hp > 0);
        target.reviving = true;
        void Promise.resolve(revival).finally(() => { target.reviving = false; });
        if (!this.finale) this.turns.schedule(target, this.recovery(target));
      }
      target.actor.ko = false;
      this.ui.popup(target.actor, g.msg('battle', 'heal_hp', { amount: target.hp - before }), 'heal', before <= 0 ? REVIVAL_NUMBER_HEADROOM : 2);
      this.ui.message(item.message.replace('{target}', target.name).replace('{amount}', String(target.hp - before)).replace('{actor}', f.name));
    }
    if (item.mp) {
      const m = target.member!;
      const before = m.mp;
      m.mp = Math.min(m.maxMp, m.mp + item.mp);
      this.ui.popup(target.actor, g.msg('battle', 'heal_mp', { amount: m.mp - before }), 'heal');
      this.ui.message(item.message.replace('{target}', target.name).replace('{amount}', String(m.mp - before)).replace('{actor}', f.name));
    }
    // The turn waits for Revival: the next blow does not land on top of it, and the player has a moment.
    if (revival) await revival;
  }

  private pickTarget(f: Fighter): Fighter | null {
    const alive = this.livingParty();
    if (!alive.length) return null;
    // Enemies tend to keep after the same member for a few hits.
    if (f.lastTarget && f.lastTarget.hp > 0 && this.rng() < TARGET_STICKY) return f.lastTarget;
    return alive[Math.floor(this.rng() * alive.length)]!;
  }

  private async enemyAttack(f: Fighter): Promise<void> {
    const g = this.game;
    const e = f.enemy!;
    if (f.hp <= 0) return;
    const target = this.pickTarget(f);
    f.timer = this.recovery(f);
    if (!target) return;
    f.lastTarget = target;
    await this.dash(f, target, () => {
      if (!hits(e.accuracy, this.rng)) {
        g.audio.play('miss');
        this.ui.popup(target.actor, g.msg('battle', 'miss_word'), 'miss');
        this.ui.message(g.msg('battle', 'enemy_miss', { actor: f.name, target: target.name }));
        return;
      }
      this.hurtMember(target, e.attack, f);
      this.ui.message(g.msg('battle', 'enemy_hit', { actor: f.name, target: target.name, amount: e.attack }));
      if (target.hp <= 0) this.ui.message(g.msg('battle', 'knocked_out', { name: target.name }));
    });
  }

  private hurtMember(target: Fighter, amount: number, from: Fighter | null = null): void {
    const g = this.game;
    if (this.phase !== 'active') return;
    if (g.dev.god) amount = 0;
    target.hp = Math.max(0, target.hp - amount);
    target.actor.hurt = HURT_TIME;
    g.audio.play('hurt');
    this.ui.impact(target.actor, from?.actor ?? null);
    this.ui.popup(target.actor, String(amount), 'party');
    this.ui.flashCard(target);
    if (target.hp <= 0) {
      target.actor.ko = true;
      target.bar = 0;
      this.turns.remove(target);
    }
  }

  /** Zero locks the outcome immediately; the finale applies damage at the visible nuke impact. */
  private async bossBlast(f: Fighter): Promise<void> {
    const g = this.game;
    const hit = this.livingParty();
    if (this.finale) {
      const epoch = this.actionEpoch;
      await this.ui.tacticalNuke(f.actor, hit.map(p => p.actor), () => {
        for (const p of hit) this.hurtMember(p, Math.max(p.hp, f.enemy!.attack), f);
        this.ui.message(g.msg('battle', 'nuke_impact'));
      }, () => this.actionValid(epoch));
      return;
    }
    for (const p of hit) this.hurtMember(p, f.enemy!.attack, f);
    this.ui.message(g.msg('battle', 'enemy_hit', { actor: f.name, target: g.msg('battle', 'everyone'), amount: f.enemy!.attack }));
    this.world.shakeTime = 0.5;
    this.ui.flash(0.6, 0.3);
    if (LOOK.has('rifle')) {
      g.audio.play('burst');
      await Promise.all([
        this.ui.rifleBurst(f.actor, hit.map(p => p.actor), { rounds: 3 * Math.max(1, hit.length), hit: true, seed: 4099 }),
        this.ui.blownAway(f.actor, hit.map(p => p.actor)),
      ]);
    } else {
      g.audio.play('blast');
      this.ui.blastRings(f.actor);
      await g.delay(0.6);
    }
    if (this.phase !== 'active') return;
    f.countdown = f.countdownMax;
    for (const p of hit) if (p.hp > 0) await this.settle(p, DASH_SPEED, true);
  }

  // ---------------------------------------------------------------------------------------------

  private async victory(): Promise<void> {
    const g = this.game;
    const c = g.content;
    // Warsaw Pac keeps Berlin through the results and last words, until its scripted explosion.
    // Whether the party is still at level 1 is read before this fight's XP, which may itself lift it. The level 1 tank also
    // asks for the ninjas' lesson (the owner, 2026-11-11: "the player ALSO now has to have Ronnienomics").
    const atOneTrained = this.party.every((p) => p.member!.level === 1) && memberSpecials(c.specials, g.state.flags, 'ronnie').includes('ronnienomics');
    // Ghosts count toward 100% with the fight won, as patrols and bosses do; a fight lost, fled or retried counts none (the owner, 2026-11-11).
    const ghosts = this.enemies.map((e) => String(e.actor.obj?.props.kind ?? '')).filter((k) => k.startsWith('ghost'));
    g.noteProgress?.((p) => noteWin(p, hundredList(c), this.encounter, atOneTrained, ghosts));
    if (this.encounter !== 'boss') g.audio.music(null);
    g.audio.play('win');
    // Each result with its kind, so the victory box can mark XP, Dots and level gains.
    const lines: VictoryLine[] = [];
    let levelled = false;
    g.state.dots += this.dotsEarned;
    // A party victory gives everyone the same share, including members still knocked out.
    const share = Math.ceil(this.xpEarned / (this.party.length || 1));
    if (share > 0) lines.push({ kind: 'xp', text: g.msg('battle', 'xp_each', { xp: share }) });
    if (this.dotsEarned) lines.push({ kind: 'dots', text: g.msg('battle', 'dots', { dots: this.dotsEarned }) });
    const up = c.party.level_up;
    for (const p of this.party) {
      const m = p.member!;
      m.hp = Math.max(0, p.hp);
      if (share <= 0) continue;
      const levels = gainXp(c, m, share);
      if (levels > 0) {
        lines.push({ kind: 'level_up', text: g.msg('battle', 'level_up', { name: p.name }), who: p.actor.look });
        // What the levels added, from party.yaml, so the numbers are always the real ones.
        lines.push({ kind: 'level_gains', text: g.msg('battle', 'level_gains', { level: m.level, hp: up.hp * levels, mp: up.mp * levels, strength: up.strength * levels, accuracy: up.accuracy * levels, speed: up.speed * levels }) });
        levelled = true;
        // The fighter's own copies follow the level, so the member's card reads the new HP out of the new most.
        p.hp = m.hp;
        p.maxHp = m.maxHp;
      }
    }
    if (levelled) g.audio.play('level_up');
    await this.ui.victory(lines);
    // Members knocked out get up with 1 HP after a win, so they can walk, visibly hurt.
    // The fighter's HP is set too, because run() writes it back to the member afterwards.
    for (const p of this.party) {
      if (p.hp <= 0) {
        p.hp = 1;
        p.member!.hp = 1;
        p.actor.ko = false;
      }
    }
  }

  /** For dev tools: ends the fight at once. */
  forceEnd(outcome: BattleOutcome): void {
    if (this.phase !== 'active' && this.phase !== 'intro') return;
    if (outcome === 'won') {
      for (const e of this.livingEnemies()) {
        this.xpEarned += e.enemy!.xp;
        this.dotsEarned += e.enemy!.dots;
        e.hp = 0;
        e.actor.hidden = true;
      }
    } else {
      for (const p of this.party) {
        p.hp = 0;
        p.actor.ko = true;
      }
    }
    this.phase = outcome;
    this.resolveOutcome?.(outcome);
  }
}
