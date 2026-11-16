import { Container } from 'pixi.js';
import { parseInline, plainText, type LineStep, type TextPiece } from '../content/screenplay.ts';
import type { GameContext } from '../game/context.ts';
import type { Actor } from '../world/actor.ts';
import { Balloon, type BalloonStyle } from '../ui/balloon.ts';
import { scriptSpeed } from '../ui/typing.ts';

interface Current {
  balloon: Balloon;
  size: number;
  /** What the balloon was built from, to build it again when the panel changes size. */
  name: string;
  full: string;
  color: string | undefined;
  pieces: TextPiece[];
  piece: number;
  char: number;
  shown: string;
  cps: number;
  pause: number;
  done: boolean;
  /** Seconds to stay up after typing, then close by itself. */
  auto: number | null;
  sinceDone: number;
  actor: Actor | null;
  /** A scripted voice from the right, independent of its actor's map position. */
  offscreenRight: boolean;
  voice: number;
  style: BalloonStyle;
  resolve: () => void;
  blipCount: number;
  /** Characters owed to the typing, carried between steps. */
  carry: number;
  /** Seconds left in which a press cannot close the line, after a press finished its typing. */
  guard: number;
  /** Seconds since the line finished while Confirm is held down to skip. */
  sinceHeld: number;
}

/** After a press finishes a line's typing, how long before a press can close it, so a quick double tap cannot skip it unread. */
const DOUBLE_TAP = 0.25;
/** How long Confirm must be held before lines skip, and how long each finished line then stays. */
const HOLD_TO_SKIP = 0.4;
/** How long Confirm must be held before the skip chevron shows. */
const SHOW_SKIP = 0.25;
const HELD_LINE = 0.15;

/**
 * Shows script lines one at a time as balloons or captions, typing them out at
 * the player's text speed. Confirm or a tap finishes the typing, then closes the line.
 */
export class Dialogue {
  readonly container = new Container();
  private cur: Current | null = null;
  private readonly game: GameContext;
  /** Figures that "Enemies" and similar speakers point at during a fight. */
  encounterActors: Actor[] = [];
  /** How long Confirm has been held down, on a keyboard or gamepad, since it was last pressed. */
  private heldFor = 0;
  /** Game time when the last line closed, so a press mashed through the end of a talk does nothing else. */
  closedAt = -Infinity;
  /** Who spoke the last line, and how, so a new speaker's balloon pops in and the same speaker's next line simply appears. */
  private lastName = '';
  private lastStyle: BalloonStyle | null = null;

  constructor(game: GameContext) {
    this.game = game;
  }

  get open(): boolean {
    return this.cur !== null;
  }

  /** Whether the open line has finished and waits for the player (lines that close by themselves never do). */
  get waiting(): boolean {
    const c = this.cur;
    return c !== null && c.done && c.auto === null;
  }

