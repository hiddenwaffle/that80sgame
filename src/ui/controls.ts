import { Container, Graphics } from 'pixi.js';
import { defaultBindings, keyName, rebind, REMAPPABLE, type KeyBindings, type RemappableAction } from '../engine/input.ts';
import type { GameContext } from '../game/context.ts';
import { RED_INK } from '../render/palette.ts';
import { EASE, motion } from '../render/motion.ts';
import { saveSettings } from '../game/settings.ts';
import type { Screen } from './screens.ts';
import { thumbReach } from '../engine/layout.ts';
import { anim, pastePanel, riseSheet } from './anim.ts';
import { drawSheet, measures, shade, sheetGeometry, sheetRoom } from './print.ts';
import { capName } from './prompts.ts';
import { MenuList, withSounds, type MenuItem } from './widgets.ts';

/**
 * The Controls page: each action with its keys. Choosing an action waits for a
 * key press, which becomes that action's first key and leaves any other action.
 * Esc keeps things as they were. Reset puts every key back. It says nothing: waiting
 * shows as an empty key cap on the row with the others faded back, and a key it
 * cannot take shakes the row (the owner, 2026-10-29).
 */
export class ControlsScreen implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private readonly game: GameContext;
  private readonly onClose: () => void;
  private menu!: MenuList;
  /** The action waiting for a key, if any. */
  private waiting: RemappableAction | null = null;

  constructor(game: GameContext, onClose: () => void) {
    this.game = game;
    this.onClose = onClose;
    this.layout();
  }

  private get bindings(): KeyBindings {
    return this.game.settings.keys ?? defaultBindings();
  }

  private store(b: KeyBindings | null): void {
    const s = this.game.settings;
    s.keys = b;
    saveSettings(s);
    this.game.input.setBindings(b ?? defaultBindings());
    // The key caps beside buttons name the keys now in use.
    this.game.refreshCaps();
  }

  /** Waits for the key the player wants for an action. */
  private choose(action: RemappableAction): void {
    this.game.audio.play('confirm');
    this.waiting = action;
    this.layout();
    this.listen(action);
  }

  /**
   * Takes the next key for the waiting action. Esc stops waiting. A key it cannot take shakes the row and it goes on
   * waiting; one that is another action's only key also shows that key in red where it is.
   */
  private listen(action: RemappableAction): void {
    const g = this.game;
    g.input.captureNext((code) => {
      if (code === 'Escape') {
        this.waiting = null;
        g.audio.play('cancel');
        this.layout();
        return;
      }
      const r = rebind(this.bindings, action, code);
      if (r.ok) {
        this.waiting = null;
        this.store(r.bindings);
        g.audio.play('confirm');
        this.layout();
        return;
      }
      g.audio.play('cancel');
      this.shake(REMAPPABLE.indexOf(action));
      if (r.reason === 'last_key') this.flash(REMAPPABLE.indexOf(r.action));
      this.listen(action);
    });
  }

  /** No, without words: the row's words and keys shake once (with reduced motion they hold still; the sound says it). */
  private shake(i: number): void {
    const parts = this.menu.rowParts(i);
    if (!parts || motion.reduced) return;
    const skins = [parts.label, parts.caps].filter((s): s is NonNullable<typeof s> => s !== null);
    const rest = skins.map((s) => s.x), amp = this.game.layout.unit * 0.35;
    void anim.run(this, 320, EASE.out, (k) => skins.forEach((s, j) => { if (!s.destroyed) s.x = rest[j]! + (k >= 1 ? 0 : Math.sin(k * Math.PI * 6) * (1 - k) * amp); }));
  }

  /** A row's keys in red for a moment, at full strength on a faded row: where the refused key is another action's only one. */
  private flash(i: number): void {
    const caps = this.menu.rowParts(i)?.caps;
    if (!caps) return;
    const faded = caps.alpha;
    caps.alpha = 1;
    caps.tint = RED_INK;
    void anim.run(caps, 700, EASE.out, (k) => {
      if (k < 1 || caps.destroyed) return;
      caps.tint = 0xffffff;
      caps.alpha = faded;
    });
  }

  private items(): MenuItem[] {
    const g = this.game;
    const b = this.bindings;
    const short = capName(g);
    const rows: MenuItem[] = REMAPPABLE.map((a) => ({
      label: g.msg('controls', a),
      detail: b[a].map((k) => this.name(k)).join(', ') || g.msg('controls', 'none'),
      caps: b[a].map((k) => keyName(k, short)),
      capWaiting: this.waiting === a,
      onChoose: () => (this.game.input.lastDevice === 'gamepad' ? this.padFixed() : this.choose(a)),
    }));
    rows.push({
      label: g.msg('controls', 'reset'),
      onChoose: () => {
        this.waiting = null;
        g.input.cancelCapture();
        this.store(null);
        g.audio.play('confirm');
        this.layout();
      },
    });
    rows.push({ id: 'back', label: g.msg('controls', 'back'), onChoose: () => this.close() });
    return rows;
  }

  private name(code: string): string {
    return keyName(code, (c) => this.game.content.messages.keys?.[c]);
  }

  private close(): void {
    this.game.input.cancelCapture();
    this.game.audio.play('cancel');
    this.onClose();
  }

  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  /**
   * The page: a sheet rising from the foot of an upright phone, or a card elsewhere, with CONTROLS on its
   * tab and each action's keys as small key caps. No words beyond those: a controls page needs no explaining
   * (the owner, 2026-10-29).
   */
  layout(): void {
    const g = this.game;
    const l = g.layout;
    const p = l.panel;
    const u = l.unit;
    const idx = this.menu?.index ?? 0;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const sh = shade(p.w, p.h);
    sh.on('pointertap', () => {
      // While waiting for a key, a tap outside stops waiting, which is how a player with no keyboard gets out.
      if (this.waiting) {
        this.waiting = null;
        this.game.input.cancelCapture();
        this.game.audio.play('cancel');
        this.layout();
      } else this.close();
    });
    this.container.addChild(sh);
    this.menu = new MenuList(this.items(), { bare: true });
    this.menu.index = Math.min(idx, this.menu.items.length - 1);
    // On touch the band rests on Back (the owner, 2026-11-12).
    this.menu.restOn(this.menu.items.length - 1);
    withSounds(this.menu, (s) => g.audio.play(s));
    this.menu.onCancel = () => this.close();
    const bottom = thumbReach(l);
    const maxW = u * 24;
    const room = sheetRoom(l, { titled: true, maxW });
    const width = bottom ? room.w : Math.min(room.w, u * 20);
    this.menu.build(u, width, { w: room.w });
    // On a short panel a card is scaled down whole rather than scroll: the top of its tab at the panel's top, the foot of its
    // shadow at the panel's foot (the owner, 2026-10-29). A sheet rising from a phone's foot scrolls its list instead.
    const tall = this.menu.height > room.h;
    if (tall && bottom) this.menu.build(u, width, { w: room.w, h: room.h });
    const geo = sheetGeometry(l, { w: this.menu.width, h: this.menu.height }, { titled: true, maxW });
    const sheet = drawSheet(geo, u, g.msg('controls', 'title'));
    this.menu.container.position.set(geo.inner.x, geo.inner.y);
    const card = new Container();
    card.label = 'controls_card';
    card.addChild(sheet.root, this.menu.container);
    if (tall && !bottom) {
      const b = card.getLocalBounds();
      const k = p.h / (b.maxY - b.minY);
      card.scale.set(k);
      card.position.set(p.w / 2 - (geo.plate.x + geo.plate.w / 2) * k, -b.minY * k);
    }
    this.container.addChild(card);
    const skins: Container[] = [sheet.face, ...this.menu.skins()];
    if (this.waiting) this.menu.dimExcept(REMAPPABLE.indexOf(this.waiting));
    this.opening = { skins, shade: sh, bottom };
  }

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. It takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  /** A gamepad player choosing a row: pads keep their usual buttons, so the row shakes no. */
  private padFixed(): void {
    this.game.audio.play('cancel');
    this.shake(this.menu.index);
  }

  update(): void {
    const input = this.game.input;
    // While waiting for a key, the list stays still: the key goes to the choice. Keys are taken by the
    // wait, but a gamepad's buttons are not, so its Cancel or Menu stops waiting, as Esc does.
    if (this.waiting) {
      if (input.pressed('cancel') || input.pressed('menu')) {
        input.consume('cancel');
        input.consume('menu');
        this.waiting = null;
        input.cancelCapture();
        this.game.audio.play('cancel');
        this.layout();
      }
      return;
    }
    this.menu.update(input);
  }

  destroy(): void {
    this.game.input.cancelCapture();
    this.container.destroy({ children: true });
  }
}
