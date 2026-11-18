import { CanvasTextMetrics, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Rect } from '../engine/layout.ts';
import { EASE, idleBob, motion, MS } from '../render/motion.ts';
import { FONT } from '../render/fonts.ts';
import { INK, INK_SOFT, CAPTION, POP_CYAN, POP_YELLOW } from '../render/palette.ts';
import { letterStyle, measures } from './print.ts';
import { anim } from './anim.ts';
import { mapToWrapped } from './typing.ts';

/** `thought` is the balloon for the script's [aside] tag, `haunted` for its [haunted] tag. */
export type BalloonStyle = 'balloon' | 'shout' | 'boss' | 'caption' | 'whisper' | 'thought' | 'haunted';

/** A haunted line: pale letters on the dark, with a sickly plate behind. */
const HAUNT_LETTERS = 0xf1fce8;
const HAUNT_FACE = 0x101512;
const HAUNT_PLATE = 0x5f8f4e;
/** The owner's picks from the slider page (2026-11-01): a slow, long wave, its height in units, about 30 letters to a wave, the slightest tilt and shake. */
const HAUNT_WAVE_HEIGHT = 0.24;
const HAUNT_WAVE_SPEED = 2.6;
const HAUNT_WAVE_STEP = (Math.PI * 2) / 30;
const HAUNT_TILT = (0.7 * Math.PI) / 180;
const HAUNT_SHAKE = 0.02;

export interface BalloonSpec {
  style: BalloonStyle;
  name: string;
  /** Full text, used to size the balloon before it types out. */
  full: string;
  /** Where the tail points, in panel coordinates, or null for no tail. */
  anchor: [number, number] | null;
  /** A directed offstage voice uses a horizontal tail instead of the usual above/below placement. */
  tailSide?: 'right';
  /**
   * How far below `anchor` the speaker's head ends, in panel pixels, for a figure whose head is a small part of it (the
   * tank's driver): with no room above, the balloon goes under the head and its tail points up to it there.
   */
  under?: number;
  /** Keep an offstage warning clear of the gathered party. */
  avoidBand?: { top: number; bottom: number; left: number; right: number };
  /** An ending newspaper reserves this measured space at its foot for narration. */
  captionSlot?: Rect;
  /** Scripted emphasis enlarges the plate and text while its pointer keeps the usual size. */
  size?: number;
  panelW: number;
  panelH: number;
  unit: number;
  color?: string;
}

/** Use the caption's real font and wrapping, including its printed shadow, before laying out the photo. */
export function endingCaptionSlot(full: string, p: { w: number; h: number }, u: number): Rect {
  const margin = Math.round(u * 0.9), padX = Math.round(u * 0.9), padY = Math.round(u * 0.7);
  const shadow = measures(u).S, line = measures(u).L;
  const w = Math.min(p.w - margin * 2 - shadow - line, u * 36);
  const fontSize = Math.round(u * 1.12);
  const style = new TextStyle({ fontFamily: FONT.body, fontWeight: '400', fontStyle: 'italic', fontSize,
    wordWrap: true, wordWrapWidth: w - padX * 2, lineHeight: Math.round(fontSize * 1.28) });
  const h = CanvasTextMetrics.measureText(full || ' ', style).height + padY * 2;
  return { x: (p.w - w - shadow) / 2, y: p.h - margin - shadow - line / 2 - h, w, h };
}

/**
 * A comic speech balloon, shout, whisper, thought, or narration caption, drawn
 * in the canvas. It is sized for its whole text, then the text types into it.
 */
export class Balloon {
  readonly container = new Container();
  /** Everything the balloon draws, which pops in as one when a new speaker talks. */
  readonly face = new Container();
  private readonly g = new Graphics();
  /** The speaker's name in a yellow caption box, set crooked across the balloon's corner. */
  private readonly nameSlab = new Container();
  private readonly slabG = new Graphics();
  private readonly body: Text;
  private readonly nameLabel: Text | null = null;
  private readonly spec: BalloonSpec;
  /** The full text with the line breaks of its final wrapping, and where each typed character ends in it. */
  private wrapped = '';
  private wrapEnds: number[] | null = null;
  /** The mark that the line has finished and waits for the player, and where it sits. */
  private doneMark: Graphics | null = null;
  private doneAt: [number, number] = [0, 0];
  private bob = 0;
  /** A haunted line's letters, each its own figure, riding a wave about where the line's wrapping puts it. */
  private readonly letters: Array<{ text: Text; at: number; x: number; y: number }> = [];
  /** Where its tail's tip was last drawn, in panel coordinates, or null with no tail: for the browser checks. */
  tailTip: [number, number] | null = null;
  /** Where the balloon grows from when it pops in: its plate's foot, over the tail. */
  private popAt: [number, number] = [0, 0];

