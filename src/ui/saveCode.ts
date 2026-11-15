import { Container, Graphics, Text } from 'pixi.js';
import type { GameContext } from '../game/context.ts';
import { warmArt } from '../art/images.ts';
import { exportSave, importSave, type GameState } from '../game/state.ts';
import { FONT } from '../render/fonts.ts';
import { CAPTION, INK, INK_SOFT, PAPER, POP_PINK, RED_INK } from '../render/palette.ts';
import { thumbReach } from '../engine/layout.ts';
import { pastePanel, riseSheet } from './anim.ts';
import { drawSheet, measures, shade, sheetGeometry, sheetRoom } from './print.ts';
import type { Screen } from './screens.ts';
import { MenuList, SMALL_TEXT, withSounds, type MenuItem } from './widgets.ts';
import { saveSummary } from '../game/saveSummary.ts';

/**
 * The save code pages. One shows the current save as a code to copy out; the
 * other takes a code pasted back in, from the title page.
 *
 * Everything is drawn in the canvas. The one piece of HTML is a transparent text
 * field laid exactly over the drawn code box, so the phone's own tap-and-hold
 * menu can paste into it. The code to copy out is not selectable: the Copy answer
 * does the copying, and a selection left standing brought up the browser's own
 * loupe and menu (the owner, 14 Nov, iPhone and Galaxy Chrome).
 */

interface FieldOptions {
  readonly: boolean;
  /** What screen readers announce for the field, from messages.yaml. */
  label: string;
  value?: string;
  input: GameContext['input'];
  onInput?: (v: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  /** Called when the field gains or loses focus, so the drawn box can show it. */
  onFocus?: (focused: boolean) => void;
}

/** A transparent text field over the drawn code box. */
class CodeField {
  readonly el: HTMLTextAreaElement;
  private readonly input: GameContext['input'];
  private static styled = false;

  constructor(opts: FieldOptions) {
    CodeField.addStyle();
    const el = document.createElement('textarea');
    el.className = 'save-code-field';
    el.readOnly = opts.readonly;
    el.value = opts.value ?? '';
    el.spellcheck = false;
    el.autocomplete = 'off';
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('aria-label', opts.label);
    // Codes are pasted, not typed: no on-screen keyboard to shrink the page. Tap and hold still pastes.
    if (!opts.readonly) el.setAttribute('inputmode', 'none');
    el.addEventListener('input', () => opts.onInput?.(el.value));
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      // The game's own key handling must not also see this press.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') opts.onEnter?.();
      else {
        el.blur();
        opts.onEscape?.();
      }
    });
    // A read-only code cannot be selected (see addStyle), so it cannot be copied in pieces either. Ctrl or Cmd+C with the field
    // focused still takes the whole code.
    if (opts.readonly) {
      el.addEventListener('copy', (e) => {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', el.value);
      });
    }
    el.addEventListener('focus', () => {
      // While the field has the keyboard, typing must not also move the party or pick menu rows.
      opts.input.suspended = true;
      opts.onFocus?.(true);
    });
    el.addEventListener('blur', () => {
      opts.input.suspended = false;
      // A selection left standing keeps the browser's loupe or menu up (Galaxy Chrome's does not go until an item is tapped).
      if (!opts.readonly) el.setSelectionRange(el.selectionEnd, el.selectionEnd);
      window.getSelection()?.removeAllRanges();
      opts.onFocus?.(false);
    });
    document.body.appendChild(el);
    this.el = el;
    this.input = opts.input;
  }

  private static addStyle(): void {
    if (CodeField.styled) return;
    CodeField.styled = true;
    const style = document.createElement('style');
    // 16px text stops iPhone Safari zooming in on focus. Transparent text keeps the drawn box the
    // only thing seen; the page turns off selection everywhere else, so it is turned back on here, but only for the field
    // that takes a paste. The read-only code is selectable just while Copy's fallback runs (.copying).
    // While the game is paused with the phone held sideways, the field is not there to be tapped.
    style.textContent = `.save-code-field{position:fixed;margin:0;padding:0;border:0;outline:none;resize:none;overflow:hidden;
      background:transparent;color:transparent;caret-color:transparent;font:16px monospace;z-index:5;
      -webkit-user-select:text;user-select:text;-webkit-touch-callout:default;-webkit-tap-highlight-color:transparent}
      .save-code-field[readonly]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
      .save-code-field[readonly].copying{-webkit-user-select:text;user-select:text}
      .save-code-field::selection{background:transparent;color:transparent}
      .game-sideways .save-code-field{display:none}`;
    document.head.appendChild(style);
  }

  /** Lays the field over a rectangle given in page pixels. */
  place(x: number, y: number, w: number, h: number): void {
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  destroy(): void {
    if (document.activeElement === this.el) this.input.suspended = false;
    this.el.remove();
  }
}

