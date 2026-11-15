import { EASE, motion, MS, type Ease } from '../render/motion.ts';

/**
 * The one stepper for interface motion. Only drawings move ("skins": a panel's face, a list's
 * rows and words); what the player taps never does, so every page takes input from its first frame.
 * The game steps it on every fixed step, a page over a paused fight included, so motion finishes
 * there too and hand-stepped checks stay exact. With reduced motion a skin simply sits at rest.
 * Closing is instant: a page that closes finishes its motion first.
 */

/** What a motion moves: any display object, or a plain object shaped like one. */
export interface Skin {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scale: { x: number; y: number };
  destroyed?: boolean;
}

/** Where a skin starts, relative to where it rests. */
export interface From {
  dx?: number;
  dy?: number;
  scale?: number;
  alpha?: number;
  rotation?: number;
}

interface Tween {
  owner: unknown;
  skin: Skin;
  rest: { x: number; y: number; alpha: number; rotation: number; sx: number; sy: number };
  from: From;
  ms: number;
  t: number;
  delay: number;
  ease: Ease;
  /** With reduced motion: 'rest' holds still, 'alpha' keeps only the fade. */
  whenReduced: 'rest' | 'alpha';
}

interface Run {
  owner: unknown;
  ms: number;
  t: number;
  ease: Ease;
  fn: (k: number) => void;
  resolve: () => void;
}

interface Loop {
  owner: unknown;
  skin: Skin;
  fn: (t: number) => void;
}

export class Anim {
  private tweens: Tween[] = [];
  private runs: Run[] = [];
  private loops: Loop[] = [];
  /** Seconds the stepper has run: the clock idle motion keeps its beat by. */
  clock = 0;

  /**
   * Calls `fn` with the clock on every step while `skin` lives: idle motion on the beat, such as the
   * cursor's glove. One loop per skin; it never counts as motion still running. The function itself
   * holds still with reduced motion (see `onBeat`).
   */
  loop(owner: unknown, skin: Skin, fn: (t: number) => void): void {
    this.loops = this.loops.filter((l) => l.skin !== skin);
    this.loops.push({ owner, skin, fn });
    fn(this.clock);
  }

  /** Stops the idle motion `owner` started. */
  unloop(owner: unknown): void {
    this.loops = this.loops.filter((l) => l.owner !== owner);
  }

  /**
   * Moves skins from `from` back to where they are now, over `ms`. A skin already moving is put at
   * its rest first, so a second play never drifts from the first.
   */
  play(owner: unknown, skins: Skin | Skin[], from: From, ms: number, ease: Ease = EASE.out, opts: { delay?: number; whenReduced?: 'rest' | 'alpha' } = {}): void {
    const whenReduced = opts.whenReduced ?? 'rest';
    for (const skin of Array.isArray(skins) ? skins : [skins]) {
      if (!skin || skin.destroyed) continue;
      this.settle(skin);
      if (motion.reduced && (whenReduced === 'rest' || from.alpha === undefined)) continue;
      const tw: Tween = {
        owner,
        skin,
        rest: { x: skin.x, y: skin.y, alpha: skin.alpha, rotation: skin.rotation, sx: skin.scale.x, sy: skin.scale.y },
        from: motion.reduced ? { alpha: from.alpha } : from,
        ms,
        t: 0,
        delay: opts.delay ?? 0,
        ease,
        whenReduced,
      };
      this.tweens.push(tw);
      apply(tw, 0);
    }
  }

