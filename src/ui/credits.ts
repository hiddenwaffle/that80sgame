import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import type { GameContext } from '../game/context.ts';
import { drawDensity } from '../render/density.ts';
import { FONT } from '../render/fonts.ts';
import { HalftoneFilter, PRINT } from '../render/halftone.ts';
import { PAPER, POP_YELLOW } from '../render/palette.ts';
import { finCard, finGround, pastedPicture, type Screen } from './screens.ts';
import { CreditsScroll } from './credits_scroll.ts';
import { measures, replayIcon, TOUCH_MIN } from './print.ts';
import { button, type PrintedButton } from './widgets.ts';

/**
 * The picture boards, each with its title and rows. A row is [role, name]: the name shows first in large type, the role under
 * it in small grey type (the owner, 2026-11-14); '' leaves either one out.
 */
export const CREDIT_REEL = [
  // What the game is built with: each principal library or tool as the name, the smaller ones that go with it as the role.
  // Those in the game itself (PixiJS and its six, yaml, zod, the typefaces) ship their licenses with every build in licenses.txt.
  { picture: 'credits_dots', aspect: 1.5, title: 'Built With', rows: [
    ['@pixi/colord, earcut, eventemitter3, ismobilejs, parse-svg-path, tiny-lru', 'PixiJS'],
    ['yaml, zod, Vitest, Playwright', 'TypeScript, Vite, Node.js'],
    ['ImageMagick', 'Tiled'],
    ['Bangers, Comic Neue, Old Standard TT, Oswald, UnifrakturMaguntia', 'Fontsource'],
  ] },
  // In these two the subject comes first and large ("Beijing Fight Music"), what it is under it and small (the owner, 2026-11-15).
  { picture: 'credits_curtain', aspect: 1.5, title: 'Coincidental Likenesses', rows: [
    ['Inspired by WarGames', 'Title Map'],
    ['Based on "Fight to Survive", from Bloodsport', 'Beijing Fight Music'],
    ['Homage to \'80s Guitar Solos', 'Berlin Music'],
  ] },
  { picture: 'credits_halt', aspect: 1.5, title: 'A hiddenwaffle Production', rows: [
    ['Lots of pens, lots of papers', 'Editing'],
    ['"Persona-like"', 'Special effects'],
    ['"It runs, doesn\'t it?"', 'Quality assurance'],
  ] },
  // The development credits: Astra's and Sol's lines from their own suggestions (docs/astra_contributions.md,
  // docs/sol_contributions.md); Claude's its own (2026-11-15).
  { picture: 'credits_over', aspect: 1.5, title: 'The Robot Army', rows: [
    ['Lead programming, game design, and coordinating the robot army', 'Opus 5.5'],
    ['"Most of what I did was keep the project tidy and check things so the rest of the team could make the game."', '(A very modest) Sonnet 5.5'],
    ['Programming, environment art and tools, music integration, combat analysis, QA', 'Astra 6'],
    ['Programming, UI design, character art, testing, code review', 'Sol 6/6.1'],
    ['Soundtrack Director', 'Opus 5.5 II'],
    ['Independent Con$ultant', 'Fable 5.2'],
  ] },
] as const;

/** The one picture between the notes and the closing thanks: the title page, on a board, without its maze and the line at its foot. */
export const CREDIT_END_PICTURE = { picture: 'credits_title', aspect: 1100 / 1000, width: .72 } as const;

