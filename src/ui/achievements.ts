import { Container, Graphics, Text } from 'pixi.js';
import type { LookId } from '../art/characters.ts';
import { thumbReach } from '../engine/layout.ts';
import { ACHIEVEMENTS, earned, hundredDone, hundredList, loadProgress, tankSecret, type AchievementId, type HundredList, type Progress } from '../game/achievements.ts';
import type { GameContext } from '../game/context.ts';
import { FONT } from '../render/fonts.ts';
import { EASE, motion } from '../render/motion.ts';
import { BOX, INK, INK_FAINT, INK_SOFT, PAPER, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { pastePanel, riseSheet } from './anim.ts';
import { ghostPicture } from './portrait.ts';
import { drawSheet, measures, shade, sheetGeometry, sheetRoom } from './print.ts';
import type { Screen } from './screens.ts';
import { clip, headline, MenuList, SMALL_TEXT, withSounds, type MenuItem } from './widgets.ts';

/** How wide the achievements' pages may be, in units. */
const PAGE_W = 26;

/** A medal `s` across: a coin on two ribbon tails, its emblem saying which (+5 for the hidden one's share), or a question mark for a secret. In faint ink, and plain, until it is earned. */
function medal(id: AchievementId, s: number, v: number, on: boolean, secret = false): Container {
  const c = new Container();
  const g = new Graphics();
  const r = s / 2;
  const m = measures(v);
  const line = on ? INK : INK_FAINT;
  const tail = (d: number) => [d * 0.15, 0, d * 0.82, 0.1, d * 0.72, 1.22, d * 0.42, 0.98, d * 0.1, 1.12].map((n) => n * r);
  for (const d of [-1, 1]) g.poly(tail(d)).fill(on ? POP_PINK : BOX).stroke({ width: m.l, color: line });
  g.circle(0, 0, r * 0.86).fill(on ? POP_YELLOW : BOX).stroke({ width: m.L, color: line });
  g.circle(0, 0, r * 0.66).stroke({ width: m.l, color: line, alpha: 0.55 });
  c.addChild(g);
  if (id === 'tank_at_one' && !secret) {
    const t = new Graphics();
    t.roundRect(-r * 0.46, r * 0.1, r * 0.92, r * 0.26, r * 0.13).fill(line);
    t.rect(-r * 0.36, -r * 0.08, r * 0.72, r * 0.2).fill(line);
    t.rect(-r * 0.18, -r * 0.27, r * 0.36, r * 0.2).fill(line);
    t.rect(r * 0.16, -r * 0.22, r * 0.38, r * 0.08).fill(line);
    c.addChild(t);
  } else {
    const word = new Text({ text: secret ? '?' : id === 'finished' ? 'FIN' : id === 'unnuked' ? '+5' : '100', style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(r * 0.62), fill: line } });
    word.anchor.set(0.5);
    c.addChild(word);
  }
  c.eventMode = 'none';
  return c;
}

/** A line of body text in soft ink. */
const body = (s: string, size: number, w: number) => new Text({ text: s, style: { fontFamily: FONT.body, fontSize: size, fill: INK_SOFT, wordWrap: true, wordWrapWidth: Math.max(1, w) } });

/** An achievement's line: plain body text, or one line per bullet ("• " opening a line of it), each wrapping under its own
 * first word rather than under the bullet. */
function lineOf(s: string, size: number, w: number): Container {
  if (!s.includes('\n• ') && !s.startsWith('• ')) return body(s, size, w);
  const c = new Container();
  const dot = body('•', size, w);
  const indent = Math.ceil(dot.width + size * 0.4);
  dot.destroy();
  let y = 0;
  for (const part of s.split('\n')) {
    const bullet = part.startsWith('• ');
    const words = body(bullet ? part.slice(2) : part, size, bullet ? w - indent : w);
    words.position.set(bullet ? indent : 0, y);
    if (bullet) { const b = body('•', size, w); b.position.set(0, y); c.addChild(b); }
    c.addChild(words);
    y += words.height;
  }
  return c;
}