/** Splits text into lines of at most `per` characters, with an ellipsis if there are more than `max`. */
function codeLines(text: string, per: number, max: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < max; i += per) lines.push(text.slice(i, i + per));
  if (text.length > per * max) lines[max - 1] = lines[max - 1]!.slice(0, per - 1) + '…';
  return lines;
}

/** A drawn mark before a result: a red cross for one that went wrong, an ink tick for one that went right. */
function resultMark(bad: boolean, x: number, y: number, u: number): Graphics {
  const s = Math.round(u * 0.9);
  const w = Math.max(2, measures(u).L);
  const g = new Graphics();
  if (bad) g.moveTo(x, y).lineTo(x + s, y + s).moveTo(x + s, y).lineTo(x, y + s).stroke({ width: w, color: RED_INK, cap: 'round' });
  else g.moveTo(x, y + s * 0.55).lineTo(x + s * 0.38, y + s * 0.92).lineTo(x + s, y + s * 0.05).stroke({ width: w, color: INK, cap: 'round', join: 'round' });
  return g;
}

/** The shared page: a sheet with the page's name on its tab, help, the code in a paper well, a status line, and the answers as printed buttons. */
abstract class CodePage implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  protected readonly game: GameContext;
  protected menu!: MenuList;
  protected field!: CodeField;
  protected status = '';
  protected statusBad = false;
  /** The field has focus, so the drawn box shows it is selected or ready for a paste. */
  protected focused = false;
  /** Where the code box was drawn, in panel pixels, for tests and for placing the field. */
  codeBox = { x: 0, y: 0, w: 0, h: 0 };
  protected readonly onClose: () => void;

  constructor(game: GameContext, onClose: () => void) {
    this.game = game;
    this.onClose = onClose;
  }

  protected abstract title(): string;
  protected abstract help(): string;
  /** What the code box shows. */
  protected abstract shown(): { text: string; placeholder: boolean };
  protected abstract items(): MenuItem[];

  close(): void {
    this.game.audio.play('cancel');
    this.onClose();
  }

  /** Shows a result in the page's own status line, where it stays until the next action. */
  protected say(text: string, bad: boolean): void {
    this.status = text;
    this.statusBad = bad;
    this.statusGood = !bad;
    this.layout();
  }

  /**
   * Only the box is redrawn, never the menu: focus leaves the field on the press of a
   * drawn button, and rebuilding the buttons then would lose that button's tap.
   */
  protected setFocused(on: boolean): void {
    this.focused = on;
    this.drawBox();
  }

  private boxG: Graphics | null = null;

  /**
   * The code box, a paper well pressed into the sheet: a shadow along its top and left edges and a fine
   * ink line. While the field has focus it turns caption yellow with a heavy line and a pink edge, so a
   * selection or a waiting paste shows.
   */
  private drawBox(): void {
    const b = this.codeBox;
    const m = measures(this.game.layout.unit);
    const g = this.boxG?.clear();
    if (!g) return;
    g.rect(b.x, b.y, b.w, b.h).fill(this.focused ? CAPTION : PAPER);
    const s = Math.max(3, Math.round(m.S * 0.7));
    g.rect(b.x, b.y, b.w, s).fill({ color: INK, alpha: 0.22 });
    g.rect(b.x, b.y + s, s, b.h - s).fill({ color: INK, alpha: 0.22 });
    if (this.focused) g.rect(b.x, b.y, Math.round(m.u * 0.35), b.h).fill(POP_PINK);
    g.rect(b.x, b.y, b.w, b.h).stroke({ width: this.focused ? m.L : m.l, color: INK, alignment: 1 });
  }

  /** How the status line reads: a result that went wrong (a red cross), one that went right (a tick), or plain. */
  protected statusGood = false;

  layout(): void {
    const g = this.game;
    const l = g.layout;
    const p = l.panel;
    const u = l.unit;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const sh = shade(p.w, p.h);
    this.container.addChild(sh);

    const maxW = u * 28;
    const room = sheetRoom(l, { titled: true, maxW });
    const inner = Math.round(room.w);
    const mono = Math.round(u * SMALL_TEXT);
    const per = Math.max(12, Math.floor((inner - u) / (mono * 0.6)));
    this.menu = this.makeMenu();
    this.menu.build(u, inner, { w: inner });
    const markW = this.status && (this.statusBad || this.statusGood) ? Math.round(u * 1.4) : 0;

    // On a short panel (a short desktop window), drop the help and show fewer code lines so the buttons fit.
    const gap = Math.round(u * 0.6);
    const measure = (withHelp: boolean, rows: number) => {
      const help = withHelp ? new Text({ text: this.help(), style: { fontFamily: FONT.body, fontStyle: 'italic', fontSize: Math.round(u * 0.95), fill: INK_SOFT, wordWrap: true, wordWrapWidth: inner, lineHeight: Math.round(u * 1.3) } }) : null;
      const status = this.status ? new Text({ text: this.status, style: { fontFamily: FONT.body, fontStyle: 'italic', fontSize: Math.round(u * 0.95), fill: this.statusBad ? RED_INK : INK, wordWrap: true, wordWrapWidth: inner - markW, lineHeight: Math.round(u * 1.3) } }) : null;
      const codeH = Math.round(mono * 1.3 * rows + u);
      const h = (help ? help.height + gap : 0) + codeH + gap + (status ? status.height + gap : 0) + u * 0.3 + this.menu.height;
      return { help, status, codeH, rows, h };
    };
    let m = measure(true, 5);
    for (const [withHelp, rows] of [[false, 5], [false, 3], [false, 2]] as const) {
      if (m.h <= room.h) break;
      for (const t of [m.help, m.status]) t?.destroy();
      m = measure(withHelp, rows);
    }
    const shown = this.shown();
    const codeText = new Text({
      text: shown.placeholder ? shown.text : codeLines(shown.text, per, m.rows).join('\n'),
      style: { fontFamily: shown.placeholder ? FONT.body : 'monospace', fontStyle: shown.placeholder ? 'italic' : 'normal', fontSize: mono, fill: shown.placeholder ? INK_SOFT : INK, lineHeight: Math.round(mono * 1.3), wordWrap: shown.placeholder, wordWrapWidth: inner - u },
    });

    const geo = sheetGeometry(l, { w: inner, h: m.h }, { titled: true, maxW });
    const sheet = drawSheet(geo, u, this.title());
    this.container.addChild(sheet.root);
    const x = geo.inner.x;
    let cy = geo.inner.y;
    if (m.help) {
      m.help.position.set(x, cy);
      sheet.face.addChild(m.help);
      cy += m.help.height + gap;
    }
    this.codeBox = { x, y: cy, w: inner, h: m.codeH };
    this.boxG = new Graphics();
    this.drawBox();
    codeText.position.set(x + u * 0.6, cy + u * 0.55);
    sheet.face.addChild(this.boxG, codeText);
    const f = g.panelRectToPage(x, cy, inner, m.codeH);
    this.field.place(f.x, f.y, f.w, f.h);
    cy += m.codeH + gap;
    if (m.status) {
      if (markW) sheet.face.addChild(resultMark(this.statusBad, x, cy + Math.round(u * 0.1), u));
      m.status.position.set(x + markW, cy);
      sheet.face.addChild(m.status);
      cy += m.status.height + gap;
    }
    this.menu.container.position.set(x, Math.round(cy + u * 0.3));
    this.container.addChild(this.menu.container);
    this.opening = { skins: [sheet.face, ...this.menu.skins()], shade: sh, bottom: thumbReach(l) };
  }

  /**
   * The answers, with the cursor kept on the row it was on. A page opens on its main answer, Copy or Load, so a code
   * pasted in loads with Enter (the owner, 2026-10-23), even though Load is greyed until there is a code.
   */
  private makeMenu(): MenuList {
    const items = this.items();
    const menu = new MenuList(items, { bare: true, buttons: true });
    menu.index = Math.min(this.menu?.index ?? Math.max(0, items.findIndex((i) => i.main)), items.length - 1);
    withSounds(menu, (s) => this.game.audio.play(s));
    menu.onCancel = () => this.close();
    return menu;
  }

  /** What moves as the page opens, and how. */
  private opening: { skins: Container[]; shade: Graphics; bottom: boolean } | null = null;

  /** Opening: the sheet rises on an upright phone, or the card is pressed onto the page. It takes input at once. */
  enter(): void {
    const o = this.opening;
    if (!o) return;
    if (o.bottom) riseSheet(this, o.skins, o.shade, this.game.layout.unit);
    else pastePanel(this, o.skins, measures(this.game.layout.unit).S);
  }

  update(_dt: number): void {
    this.menu.update(this.game.input);
  }

  destroy(): void {
    this.field.destroy();
    this.container.destroy({ children: true });
  }
}