/** Pictures and credits share one upward-moving reel. Resizing preserves its progress. */
export class CreditsScreen implements Screen {
  readonly container = new Container();
  readonly opaque = true;
  readonly blocking = true;
  readonly duration = 60;
  age = 0;
  private done = false;
  private reel = new Container();
  /**
   * FIN and Play again. They come up with the reel, the credits' own gap after the last line, and stop in the middle while
   * the lines above roll on out of sight (the owner, 2026-11-13); scrolled back, they go down with the reel again.
   */
  private pin = new Container();
  /** Where FIN's card stops: its top, 0 with FIN in the middle (less on a panel too short for Play again under it there). */
  private pinY = 0;
  /** FIN's card's top in the reel. */
  private finAt = 0;
  private distance = 0;
  private stops: number[] = [];
  private readonly scroll = new CreditsScroll();
  /** `again`: the press began on Play again. */
  private pointer: { id: number; y: number; startY: number; moved: boolean; time: number; velocity: number; canFinish: boolean; again: boolean } | null = null;
  /**
   * Play again, under FIN: back to the title, as a tap on FIN once it has settled is. It takes a press at any point of the
   * roll, and answers it as a list's row does (the owner, 2026-11-13): lit with the blip while the finger is on it, and let
   * go of there, the confirm sound as the game goes.
   */
  private again: PrintedButton | null = null;
  private againLit = false;
  /** Confirm on keys or a pad, pressed with FIN settled, holds Play again lit until it is let go of. */
  private againKey = false;
  /** False while a notification covers Play again: it is drawn clear (its bounds still count) and takes no press. */
  private againShown = true;
  private readonly keys = new Set<string>();
  private centeredAge = 0;
  private reducedAge = 0;
  private reducedPage: number | null = 0;
  private wheelUntil = 0;
  /** FIN is part of this reel; callers can wait until it has actually settled. */
  get finReady(): boolean { return !this.done && this.centeredAge >= .35; }
  private readonly game: GameContext;
  private readonly onDone: () => void;
  private readonly filter = new HalftoneFilter({ dot: 3, resolution: drawDensity(), paper: PAPER, strength: PRINT.strength });