/** The opening and shape every achievements page shares: a sheet with a list under what it shows. */
abstract class AchievementPage implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  protected readonly game: GameContext;
  protected readonly onClose: () => void;
  protected readonly progress: Progress = loadProgress();
  protected readonly list: HundredList;
  private menu: MenuList | null = null;
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  constructor(game: GameContext, onClose: () => void) {
    this.game = game;
    this.onClose = onClose;
    this.list = hundredList(game.content);
    game.audio.play('confirm');
  }

  protected abstract title(): string;
  protected abstract items(): MenuItem[];
  /** The page's contents, `w` across, at the drawing unit `v`; its height is what it drew. */
  protected abstract draw(w: number, v: number): Container;

  layout(): void {
    const g = this.game;
    const l = g.layout;
    const u = l.unit;
    const p = l.panel;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const sh = shade(p.w, p.h);
    sh.on('pointertap', () => this.onClose());
    this.container.addChild(sh);
    const index = this.menu?.index ?? 0;
    this.menu = new MenuList(this.items(), { bare: true });
    this.menu.index = index;
    this.menu.onCancel = () => this.onClose();
    withSounds(this.menu, (s) => g.audio.play(s));
    const bottom = thumbReach(l);
    const room = sheetRoom(l, { titled: true, maxW: u * PAGE_W });
    const w = bottom ? room.w : Math.min(room.w, u * (PAGE_W - 1.2));
    this.menu.build(u, w, { w: room.w, h: room.h });
    const gap = Math.round(u * 0.3);
    // A short window draws the contents smaller rather than scrolling them.
    let contents = this.draw(w, u);
    const spare = room.h - this.menu.height - gap;
    if (contents.height > spare) {
      const v = u * Math.max(0.5, spare / contents.height);
      contents.destroy({ children: true });
      contents = this.draw(w, v);
    }
    const h = Math.ceil(contents.height);
    const geo = sheetGeometry(l, { w, h: h + gap + this.menu.height }, { titled: true, maxW: u * PAGE_W });
    const sheet = drawSheet(geo, u, this.title());
    contents.position.set(geo.inner.x, geo.inner.y);
    this.menu.container.position.set(geo.inner.x, geo.inner.y + h + gap);
    this.container.addChild(sheet.root, contents, this.menu.container);
    this.opening = { skins: [sheet.face, contents, ...this.menu.skins()], shade: sh, bottom };
  }

  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  update(): void {
    this.menu?.update(this.game.input);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** The page the main menu opens: the three achievements, the middle one with its meter and a way into its details. */
export class AchievementsScreen extends AchievementPage {
  private readonly onDetails: () => void;

  constructor(game: GameContext, onClose: () => void, onDetails: () => void) {
    super(game, onClose);
    this.onDetails = onDetails;
    this.layout();
  }

  protected title(): string {
    return this.game.msg('achievements', 'title');
  }

  protected items(): MenuItem[] {
    return [
      { id: 'details', label: this.game.msg('achievements', 'details', { percent: hundredDone(this.progress, this.list).percent }), onChoose: () => this.onDetails() },
      { id: 'back', label: this.game.msg('menu', 'back'), onChoose: () => this.onClose() },
    ];
  }

  protected draw(w: number, v: number): Container {
    const g = this.game;
    const c = new Container();
    const have = earned(this.progress, this.list);
    const m = (k: string, vars?: Record<string, string | number>) => g.msg('achievements', k, vars);
    const share = hundredDone(this.progress, this.list).percent;
    const ms = Math.round(v * 2.7);
    const textX = ms + Math.round(v * 0.7);
    let y = Math.round(v * 0.2);
    for (const id of ACHIEVEMENTS) {
      const on = have.includes(id);
      const secret = id === 'tank_at_one' && tankSecret(this.progress);
      const words = secret ? 'secret' : id;
      // The 100% one's share is on the row below the list that opens its details (the owner, 2026-11-11).
      const state = headline(m(on ? 'earned' : 'not_yet'), Math.round(v * 1.05), { fill: on ? INK : INK_FAINT });
      const name = headline(m(`${words}_name`), Math.round(v * 1.3), { fill: on ? INK : INK_SOFT, fontWeight: '700' });
      clip(name, w - textX - state.width - v);
      name.position.set(textX, y);
      state.position.set(w - state.width, y + Math.round((name.height - state.height) / 2));
      // The secret one has its name alone (the owner, 2026-11-13: its line "seems unnecessary").
      const line = secret ? null : lineOf(m(`${words}_line`), Math.round(v * SMALL_TEXT), w - textX);
      line?.position.set(textX, y + name.height);
      c.addChild(name, state);
      if (line) c.addChild(line);
      let bottom = line ? line.y + line.height : y + name.height;
      if (id === 'hundred') {
        const barH = Math.max(6, Math.round(v * 0.55));
        const mm = measures(v);
        const bar = new Graphics().rect(textX, bottom + v * 0.2, w - textX, barH).fill(BOX);
        // Full at 100; the hidden one's 105 keeps it full.
        if (share > 0) bar.rect(textX, bottom + v * 0.2, (w - textX) * Math.min(1, share / 100), barH).fill(POP_PINK);
        bar.rect(textX, bottom + v * 0.2, w - textX, barH).stroke({ width: mm.l, color: INK });
        c.addChild(bar);
        bottom += v * 0.2 + barH;
        // The whole row opens the details, as the list's row does.
        const hit = new Graphics().rect(0, y - v * 0.2, w, bottom - y + v * 0.4).fill({ color: 0xffffff, alpha: 0.001 });
        hit.eventMode = 'static';
        hit.cursor = 'pointer';
        hit.on('pointertap', () => this.onDetails());
        c.addChild(hit);
      }
      const rowH = Math.max(ms * 1.15, bottom - y);
      const badge = medal(id, ms, v, on, secret);
      badge.position.set(ms / 2, y + ms / 2);
      c.addChild(badge);
      y += rowH + Math.round(v * 0.55);
    }
    return c;
  }
}

/** The 100% achievement's details: how much of each thing, with the ghosts as tiny pictures in their groups. */
export class AchievementDetails extends AchievementPage {
  constructor(game: GameContext, onClose: () => void) {
    super(game, onClose);
    this.layout();
  }

  protected title(): string {
    return this.game.msg('achievements', 'hundred_name');
  }

  protected items(): MenuItem[] {
    return [{ id: 'back', label: this.game.msg('menu', 'back'), onChoose: () => this.onClose() }];
  }

  /** A ghost standing on `y`, `high` tall, centred on `x`, as a dark shape until it is beaten. */
  private ghost(c: Container, kind: string, x: number, y: number, high: number, on: boolean): void {
    const one = ghostPicture(this.game.content.enemies[kind]?.look as LookId, high, on);
    one.position.set(x, y - high / 2.05);
    c.addChild(one);
  }

  protected draw(w: number, v: number): Container {
    const g = this.game;
    const c = new Container();
    const m = (k: string) => g.msg('achievements', k);
    const p = this.progress;
    const list = this.list;
    const mm = measures(v);
    const gap = Math.round(v * 0.75);
    let y = Math.round(v * 0.1);
    /** A row's words and count, and how far down its pictures may start. */
    const row = (label: string, count: string | null, soft = false) => {
      const name = headline(label, Math.round(v * 1.1), { fill: soft ? INK_FAINT : INK, fontWeight: '700' });
      name.position.set(0, y);
      c.addChild(name);
      if (count) {
        const n = headline(count, Math.round(v * 1.1), { fill: INK });
        n.position.set(w - n.width, y);
        clip(name, w - n.width - v);
        c.addChild(n);
      }
      y += name.height + Math.round(v * 0.15);
    };
    const pellets = list.pellets.filter((k) => p.pellets.includes(k)).length;
    row(m('pellets'), `${pellets}/${list.pellets.length}`);
    const dots = new Graphics();
    const r = v * 0.46;
    list.pellets.forEach((k, i) => {
      const on = p.pellets.includes(k);
      dots.circle(r + mm.l + i * (r * 2 + v * 0.4), y + r + mm.l, r).fill(on ? POP_YELLOW : BOX).stroke({ width: mm.l, color: on ? INK : INK_FAINT });
    });
    c.addChild(dots);
    y += r * 2 + mm.l * 2 + gap;

    const all = list.ghostGroups.flat();
    row(m('ghosts'), `${all.filter((k) => p.ghosts.includes(k)).length}/${all.length}`);
    // The tiny pictures in their groups, shrunk to fit a narrow page.
    const part = 0.9;
    const groupGap = 0.55;
    const want = all.length * part * 1.5 + (list.ghostGroups.length - 1) * groupGap;
    const high = v * 1.5 * Math.min(1, w / (want * v));
    const cell = high * part;
    const between = high * (groupGap / 1.5);
    let x = 0;
    for (const group of list.ghostGroups) {
      for (const kind of group) {
        this.ghost(c, kind, x + cell / 2, y + high, high, p.ghosts.includes(kind));
        x += cell;
      }
      x += between;
    }
    y += high + gap;

    const patrols = list.patrols.filter((k) => p.patrols.includes(k)).length;
    row(m('patrols'), `${patrols}/${list.patrols.length}`);
    const ticks = new Graphics();
    const tick = Math.min(v * 0.62, (w - (list.patrols.length - 1) * v * 0.22) / list.patrols.length);
    list.patrols.forEach((k, i) => {
      const on = p.patrols.includes(k);
      ticks.rect(i * (tick + v * 0.22), y, tick, v * 0.8).fill(on ? POP_PINK : BOX).stroke({ width: mm.l, color: on ? INK : INK_FAINT });
    });
    c.addChild(ticks);
    y += v * 0.8 + gap;

    /** A boss's row, with a box that is ticked once it is beaten. */
    const boss = (label: string, on: boolean, soft: boolean) => {
      const top = y;
      row(label, null, soft);
      const s = Math.round(v * 1.15);
      const box = new Graphics().rect(w - s, top, s, s).fill(on ? POP_YELLOW : BOX).stroke({ width: mm.L, color: soft ? INK_FAINT : INK });
      if (on) box.moveTo(w - s * 0.8, top + s * 0.52).lineTo(w - s * 0.56, top + s * 0.76).lineTo(w - s * 0.2, top + s * 0.26).stroke({ width: mm.L, color: INK });
      c.addChild(box);
      y = Math.max(y, top + s) + Math.round(v * 0.45);
    };
    boss(m('tank'), p.tank, false);
    boss(p.warsawMet ? m('warsaw') : m('unknown'), p.warsaw, !p.warsawMet);
    // The hidden one, in words from the start: by the time this page is offered the player has been nuked or has skipped
    // Berlin by the alley (the owner, 2026-11-11).
    boss(m('unnuked'), p.unnuked, false);
    return c;
  }
}

/** How long a notification is whole, in seconds, and how long it takes to come and go. */
const TOAST_HOLD = 5.5;
const TOAST_OPEN = 0.5;
const TOAST_SHUT = 0.28;

/**
 * The notification when an achievement is earned, of the stereotypical kind: at the foot of the panel a medal pops up,
 * a dark pill unrolls out of it with the words, and after a few seconds it rolls back in. It takes no input.
 */
export class AchievementToast {
  readonly container = new Container();
  private readonly game: GameContext;
  private readonly id: AchievementId;
  private age = 0;
  private coin: Container | null = null;
  private plate: Graphics | null = null;
  private words: Container | null = null;
  private size = { w: 0, h: 0 };
  done = false;

  constructor(game: GameContext, id: AchievementId) {
    this.game = game;
    this.id = id;
    this.container.eventMode = 'none';
    this.layout();
    this.pose();
  }

  layout(): void {
    // A relayout can reach a toast that has just finished and destroyed itself (Fable review, a one-liner).
    if (this.container.destroyed) return;
    const g = this.game;
    const p = g.layout.panel;
    const u = g.layout.unit;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const h = Math.round(u * 3.3);
    const small = new Text({ text: g.msg('achievements', this.id === 'unnuked' ? 'hidden_unlocked' : 'unlocked').toUpperCase(), style: { fontFamily: FONT.body, fontSize: Math.round(u * SMALL_TEXT), fill: POP_YELLOW, letterSpacing: 1 } });
    const name = headline(g.msg('achievements', `${this.id}_name`), Math.round(u * 1.45), { fill: PAPER, fontWeight: '700' });
    const w = Math.round(Math.min(p.w - u, h + Math.max(small.width, name.width) + u * 1.6));
    clip(name, w - h - u);
    clip(small, w - h - u);
    const words = new Container();
    small.position.set(0, 0);
    name.position.set(0, small.height);
    words.addChild(small, name);
    words.position.set(h + Math.round(u * 0.1), Math.round((h - words.height) / 2));
    this.plate = new Graphics();
    this.coin = medal(this.id, Math.round(h * 0.86), u, true);
    this.coin.position.set(h / 2, h / 2);
    this.words = words;
    this.size = { w, h };
    this.container.addChild(this.plate, words, this.coin);
    this.container.position.set(Math.round((p.w - w) / 2), Math.round(p.h - h - u));
    this.pose();
  }

  private pose(): void {
    const { w, h } = this.size;
    const reduced = motion.reduced;
    const shut = this.age - TOAST_OPEN - TOAST_HOLD;
    const clamp = (k: number) => Math.max(0, Math.min(1, k));
    const pop = reduced ? 1 : shut > 0 ? 1 - clamp((shut - TOAST_SHUT * 0.6) / (TOAST_SHUT * 0.4)) : EASE.pop(clamp(this.age / 0.22));
    const open = reduced ? (shut > 0 ? 0 : 1) : shut > 0 ? 1 - EASE.out(clamp(shut / (TOAST_SHUT * 0.7))) : EASE.out(clamp((this.age - 0.18) / (TOAST_OPEN - 0.18)));
    const u = this.game.layout.unit;
    this.coin!.scale.set(pop);
    const now = h + (w - h) * open;
    this.plate!.clear();
    if (pop > 0.02) this.plate!.roundRect(0, 0, now, h, h / 2).fill(INK).stroke({ width: measures(u).L, color: POP_YELLOW });
    this.words!.alpha = clamp((open - 0.6) / 0.4);
  }

  update(dt: number): void {
    if (this.done) return;
    this.age += dt;
    this.pose();
    if (this.age >= TOAST_OPEN + TOAST_HOLD + TOAST_SHUT) {
      this.done = true;
      this.container.destroy({ children: true });
    }
  }
}