  constructor(spec: BalloonSpec) {
    this.spec = { ...spec };
    const u = spec.unit * (spec.size ?? 1);
    this.container.addChild(this.face);
    this.face.addChild(this.g);
    const caption = spec.style === 'caption';
    const haunted = spec.style === 'haunted';
    const shout = spec.style === 'shout' || spec.style === 'boss' || haunted;
    const quiet = spec.style === 'whisper' || spec.style === 'thought';
    // Narration is as wide as speech may be, so it sits where a balloon would.
    const maxW = caption && spec.captionSlot ? spec.captionSlot.w - Math.round(u * 0.9) * 2
      : Math.min(spec.panelW * 0.8, u * 24, spec.tailSide === 'right' ? Math.max(u * 4, spec.panelW - u * 6) : Infinity,
        // Enlarged plates reserve room for their spikes, printed shadow and padding on narrow phones.
        (spec.size ?? 1) > 1 ? Math.max(u * 4, spec.panelW - Math.round(u) * 2 - Math.round(u * 1.1) * 2) : Infinity);
    const fontSize = Math.round(u * (haunted ? 1.8 : shout ? 1.3 : spec.style === 'whisper' ? 0.98 : 1.12));
    const fill = haunted ? HAUNT_LETTERS : spec.style === 'boss' ? (spec.color ?? '#8b0000') : spec.style === 'whisper' ? INK_SOFT : INK;
    this.body = new Text({
      text: spec.full,
      style: {
        fontFamily: caption || haunted ? FONT.body : shout ? FONT.shout : FONT.balloon,
        fontWeight: caption || quiet || haunted ? '400' : '700',
        fontStyle: caption || quiet ? 'italic' : 'normal',
        fontSize,
        fill,
        wordWrap: true,
        wordWrapWidth: maxW,
        lineHeight: Math.round(fontSize * (shout ? 1.1 : 1.28)),
        letterSpacing: shout ? 1 : 0,
      },
    });
    this.prewrap();
    const nameText = spec.name && !caption ? spec.name.toUpperCase() : '';
    if (nameText) {
      this.nameLabel = new Text({ text: nameText, style: letterStyle(Math.round(u * 1.35), INK) });
      this.nameLabel.anchor.set(0, 0.5);
      // A name too long to show whole across the panel (the longest Beijing names at the largest text on a 320 px phone)
      // gets lettering just small enough to fit; every other name keeps its size.
      const room = spec.panelW - marginFor(u, spec.size) * 2;
      for (let size = Math.round(u * 1.35) - 1; this.nameBox(u).reach > room && size >= Math.round(u * 0.6); size--) {
        this.nameLabel.style = letterStyle(size, INK);
      }
      this.nameSlab.addChild(this.slabG, this.nameLabel);
    }
    this.face.addChild(this.body);
    if (this.nameLabel) this.face.addChild(this.nameSlab);
    if (haunted) this.buildLetters();
    this.layout();
  }

  /**
   * The name's box: its height and width, and how far right of the balloon's left edge it reaches, turned, with its
   * shadow and line. None without a name.
   */
  private nameBox(u: number): { slabH: number; slabW: number; reach: number } {
    const label = this.nameLabel;
    if (!label) return { slabH: 0, slabW: 0, reach: 0 };
    const slabH = Math.round(Number(label.style.fontSize) * 1.25);
    const slabW = Math.round(label.width + u * 1.0);
    const m = measures(u);
    const reach = Math.ceil(-u * 0.4 + (slabW + m.S) * Math.cos(NAME_TURN) + (slabH / 2 + m.S) * Math.sin(NAME_TURN) + m.L / 2);
    return { slabH, slabW, reach };
  }