/** Shows the current save as a code, with Copy. */
export class SaveCodeOut extends CodePage {
  /** A player switching apps to paste the code is at a safe point to save. */
  readonly saveSafe = true;
  private readonly code: string;

  constructor(game: GameContext, onClose: () => void) {
    super(game, onClose);
    this.code = exportSave(game.state);
    this.field = new CodeField({
      readonly: true,
      label: game.msg('savecode', 'out_title'),
      value: this.code,
      input: game.input,
      onEscape: () => this.close(),
      onFocus: (on) => this.setFocused(on),
    });
    this.status = game.msg('savecode', 'size', { count: this.code.length.toLocaleString('en-US') });
    this.layout();
    game.audio.play('confirm');
  }

  protected title(): string {
    return this.game.msg('savecode', 'out_title');
  }

  protected help(): string {
    return this.game.msg('savecode', 'out_help');
  }

  protected shown(): { text: string; placeholder: boolean } {
    return { text: this.code, placeholder: false };
  }

  protected items(): MenuItem[] {
    const g = this.game;
    return [
      { label: g.msg('savecode', 'copy'), main: true, onChoose: () => void this.copy() },
      { id: 'back', label: g.msg('savecode', 'back'), onChoose: () => this.close() },
    ];
  }

  /** Copies the code, by the clipboard if the browser allows, or by selecting the hidden field. */
  private async copy(): Promise<void> {
    const g = this.game;
    let ok = false;
    try {
      if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(this.code);
        ok = true;
      }
    } catch (err) {
      console.warn('Save code: the browser would not copy; trying the text field.', err);
    }
    if (!ok && this.field.el.isConnected) {
      const el = this.field.el;
      // Selectable only for this: selecting a field the page has switched off selection for fails in some browsers (Safari's).
      el.classList.add('copying');
      try {
        el.focus();
        el.select();
        el.setSelectionRange(0, el.value.length);
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      // Nothing is left selected, so no loupe or menu stays up (the blur handler also clears the page's selection).
      el.setSelectionRange(0, 0);
      el.blur();
      el.classList.remove('copying');
      window.getSelection()?.removeAllRanges();
    }
    if (!this.field.el.isConnected) return;
    g.audio.play(ok ? 'confirm' : 'cancel');
    this.say(g.msg('savecode', ok ? 'copied' : 'copy_failed'), !ok);
  }
}