  say(line: LineStep, opts: { auto?: number } = {}): Promise<void> {
    const g = this.game;
    const char = line.speaker !== null ? g.content.characters[line.speaker] : undefined;
    let style: BalloonStyle = line.speaker === null ? 'caption' : (char?.style ?? 'balloon');
    if (line.speaker !== null && line.tags.includes('whisper')) style = 'whisper';
    if (line.speaker !== null && line.tags.includes('aside')) style = 'thought';
    if (line.tags.includes('shout')) style = style === 'boss' ? 'boss' : 'shout';
    if (line.speaker !== null && line.tags.includes('haunted')) style = 'haunted';
    const actor = char ? this.findActor(char.actor) : null;
    const name = line.speaker === null ? '' : (char?.label ?? line.speaker);
    const full = plainText(line.text);
    const offscreenRight = line.tags.includes('offscreen_right');
    const size = line.tags.includes('large') ? 2 : 1;
    const balloon = this.build(style, name, full, char?.color, actor, offscreenRight, size);
    const fresh = name !== this.lastName || style !== this.lastStyle || (!this.cur && g.time - this.closedAt > 0.3);
    this.lastName = name;
    this.lastStyle = style;
    this.close();
    if (fresh) balloon.popIn();
    this.container.addChild(balloon.container);
    const speed = g.dev.fastText ? 0 : g.settings.textSpeed;
    return new Promise((resolve) => {
      this.cur = {
        balloon,
        size,
        name,
        full,
        color: char?.color,
        pieces: parseInline(line.text),
        piece: 0,
        char: 0,
        shown: '',
        cps: speed,
        pause: 0,
        done: false,
        auto: opts.auto ?? null,
        sinceDone: 0,
        actor,
        offscreenRight,
        voice: char?.voice ?? 400,
        style,
        resolve,
        blipCount: 0,
        carry: 0,
        guard: 0,
        sinceHeld: 0,
      };
      balloon.setVisible('');
      // The mouth moves while the line types; finishTyping stops it, so instant text never starts it.
      if (actor) actor.talking = true;
      if (speed === 0) this.finishTyping();
      // A press that lands just after the line opens (the second of a quick double tap) cannot close it unread.
      // Not with the developers' fast text, which the test tools use to get through scenes.
      if (!g.dev.fastText) this.cur.guard = DOUBLE_TAP;
    });
  }

  private build(style: BalloonStyle, name: string, full: string, color: string | undefined, actor: Actor | null, offscreenRight: boolean, size = 1): Balloon {
    const g = this.game;
    const band = offscreenRight ? this.partyBand() : undefined;
    const follow = style === 'caption' ? this.leader() : actor;
    const anchor = this.anchorFor(follow, offscreenRight);
    const under = this.underFor(follow, anchor, offscreenRight);
    const captionSlot = style === 'caption' ? g.pictureCaption?.(full) : undefined;
    return new Balloon({
      style,
      size,
      name,
      full,
      anchor,
      ...(under !== undefined ? { under } : {}),
      ...(offscreenRight ? { tailSide: 'right' as const } : {}),
      ...(band ? { avoidBand: band } : {}),
      ...(captionSlot ? { captionSlot } : {}),
      panelW: g.layout.panel.w,
      panelH: g.layout.panel.h,
      unit: g.layout.unit,
      ...(color ? { color } : {}),
    });
  }

  private partyBand(): { top: number; bottom: number; left: number; right: number } | undefined {
    const g = this.game, w = g.world;
    if (!w) return;
    const party = w.party.filter(a => !a.hidden);
    if (!party.length) return;
    return {
      top: Math.min(...party.map(a => w.worldToPanel(a.x, a.y, a.size * 2 + 6)[1])),
      bottom: Math.max(...party.map(a => w.worldToPanel(a.x, a.y + 4)[1])),
      left: Math.min(...party.map(a => w.worldToPanel(a.x - a.size - 3, a.y)[0])),
      right: Math.max(...party.map(a => w.worldToPanel(a.x + a.size + 3, a.y)[0])),
    };
  }

  /**
   * The party's leader, whose place narration takes a balloon's position from; null off the map, or when a
   * page is up over it (an ending picture), when narration takes the top middle as an unplaced balloon does.
   */
  private leader(): Actor | null {
    if (this.game.screensOpen()) return null;
    return this.game.world?.leader ?? null;
  }