  /** One figure for each letter of a haunted line, placed as the whole line would be. The whole line stays only to size the balloon. */
  private buildLetters(): void {
    const style = this.body.style;
    const lineH = Number(style.lineHeight);
    let at = 0;
    (this.wrapped || this.spec.full).split('\n').forEach((line, row) => {
      for (let i = 0; i < line.length; i++, at++) {
        const ch = line[i]!;
        if (!ch.trim()) continue;
        const text = new Text({ text: ch, style });
        text.anchor.set(0.5);
        text.visible = false;
        this.face.addChild(text);
        this.letters.push({ text, at, x: CanvasTextMetrics.measureText(line.slice(0, i), style).width + text.width / 2, y: row * lineH + lineH / 2 });
      }
      at++;
    });
    this.body.visible = false;
  }

  /** The letters ride a slow wave along the line, tipping just a little with its slope, with a slight shake. With reduced motion they stand still. */
  private placeLetters(): void {
    const u = this.spec.unit, t = this.bob, still = motion.reduced;
    const reach = still ? 0 : u * HAUNT_WAVE_HEIGHT, shake = still ? 0 : u * HAUNT_SHAKE;
    this.letters.forEach(({ text, x, y }, i) => {
      const at = t * HAUNT_WAVE_SPEED - i * HAUNT_WAVE_STEP;
      const dx = (Math.sin(t * 37 + i * 2.3) + Math.sin(t * 53 + i * 5.1) * 0.5) * shake;
      const dy = (Math.sin(t * 41 + i * 3.7) + Math.sin(t * 59 + i * 1.9) * 0.5) * shake;
      text.position.set(this.body.x + x + dx, this.body.y + y + Math.sin(at) * reach + dy);
      text.rotation = still ? 0 : Math.cos(at) * HAUNT_TILT;
    });
  }

  /**
   * Breaks the full text into lines once. Typing then fills in those same lines,
   * so a half-typed word never jumps down a line when it grows too long.
   */
  private prewrap(): void {
    const full = this.spec.full;
    const lines = CanvasTextMetrics.measureText(full, this.body.style).lines;
    const wrapped = lines.join('\n');
    const ends = mapToWrapped(full, wrapped);
    if (!ends) return;
    this.wrapped = wrapped;
    this.wrapEnds = ends;
    this.body.style.wordWrap = false;
    this.body.text = wrapped;
  }

  /** Where the tail points now. The balloon follows its speaker as they and the camera move. */
  get anchor(): [number, number] | null {
    return this.spec.anchor;
  }

  setAnchor(anchor: [number, number] | null, under?: number): void {
    this.spec.anchor = anchor;
    if (under === undefined) delete this.spec.under;
    else this.spec.under = under;
    this.layout();
  }

  setAvoidBand(band: BalloonSpec['avoidBand']): void {
    const old = this.spec.avoidBand;
    if ((!old && !band) || (old && band && Math.abs(old.top - band.top) < 1.5 && Math.abs(old.bottom - band.bottom) < 1.5 &&
      Math.abs(old.left - band.left) < 1.5 && Math.abs(old.right - band.right) < 1.5)) return;
    if (band) this.spec.avoidBand = band;
    else delete this.spec.avoidBand;
    this.layout();
  }

  /**
   * Where the tail goes: its base on the balloon's edge toward the speaker, and its tip a little short of
   * them, leaning toward the balloon's middle like a pen stroke. The tail's own cyan plate is this shape, off register.
   */
  private tailShape(x: number, y: number, w: number, h: number, tail: number, tailUp: boolean) {
    const s = this.spec;
    const u = s.unit;
    const [ax, ay] = s.anchor!;
    if (s.tailSide === 'right') {
      // A moved warning keeps its tail horizontal, safely away from the party too.
      const tipY = s.avoidBand ? y + h / 2 : ay;
      const baseY = Math.max(y + u, Math.min(y + h - u, tipY));
      return { bx: x + w, baseY, tipX: ax, tipY, half: u * 0.55, tx: ax, ty: tipY, right: true };
    }
    const snip = s.style === 'balloon' ? Math.round(Math.min(h / 2, u * 1.6) * 0.8) : 0;
    const bx = Math.max(x + u + snip, Math.min(x + w - u - snip, ax));
    const baseY = tailUp ? y : y + h;
    // Below its speaker, the tail points up to the head's top, or to the chin of a head that is a small part of them.
    const tipY = tailUp ? Math.max(ay + (s.under ?? 0) + u * 0.5, y - tail * 2) : Math.min(ay, y + h + tail * 2);
    const tipX = ax * 0.3 + bx * 0.7;
    const half = u * (s.style === 'balloon' ? 0.7 : 0.55);
    const tx = tipX + (bx < x + w / 2 ? u * 0.2 : -u * 0.2);
    const ty = tipY + (tailUp ? u * 0.25 : -u * 0.25);
    return { bx, baseY, tipX, tipY, half, tx, ty, right: false };
  }