/** Takes a pasted code and, once it checks out, loads it. */
export class SaveCodeIn extends CodePage {
  private value = '';
  private found: GameState | null = null;
  private readonly onLoad: (s: GameState) => void;
  /** Ctrl or Cmd+V anywhere on the page pastes, without the field needing the keyboard. */
  private readonly onPaste = (e: ClipboardEvent) => {
    if (e.target === this.field.el) return;
    const text = e.clipboardData?.getData('text');
    if (text === undefined) return;
    e.preventDefault();
    this.setValue(text);
  };

  constructor(game: GameContext, onClose: () => void, onLoad: (s: GameState) => void) {
    super(game, onClose);
    this.onLoad = onLoad;
    this.field = new CodeField({
      readonly: false,
      label: game.msg('savecode', 'in_title'),
      input: game.input,
      // A character typed blips quietly; a paste (many at once) does not.
      onInput: (v) => { if (v.length === this.value.length + 1) game.audio.play('key'); this.setValue(v); },
      onEnter: () => this.load(),
      onEscape: () => this.close(),
      onFocus: (on) => this.setFocused(on),
    });
    window.addEventListener('paste', this.onPaste);
    this.layout();
    game.audio.play('confirm');
  }

  protected title(): string {
    return this.game.msg('savecode', 'in_title');
  }

