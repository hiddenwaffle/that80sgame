import { Container, Graphics } from 'pixi.js';
import { clearIfInked } from '../render/clear_if_inked.ts';
import { EASE, motion } from '../render/motion.ts';
import { INK, PAPER, PAPER_DARK, POP_CYAN, POP_YELLOW, RED_INK } from '../render/palette.ts';
import { box, brackets } from '../ui/widgets.ts';
import { portrait } from '../ui/portrait.ts';

interface Entry { key: string; look: Parameters<typeof portrait>[0]; enemy: boolean; active: boolean; danger?: boolean }
interface Node {
  /** The portrait's frame: its ink and paper in `ink`, the colour (tinted, so a pulse is no redraw) in `colour`, a pointer over it in `mark`. */
  root: Container; border: Container; ink: Graphics; colour: Graphics; mark: Graphics; shape: string; halo: Graphics; warning: Graphics; from: number; to: number; age: number;
  /** The fight's cyan corners round the member choosing, drawn once for the node's size and shown while they choose. */
  corners: Graphics;
  leaving: boolean; active: boolean;
  /** Where its slide has it along the strip, and how far its bob lifts it (a column's portraits slide up and bob up). */
  pos: number; bob: number;
}

/** Portraits retain their logical turn identity while sliding into their new places. */
export class TurnStrip {
  readonly container = new Container();
  readonly track = new Container();
  /** The decision meter: its frame and track (drawn when they change), hatching (a layer whose alpha pulses) and fill (drawn each step). */
  readonly meter = new Container();
  private readonly meterInk = new Graphics();
  private readonly meterFrame = new Graphics();
  private readonly meterTrack = new Graphics();
  private readonly meterHatch = new Graphics();
  private readonly meterFill = new Graphics();
  private meterFor = '';
  readonly nodes = new Map<string, Node>();
  private readonly bg = new Graphics();
  private readonly mask = new Graphics();
  private geometry = '';
  private readonly timeoutMark = new Graphics();
  private timeoutKey: string | null = null;
  private timeoutAge = 0;
  focus: Node | null = null;
  meterRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor() {
    this.bg.eventMode = 'static';
    this.track.eventMode = 'none';
    this.meter.eventMode = 'none';
    this.meter.label = 'decision_meter';
    this.meterFill.label = 'decision_meter_fill';
    this.meter.addChild(this.meterInk, this.meterFrame, this.meterTrack, this.meterHatch, this.meterFill);
    this.track.mask = this.mask;
    this.timeoutMark.eventMode = 'none';
    this.timeoutMark.label = 'timeout_attack_mark';
    this.container.addChild(this.bg, this.track, this.mask, this.meter, this.timeoutMark);
  }

  /** Presentation only: never holds the queue or consumes combat random numbers. */
  timeout(key: string): void {
    this.timeoutKey = key;
    this.timeoutAge = 0;
  }