  /**
   * Where a speaker's balloon points, in panel coordinates, or null for none. A speaker out of sight
   * (not yet shown, or off the panel) speaks from the panel's edge on their side of the party's leader,
   * as a voice off stage does, so the Warsaw Pac's warnings come from where it will appear.
   */
  private anchorFor(actor: Actor | null, offscreenRight = false): [number, number] | null {
    const world = this.game.world;
    if (!actor || !world) return null;
    const at = actor.speakingPoint();
    const a = world.worldToPanel(at.x, at.y, at.up);
    const l = this.game.layout.panel;
    // The unseen boss calls from high on the right, above his entrance and Berlin's workers.
    // Keep this independent of his hidden waiting spot and the party's approach.
    if (offscreenRight) return [l.w - this.game.layout.unit * 1.2, l.h * 0.2];
    if (!actor.hidden && a[0] >= 0 && a[1] >= 0 && a[0] <= l.w && a[1] <= l.h) return a;
    const lead = world.leader;
    if (actor === lead) return null;
    const leadAt = lead.speakingPoint();
    const from = world.worldToPanel(leadAt.x, leadAt.y, leadAt.up);
    const inset = this.game.layout.unit * 1.2;
    const dx = a[0] - from[0];
    const dy = a[1] - from[1];
    const clamp = (v: number, hi: number) => Math.max(inset, Math.min(hi - inset, v));
    if (Math.abs(dx) >= Math.abs(dy)) return [dx < 0 ? inset : l.w - inset, clamp(a[1], l.h)];
    return [clamp(a[0], l.w), dy < 0 ? inset : l.h - inset];
  }

  /**
   * For a figure whose head is a small part of it (the tank's driver, in its turret), how far below its balloon's
   * anchor the head ends, in panel pixels: a balloon with no room above it goes under the head and points up to it,
   * rather than over the face (the review of 2026-10-14, on a 320-pixel-wide phone). Undefined for anyone else, and
   * where the balloon points from the panel's edge.
   */
  private underFor(actor: Actor | null, anchor: [number, number] | null, offscreenRight: boolean): number | undefined {
    const world = this.game.world;
    if (!actor || !anchor || !world || offscreenRight) return undefined;
    const at = actor.speakingPoint();
    if (at.chin === undefined) return undefined;
    const head = world.worldToPanel(at.x, at.y, at.up);
    if (Math.abs(head[0] - anchor[0]) > 0.5 || Math.abs(head[1] - anchor[1]) > 0.5) return undefined;
    return world.worldToPanel(at.x, at.y, at.chin)[1] - head[1];
  }

  /** Builds the open balloon again for a new panel size, such as after rotating a phone. */
  relayout(): void {
    const c = this.cur;
    if (!c) return;
    const next = this.build(c.style, c.name, c.full, c.color, c.actor, c.offscreenRight, c.size);
    next.setVisible(c.shown);
    next.setDone(this.waiting);
    c.balloon.destroy();
    c.balloon = next;
    this.container.addChild(next.container);
  }

  private findActor(ref: string): Actor | null {
    const world = this.game.world;
    if (!world) return null;
    if (ref === 'encounter') return this.encounterActors.find((a) => !a.ko && !a.hidden) ?? null;
    if (ref === 'none') return null;
    return world.actor(ref) ?? null;
  }

  private finishTyping(): void {
    const c = this.cur;
    if (!c) return;
    c.shown = c.pieces.map((p) => (p.kind === 'text' ? p.text : p.kind === 'break' ? '\n' : '')).join('');
    c.balloon.setVisible(c.shown);
    c.piece = c.pieces.length;
    this.finished();
  }

  /** The line has typed out: it now waits for the player, with a mark to say so. */
  private finished(): void {
    const c = this.cur;
    if (!c) return;
    c.done = true;
    c.carry = 0;
    if (c.actor) c.actor.talking = false;
    c.balloon.setDone(this.waiting);
  }

  /** Confirm, Cancel, or a tap: finish the typing, or close a finished line. */
  advance(): void {
    const c = this.cur;
    if (!c) return;
    if (c.style === 'caption') this.game.finishPictureEntry?.();
    if (!c.done) {
      this.finishTyping();
      c.guard = DOUBLE_TAP;
      return;
    }
    if (c.guard > 0) return;
    this.close();
  }