  protected help(): string {
    return this.game.msg('savecode', 'in_help');
  }

  protected shown(): { text: string; placeholder: boolean } {
    const text = this.value.replace(/\s+/g, '');
    return text ? { text, placeholder: false } : { text: this.game.msg('savecode', 'box_empty'), placeholder: true };
  }

  protected items(): MenuItem[] {
    const g = this.game;
    return [
      { id: 'back', label: g.msg('savecode', 'back'), onChoose: () => this.close() },
      { label: g.msg('savecode', 'load'), main: true, enabled: this.found !== null, onChoose: () => this.load() },
    ];
  }

  /** Checks the text as it changes, and says what was found or what is wrong. */
  setValue(v: string): void {
    const g = this.game;
    this.value = v;
    if (this.field.el.value !== v) this.field.el.value = v;
    const r = importSave(v, g.content);
    if ('state' in r) {
      const s = r.state;
      this.found = s;
      // Its chapter's pictures start coming in now, so Load is less likely to wait on the loading page for them.
      warmArt(s.map);
      const { place, time } = saveSummary(g.content, s);
      const level = Math.max(...s.order.map((id) => s.members[id]!.level));
      this.status = g.msg('savecode', 'valid', { place, level, time });
      this.statusBad = false;
      this.statusGood = true;
    } else {
      this.found = null;
      this.status = v.trim() ? g.msg('savecode', r.error) : '';
      this.statusBad = Boolean(v.trim());
      this.statusGood = false;
    }
    this.layout();
  }

  private loading = false;
  private pendingLoad: { state: GameState; remaining: number } | null = null;

  /** A code that checks out plays C, E and G rising, then the title wipes away onto its game; a wrong one buzzes. */
  load(): void {
    if (this.loading) return;
    if (!this.found) {
      if (this.value.trim()) this.game.audio.play('cancel');
      return;
    }
    const found = this.found;
    this.loading = true;
    this.game.audio.play('code_ok');
    this.pendingLoad = { state: found, remaining: 0.25 };
  }

  override update(dt: number): void {
    const pending = this.pendingLoad;
    super.update(dt);
    // Only this page's game-clock updates advance the cue. Back wins even on its final step,
    // and a cue started by this update does not count time from before the choice.
    if (!pending || this.pendingLoad !== pending) return;
    pending.remaining -= dt;
    if (pending.remaining <= 0) {
      this.pendingLoad = null;
      this.onLoad(pending.state);
    }
  }

  override close(): void {
    this.pendingLoad = null;
    super.close();
  }

  override destroy(): void {
    this.pendingLoad = null;
    window.removeEventListener('paste', this.onPaste);
    super.destroy();
  }
}