  private layout(): void {
    const s = this.spec;
    const u = s.unit * (s.size ?? 1);
    const padX = Math.round(u * (s.style === 'caption' ? 0.9 : 1.1));
    const padY = Math.round(u * 0.7);
    const nameLabel = this.nameLabel;
    // The body holds the whole wrapped text while it is laid out, so the balloon fits the finished line.
    const typed = this.body.text;
    if (this.wrapEnds) this.body.text = this.wrapped;
    const textW = this.body.width;
    const textH = this.body.height;
    this.body.text = typed;
    // The name's slab straddles the top edge; the words start below the part of it that hangs inside.
    const { slabH, slabW, reach } = this.nameBox(u);
    const padTop = nameLabel ? Math.max(padY, Math.round(slabH * 0.5 + u * 0.3)) : padY;
    // The box fits the words, and a name longer than they are hangs its box past the balloon's right edge (the owner,
    // 13 Nov, from a preview of four ways: a short line sat at the left of a balloon as wide as THE PEOPLE'S
    // BACKSTREET RESIDENT, with empty space on its right).
    const w = Math.max(textW + padX * 2, u * 1.2);
    // The balloon keeps as far in from the panel's right edge as its name's box reaches, so the whole name shows.
    const room = Math.max(w, reach);
    const h = textH + padTop + padY;
    const margin = marginFor(u, s.size);
    const tail = Math.round(s.unit * 1.4);
    // The highest the balloon's top may be: the margin, and room for the name's box, which stands above the top
    // edge by nearly half its height, and at its right end higher still for its turn.
    const top = margin + (nameLabel ? Math.ceil(slabH * 0.45 + slabW * Math.sin(NAME_TURN) + measures(u).L / 2) : 0);

    let x: number;
    let y: number;
    let tailUp = false;
    // Narration goes where a balloon over the party's leader would (its anchor is the leader's), so the eye stays
    // in one place from speech to narration; it has no tail.
    if (s.style === 'caption' && s.captionSlot) {
      x = s.captionSlot.x + (s.captionSlot.w - w) / 2;
      y = s.captionSlot.y + s.captionSlot.h - h;
    } else if (!s.anchor) {
      x = Math.max(margin, Math.min((s.panelW - w) / 2, s.panelW - room - margin));
      y = Math.max(margin * 1.5, top);
    } else if (s.tailSide === 'right') {
      const [ax, ay] = s.anchor;
      x = Math.max(margin, Math.min(s.panelW - room - margin, ax - tail - w));
      y = Math.max(top, Math.min(s.panelH - h - margin, ay - h / 2));
      if (s.avoidBand) {
        const gap = Math.ceil(u * 1.1); // Include the shout's spikes and printed shadow.
        const band = s.avoidBand;
        if (x - gap < band.right && ax + gap > band.left && y + h + gap > band.top && y - gap < band.bottom) {
          const above = band.top - h - gap;
          y = above >= top ? above : Math.min(s.panelH - h - margin, band.bottom + gap);
        }
      }
    } else {
      const [ax, ay] = s.anchor;
      x = Math.max(margin, Math.min(s.panelW - room - margin, ax - w / 2));
      y = ay - tail - h;
      if (y < top) {
        // No room above: put the balloon below its speaker, or just under a head that is a small part of them.
        y = s.under === undefined ? ay + tail + u * 2.4 : ay + s.under + tail;
        tailUp = true;
      }
      y = Math.max(top, Math.min(s.panelH - h - margin, y));
    }
    x = Math.round(x);
    y = Math.round(y);

    const g = this.g;
    g.clear();
    // Speech and shouts carry a cyan plate printed a little off, down and right, like a colour plate out of register.
    const offset = Math.round(measures(u).S * 1.1);
    const line = s.style === 'boss' ? 0x8b0000 : s.style === 'haunted' ? HAUNT_LETTERS : INK;
    const face = s.style === 'haunted' ? HAUNT_FACE : 0xffffff;
    // The tail's shape, worked out first so its cyan plate can go down before the balloon's white face.
    const pointed = s.anchor && s.style !== 'caption' ? this.tailShape(x, y, w, h, tail, tailUp) : null;
    this.tailTip = pointed ? [pointed.tipX, pointed.tipY] : null;
    if (pointed && s.style !== 'thought') {
      const { bx, baseY, half, tx, ty, right } = pointed;
      const points = right ? [bx, baseY - half, bx, baseY + half, tx, ty] : [bx - half, baseY, bx + half, baseY, tx, ty];
      g.poly(points.map((v) => v + offset)).fill(s.style === 'haunted' ? HAUNT_PLATE : POP_CYAN);
    }
    if (s.style === 'caption') {
      const m = measures(u);
      g.rect(x + m.S, y + m.S, w, h).fill(INK);
      g.rect(x, y, w, h).fill(CAPTION).stroke({ width: m.L, color: INK });
    } else if (s.style === 'shout' || s.style === 'boss' || s.style === 'haunted') {
      const pts = spikyRect(x, y, w, h, Math.round(u * 0.55));
      g.poly(pts.map((v) => v + offset)).fill(s.style === 'haunted' ? HAUNT_PLATE : POP_CYAN);
      g.poly(pts).fill(face).stroke({ width: Math.round(measures(u).L * 1.2), color: line, join: 'miter' });
    } else if (s.style === 'thought') {
      cloud(g, x, y, w, h, u, { color: POP_CYAN, alpha: 1 }, measures(u).L, offset);
    } else if (s.style === 'whisper') {
      // A whisper keeps its dashed soft line, so it reads quieter than speech, over the same cyan plate.
      const r = Math.min(h / 2, u * 1.2);
      g.roundRect(x + offset, y + offset, w, h, r).fill(POP_CYAN);
      g.roundRect(x, y, w, h, r).fill(0xffffff);
      dashedRoundRect(g, x, y, w, h, r, u * 0.55, u * 0.4, INK_SOFT, measures(u).L);
    } else {
      // A comic balloon: round-cornered, white, with a heavy ink line over its cyan plate.
      const r = Math.round(Math.min(h / 2, u * 1.6));
      g.roundRect(x + offset, y + offset, w, h, r).fill(POP_CYAN);
      g.roundRect(x, y, w, h, r).fill(0xffffff).stroke({ width: Math.round(measures(u).L * 1.2), color: INK });
    }
    // The tail: a point for speech, a trail of bubbles for thoughts.
    if (pointed) {
      const { bx, baseY, tipX, tipY, half, tx, ty, right } = pointed;
      if (s.style === 'thought') {
        for (const [k, r] of [
          [0.3, 0.42],
          [0.62, 0.3],
          [0.9, 0.2],
        ] as const) {
          const cx = bx + (tipX - bx) * k;
          const cy = baseY + (tipY - baseY) * k;
          g.circle(cx + offset * 0.6, cy + offset * 0.6, u * r).fill(POP_CYAN);
          g.circle(cx, cy, u * r).fill(0xffffff).stroke({ width: measures(u).L * 0.8, color: INK });
        }
      } else {
        const color = s.style === 'whisper' ? INK_SOFT : line;
        const lw = s.style === 'balloon' || shoutish(s.style) ? Math.round(measures(u).L * 1.2) : measures(u).L;
        if (right) {
          g.poly([bx - lw, baseY - half, bx - lw, baseY + half, tx, ty]).fill(face);
          g.moveTo(bx - lw, baseY - half).lineTo(tx, ty).lineTo(bx - lw, baseY + half).stroke({ width: lw, color, join: 'miter' });
        } else {
          const inside = tailUp ? lw : -lw;
          g.poly([bx - half, baseY + inside, bx + half, baseY + inside, tx, ty]).fill(face);
          g.moveTo(bx - half, baseY + inside).lineTo(tx, ty).lineTo(bx + half, baseY + inside).stroke({ width: lw, color, join: 'miter' });
        }
      }
    }
    if (nameLabel) {
      // The name's box: yellow, a heavy ink line and a solid ink shadow, set crooked across the top left corner.
      const m = measures(u);
      const sg = this.slabG.clear();
      sg.rect(m.S, m.S, slabW, slabH).fill(INK);
      sg.rect(0, 0, slabW, slabH).fill(POP_YELLOW).stroke({ width: m.L, color: s.style === 'boss' ? line : INK });
      nameLabel.position.set(Math.round((slabW - nameLabel.width) / 2), Math.round(slabH / 2 + u * 0.04));
      this.nameSlab.pivot.set(0, slabH / 2);
      this.nameSlab.position.set(x - u * 0.4, y + slabH * 0.05);
      this.nameSlab.rotation = -NAME_TURN;
    }
    this.body.position.set(x + padX, y + padTop);
    this.popAt = s.tailSide === 'right' ? [Math.round(x + w), Math.round(y + h / 2)] : [Math.round(x + w / 2), Math.round(tailUp ? y : y + h)];
    // The finished mark sits in the bottom padding at the right, clear of the last line and of a round corner.
    const tri = u * 0.45;
    const corner = s.style === 'balloon' ? Math.min(h / 2, u * 1.6) * 0.7 : s.style === 'whisper' ? Math.min(h / 2, u * 1.2) * 0.7 : 0;
    this.doneAt = [Math.round(x + w - Math.max(padX * 0.6, corner) - tri * 1.3), Math.round(y + h - padY / 2 - tri * 0.4)];
    this.placeDone();
  }