  private close(): void {
    const c = this.cur;
    if (!c) return;
    if (c.actor) c.actor.talking = false;
    c.balloon.destroy();
    this.cur = null;
    this.closedAt = this.game.time;
    // Kept for the log page.
    this.game.record({ speaker: c.name, text: c.full, kind: c.style === 'caption' ? 'caption' : 'line' });
    c.resolve();
  }

  update(dt: number): void {
    const input = this.game.input;
    // A hold counts from the last press and only while unbroken, whether or not a line is open, so a
    // hold that outlasts one talk cannot skip the first line of the next.
    this.heldFor = input.pressed('confirm') || !input.isHeld('confirm') ? 0 : this.heldFor + dt;
    const c = this.cur;
    if (!c) return;
    c.guard -= dt;
    c.balloon.tick(dt);
    // A hold on Confirm shows the skip chevron a little before skipping starts, so the player sees what the hold does.
    c.balloon.setSkipping(this.heldFor >= SHOW_SKIP && c.auto === null);
    // Cancel reads text too, as in most games; either press is used up here.
    if (input.pressed('confirm') || input.pressed('cancel')) {
      input.consume('confirm');
      input.consume('cancel');
      this.advance();
      return;
    }
    // Holding Confirm on a keyboard or gamepad skips: each line shows at once and closes soon after.
    if (this.heldFor >= HOLD_TO_SKIP && c.auto === null) {
      if (!c.done) this.finishTyping();
      c.sinceHeld += dt;
      if (c.sinceHeld >= HELD_LINE) this.close();
      return;
    }
    // The balloon follows its speaker (narration, the party's leader) as they and the camera move.
    const follow = c.style === 'caption' ? this.leader() : c.actor;
    if (c.offscreenRight) c.balloon.setAvoidBand(this.partyBand());
    if (follow) {
      const now = this.anchorFor(follow, c.offscreenRight);
      const was = c.balloon.anchor;
      if ((now === null) !== (was === null) || (now && was && Math.hypot(now[0] - was[0], now[1] - was[1]) > 1.5)) c.balloon.setAnchor(now, this.underFor(follow, now, c.offscreenRight));
    }
    if (!c.done) {
      if (c.pause > 0) {
        c.pause -= dt;
        return;
      }
      // When in this step each letter came due: after a slow frame the game types several letters in one step, and at speed
      // two, and each chirp keeps its letter's own moment (Audio.blip, src/audio/blip_clock.ts).
      const from = c.carry, stepStart = this.game.time - dt, cps = c.cps;
      let typed = 0;
      c.carry += c.cps * dt;
      while (c.carry >= 1 && !c.done) {
        const p = c.pieces[c.piece];
        if (!p) {
          c.done = true;
          break;
        }
        if (p.kind === 'pause') {
          c.pause = p.seconds;
          c.piece++;
          break;
        }
        if (p.kind === 'speed') {
          c.cps = this.game.dev.fastText ? c.cps : scriptSpeed(p.cps, this.game.settings.textSpeed);
          c.piece++;
          continue;
        }
        if (p.kind === 'break') {
          c.shown += '\n';
          c.piece++;
          continue;
        }
        const ch = p.text[c.char];
        if (ch === undefined) {
          c.piece++;
          c.char = 0;
          continue;
        }
        c.shown += ch;
        c.char++;
        if (ch.trim()) {
          c.carry -= 1;
          typed++;
          const due = cps > 0 ? Math.min(dt, Math.max(0, (typed - from) / cps)) : 0;
          if (c.blipCount++ % 2 === 0) this.game.audio.blip(c.voice, stepStart + due);
        }
      }
      c.balloon.setVisible(c.shown);
      // A {pause} at the very end still waits before the line counts as finished.
      if (c.piece >= c.pieces.length && c.pause <= 0) this.finished();
      return;
    }
    if (c.auto !== null) {
      c.sinceDone += dt;
      if (c.sinceDone >= c.auto) this.close();
    }
  }

  clear(): void {
    this.close();
  }
}