  constructor(game: GameContext, onDone: () => void) {
    this.game = game;
    this.onDone = onDone;
    game.input.consume();
    this.layout();
    this.container.eventMode = 'static';
    this.container.interactiveChildren = false;
    this.container.cursor = 'grab';
    this.container.on('pointerdown', this.grab);
    this.container.on('globalpointermove', this.drag);
    this.container.on('globalpointermove', this.hover);
    this.container.on('pointerleave', this.unhover);
    this.container.on('pointerup', this.release);
    this.container.on('pointerupoutside', this.release);
    this.container.on('wheel', e => {
      if (this.pointer) return;
      e.stopPropagation();
      this.takeOver();
      this.scroll.grab(); this.scroll.drag(e.deltaY, game.settings.reduceMotion);
      this.wheelUntil = performance.now() + 120;
      this.position();
    });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.cancel);
    window.addEventListener('pointercancel', this.cancelPointer);
  }

  private keyDown = (e: KeyboardEvent): void => { this.keys.add(e.code); };
  private keyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };
  private cancelPointer = (e: PointerEvent): void => { if (e.pointerId === this.pointer?.id) this.cancel(); };
  private cancel = (): void => {
    // A Confirm held when the window loses it is no press, and its release never comes.
    this.keys.clear(); this.pointer = null; this.wheelUntil = 0; this.againKey = false;
    this.scroll.release(0, this.game.settings.reduceMotion); this.container.cursor = 'grab';
    this.lightAgain(false);
  };

  /** Whether the pointer is on Play again's face, as the reel is drawn now (never while it waits unseen). */
  private overAgain(e: FederatedPointerEvent): boolean {
    const b = this.again;
    if (!b || !this.againShown || !this.pin.visible) return false;
    const at = e.getLocalPosition(this.container);
    const x = at.x - this.pin.x - b.x;
    const y = at.y - this.pin.y - b.y;
    return (b.hitArea as Rectangle).contains(x, y);
  }

  /** Lights Play again or puts it out. Lit, it blips, as the band reaching a list's row does. */
  private lightAgain(lit: boolean): void {
    if (lit === this.againLit || !this.again) return;
    this.againLit = lit;
    this.again.setLit(lit);
    if (lit) this.game.audio.play('blip');
  }

  /**
   * Play again waits, unseen and taking no press, while a notification covers it: the achievement for finishing pops up
   * at the foot of the panel as the credits start, and a fling can reach FIN before it has gone. It shows again as the
   * notification goes.
   */
  private keepAgainClear(dt: number): void {
    const b = this.again;
    if (!b || !this.pin.visible) return;
    const mine = b.getBounds();
    const covered = this.game.toastLayer.children.some((n) => {
      if (n.destroyed || !n.visible || n.alpha <= 0) return false;
      const o = n.getBounds();
      return o.minX < mine.maxX && o.maxX > mine.minX && o.minY < mine.maxY && o.maxY > mine.minY;
    });
    this.againShown = !covered;
    if (covered) {
      if (this.pointer?.again) this.pointer.again = false;
      this.lightAgain(false);
      b.alpha = 0;
    } else b.alpha = this.game.settings.reduceMotion ? 1 : Math.min(1, b.alpha + dt / 0.18);
  }

  /**
   * The mouse shows the pointing hand over Play again, as over any button, and lights it with the blip, as the band follows
   * the mouse along a list's rows (the owner, 2026-11-13: "like the usual ways of the UI's buttons"); off it, it goes out.
   */
  private hover = (e: FederatedPointerEvent): void => {
    if (this.pointer || this.done || this.againKey) return;
    const over = this.overAgain(e);
    this.container.cursor = over ? 'pointer' : 'grab';
    if (e.pointerType === 'mouse') this.lightAgain(over);
  };

  /** The mouse gone off the panel puts Play again out. */
  private unhover = (): void => {
    if (!this.pointer && !this.done && !this.againKey) this.lightAgain(false);
  };

  /** A reduced-motion card gives the content under the pointer to the full-size manual reel. */
  private takeOver(y = this.game.layout.panel.h / 2): void {
    if (this.game.settings.reduceMotion && this.reducedPage !== null) {
      const content = (y - this.reel.y) / this.reel.scale.y;
      this.scroll.position = Math.max(0, Math.min(this.scroll.maximum, this.game.layout.panel.h * .8 - y + content));
    }
    this.reducedPage = null; this.reducedAge = 0;
  }

  private grab = (e: FederatedPointerEvent): void => {
    if (this.pointer || e.button !== 0) return;
    e.stopPropagation();
    const y = e.getLocalPosition(this.container).y;
    // What the press landed on as the player saw it, before the press takes the reel over (a Reduce motion page is smaller).
    const again = !this.done && this.overAgain(e);
    this.pointer = { id: e.pointerId, y, startY: y, moved: false, time: performance.now(), velocity: 0, canFinish: this.centeredAge >= .35, again };
    this.wheelUntil = 0; this.takeOver(y);
    // The press holds the roll, so the button stays under the finger.
    this.scroll.grab(); this.container.cursor = again ? 'pointer' : 'grabbing';
    if (again) this.lightAgain(true);
  };

  private drag = (e: FederatedPointerEvent): void => {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    const y = e.getLocalPosition(this.container).y, now = performance.now();
    const dt = Math.max(.001, (now - p.time) / 1000), delta = p.y - y;
    if (Math.abs(y - p.startY) > 4) p.moved = true;
    const actual = this.scroll.drag(delta, this.game.settings.reduceMotion);
    const blend = 1 - Math.exp(-dt / .045);
    p.velocity += (actual / dt - p.velocity) * blend;
    p.y = y; p.time = now; this.position();
    // Play again's press while the finger stays on it; once the reel has scrolled, the press is a scroll and never a tap.
    if (p.again) {
      this.lightAgain(!p.moved && this.overAgain(e));
      this.container.cursor = p.moved ? 'grabbing' : 'pointer';
    }
  };

  private release = (e: FederatedPointerEvent): void => {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    e.stopPropagation();
    // The release's final movement counts too; an idle hold is not a fling.
    if (e.getLocalPosition(this.container).y !== p.y) this.drag(e);
    const again = p.again && !p.moved && this.overAgain(e);
    this.pointer = null; this.container.cursor = 'grab';
    const cap = this.game.layout.panel.h * 5;
    const velocity = p.moved && performance.now() - p.time < 100 ? Math.max(-cap, Math.min(cap, p.velocity)) : 0;
    this.scroll.release(velocity, this.game.settings.reduceMotion);
    // Let go of on Play again: the confirm sound, and the game goes, the button lit as a chosen row stays.
    if (again && this.finish()) return void this.game.audio.play('confirm');
    this.lightAgain(false);
    // A press that began on Play again and slid off it chooses nothing, as on a list.
    if (p.canFinish && !p.moved && !p.again && this.scroll.atEnd) this.finish();
  };

  layout(): void {
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const { w, h } = this.game.layout.panel;
    this.container.hitArea = new Rectangle(0, 0, w, h);
    const u = this.game.layout.unit;
    // FIN's ground behind the whole reel, where black stood (the owner, 2026-10-09: the FIN screen's background should
    // run behind the entire credits), so the end card arrives on the ground the credits ran on.
    this.container.addChild(finGround(this.game));
    const clip = new Graphics().rect(0, 0, w, h).fill(0xffffff);
    this.reel = new Container();
    this.pin = new Container();
    const view = new Container();
    view.addChild(this.reel, this.pin);
    view.mask = clip;
    this.container.addChild(view, clip);
    const textWidth = Math.min(w - u * 3, u * 36);
    let y = 0;
    const line = (text: string, size: number, color = PAPER, face = FONT.headline as string) => {
      const t = new Text({ text, style: { fontFamily: face, fontSize: u * size, fill: color,
        align: 'center', wordWrap: true, wordWrapWidth: textWidth, lineHeight: u * size * 1.3 } });
      t.anchor.set(.5, 0);
      t.position.set(w / 2, y);
      this.reel.addChild(t);
      y += t.height + u * .55;
    };
    const rows = (list: ReadonlyArray<readonly [string, string]>) => {
      for (const [role, name] of list) {
        if (name) line(name, 1.15);
        if (role) line(role, .85, 0xaaa7b1, FONT.body);
      }
    };
    this.stops = [0];
    line("THAT '80S GAME", 2.2, POP_YELLOW);
    line('Original by KD and MX (2003)', 1.05);
    y += u * 3;
    const pw = Math.min(w - u * 4, u * 30, h * .66);
    // Each section stands midway between boards (the owner, 2026-11-14): as far under one board's paper edge as above the next's.
    const border = u * .35, gap = u * 2.625;
    for (const block of CREDIT_REEL) {
      this.stops.push(y);
      const ph = pw / block.aspect;
      const photo = pastedPicture(block.picture, pw, ph, u, this.filter, { shadow: 0x34323b, drop: u * .3, border });
      photo.position.set(w / 2, y + ph / 2);
      this.reel.addChild(photo);
      y += ph + border + gap;
      line(block.title.toUpperCase(), 1.15, POP_YELLOW);
      rows(block.rows);
      // line() leaves .55 u under the last line, and the next board's paper starts a border above its picture.
      y += gap - u * .55 + border;
    }
    this.stops.push(y);
    line('SPECIAL THANKS', 1.3, POP_YELLOW);
    line('The Department of Unfinished Business\nEvery patient playtester\nAnd you', 1.1);
    y += u * 2;
    line('No historical accuracy was harmed\nin the making of this game.', .95, PAPER, FONT.body);
    y += u * 2;
    const ew = pw * CREDIT_END_PICTURE.width, eh = ew / CREDIT_END_PICTURE.aspect;
    const last = pastedPicture(CREDIT_END_PICTURE.picture, ew, eh, u, this.filter, { shadow: 0x34323b, drop: u * .3, border: u * .35 });
    last.position.set(w / 2, y + eh / 2);
    this.reel.addChild(last);
    y += eh + u * 2.2;
    line('THANK YOU FOR PLAYING', 1.6, POP_YELLOW);
    const autoSpeed = (y + h) / this.duration;
    this.stops.push(y);
    const fin = finCard(this.game, { background: false, animate: false });
    this.pin.addChild(fin);
    // Under the confetti (look C of five, the owner, 2026-11-13). This screen handles its presses.
    const again = button(this.game.msg('system', 'play_again'), u, () => undefined,
      { slab: true, size: Math.round(u * 1.05), h: Math.max(TOUCH_MIN, Math.round(u * 2.1)), icon: replayIcon(Math.round(u * 1.4)) });
    again.position.set(Math.round(w / 2 - (again.hitArea as Rectangle).width / 2), Math.round(fin.foot + u * 1.1));
    this.pin.addChild(again);
    this.again = again;
    this.againLit = false;
    // FIN stops in the middle; on a panel too short for Play again under it there (1280 by 720), that much higher, so the
    // button keeps a unit of ground under it.
    const reach = again.y + (again.hitArea as Rectangle).height + measures(u).S + u;
    this.pinY = -Math.max(0, Math.ceil(reach - h));
    // In the reel, FIN's letters start as far under the last line's as the closing lines' letters stand apart (about three
    // units, 2.2 of them after the line's own end).
    this.finAt = y + u * 2.2 - fin.head;
    // The roll starts with the reel's origin at .8h, and ends once the last line has gone over the top, FIN stopped by then.
    this.distance = h * .8 + Math.max(y, this.finAt - this.pinY);
    this.scroll.layout(this.distance, autoSpeed, h);
    if (this.pointer) this.cancel();
    this.position();
  }

  private position(): void {
    const h = this.game.layout.panel.h;
    const w = this.game.layout.panel.w;
    if (this.game.settings.reduceMotion && this.reducedPage !== null && !this.scroll.atEnd) {
      const i = this.reducedPage;
      const top = this.stops[i]!;
      const bottom = this.stops[i + 1] ?? this.distance;
      const scale = Math.min(1, (h - this.game.layout.unit * 6) / (bottom - top));
      this.reel.scale.set(scale);
      this.reel.position.set(w * (1 - scale) / 2, h * .08 - top * scale);
      // FIN comes on its own, as the last page.
      this.pin.visible = false;
    } else {
      this.reel.scale.set(1);
      this.reel.position.set(0, h * .8 - this.scroll.position);
      this.pin.visible = true;
      this.pin.y = Math.max(this.pinY, this.reel.y + this.finAt);
    }
  }

  /** Ends the credits for the title; false when it is too soon or already done. */
  private finish(): boolean {
    if (this.done || this.age < 1) return false;
    this.done = true;
    this.game.input.consume();
    this.onDone();
    return true;
  }

  update(dt: number): void {
    if (this.done) return;
    this.age += dt;
    const input = this.game.input;
    // Confirm on keys or a pad, pressed with FIN settled, lights Play again with the blip, and let go of, the confirm sound
    // as the game goes, as a finger on it does (the owner, 2026-11-13: "like the usual ways of the UI's buttons"). Only a
    // fresh press counts: a key held into FIN, or its repeats, neither lights it nor goes.
    if (this.againKey) {
      if (input.isHeld('confirm')) return;
      this.againKey = false;
      if (this.finish()) return void this.game.audio.play('confirm');
      this.lightAgain(false);
    }
    if (this.finReady && !this.pointer && input.pressed('confirm') && this.again && this.againShown && this.pin.visible) {
      this.againKey = true;
      this.lightAgain(true);
      return;
    }
    // A press held into FIN never dismisses it, except the explicit Escape/B fast-forward rule.
    if (this.finReady && (input.isHeld('cancel') || this.keys.has('Escape') ||
      input.pressed('confirm') || input.pressed('down') || input.pressed('cancel'))) { this.finish(); return; }
    const direction = input.isHeld('cancel') || this.keys.has('Escape') ? 2
      : input.isHeld('up') || this.keys.has('ArrowUp') ? -1
      : input.isHeld('down') || input.isHeld('confirm') || this.keys.has('Space') || this.keys.has('ArrowDown') ? 1 : 0;
    if (this.wheelUntil && performance.now() >= this.wheelUntil) { this.wheelUntil = 0; this.scroll.release(0, this.game.settings.reduceMotion); }
    if (direction) this.takeOver();
    if (this.game.settings.reduceMotion && !direction && !this.scroll.dragging) {
      this.scroll.velocity = 0;
      this.reducedAge += dt;
      if (this.reducedAge >= this.duration / (this.stops.length - 1) && !this.scroll.atEnd) {
        this.reducedAge = 0;
        const next = this.stops.findIndex(top => top > this.scroll.position);
        if (next < 0 || next === this.stops.length - 1) {
          this.scroll.position = this.scroll.maximum; this.scroll.velocity = 0; this.reducedPage = null;
        } else { this.scroll.position = this.stops[next]!; this.reducedPage = next; }
      }
    } else this.scroll.update(dt, direction, this.game.settings.reduceMotion);
    this.centeredAge = this.scroll.atEnd ? this.centeredAge + dt : 0;
    this.position();
    this.keepAgainClear(dt);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.cancel);
    window.removeEventListener('pointercancel', this.cancelPointer);
    this.container.destroy({ children: true });
    this.filter.destroy();
  }
}
