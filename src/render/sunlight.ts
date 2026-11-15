import { ColorMatrixFilter, Container, Sprite, Texture, type ColorMatrix } from 'pixi.js';
import { EASE, motion } from './motion.ts';

/**
 * The pace of the warm light coming up, and of the rays after it: the seconds an S-curve would take. Each comes up at
 * the curve's pace until its middle, then keeps that pace until it is full, without the curve's slowing at the end.
 */
const GRADE_SECONDS = 4;
const RAYS_DELAY = 0.8;
const RAYS_SECONDS = 5;
/**
 * Once the rays are full, the whole view goes on brightening in a warm wash from where the sun breaks in, this much more
 * a second at first (the owner, 2026-11-13: "the sunshine just keeps getting brighter and brighter at the same pace as it
 * was"). For a slow reader it eases off toward WASH_MOST, short of white.
 */
const WASH_PACE = 0.05;
const WASH_MOST = 0.6;

/** Each ray: its angle from straight right (radians, downward), its half-width (radians) and its strength. */
const RAYS: Array<[number, number, number]> = [
  [0.42, 0.035, 0.8],
  [0.58, 0.06, 1],
  [0.74, 0.03, 0.65],
  [0.88, 0.05, 0.9],
  [1.05, 0.025, 0.55],
];
const RAY_COLOUR = '255, 226, 160';

/** An S-curve's first half over `seconds`, then on at its middle's pace to 1. */
function rise(t: number, seconds: number): number {
  const k = Math.max(0, t / seconds);
  return k <= 0.5 ? EASE.smooth(k) : Math.min(1, 0.5 + 1.5 * (k - 0.5));
}
/** When the rays are full, in seconds from the start. */
const RAYS_FULL = RAYS_DELAY + RAYS_SECONDS * (0.5 + 0.5 / 1.5);

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** Berlin in sunshine: more colour, a touch more contrast and brightness, and only a little warmer (the rays bring the warmth). */
function warmGrade(): ColorMatrix {
  const s = 1.35;
  const contrast = 1.08;
  const [lr, lg, lb] = [0.2126, 0.7152, 0.0722];
  const sat = [
    [lr * (1 - s) + s, lg * (1 - s), lb * (1 - s)],
    [lr * (1 - s), lg * (1 - s) + s, lb * (1 - s)],
    [lr * (1 - s), lg * (1 - s), lb * (1 - s) + s],
  ];
  const gain = [1.07, 1.05, 1.0];
  const lift = [0.02, 0.015, 0];
  const m: number[] = [];
  for (let r = 0; r < 3; r++) m.push(...sat[r]!.map((v) => v * gain[r]! * contrast), 0, lift[r]! + 0.5 * (1 - contrast));
  m.push(0, 0, 0, 1, 0);
  return m as ColorMatrix;
}

/**
 * The finale's hopeful light (the owner, 2026-10-19, asked for a lighting change that makes drab Berlin look more
 * hopeful, like a ray of sunshine): once the Warsaw Pac has gone up, Berlin warms over a few seconds and soft shafts of
 * sunlight break in from the top left corner. The rays sit over the map in panel space;
 * the warmth is a colour grade after the printed map's own filters (its print dots), on the same layer.
 */
export class Sunlight {
  readonly rays = new Container();
  private wash: Sprite | null = null;
  private washTexture: Texture | null = null;
  // At the screen's density: a filter's resolution is 1 unless set, and Pixi runs a container's filters at the lowest among
  // them, so a plain one drew the whole printed map at 1x on a dense screen (Fable review P6; docs/pixi_dependencies.md).
  private readonly grade = new ColorMatrixFilter({ resolution: 'inherit' });
  private readonly target = warmGrade();
  private sprite: Sprite | null = null;
  private texture: Texture | null = null;
  private source = { x: 0, y: 0 };
  private t = 0;
  private readonly graded: Container;

  constructor(graded: Container, w: number, h: number) {
    this.graded = graded;
    this.rays.eventMode = 'none';
    this.grade.matrix = IDENTITY;
    graded.filters = [...(graded.filters ? [graded.filters].flat() : []), this.grade];
    this.layout(w, h);
  }