  /**
   * Shows or hides the small inked triangle that says the line has finished and is waiting
   * for the player.
   */
  setDone(on: boolean): void {
    if (!on) {
      this.doneMark?.destroy();
      this.doneMark = null;
      return;
    }
    if (this.doneMark) return;
    const u = this.spec.unit;
    const tri = u * 0.45;
    const g = new Graphics();
    g.poly([0, 0, tri * 1.3, 0, tri * 0.65, tri]).fill(this.spec.style === 'boss' ? 0x8b0000 : INK);
    this.doneMark = g;
    g.visible = !this.skippingNow;
    this.face.addChild(g);
    this.placeDone();
  }

  get done(): boolean {
    return this.doneMark !== null;
  }

  /** The double chevron shown while Confirm is held to skip, in the finished mark's place. */
  private chevron: Graphics | null = null;
  private skippingNow = false;

  /** While Confirm is held to skip lines, a double chevron takes the finished mark's place; it does not bob. */
  setSkipping(on: boolean): void {
    if (on === this.skippingNow) return;
    this.skippingNow = on;
    if (on && !this.chevron) {
      const tri = this.spec.unit * 0.45;
      const g = new Graphics();
      for (const dx of [0, tri * 0.85]) g.poly([dx, 0, dx + tri * 0.8, tri * 0.55, dx, tri * 1.1]).fill(this.spec.style === 'boss' ? 0x8b0000 : INK);
      this.chevron = g;
      this.face.addChild(g);
    }
    if (this.chevron) this.chevron.visible = on;
    if (this.doneMark) this.doneMark.visible = !on;
    this.placeDone();
  }