  /** Runs `fn` with an eased 0 to 1 over `ms`: for motions that are not a skin moving (a map sliding, a page turning). */
  run(owner: unknown, ms: number, ease: Ease, fn: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      fn(ease(0));
      this.runs.push({ owner, ms, t: 0, ease, fn, resolve });
    });
  }

  /** Puts everything `owner` is moving at rest at once. */
  finish(owner: unknown): void {
    for (const tw of this.tweens.filter((x) => x.owner === owner)) this.drop(tw);
    for (const r of this.runs.filter((x) => x.owner === owner)) this.end(r);
  }

  /** Puts everything at rest at once, as when the screen changes shape. */
  finishAll(): void {
    for (const tw of [...this.tweens]) this.drop(tw);
    for (const r of [...this.runs]) this.end(r);
  }

  /** Whether `owner` has anything still moving. */
  busy(owner: unknown): boolean {
    return this.tweens.some((x) => x.owner === owner) || this.runs.some((x) => x.owner === owner);
  }

  /** How many motions are running, for the checks. */
  get active(): number {
    return this.tweens.length + this.runs.length;
  }

  step(dt: number): void {
    const ms = dt * 1000;
    this.clock += dt;
    this.loops = this.loops.filter((l) => !l.skin.destroyed);
    for (const l of this.loops) l.fn(this.clock);
    for (const tw of [...this.tweens]) {
      if (tw.skin.destroyed) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        continue;
      }
      // Reduced motion turned on part way: at rest at once, unless only a fade is kept.
      if (motion.reduced && tw.whenReduced === 'rest') {
        this.drop(tw);
        continue;
      }
      if (tw.delay > 0) {
        tw.delay -= ms;
        continue;
      }
      tw.t += ms;
      if (tw.t >= tw.ms) this.drop(tw);
      else apply(tw, tw.ease(tw.t / tw.ms));
    }
    for (const r of [...this.runs]) {
      r.t += ms;
      if (r.t >= r.ms) this.end(r);
      else r.fn(r.ease(r.t / r.ms));
    }
  }

  /** A skin already moving goes to its rest before anything else moves it. */
  private settle(skin: Skin): void {
    const tw = this.tweens.find((x) => x.skin === skin);
    if (tw) this.drop(tw);
  }

  private drop(tw: Tween): void {
    const i = this.tweens.indexOf(tw);
    if (i >= 0) this.tweens.splice(i, 1);
    if (!tw.skin.destroyed) apply(tw, 1);
  }

  private end(r: Run): void {
    const i = this.runs.indexOf(r);
    if (i < 0) return;
    this.runs.splice(i, 1);
    r.fn(1);
    r.resolve();
  }
}

/**
 * Sets a skin part of the way from its start (k = 0) to its rest (k = 1). Only what the motion moves is
 * touched, so a skin placed again while it pops (a notice restacked, a name box following its balloon)
 * keeps its new place.
 */
function apply(tw: Tween, k: number): void {
  const { skin, rest, from } = tw;
  const f = 1 - k;
  if (from.dx !== undefined) skin.x = rest.x + from.dx * f;
  if (from.dy !== undefined) skin.y = rest.y + from.dy * f;
  if (from.alpha !== undefined) skin.alpha = rest.alpha + (from.alpha - rest.alpha) * f;
  if (from.rotation !== undefined) skin.rotation = rest.rotation + from.rotation * f;
  if (from.scale !== undefined) {
    const s = 1 + (from.scale - 1) * f;
    skin.scale.x = rest.sx * s;
    skin.scale.y = rest.sy * s;
  }
}

/** The game's stepper. */
export const anim = new Anim();

/**
 * A panel, list, or caption slapped onto the page: it lands from off its shadow and bounces flat. It is
 * not turned, since a page's skins have different origins and would turn apart.
 */
export function pastePanel(owner: unknown, skins: Skin | Skin[], shadow: number): void {
  anim.play(owner, skins, { dx: shadow * 1.8, dy: shadow * 1.8 }, MS.paste, EASE.pop);
}

/** A page rising as a sheet from the bottom of an upright phone, past its place and back, while its shade darkens behind it. */
export function riseSheet(owner: unknown, skins: Skin | Skin[], shade: Skin | null, unit: number): void {
  anim.play(owner, skins, { dy: unit * 2.4 }, MS.sheet, EASE.pop);
  if (shade) anim.play(owner, shade, { alpha: 0 }, MS.sheet, EASE.out);
}