  layout(w: number, h: number): void {
    this.sprite?.destroy();
    this.texture?.destroy(true);
    this.wash?.destroy();
    this.washTexture?.destroy(true);
    // Drawn at half size: the rays are soft, and a smaller picture costs less to draw over the map.
    const cw = Math.max(1, Math.ceil(w / 2)), ch = Math.max(1, Math.ceil(h / 2));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const c = canvas.getContext('2d')!;
    const sx = -cw * 0.12, sy = -ch * 0.3;
    const reach = Math.hypot(cw - sx, ch - sy) * 1.05;
    // A soft warm glow where the sun breaks in, fading across the map.
    const glow = c.createRadialGradient(sx, sy, 0, sx, sy, reach * 0.85);
    glow.addColorStop(0, `rgba(${RAY_COLOUR}, 0.55)`);
    glow.addColorStop(0.4, `rgba(${RAY_COLOUR}, 0.18)`);
    glow.addColorStop(1, `rgba(${RAY_COLOUR}, 0)`);
    c.fillStyle = glow;
    c.fillRect(0, 0, cw, ch);
    for (const [angle, half, strength] of RAYS) {
      // Several wedges, each wider and fainter, give the ray a soft edge without a blur.
      for (let i = 0; i < 7; i++) {
        const spread = half * (0.45 + i * 0.32);
        const a = 0.15 * strength;
        const g = c.createLinearGradient(sx, sy, sx + Math.cos(angle) * reach, sy + Math.sin(angle) * reach);
        g.addColorStop(0, `rgba(${RAY_COLOUR}, ${a})`);
        g.addColorStop(0.45, `rgba(${RAY_COLOUR}, ${a * 0.75})`);
        g.addColorStop(1, `rgba(${RAY_COLOUR}, 0)`);
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(sx + Math.cos(angle - spread) * reach, sy + Math.sin(angle - spread) * reach);
        c.lineTo(sx + Math.cos(angle + spread) * reach, sy + Math.sin(angle + spread) * reach);
        c.closePath();
        c.fill();
      }
    }
    this.texture = Texture.from(canvas);
    const sp = new Sprite(this.texture);
    sp.blendMode = 'screen';
    sp.scale.set(w / cw, h / ch);
    // Turned about the light's source, so a slow sway swings the rays' far ends.
    sp.pivot.set(sx, sy);
    this.source = { x: sx * (w / cw), y: sy * (h / ch) };
    sp.position.set(this.source.x, this.source.y);
    this.sprite = sp;
    this.rays.addChild(sp);
    // The light growing on: strongest where the sun breaks in, and reaching across the whole view.
    const washCanvas = document.createElement('canvas');
    washCanvas.width = cw;
    washCanvas.height = ch;
    const wc = washCanvas.getContext('2d')!;
    const bright = wc.createRadialGradient(sx, sy, 0, sx, sy, reach);
    bright.addColorStop(0, `rgba(${RAY_COLOUR}, 1)`);
    bright.addColorStop(0.5, `rgba(${RAY_COLOUR}, 0.7)`);
    bright.addColorStop(1, `rgba(${RAY_COLOUR}, 0.35)`);
    wc.fillStyle = bright;
    wc.fillRect(0, 0, cw, ch);
    this.washTexture = Texture.from(washCanvas);
    const wash = new Sprite(this.washTexture);
    wash.blendMode = 'screen';
    wash.scale.set(w / cw, h / ch);
    this.wash = wash;
    this.rays.addChild(wash);
    this.place();
  }

  update(dt: number): void {
    this.t += dt;
    this.place();
  }

  private place(): void {
    const k = rise(this.t, GRADE_SECONDS);
    this.grade.matrix = IDENTITY.map((v, i) => v + (this.target[i]! - v) * k) as ColorMatrix;
    if (this.wash) this.wash.alpha = WASH_MOST * (1 - Math.exp(-Math.max(0, this.t - RAYS_FULL) * WASH_PACE / WASH_MOST));
    const sp = this.sprite;
    if (!sp) return;
    const r = rise(this.t - RAYS_DELAY, RAYS_SECONDS);
    const still = motion.reduced;
    sp.alpha = r * (still ? 1 : 0.85 + 0.15 * Math.sin(this.t * 0.7));
    sp.rotation = still ? 0 : Math.sin(this.t * 0.23) * 0.012;
  }

  destroy(): void {
    this.graded.filters = (this.graded.filters ? [this.graded.filters].flat() : []).filter((f) => f !== this.grade);
    this.rays.destroy({ children: true });
    this.texture?.destroy(true);
    this.washTexture?.destroy(true);
  }
}