  /** Moves the finished mark gently, unless motion is reduced. */
  tick(dt: number): void {
    this.bob += dt;
    this.placeDone(idleBob(this.bob, this.spec.unit, 6));
    if (this.letters.length) this.placeLetters();
  }

  private placeDone(dy = 0): void {
    this.doneMark?.position.set(this.doneAt[0], this.doneAt[1] - this.spec.unit * 0.2 + dy);
    this.chevron?.position.set(this.doneAt[0] - this.spec.unit * 0.3, this.doneAt[1] - this.spec.unit * 0.3);
  }

  /** Shows the typed part of the text (with {br} already turned into newlines). */
  setVisible(shown: string): void {
    const ends = this.wrapEnds;
    if (this.letters.length) {
      const end = shown.length ? ends?.[shown.length - 1] ?? shown.length : 0;
      for (const { text, at } of this.letters) text.visible = at < end;
      this.placeLetters();
    }
    if (ends && this.spec.full.startsWith(shown)) {
      this.body.text = shown.length ? this.wrapped.slice(0, ends[shown.length - 1]) : '';
    } else {
      this.body.style.wordWrap = true;
      this.body.text = shown;
    }
  }

  /** A new speaker's balloon bursts in from its foot, swinging a little, past full size and back. With reduced motion it is simply there. */
  popIn(): void {
    const [cx, cy] = this.popAt;
    this.face.pivot.set(cx, cy);
    this.face.position.set(cx, cy);
    anim.play(this, this.face, { scale: 0.55, alpha: 0, rotation: -0.12 }, MS.balloonPop, EASE.pop);
    if (this.nameLabel) anim.play(this, this.nameSlab, { scale: 1.6, rotation: 0.25 }, MS.nameSlam, EASE.pop, { delay: 60 });
  }

