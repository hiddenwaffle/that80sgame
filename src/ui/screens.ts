import { PATROL_WARNING_PEAK, patrolWarningScale } from './patrol_warning.ts';
import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, type Filter } from 'pixi.js';
import { art } from '../art/images.ts';
import { PICTURE_DRAW } from '../art/pictures.ts';
import { buildIsoScene } from '../world/iso_scenes.ts';
import type { GameContext } from '../game/context.ts';
import { saveSettings, TEXT_SIZES, textSizesFor } from '../game/settings.ts';
import { saverOffered } from '../render/density.ts';
import { FONT } from '../render/fonts.ts';
import { INK, INK_SOFT, PAPER, POP_CYAN, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { thumbReach } from '../engine/layout.ts';
import { button, Caption, MenuList, TOUCH_MIN, withSounds, type MenuItem, type MenuPlace } from './widgets.ts';
import { TalkMark } from './talkMark.ts';
import { anim, pastePanel, riseSheet } from './anim.ts';
import { benDay, confetti, drawSheet, LEAN, letterStyle, measures, newspaperIcon, posterTag, shade, sheetGeometry, sheetRoom, TAB_KEYLINE } from './print.ts';
import { EASE, motion, MS } from '../render/motion.ts';
import { defaultBindings } from '../engine/input.ts';
import { capName, keyCap, promptFor } from './prompts.ts';
import { clearIfInked } from '../render/clear_if_inked.ts';
import { BUILD, buildTime } from '../build_stamp.ts';
/** A full-panel layer above the map: front pages, menus, pictures. */
export interface Screen {
  readonly container: Container;
  update(dt: number): void;
  layout(): void;
  destroy(): void;
  /** Covers the panel completely, so the map need not show. */
  readonly opaque: boolean;
  /** Stops the party from walking. */
  readonly blocking: boolean;
  /** The game may save while this is open: nothing on it is half done (the party menu, the save code page). */
  readonly saveSafe?: boolean;
  /** Plays the page's opening motion, once, when it is shown. The page takes input from its first frame regardless. */
  enter?(): void;
}

// -----------------------------------------------------------------------------------------------

/**
 * A picture pasted on: halftoned and clipped to its size, in an ink frame over a hard shadow, and taped at
 * all four corners. A border first puts a paper margin round it, as on a print. The result turns about the
 * picture's middle: the caller places that middle and sets the turn.
 */
export function pastedPicture(name: string, w: number, h: number, u: number, filter: Filter, opts: { shadow: number; drop: number; border?: number }): Container {
  const ms = measures(u);
  const b = opts.border ?? 0;
  const pc = new Container();
  // An isometric scene where the picture is one (src/world/iso_scenes.ts); else its art, covering the box about its middle; its
  // code drawing otherwise. A scene's drawings each own their graphics context, which the page lets go of with it.
  const scene = buildIsoScene(name, w, h);
  const tex = scene ? null : art(`pictures/${name}`);
  let pg: Container;
  if (scene) pg = scene.view;
  else if (tex) {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.scale.set(Math.max(w / tex.width, h / tex.height));
    s.position.set(w / 2, h / 2);
    pg = s;
  } else {
    const g = new Graphics();
    PICTURE_DRAW[name]?.(g, w, h, 0);
    pg = g;
  }
  const mask = new Graphics().rect(0, 0, w, h).fill(0xffffff);
  pg.mask = mask;
  pc.addChild(pg, mask);
  pc.filters = [filter];
  const out = new Container();
  const back = new Graphics().rect(opts.drop - b, opts.drop - b, w + b * 2, h + b * 2).fill(opts.shadow);
  if (b) back.rect(-b, -b, w + b * 2, h + b * 2).fill(PAPER);
  const frame = new Graphics().rect(0, 0, w, h).stroke({ width: b ? ms.l : ms.L, color: INK, alignment: 1 });
  out.addChild(back, pc, frame);
  const tw = Math.round(u * 2.1);
  const th = Math.round(u * 0.8);
  for (const [tx, ty, turn] of [
    [tw * 0.3 - b, th * 0.15 - b, -0.6],
    [w + b - tw * 0.3, th * 0.15 - b, 0.6],
    [tw * 0.3 - b, h + b - th * 0.15, 0.6],
    [w + b - tw * 0.3, h + b - th * 0.15, -0.6],
  ] as const) {
    const tape = new Graphics().rect(-tw / 2, -th / 2, tw, th).fill({ color: POP_YELLOW, alpha: 0.82 });
    tape.position.set(tx, ty);
    tape.rotation = turn;
    out.addChild(tape);
  }
  out.pivot.set(w / 2, h / 2);
  return out;
}

// -----------------------------------------------------------------------------------------------

export class SettingsScreen implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private readonly game: GameContext;
  private menu!: MenuList;
  private readonly onClose: () => void;
  private readonly page: 'main' | 'more';
  /** On touch, the row chosen last, where the band rests while it lasts (the party menu's Settings and More settings keep theirs between visits). */
  private readonly place: MenuPlace | undefined;
  /** The build stamp at the main page's foot; null on More, and where the source runs without Vite. The checks read it. */
  stamp: Text | null = null;

  constructor(game: GameContext, onClose: () => void, page: 'main' | 'more' = 'main', place?: MenuPlace) {
    this.game = game;
    this.onClose = onClose;
    this.page = page;
    this.place = place;
    this.layout();
    game.audio.play('confirm');
  }

  private items(): MenuItem[] {
    const g = this.game;
    const s = g.settings;
    const m = (k: string) => g.msg('settings', k);
    const speeds: Array<[number, string]> = [
      [30, m('slow')],
      [60, m('normal')],
      [120, m('fast')],
      [0, m('instant')],
    ];
    const speedAt = Math.max(0, speeds.findIndex(([v]) => v === s.textSpeed));
    const speedLabel = speeds[speedAt]?.[1] ?? String(s.textSpeed);
    const vol = (v: number) => `${Math.round(v * 10)}/10`;
    // A size this screen no longer offers (Large, chosen on a phone before 29 Oct) sits past the end until stepped down from.
    const sizes = textSizesFor();
    const sizeAt = sizes.includes(s.textSize) ? sizes.indexOf(s.textSize) : sizes.length;
    const sizeLabel = [m('small'), m('normal'), m('large')][Math.max(0, TEXT_SIZES.indexOf(s.textSize as (typeof TEXT_SIZES)[number]))];
    // A change is saved and shown in place, keeping the rows, so a finger on an arrow can go on tapping it.
    const save = () => {
      saveSettings(s);
      g.audio.applyVolumes();
      if (!this.menu.refresh(this.items())) this.layout();
    };
    /** A volume one tenth up or down, stopping at silence and full. */
    const nudge = (v: number, dir: -1 | 1) => Math.max(0, Math.min(1, Math.round((v + dir * 0.1) * 10) / 10));
    /** Confirm on a volume: a fifth up, stopping at full, then round to silence. */
    const cycle = (v: number) => (v >= 1 ? 0 : Math.min(1, Math.round((v + 0.2) * 10) / 10));
    const setSize = (i: number) => {
      if (i === sizeAt || i < 0 || i >= sizes.length) return;
      s.textSize = sizes[i]!;
      saveSettings(s);
      g.relayout();
    };
    /** Reduce motion goes off at once; on, only after the player says yes to the question it asks. */
    const motion = () => {
      if (s.reduceMotion) { s.reduceMotion = false; save(); }
      else g.confirmSetting('motion', () => { s.reduceMotion = true; save(); });
    };
    /** The Print filter goes on at once; off, only after the player says yes to the question it asks. */
    const halftone = () => {
      if (!s.halftone) { s.halftone = true; save(); }
      else g.confirmSetting('halftone', () => { s.halftone = false; save(); });
    };
    /** Battery saver goes off at once; on, only after the player says yes to the question it asks. */
    const battery = () => {
      if (s.batterySaver) { s.batterySaver = false; save(); }
      else g.confirmSetting('battery', () => { s.batterySaver = true; save(); });
    };
    // Confirm, or a tap on the value between the arrows, cycles values; left/right and the arrows stop at the ends. A tap
    // on a row's words only puts the cursor there (the owner, 2026-10-26); the two that need explaining do it in their
    // questions (2026-11-11).
    const back: MenuItem = { id: 'back', label: g.msg('menu', 'back'), onChoose: () => this.onClose() };
    if (this.page === 'main') return [
      {
        id: 'music', label: m('music'),
        detail: vol(s.music),
        ends: { low: s.music <= 0, high: s.music >= 1 },
        onChoose: () => { s.music = cycle(s.music); save(); },
        onAdjust: (dir) => { const v = nudge(s.music, dir); if (v !== s.music) { s.music = v; save(); } },
      },
      {
        id: 'effects', label: m('effects'),
        detail: vol(s.effects),
        ends: { low: s.effects <= 0, high: s.effects >= 1 },
        onChoose: () => { s.effects = cycle(s.effects); save(); g.audio.play('blip'); },
        // Each step plays a blip at the new level, so the player hears what they chose.
        onAdjust: (dir) => { const v = nudge(s.effects, dir); if (v !== s.effects) { s.effects = v; save(); g.audio.play('blip'); } },
      },
      { id: 'controls', label: m('controls'), onChoose: () => g.openControls() },
      { id: 'more', label: m('more'), onChoose: () => g.openMoreSettings() },
      back,
    ];
    return [
      // Recent lines live here, first and so under the cursor as the page opens (the owner, 2026-10-28: moved from the
      // Stats/Item list, on every screen, so that list is shorter).
      { id: 'log', label: m('log'), onChoose: () => g.openLog() },
      {
        id: 'text_speed', label: m('text_speed'),
        detail: speedLabel,
        ends: { low: speedAt === 0, high: speedAt === speeds.length - 1 },
        onChoose: () => { s.textSpeed = speeds[(speedAt + 1) % speeds.length]![0]; save(); },
        onAdjust: (dir) => { const i = speedAt + dir; if (i >= 0 && i < speeds.length) { s.textSpeed = speeds[i]![0]; save(); } },
      },
      {
        id: 'text_size', label: m('text_size'),
        detail: sizeLabel,
        ends: { low: sizeAt === 0, high: sizeAt >= sizes.length - 1 },
        onChoose: () => setSize((sizeAt + 1) % sizes.length),
        onAdjust: (dir) => setSize(sizeAt + dir),
      },
      { id: 'motion', label: m('motion'), detail: s.reduceMotion ? m('on') : m('off'), onChoose: motion, onAdjust: motion },
      { id: 'halftone', label: m('halftone'), detail: s.halftone ? m('on') : m('off'), onChoose: halftone, onAdjust: halftone },
      // Only where it would draw fewer pixels: a phone or tablet denser than 2x (the owner, 2026-11-14).
      ...(saverOffered() ? [{ id: 'battery', label: m('battery'), detail: s.batterySaver ? m('on') : m('off'), onChoose: battery, onAdjust: battery }] : []),
      back,
    ];
  }

  private caption: Caption | null = null;
  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;
  /** Where the sheet and its tab went, for the browser checks. */
  sheet: { plate: { x: number; y: number; w: number; h: number }; top: number; tab: { x: number; y: number; w: number; h: number } | null; room: number } | null = null;

  /**
   * The page: a sheet rising from the foot of an upright phone, or a card elsewhere, with its name
   * on a tab. A caption says what the row under the cursor does, where that is not plain: above the
   * sheet when both fit, beside it on a wide panel where they do not, and otherwise above a list that scrolls.
   */
  layout(): void {
    const g = this.game;
    const l = g.layout;
    const p = l.panel;
    const u = l.unit;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const sh = shade(p.w, p.h);
    // A tap outside the page closes it, like the cancel key.
    sh.on('pointertap', () => this.onClose());
    this.container.addChild(sh);
    const idx = this.menu?.index ?? 0;
    this.menu = new MenuList(this.items(), { bare: true });
    this.menu.index = idx;
    // On touch the band rests on Back, or on the row chosen last while this page keeps one (the owner, 2026-11-12).
    this.menu.restOn(this.menu.items.findIndex((it) => it.id === 'back'), { place: this.place });
    this.menu.onCancel = () => this.onClose();
    withSounds(this.menu, (s) => g.audio.play(s));
    const blip = this.menu.onMove;
    this.menu.onMove = (i) => {
      blip?.(i);
      this.caption?.set(this.menu.items[i]?.help ?? '');
    };
    const bottom = thumbReach(l);
    const gap = Math.round(u * 0.5);
    const helps = this.menu.items.map((i) => i.help ?? '');
    // The build this copy of the game is, tiny and faint in the Settings page's bottom margin, so the card is no taller for it
    // (the owner, 2026-11-11: "a much, much ... smaller font that doesn't cause the window to grow at all").
    const stamp = this.page === 'more' || !BUILD ? null : new Text({
      // Named for the text-size check, which lets this one line under the floor.
      label: 'build_stamp',
      text: g.msg('settings', BUILD.changed ? 'build_changed' : 'build', { sha: BUILD.sha, time: buildTime(BUILD.time) }),
      style: { fontFamily: FONT.body, fontSize: Math.round(u * 0.4), fill: INK_SOFT },
    });
    this.stamp = stamp;
    const build = (above: number) => {
      const room = sheetRoom(l, { titled: true, above });
      this.menu.build(u, bottom ? room.w : u * 16, { w: room.w, h: room.h });
    };
    build(0);
    let geo = sheetGeometry(l, { w: this.menu.width, h: this.menu.height }, { titled: true });
    this.caption = new Caption(u, bottom ? geo.inner.w : geo.plate.w, helps);
    const m = measures(u);
    // Upright, the caption goes above the sheet; elsewhere the caption and the card are centred together.
    const fits = bottom ? geo.top - gap - this.caption.height >= u * 0.5 : geo.plate.y + geo.plate.h + m.S - geo.top + this.caption.height + gap <= p.h - u;
    const beside = !fits && !bottom && p.w - geo.plate.w - u * 2.5 >= u * 10;
    if (beside) {
      this.caption = new Caption(u, Math.min(p.w - geo.plate.w - u * 2.5, u * 16), helps);
      // The card and the caption side by side, centred together.
      const x0 = Math.round((p.w - (geo.plate.w + u + this.caption.width)) / 2);
      const dx = x0 - geo.plate.x;
      geo = { ...geo, plate: { ...geo.plate, x: geo.plate.x + dx }, inner: { ...geo.inner, x: geo.inner.x + dx } };
      this.caption.container.position.set(geo.plate.x + geo.plate.w + u, geo.plate.y);
    } else {
      if (!fits) build(this.caption.height + gap);
      if (!fits || !bottom) geo = sheetGeometry(l, { w: this.menu.width, h: this.menu.height }, { titled: true, above: bottom ? 0 : this.caption.height + gap });
      this.caption.container.position.set(bottom ? geo.inner.x : geo.plate.x, geo.top - gap - this.caption.height);
    }
    const sheet = drawSheet(geo, u, g.msg('settings', this.page === 'more' ? 'more' : 'title'));
    const t = sheet.tab;
    this.sheet = { plate: geo.plate, top: geo.top, tab: t ? { x: t.container.x, y: t.container.y, w: t.width, h: t.height } : null, room: sheetRoom(l, { titled: true, above: fits || beside ? 0 : this.caption.height + gap }).h };
    this.menu.container.position.set(geo.inner.x, geo.inner.y);
    if (stamp) {
      // Between the rows and the card's edge; shrunk if the margin or the rows' width is too small for it, and never wrapped.
      const room = geo.plate.y + geo.plate.h - m.L - (geo.inner.y + this.menu.height);
      stamp.scale.set(Math.min(1, room / stamp.height, geo.inner.w / stamp.width));
      stamp.position.set(geo.inner.x, geo.plate.y + geo.plate.h - m.L - stamp.height);
    }
    // The line about the row the band is on: on touch, where it rests until a row is pressed.
    this.caption.set(this.menu.items[this.menu.shown]?.help ?? '');
    this.container.addChild(sheet.root, this.caption.container, this.menu.container, ...(stamp ? [stamp] : []));
    this.opening = { skins: [sheet.face, ...this.menu.skins(), ...this.caption.skins(), ...(stamp ? [stamp] : [])], shade: sh, bottom };
  }

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. The list takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  update(): void {
    this.menu.update(this.game.input);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// -----------------------------------------------------------------------------------------------

/**
 * On-map extras: a menu button for touch and mouse players, and short notices
 * such as pickups, printed like a news ticker at the top of the panel.
 */
export class Hud {
  readonly container = new Container();
  readonly chaseWarnings = new Graphics();
  edgeWarningCount = 0;
  /** The positions and scale used to draw the edge cues on the last HUD update. */
  readonly chaseWarningFrames: Array<{ id: string; x: number; y: number; scale: number }> = [];
  private readonly chaseCueAges = new Map<string, number>();
  private readonly game: GameContext;
  private menuButton: Container | null = null;
  /** The button and its key cap, in a layer aligned with the panel but outside its mask (game.ts hudEdgeLayer). */
  readonly edge = new Container();
  /** The mark over whoever the party can talk to from where the leader stands. */
  readonly talkMark = new TalkMark();
  private toasts: Array<{ c: Container; age: number; text: string; w: number; h: number; tilt: number }> = [];
  onMenu: () => void = () => undefined;
  /** The map's name after the party arrives (low in the middle of the panel), or a gain announced large (nearer the middle, away from the party), for a moment; for the checks. */
  placeFlag: { text: string; age: number; tone: 'place' | 'bonus' } | null = null;
  private place: { root: Container; slab: Container; word: Container; letters: Text[]; lines: Graphics; dist: number } | null = null;

  constructor(game: GameContext) {
    this.game = game;
    this.chaseWarnings.eventMode = 'none';
    this.chaseWarnings.label = 'chase_warnings';
    this.container.addChild(this.talkMark.container, this.chaseWarnings);
  }

  layout(): void {
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    this.menuButton?.destroy({ children: true });
    this.menuButton = button(g.msg('party', 'title'), u, () => this.onMenu(), { size: Math.round(u * 1.05), h: Math.max(TOUCH_MIN, Math.round(u * 1.9)), slab: true, icon: newspaperIcon(Math.round(u * 1.3), u), light: () => g.audio.play('blip') });
    // On a phone held upright it sits at the bottom right, within reach of a thumb; elsewhere at the top right.
    const low = thumbReach(g.layout);
    this.menuButton.position.set(p.w - this.menuButton.width - u * 0.5, low ? p.h - this.menuButton.height - u * 0.5 : u * 0.5);
    this.edge.addChild(this.menuButton);
    this.refreshCaps();
    this.placeButton();
    this.drawPlace();
    // Notices showing are made again at the new size, keeping how long they have been up.
    const live = this.toasts.splice(0);
    for (const t of live) t.c.destroy({ children: true });
    for (const t of live) this.toast(t.text, t.age, t.tilt);
  }

  /** The key cap beside the Stats/Item button, for keyboard and gamepad players. */
  cap: Container | null = null;

  /** Draws the cap again for the device in use. */
  /** The Stats/Item button's screen rectangle while it shows, for what must keep clear of it; null while it is hidden. */
  menuBounds(): { x: number; y: number; w: number; h: number } | null {
    const b = this.menuButton;
    if (!b?.visible) return null;
    const r = b.getBounds();
    return { x: r.minX, y: r.minY, w: r.width, h: r.height };
  }

  refreshCaps(): void {
    const g = this.game;
    const u = g.layout.unit;
    this.cap?.destroy({ children: true });
    this.cap = null;
    const b = this.menuButton;
    const prompt = promptFor('menu', g.input.lastDevice, g.settings.keys ?? defaultBindings(), capName(g));
    if (!b || !prompt) return;
    this.cap = keyCap(prompt, u);
    this.cap.position.set(Math.round(b.x - this.cap.width - u * 0.3), Math.round(b.y + (b.height - this.cap.height) / 2));
    this.edge.addChild(this.cap);
  }

  /**
   * On a phone held upright, the button's gap to the bottom of the screen's safe area equals its gap to the right (the owner,
   * 2026-10-27: "the margin between it and the bottom is the same as the margin between it and the right side"), below the
   * panel where there is room. Each step, as the view opens out between the arcade and the printed world.
   */
  private placeButton(): void {
    const b = this.menuButton, g = this.game;
    if (!b || !thumbReach(g.layout)) return;
    const e = g.screenEdges?.();
    if (!e) return;
    const y = Math.round(e.y + e.h - (e.x + e.w - (b.x + b.width)) - b.height);
    if (y === b.y) return;
    b.y = y;
    if (this.cap) this.cap.y = Math.round(b.y + (b.height - this.cap.height) / 2);
  }

  /** How long the map's name stays up after an arrival, and a gain announced, in seconds, their way in and out included. */
  static readonly PLACE_S = 2.8;
  static readonly BONUS_S = 3.6;

  /** Shows the map's name, low in the middle of the panel, for a moment. It never takes taps. */
  showPlace(text: string): void {
    this.placeFlag = { text, age: 0, tone: 'place' };
    this.drawPlace();
  }

  /** Announces something the party gained, as the place's name shows but on a pink band, split at a sentence where it is long. */
  showBonus(text: string): void {
    this.placeFlag = { text, age: 0, tone: 'bonus' };
    this.drawPlace();
  }

  private flagSeconds(): number {
    return this.placeFlag?.tone === 'bonus' ? Hud.BONUS_S : Hud.PLACE_S;
  }

  /**
   * The map's name in big yellow poster capitals on an ink band, printed off register (cyan above, a
   * pink shadow below) and set a little crooked, centred low in the panel above the Stats/Item button
   * when that is at the bottom. A gain is announced the same way on a pink band with an ink shadow, in
   * two or more lines, one a sentence, when one line would be printed too small, a third of the way in
   * from the top or the bottom, whichever is away from the party. Drawn at rest;
   * `posePlace` sets its motion from how long it has shown, so laid out again it carries on where it was.
   */
  private drawPlace(): void {
    this.place?.root.destroy({ children: true });
    this.place = null;
    const f = this.placeFlag;
    if (!f) return;
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    const m = measures(u);
    const size = Math.round(Math.min(u * 4.5, Math.max(u * 2.2, p.h * 0.06, p.w * 0.05)));
    const style = letterStyle(size, POP_YELLOW, { outline: true, extrude: true });
    const measure = new TextStyle(style);
    // How far the pen moves over some letters: measured between two I's, so the leaning letters'
    // overhangs and the outline, which the measure otherwise counts, cancel out.
    const pen = (s: string) => CanvasTextMetrics.measureText(`I${s}I`, measure).width - CanvasTextMetrics.measureText('II', measure).width;
    const bonus = f.tone === 'bonus';
    const width = (s: string) => pen(s) - Number(style.letterSpacing ?? 0);
    // A gain too long for one line at a readable size is split at its sentences.
    let rows = [f.text.toUpperCase()];
    if (bonus && width(rows[0]!) > (p.w - u * 6) / 0.75) rows = (f.text.match(/[^.!?]+[.!?]*/g) ?? [f.text]).map((r) => r.trim().toUpperCase()).filter(Boolean);
    const ww = Math.max(...rows.map(width));
    const lineH = Math.round(size * 1.15);
    const H = Math.round(size * 0.3 + lineH * rows.length);
    // One Text a letter, each where it falls in its line, so each can pop up on its own about its middle.
    const word = new Container();
    const letters: Text[] = [];
    rows.forEach((text, r) => {
      const rw = width(text);
      const y = Math.round(-H / 2 + size * 0.15 + lineH * (r + 0.5) + size * 0.04);
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue;
        const t = new Text({ text: text[i], style });
        const a = pen(text[i]!);
        t.anchor.set(0, 0.5);
        t.pivot.x = a / 2;
        t.position.set(Math.round(pen(text.slice(0, i)) + a / 2 - rw / 2), y);
        word.addChild(t);
        letters.push(t);
      }
    });
    const cut = H * LEAN;
    const bw = Math.round(ww + u * 2 + cut * 2);
    const off = Math.round(u * 0.35);
    const band = (dx: number, dy: number) => [-bw / 2 + cut + dx, -H / 2 + dy, bw / 2 + dx, -H / 2 + dy, bw / 2 - cut + dx, H / 2 + dy, -bw / 2 + dx, H / 2 + dy];
    const slab = new Graphics();
    slab.poly(band(-off, -off)).fill(POP_CYAN);
    slab.poly(band(m.S, m.S)).fill(bonus ? INK : POP_PINK);
    slab.poly(band(0, 0)).stroke({ width: TAB_KEYLINE, color: PAPER, alignment: 0 }).fill(bonus ? POP_PINK : INK);
    // Speed lines trailing the band's left end, while it moves.
    const lines = new Graphics();
    for (const [y, len] of [[-0.3, 0.5], [0.05, 0.8], [0.32, 0.35]] as const) lines.rect(-bw / 2 - off - u * 0.4 - len * bw * 0.5, y * H, len * bw * 0.5, Math.max(2, m.l * 1.5)).fill(POP_YELLOW);
    const slabC = new Container();
    slabC.addChild(lines, slab);
    const root = new Container();
    root.eventMode = 'none';
    root.rotation = -0.035;
    root.addChild(slabC, word);
    // A long name is printed smaller, to fit the panel.
    const k = Math.max(0.5, Math.min(1, (p.w - u * 2) / (bw + off + m.S)));
    root.scale.set(k);
    // The map's name: above the Stats/Item button when it is at the bottom, else near the panel's foot. A gain:
    // nearer the middle, a third of the way in from the top or the bottom, on the side away from the party,
    // so the celebration round them stays in sight.
    const b = this.menuButton;
    const floor = b && thumbReach(g.layout) ? b.y - u * 0.8 : p.h - u * 1.4;
    const half = (H / 2 + m.S) * k;
    const low = floor - half;
    let y = low;
    const w = g.world;
    if (bonus && w) {
      const lead = w.leader;
      const mid = w.worldToPanel(lead.x, lead.y, lead.size)[1];
      // The figure's reach above and below its middle, with its shadow and a little air.
      const reach = lead.size * w.zoom * 1.4 + u;
      y = mid > p.h / 2 ? Math.min(p.h / 3, mid - reach - half) : Math.max((p.h * 2) / 3, mid + reach + half);
      y = Math.max(half + u, Math.min(low, y));
    }
    root.position.set(Math.round(p.w / 2), Math.round(y));
    this.container.addChild(root);
    // How far the band travels to be clear of the panel's edge, in its own units.
    const dist = p.w / 2 / k + bw / 2 + off + m.S + u;
    this.place = { root, slab: slabC, word, letters, lines, dist };
    this.posePlace(f.age);
  }

  /**
   * Sets the map's name `t` seconds in: the band swipes in from the panel's left edge trailing speed
   * lines, and the letters pop up one after another as it lands; at the end the band and the letters are
   * pulled away past the right edge together. With Reduce motion it stands still, there and then gone
   * (a fade would show its layers through one another).
   */
  private posePlace(t: number): void {
    const c = this.place;
    if (!c) return;
    const inS = MS.placeIn / 1000;
    const outS = MS.placeOut / 1000;
    const leave = Math.max(0, Math.min(1, (t - (this.flagSeconds() - outS)) / outS));
    if (motion.reduced) {
      c.slab.x = 0;
      c.word.x = 0;
      c.lines.visible = false;
      for (const l of c.letters) l.scale.set(1);
      return;
    }
    const land = inS * 0.35;
    const arrive = EASE.out(Math.min(1, t / land));
    c.slab.x = leave > 0 ? EASE.in(leave) * c.dist : -(1 - arrive) * c.dist;
    c.word.x = leave > 0 ? c.slab.x : 0;
    // The speed lines show while the band moves, and fade once it has landed.
    c.lines.visible = t < inS || leave > 0;
    c.lines.alpha = leave > 0 ? Math.min(1, leave * 4) : 1 - EASE.out(Math.max(0, Math.min(1, (t - land) / (inS - land))));
    // The letters pop up from nothing, left to right, as the band arrives under them.
    const n = c.letters.length;
    const spread = inS * 0.3;
    const pop = inS * 0.4;
    c.letters.forEach((l, i) => {
      const s = Math.max(0, Math.min(1, (t - inS * 0.3 - (n > 1 ? (spread * i) / (n - 1) : 0)) / pop));
      l.scale.set(s <= 0 ? 0 : EASE.pop(s));
    });
  }

  /** A short notice at the top of the panel, such as a pickup. Several stack, newest last, and restack as they go. */
  toast(text: string, age = 0, tilt?: number, unique = false): void {
    // Repeated saves keep the existing notice and its original expiry instead of stacking or restarting it.
    if (unique && this.toasts.some((t) => t.text === text)) return;
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    // A poster tag (yellow, a pink star, poster capitals), wrapping a long notice.
    const { c, w, h } = posterTag(text, u, { wrapW: p.w - u * 6 });
    // Turned a little about its middle, the other way from the one above it; made again after a relayout, as it was.
    c.pivot.set(w / 2, h / 2);
    const above = this.toasts.at(-1);
    c.rotation = tilt ?? (above && above.tilt < 0 ? 0.03 : -0.03);
    this.container.addChild(c);
    this.toasts.push({ c, age, text, w, h, tilt: c.rotation });
    // At most three at once (two on a short panel): the oldest gives way.
    const most = p.h < 420 ? 2 : 3;
    while (this.toasts.length > most) this.toasts.shift()!.c.destroy({ children: true });
    this.stackToasts();
    // A new notice slaps down from larger; one made again after a relayout is simply there.
    if (age === 0) anim.play(c, c, { scale: 1.6, rotation: 0.2 }, MS.notice, EASE.pop);
  }

  /** Puts the notices one under another from the top, clear of the Stats/Item button when it is up there. */
  private stackToasts(): void {
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    const b = this.menuButton;
    let y = b && !thumbReach(g.layout) ? b.y + b.height + u * 0.4 : u * 0.5;
    for (const t of this.toasts) {
      t.c.position.set(Math.round(p.w / 2), Math.round(y + t.h / 2));
      y += t.h + u * 0.45;
    }
  }

  /** Yellow edge alerts stay visible beside the controls, and paired guards share one cue. */
  private drawChaseWarnings(show: boolean, dt: number): void {
    const ink = this.chaseWarnings;
    clearIfInked(ink); this.edgeWarningCount = 0;
    this.chaseWarningFrames.length = 0;
    if (!show) { this.chaseCueAges.clear(); return; }
    const g = this.game, panel = g.layout.panel;
    const scale = Math.min(2.2, Math.max(1.7, g.layout.unit / 13 * 1.7));
    const peak = motion.reduced ? 1 : PATROL_WARNING_PEAK;
    const hw = 4.6 * scale * peak, hh = 10.6 * scale * peak, margin = 5;
    const reserved = [this.menuButton, this.cap].filter(c => c?.visible).map(c => ({
      x: c!.x - margin, y: c!.y - margin, w: c!.width + margin * 2, h: c!.height + margin * 2,
    }));
    const overlaps = (x: number, y: number) => reserved.some(r => x + hw > r.x && x - hw < r.x + r.w && y + hh > r.y && y - hh < r.y + r.h);
    const seen = new Set<string>();
    for (const cue of g.world?.patrolWarnings() ?? []) {
      if (seen.has(cue.id)) continue;
      if (cue.x >= hw && cue.x <= panel.w - hw && cue.y >= hh && cue.y <= panel.h - hh && !overlaps(cue.x, cue.y)) continue;
      const dx = cue.x - panel.w / 2, dy = cue.y - panel.h / 2;
      const kx = Math.abs(dx) > .01 ? (panel.w / 2 - hw - margin) / Math.abs(dx) : Infinity;
      const ky = Math.abs(dy) > .01 ? (panel.h / 2 - hh - margin) / Math.abs(dy) : Infinity;
      const vertical = kx < ky, k = Math.min(1, kx, ky);
      let x = panel.w / 2 + dx * k, y = panel.h / 2 + dy * k;
      // Slide along the same edge instead of covering the party-menu controls or another warning.
      const clamp = (v: number, half: number, length: number) => Math.max(half + margin, Math.min(length - half - margin, v));
      const candidates = [vertical ? y : x, ...reserved.flatMap(r => vertical ? [r.y - hh - margin, r.y + r.h + hh + margin] : [r.x - hw - margin, r.x + r.w + hw + margin])]
        .map(v => clamp(v, vertical ? hh : hw, vertical ? panel.h : panel.w))
        .sort((a, b) => Math.abs(a - (vertical ? y : x)) - Math.abs(b - (vertical ? y : x)));
      const at = candidates.find(v => !overlaps(vertical ? x : v, vertical ? v : y));
      if (at === undefined) continue;
      if (vertical) y = at; else x = at;
      const age = (this.chaseCueAges.get(cue.id) ?? 0) + dt;
      this.chaseCueAges.set(cue.id, age);
      const drawn = scale * patrolWarningScale(age, cue.hesitation, motion.reduced);
      this.chaseWarningFrames.push({ id: cue.id, x, y, scale: drawn });
      ink.roundRect(x - 4 * drawn, y - 10 * drawn, 8 * drawn, 20 * drawn, 3 * drawn)
        .fill(0xffd23f).stroke({ width: 1.2 * drawn, color: 0x201b24 });
      ink.rect(x - drawn, y - 7 * drawn, 2 * drawn, 9 * drawn).circle(x, y + 6 * drawn, 1.2 * drawn).fill(0x201b24);
      reserved.push({ x: x - hw - margin, y: y - hh - margin, w: hw * 2 + margin * 2, h: hh * 2 + margin * 2 });
      seen.add(cue.id); this.edgeWarningCount++;
    }
    for (const id of this.chaseCueAges.keys()) if (!seen.has(id)) this.chaseCueAges.delete(id);
  }

  /** Whether the button showed on the last step, so it can be pasted back on when it returns after a scene. */
  private buttonShown = false;

  update(dt: number, showButton: boolean): void {
    this.placeButton();
    if (this.menuButton) {
      // Back after a scene or a fight, its face is pasted on again (only the drawing moves; it takes taps at once).
      if (showButton && !this.buttonShown) pastePanel(this.menuButton, this.menuButton.children[1]!, measures(this.game.layout.unit).S);
      this.menuButton.visible = showButton;
    }
    this.buttonShown = showButton;
    if (this.cap) this.cap.visible = showButton;
    this.drawChaseWarnings(showButton, dt);
    // The mark shows when the party is free to walk, as the button does.
    const g = this.game;
    this.talkMark.update(showButton ? (g.world?.markAnchor() ?? null) : null, g.layout.unit, g.layout.panel);
    // The map's name: gone at once when the party is not free to walk, else up for a moment.
    const f = this.placeFlag;
    if (f && this.place) {
      f.age += dt;
      if (!showButton || f.age >= this.flagSeconds()) {
        this.placeFlag = null;
        this.drawPlace();
      } else this.posePlace(f.age);
    }
    for (const t of [...this.toasts]) {
      t.age += dt;
      t.c.alpha = Math.min(1, t.age * 6, Math.max(0, 2.6 - t.age) * 2);
      if (t.age > 2.6) {
        t.c.destroy({ children: true });
        this.toasts.splice(this.toasts.indexOf(t), 1);
        this.stackToasts();
      }
    }
  }
}

/**
 * The end card's ground: cyan dots on ink, growing out from the middle toward two corners. The credits roll over it
 * too, so FIN arrives on the ground they ran on.
 */
export function finGround(game: GameContext): Graphics {
  const p = game.layout.panel;
  const u = game.layout.unit;
  const ground = new Graphics().rect(0, 0, p.w, p.h).fill(INK);
  benDay(ground, { x: 0, y: 0, w: p.w, h: p.h }, { color: POP_CYAN, alpha: 0.45, pitch: u * 1.1, from: [p.w / 2, p.h / 2], to: [0, 0] });
  benDay(ground, { x: 0, y: 0, w: p.w, h: p.h }, { color: POP_CYAN, alpha: 0.45, pitch: u * 1.1, from: [p.w / 2, p.h / 2], to: [p.w, p.h] });
  return ground;
}

/**
 * The end card, as a last poster: the word in yellow poster capitals with a hard pink extrusion, over a
 * field of cyan dots on ink and a throw of confetti under it. The word slams down; Reduce motion keeps it
 * still. The card owns its motion, so whoever takes it down finishes that first. `head` is where its letters start, and
 * `foot` where its confetti ends.
 */
export function finCard(game: GameContext, opts: { background?: boolean; animate?: boolean } = {}): Container & { head: number; foot: number } {
  const p = game.layout.panel;
  const u = game.layout.unit;
  const c = new Container();
  if (opts.background !== false) c.addChild(finGround(game));
  const size = Math.round(Math.min(u * 9, p.w * 0.3));
  const style = letterStyle(size, POP_YELLOW, { outline: true });
  const t = new Text({ text: game.msg('system', 'fin').toUpperCase(), style: { ...style, dropShadow: { color: POP_PINK, alpha: 1, angle: Math.PI / 4, blur: 0, distance: Math.round(size * 0.1) } } });
  t.anchor.set(0.5);
  t.position.set(Math.round(p.w / 2), Math.round(p.h / 2));
  const bits = confetti(new Graphics(), { x: p.w / 2 - t.width * 0.7, y: p.h / 2 + t.height * 0.55, w: t.width * 1.4, h: u * 2 }, u, 5);
  c.addChild(bits, t);
  if (opts.animate !== false) anim.play(c, t, { scale: 1.4, rotation: -0.1, alpha: 0 }, 260, EASE.pop, { delay: 120 });
  // Where the word's yellow starts and the confetti's strip ends, for what goes over and under the card. The drawing starts
  // 0.36 to 0.37 of the size into the word's box (its padding, and the room the font keeps over capitals): measured from
  // Pixi's trimmed drawing of the word in Chromium, WebKit and Firefox at sizes 92 to 234, within a pixel (2026-11-13).
  // The yellow starts half the outline lower: the outline is ink, unseen on the ink ground.
  const outline = (style.stroke as { width: number }).width;
  return Object.assign(c, { head: p.h / 2 - t.height / 2 + size * 0.365 + outline / 2, foot: p.h / 2 + t.height * 0.55 + u * 2 });
}

// -----------------------------------------------------------------------------------------------

interface ConfirmOptions {
  message: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
  /** Yes printed first, as a question put in a story reads ("[Yes] [No]"); the safe answer is still the one picked to start. */
  yesFirst?: boolean;
  /**
   * Yes picked to start, where it is the answer to take: Reload after loading problems (the owner, 15 Nov: "We should have
   * reload as the default, instead of ignore"). It stays where it is printed, on the right as in the game's other questions
   * ("I think the affirmative button should be on the right"); going back or tapping beside the card is still No.
   */
  yesPicked?: boolean;
  /** On touch the band rests on the safe answer; with `glove`, the glove too (the owner, 2026-11-12, for some questions). */
  glove?: boolean;
}

/** A question with two answers, drawn over what is behind it. The safe answer comes first. */
export class ConfirmScreen implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private readonly game: GameContext;
  private readonly opts: ConfirmOptions;
  private menu!: MenuList;

  constructor(game: GameContext, opts: ConfirmOptions) {
    this.game = game;
    this.opts = opts;
    this.layout();
    game.audio.play('confirm');
  }

  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  /**
   * The page: a sheet rising from the foot of an upright phone, or a card elsewhere, with the question
   * over its two answers as printed buttons side by side, the safe one first (or Yes first, with `yesFirst`), the safe one
   * picked to start (or Yes, with `yesPicked`).
   */
  layout(): void {
    const g = this.game;
    const l = g.layout;
    const u = l.unit;
    const yesFirst = this.opts.yesFirst === true;
    const yesAt = yesFirst ? 0 : 1;
    const start = this.opts.yesPicked ? yesAt : 1 - yesAt;
    const idx = this.menu?.index ?? start;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const sh = shade(l.panel.w, l.panel.h);
    sh.on('pointertap', () => this.opts.onNo());
    this.container.addChild(sh);
    const maxW = u * 24;
    const room = sheetRoom(l, { titled: false, maxW });
    const text = new Text({ text: this.opts.message, style: { fontFamily: FONT.body, fontSize: Math.round(u * 1.1), fill: INK, wordWrap: true, wordWrapWidth: room.w, lineHeight: Math.round(u * 1.45) } });
    const no = { label: this.opts.no, onChoose: () => this.opts.onNo() };
    const yes = { label: this.opts.yes, onChoose: () => this.opts.onYes() };
    this.menu = new MenuList(yesFirst ? [yes, no] : [no, yes], { bare: true, buttons: true });
    this.menu.index = idx;
    this.menu.restOn(start, { glove: this.opts.glove });
    withSounds(this.menu, (s) => g.audio.play(s));
    this.menu.onCancel = () => this.opts.onNo();
    const bottom = thumbReach(l);
    const gap = Math.round(u * 1.0);
    const place = () => sheetGeometry(l, { w: Math.max(text.width, this.menu.width), h: text.height + gap + this.menu.height }, { titled: false, maxW });
    this.menu.build(u, bottom ? room.w : Math.min(room.w, Math.max(text.width, u * 16)), { w: room.w });
    let geo = place();
    // The buttons share the sheet's whole width.
    if (this.menu.width < geo.inner.w) {
      this.menu.build(u, geo.inner.w, { w: geo.inner.w });
      geo = place();
    }
    const sheet = drawSheet(geo, u);
    text.position.set(geo.inner.x, geo.inner.y);
    sheet.face.addChild(text);
    this.menu.container.position.set(geo.inner.x, geo.inner.y + text.height + gap);
    this.container.addChild(sheet.root, this.menu.container);
    this.opening = { skins: [sheet.face, ...this.menu.skins()], shade: sh, bottom };
  }

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. It takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  update(): void {
    this.menu.update(this.game.input);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * The pause page during a fight. While any page is open the fight's clock stops,
 * so this is all a pause needs to be. The Warsaw finale's fuse is the exception: it
 * burns on, its placard counting behind the page (the owner, 2026-11-11).
 */
export class PauseScreen implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private readonly game: GameContext;
  private readonly onResume: () => void;
  private readonly onSettings: () => void;
  private readonly onLog: () => void;
  private readonly onQuit: () => void;
  private menu!: MenuList;
  /**
   * On touch the band rests on Resume, with the glove, each time the page opens, and back from Settings or Recent lines on the
   * row that opened them (the owner, 2026-11-12): a place kept only while this page is open.
   */
  private readonly place: MenuPlace = { key: null };

  constructor(game: GameContext, handlers: { resume: () => void; settings: () => void; log: () => void; quit: () => void }) {
    this.game = game;
    this.onResume = handlers.resume;
    this.onSettings = handlers.settings;
    this.onLog = handlers.log;
    this.onQuit = handlers.quit;
    this.layout();
    game.audio.play('confirm');
  }

  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  /** The page: a sheet rising from the foot of an upright phone, or a card elsewhere, with PAUSED on its tab. A tap outside resumes. */
  layout(): void {
    const g = this.game;
    const l = g.layout;
    const p = l.panel;
    const u = l.unit;
    const idx = this.menu?.index ?? 0;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    // Darker than over the map: a fight behind is busier, and the page says it has stopped.
    const sh = shade(p.w, p.h, 0.45);
    sh.on('pointertap', () => this.onResume());
    this.container.addChild(sh);
    this.menu = new MenuList(
      [
        { id: 'resume', label: g.msg('pause', 'resume'), onChoose: () => this.onResume() },
        { id: 'settings', label: g.msg('pause', 'settings'), onChoose: () => this.onSettings() },
        { id: 'log', label: g.msg('pause', 'log'), onChoose: () => this.onLog() },
        { id: 'quit', label: g.msg('pause', 'quit'), onChoose: () => this.onQuit() },
      ],
      { bare: true },
    );
    this.menu.index = idx;
    this.menu.restOn(0, { glove: true, place: this.place });
    withSounds(this.menu, (s) => g.audio.play(s));
    this.menu.onCancel = () => this.onResume();
    const bottom = thumbReach(l);
    const room = sheetRoom(l, { titled: true, maxW: u * 20 });
    this.menu.build(u, bottom ? room.w : u * 12, { w: room.w, h: room.h });
    const geo = sheetGeometry(l, { w: this.menu.width, h: this.menu.height }, { titled: true, maxW: u * 20 });
    const sheet = drawSheet(geo, u, g.msg('system', 'paused'));
    this.menu.container.position.set(geo.inner.x, geo.inner.y);
    this.container.addChild(sheet.root, this.menu.container);
    this.opening = { skins: [sheet.face, ...this.menu.skins()], shade: sh, bottom };
  }

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. It takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  update(): void {
    this.menu.update(this.game.input);
    // The same key that paused the fight carries on with it.
    if (this.game.input.pressed('menu')) this.onResume();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