  draw(entries: Entry[], opts: {
    u: number; icon: number; pad: number; gap: number; width: number; height: number;
    meterWidth: number; fraction: number | null; urgent: boolean; time: number; dt: number;
    compact?: boolean;
    /** A column (an upright screen's, beside the command list): the current turn at the top, the meter beside the faces. */
    vertical?: boolean;
    /** The current turn's member is choosing, with the fight's cyan corners round their figure. */
    choosing?: boolean;
  }): void {
    const { u, icon, pad, gap, width, height, fraction, urgent, time, dt } = opts;
    const compact = opts.compact ?? false;
    const vertical = opts.vertical ?? false;
    const geometry = `${u}|${icon}|${pad}|${gap}|${width}|${height}|${compact}|${vertical}`;
    if (geometry !== this.geometry) {
      this.geometry = geometry;
      for (const node of this.nodes.values()) node.root.destroy({ children: true });
      this.nodes.clear();
      box(this.bg.clear(), 0, 0, width, height, { unit: u });
      this.mask.clear().rect(0, 0, width, height).fill(INK);
    }
    const first = this.nodes.size === 0;
    const keys = new Set(entries.map(entry => entry.key));
    const rim = compact ? 3 : Math.max(6, Math.round(u * 0.4));
    const pulse = motion.reduced ? 1 : (1 + Math.sin(time * Math.PI * (urgent ? 4 : 1.5))) / 2;
    // A two-Hz colour pulse over the whole frame and timer, not just its shrinking fill.
    const alertColour = [16, 8, 0].reduce((colour, shift) => colour | Math.round(
      ((RED_INK >> shift) & 255) * (1 - pulse) + ((POP_YELLOW >> shift) & 255) * pulse,
    ) << shift, 0);
    this.focus = null;
    entries.forEach((entry, i) => {
      const target = pad + i * (icon + gap);
      let node = this.nodes.get(entry.key);
      if (!node) {
        const root = new Container();
        const border = new Container(), ink = new Graphics(), colour = new Graphics(), mark = new Graphics(), halo = new Graphics(), warning = new Graphics();
        border.addChild(ink, colour, mark);
        for (const [spread, alpha] of [[3, 0.12], [1.5, 0.25], [0, 0.5]]) {
          halo.roundRect(-rim - spread!, -rim - spread!, icon + (rim + spread!) * 2, icon + (rim + spread!) * 2, 3).stroke({ width: 3, color: 0xffffff, alpha });
        }
        const r = Math.max(9, icon * 0.22);
        warning.circle(0, 0, r).fill(POP_YELLOW).stroke({ width: 2, color: INK });
        warning.rect(-1.6, -r * 0.62, 3.2, r * 0.82).fill(INK);
        warning.circle(0, r * 0.5, 1.8).fill(INK);
        warning.position.set(icon - 4, 6);
        warning.label = 'decision_warning';
        // The fight's cyan corners: clear of the frame where the padding leaves room, on it where it does not (the smallest
        // phone). Over the face, under its warning; the next face, the meter and the strip's edge go over them.
        const out = compact ? Math.max(rim, pad - 1) : Math.min(rim + 3, pad - 2), side = icon + out * 2;
        const corners = new Graphics();
        brackets(corners, -out, -out, side, side, Math.round(side * 0.25), POP_CYAN, icon < 26 ? 2 : 2.5, PAPER);
        corners.label = 'choosing_mark';
        corners.visible = false;
        const face = portrait(entry.look, icon, u, false, { whole: entry.enemy });
        face.label = 'queue_face';
        root.addChild(halo, border, face, corners, warning);
        const start = first || motion.reduced ? target : (vertical ? height : width) + pad;
        if (vertical) root.position.set(pad, start); else root.position.set(start, pad);
        this.track.addChild(root);
        node = { root, border, ink, colour, mark, shape: '', halo, warning, corners, from: start, to: target, age: 0, leaving: false, active: false, pos: start, bob: 0 };
        this.nodes.set(entry.key, node);
      }
      if (node.to !== target || node.leaving) {
        node.from = node.pos; node.to = target; node.age = 0;
      }
      node.leaving = false;
      node.root.label = entry.active ? 'current_turn' : 'upcoming_turn';
      const colour = entry.active && urgent ? alertColour : entry.active && compact ? POP_YELLOW : entry.enemy ? RED_INK : POP_CYAN;
      // The frame's shape is drawn when it changes; its colour, which pulses under urgency, is a tint on white (the pieces are the
      // same bytes either way), so a pulse is no redraw. A Graphics drawn again makes Pixi rebuild the whole stage's draw list.
      node.active = entry.active;
      const shape = `${entry.active}|${rim}|${icon}|${compact}`;
      if (shape !== node.shape) {
        node.shape = shape;
        node.ink.clear(); node.colour.clear(); node.mark.clear();
        if (entry.active) {
          node.ink.rect(-rim, -rim, icon + rim * 2, icon + rim * 2).fill(INK);
          if (!compact) node.ink.rect(-rim + 1, -rim + 1, icon + rim * 2 - 2, icon + rim * 2 - 2).fill(PAPER);
          if (compact) node.colour.rect(-rim + 1, -rim + 1, icon + rim * 2 - 2, icon + rim * 2 - 2).fill(0xffffff);
          node.colour.rect(-rim + 3, -rim + 3, icon + rim * 2 - 6, icon + rim * 2 - 6).fill(0xffffff);
          if (compact) node.mark.poly([icon / 2 - 4, -5, icon / 2 + 4, -5, icon / 2, -1]).fill(POP_YELLOW);
        } else node.colour.rect(-2, -2, icon + 4, icon + 4).fill(0xffffff);
      }
      node.colour.tint = colour;
      node.halo.visible = entry.active;
      node.corners.visible = entry.active && !!opts.choosing;
      node.halo.tint = urgent || compact ? POP_YELLOW : entry.enemy ? RED_INK : POP_CYAN;
      node.halo.alpha = motion.reduced ? 0.8 : urgent ? 0.55 + pulse * 0.45 : 0.45 + pulse * 0.55;
      node.halo.scale.set(urgent && !motion.reduced ? 1 + pulse * 0.12 : 1);
      node.warning.visible = (entry.active && urgent) || Boolean(entry.danger);
      node.warning.scale.set((urgent || entry.danger) && !motion.reduced ? 1 + pulse * 0.12 : 1);
      node.bob = entry.active && !motion.reduced ? pulse * (urgent ? 4 : 2) : 0;
      if (!vertical) node.root.y = pad - node.bob;
      if (entry.active) this.focus = node;
    });
    for (const [key, node] of this.nodes) {
      if (!keys.has(key) && !node.leaving) {
        node.leaving = true; node.active = false; node.halo.visible = false; node.warning.visible = false; node.corners.visible = false;
        node.root.label = 'departing_turn';
        node.from = node.pos; node.to = -icon - pad; node.age = 0; node.bob = 0;
      }
      node.age += dt;
      const k = motion.reduced ? 1 : Math.min(1, node.age / 0.24);
      node.pos = node.from + (node.to - node.from) * EASE.out(k);
      if (vertical) node.root.position.set(pad, node.pos - node.bob); else node.root.x = node.pos;
      node.root.alpha = node.leaving ? 1 - k : 1;
      if (node.leaving && k === 1) { node.root.destroy({ children: true }); this.nodes.delete(key); }
    }
    // The header keeps the same decision cues in a shallower meter; desktop retains its existing strip.
    // A column's meter stands beside the portraits, as tall as they are, and empties downward.
    this.meterRect = vertical ? { x: icon + pad * 2 + 1, y: pad, w: opts.meterWidth, h: height - pad * 2 }
      : { x: pad, y: icon + pad * 2 + 1, w: opts.meterWidth, h: compact ? 8 : 15 };
    const { x, y, w, h } = this.meterRect;
    this.meter.visible = fraction !== null;
    if (fraction !== null) {
      // The frame, the track and the hatching are drawn when the meter's rectangle or urgency changes; the frame's colour and the
      // hatching's strength, which pulse, are a tint and an alpha on layers drawn white and opaque (the same bytes), and the fill,
      // whose end moves, is drawn each step. A Graphics drawn again makes Pixi rebuild the whole stage's draw list.
      const key = `${x}|${y}|${w}|${h}|${urgent}`;
      if (key !== this.meterFor) {
        this.meterFor = key;
        this.meterInk.clear().rect(x - 3, y - 3, w + 6, h + 6).fill(INK);
        this.meterFrame.clear().rect(x - 2, y - 2, w + 4, h + 4).fill(0xffffff);
        this.meterTrack.clear().rect(x, y, w, h).fill(urgent ? RED_INK : PAPER_DARK);
        const hatch = this.meterHatch.clear();
        if (urgent) {
          // Hatching signals urgency even with reduced motion or little remaining fill.
          if (vertical) for (let sy = 0; sy + w + 5 <= h; sy += 15) hatch.poly([x, y + sy + w, x, y + sy + w + 5, x + w, y + sy + 5, x + w, y + sy]).fill(POP_YELLOW);
          else for (let sx = 0; sx + h + 5 <= w; sx += 15) hatch.poly([x + sx, y + h, x + sx + 5, y + h, x + sx + h + 5, y, x + sx + h, y]).fill(POP_YELLOW);
        }
      }
      this.meterFrame.tint = urgent ? alertColour : PAPER;
      this.meterHatch.visible = urgent;
      this.meterHatch.alpha = motion.reduced ? 0.5 : 0.25 + pulse * 0.4;
      const left = Math.max(0, Math.min(1, fraction));
      if (vertical) {
        const fill = h * left;
        const fillG = this.meterFill.clear().rect(x, y + h - fill, w, fill).fill(urgent ? POP_YELLOW : POP_CYAN);
        if (urgent && fill > 0 && fill < h) fillG.rect(x, y + h - fill - 1, w, 2).fill(INK);
      } else {
        const fill = w * left;
        const fillG = this.meterFill.clear().rect(x, y, fill, h).fill(urgent ? POP_YELLOW : POP_CYAN);
        if (urgent && fill > 0 && fill < w) fillG.rect(x + fill - 1, y, 2, h).fill(INK);
      }
    }
    const mark = clearIfInked(this.timeoutMark);
    if (this.timeoutKey !== null) {
      const node = this.nodes.get(this.timeoutKey);
      const age = this.timeoutAge;
      if (node && age < 0.36) {
        const r = icon * 0.62 * (motion.reduced ? 1 : 0.85 + Math.min(1, age / 0.1) * 0.25);
        const cx = node.root.x + icon / 2, cy = node.root.y + icon / 2;
        const points: number[] = [];
        for (let i = 0; i < 16; i++) {
          const a = i * Math.PI / 8, d = r * (i % 2 ? 0.72 : 1);
          points.push(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        }
        mark.alpha = age < 0.24 ? 1 : Math.max(0, (0.36 - age) / 0.12);
        mark.poly(points).fill(POP_YELLOW).stroke({ width: Math.max(2, u * 0.12), color: INK, join: 'miter' });
        mark.poly([cx-r*.5,cy-r*.15,cx+r*.05,cy-r*.15,cx+r*.05,cy-r*.45,cx+r*.55,cy,cx+r*.05,cy+r*.45,cx+r*.05,cy+r*.15,cx-r*.5,cy+r*.15]).fill(INK);
      }
      this.timeoutAge += dt;
      if (this.timeoutAge >= 0.36 || !node) this.timeoutKey = null;
    }
  }
}