  get style(): BalloonStyle {
    return this.spec.style;
  }

  destroy(): void {
    anim.finish(this);
    this.container.destroy({ children: true });
  }
}

/** The points of a jagged edge around a rectangle: a shout's balloon, or a hit's burst. */
export function spikyRect(x: number, y: number, w: number, h: number, spike: number): number[] {
  const pts: number[] = [];
  const perim = (t: number): [number, number, number, number] => {
    // Point on the rectangle's edge, with its outward normal.
    const p = 2 * (w + h);
    let d = t * p;
    if (d < w) return [x + d, y, 0, -1];
    d -= w;
    if (d < h) return [x + w, y + d, 1, 0];
    d -= h;
    if (d < w) return [x + w - d, y + h, 0, 1];
    d -= w;
    return [x, y + h - d, -1, 0];
  };
  const n = Math.max(16, Math.round((2 * (w + h)) / (spike * 2.2)));
  for (let i = 0; i < n; i++) {
    const [px, py, nx, ny] = perim(i / n);
    const out = i % 2 === 0 ? spike : 0;
    pts.push(px + nx * out, py + ny * out);
  }
  return pts;
}

/** A thought balloon: scallops of ink around a white box. */
export function cloud(g: Graphics, x: number, y: number, w: number, h: number, u: number, shadow: { color: number; alpha: number } | null, line = 1.8, off = 3): void {
  const r = u * 0.75;
  const bumps: Array<[number, number]> = [];
  const nx = Math.max(2, Math.round(w / (r * 1.5)));
  const ny = Math.max(1, Math.round(h / (r * 1.5)));
  for (let i = 0; i <= nx; i++) bumps.push([x + (w * i) / nx, y], [x + (w * i) / nx, y + h]);
  for (let i = 1; i < ny; i++) bumps.push([x, y + (h * i) / ny], [x + w, y + (h * i) / ny]);
  if (shadow) {
    for (const [bx, by] of bumps) g.circle(bx + off, by + off, r).fill(shadow);
    g.rect(x + off, y + off, w, h).fill(shadow);
  }
  for (const [bx, by] of bumps) g.circle(bx, by, r).fill(0xffffff).stroke({ width: line, color: INK });
  // Covers the inner halves of the scallops, leaving only their outer edges.
  g.rect(x, y, w, h).fill(0xffffff);
}

/** A rounded box outlined in dashes, for whispers. */
function dashedRoundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number, dash: number, gap: number, color: number, width = 1.8): void {
  // Points around the outline, then every other stretch of it is inked.
  const pts: Array<[number, number]> = [];
  const arc = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  arc(x + w - r, y + r, -Math.PI / 2);
  arc(x + w - r, y + h - r, 0);
  arc(x + r, y + h - r, Math.PI / 2);
  arc(x + r, y + r, Math.PI);
  pts.push(pts[0]!);
  let inked = true;
  let left = dash;
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) {
    let [px, py] = pts[i - 1]!;
    const [qx, qy] = pts[i]!;
    let seg = Math.hypot(qx - px, qy - py);
    while (seg > 0) {
      const step = Math.min(seg, left);
      const k = step / seg;
      px += (qx - px) * k;
      py += (qy - py) * k;
      if (inked) g.lineTo(px, py);
      else g.moveTo(px, py);
      seg -= step;
      left -= step;
      if (left <= 0) {
        inked = !inked;
        left = inked ? dash : gap;
      }
    }
  }
  g.stroke({ width, color });
}

/** Shouts, and the boss's, whose balloons are jagged. */
/** How far the speaker's name box is turned (radians), crooked across the balloon's top left corner. */
const NAME_TURN = 0.06;

/** The least gap between a balloon and the panel's edges; an enlarged one keeps more. */
function marginFor(u: number, size: number | undefined): number {
  return Math.round(u * ((size ?? 1) > 1 ? 1 : 0.6));
}

function shoutish(style: BalloonStyle): boolean {
  return style === 'shout' || style === 'boss' || style === 'haunted';
}
