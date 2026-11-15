import { Container, Graphics } from 'pixi.js';
import { EASE } from '../render/motion.ts';
import { AFTER, drawScorchedPaving, heatAt } from '../render/nukeStrike.ts';
import { POP_YELLOW } from '../render/palette.ts';

const mix = (a: number, b: number, t: number) => {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
/**
 * How far a puff has coasted s seconds after the cloud turned white, in seconds of its speed at the turn: `kept` for
 * the speed it had, slowing a little as the air drags on it, and `turned` for the share that has swung round to its
 * heading, blended in over AFTER.whiteTurn so it bends rather than kinks. It never moves faster than at the turn.
 */
function coast(s: number): [number, number] {
  const k = AFTER.whiteSlow, r = AFTER.whiteTurn;
  const kept = k * (1 - Math.exp(-s / k));
  const ramp = (u: number) => (k * k - k * (u + k) * Math.exp(-u / k)) / r;
  const turned = s <= r ? ramp(s) : ramp(r) + k * (Math.exp(-r / k) - Math.exp(-s / k));
  return [kept, turned];
}

/** A bounded set of pre-drawn puffs. Only transforms, tint and alpha change each frame;
 * there are no emitters, random allocations, or fluid simulation in the animation. */
export class NukeCloud {
  readonly view = new Container();
  private readonly puffs: Array<{ art: Graphics; x: number; y: number; seed: number; layer: 'column' | 'cap' | 'skirt'; hot: number; heading: [number, number]; thinAt: number; at: [number, number]; v0: [number, number] }> = [];
  private readonly radius: number;
  private readonly height: number;

  constructor(radius: number, height: number) {
    this.radius = radius; this.height = height;
    this.view.label = 'nuke_smoke'; this.view.eventMode = 'none';
    // Born hot (the grand pass, src/render/nukeStrike.ts): the column yellow, the cap's lower rows the clock's urgent
    // orange paling upward, the skirt half as hot; each cools into its grey (heatAt).
    const ORANGE = 0xff7352;
    const puff = (x: number, y: number, r: number, seed: number, layer: 'column' | 'cap' | 'skirt', hot: number) => {
      const art = new Graphics(); art.label = layer;
      // Actual-size geometry keeps the billows round when enlarged. Shading gives
      // depth without a blur filter or per-frame mesh reconstruction.
      art.ellipse(0, 0, r * 1.1, r * 1.02).fill({ color: 0xcac7c0, alpha: 0.14 });
      art.ellipse(0, 0, r, r * 0.92).fill({ color: 0xffffff, alpha: 0.9 });
      art.ellipse(-r * 0.23, -r * 0.23, r * 0.7, r * 0.61).fill({ color: 0xffffff, alpha: 0.3 });
      // The way it turns to once the cloud is white, fanning out so the dome loosens: the cap's puffs out and up at
      // angles varied by seed, the stem's up after them, the skirt's out along the ground.
      const lean = (noise(seed * 977) - 0.5) * 1.6, lift = 0.4 + noise(seed * 541) * 1.2;
      const heading: [number, number] = layer === 'cap' ? [x / radius * 1.6 + lean, -lift]
        : layer === 'column' ? [x / radius * 1.2 + lean * 0.6, -1] : [Math.sign(x) || 1, -0.1];
      // When it starts to thin after the turn to white: the stem and skirt first, the cap round the end of the hold.
      const thinAt = AFTER.whiteHold * (layer === 'cap' ? 0.5 + noise(seed * 733) : 0.1 + 0.5 * noise(seed * 733));
      this.view.addChild(art); this.puffs.push({ art, x, y, seed, layer, hot, heading, thinAt, at: [0, 0], v0: [0, 0] });
    };
    // A thick, upright column. Three overlapping columns avoid both a tapered
    // funnel and the previous diagonal string of smoke beads.
    for (let row = 0; row < 7; row++) for (let col = -1; col <= 1; col++) {
      const seed = noise(row * 3 + col + 20);
      puff(col * radius * 0.17 + (seed - 0.5) * radius * 0.045,
        -height * (0.08 + row * 0.08), radius * (0.18 + seed * 0.055), seed, 'column', POP_YELLOW);
    }
    // Filled, overlapping rows build a rounded cauliflower dome rather than an
    // elliptical ring with a hole through its centre. More, smaller upper lobes
    // concentrate the billowing detail in the crown instead of the stalk.
    for (const [row, count, spread, level] of [[0, 7, 0.62, 0.61], [1, 11, 0.68, 0.71], [2, 13, 0.59, 0.8], [3, 13, 0.48, 0.865], [4, 7, 0.3, 0.92]] as const) {
      for (let i = 0; i < count; i++) {
        const k = i / (count - 1) * 2 - 1, seed = noise(row * 17 + i + 100);
        puff((k * spread + (seed - 0.5) * 0.025) * radius,
          -height * (level + (1 - k * k) * 0.035 + (seed - 0.5) * 0.012),
          radius * ((row < 2 ? 0.2 : 0.16) + seed * 0.055), seed, 'cap', row < 2 ? ORANGE : mix(ORANGE, POP_YELLOW, 0.6));
      }
    }
    // A low spreading skirt anchors the column to the scorched ground.
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12, seed = noise(i + 200);
      puff(Math.cos(a) * radius * 0.43, -height * 0.045 + Math.sin(a) * radius * 0.045,
        radius * (0.18 + seed * 0.04), seed, 'skirt', mix(POP_YELLOW, 0xfff0d0, 0.5));
    }
    for (const p of this.puffs) this.turn(p);
  }

  /** Where a puff is while the cloud is hot: rising out of the ground, swelling, the dome rolling and the column churning. */
  private hotPosition(p: NukeCloud['puffs'][number], age: number): [number, number] {
    const rise = 0.5 + 0.5 * EASE.out(Math.min(1, age / 2.5));
    const swell = 0.6 + 0.4 * EASE.out(Math.min(1, age / 2.8));
    const drift = Math.max(0, age - 1.2), roll = drift * (0.42 + p.seed * 0.2), side = Math.sign(p.x) || 1;
    const dx = p.layer === 'cap' ? side * Math.sin(roll) * this.radius * 0.085
      : p.layer === 'skirt' ? p.x * drift * 0.19 : Math.sin(roll + p.seed * 5) * this.radius * 0.035;
    const dy = p.layer === 'cap' ? -Math.sin(roll * 0.8) * this.height * 0.035
      : p.layer === 'skirt' ? 0 : -drift * this.height * (0.02 + p.seed * 0.012);
    return [p.x * swell + dx, p.y * rise + dy];
  }

  /** Where the puff is and how fast it is going as the cloud turns white, from its hot motion. */
  private turn(p: NukeCloud['puffs'][number]): void {
    const t = AFTER.whiteFrom, a = this.hotPosition(p, t), b = this.hotPosition(p, t - 0.01);
    p.at = a; p.v0 = [(a[0] - b[0]) / 0.01, (a[1] - b[1]) / 0.01];
  }

  draw(age: number, reduced: boolean): void {
    const swell = reduced ? 1 : 0.6 + 0.4 * EASE.out(Math.min(1, age / 2.8));
    const drift = reduced ? 0 : Math.max(0, age - 1.2);
    // Once it reads white, every puff goes on from where it is at the speed it has, turning to its heading, and
    // never speeds up. The puffs go on growing at about the pace the cloud swelled at.
    const since = Math.max(0, age - AFTER.whiteFrom);
    const grown = reduced ? 0 : 0.12 * since;
    const [kept, turned] = coast(since);
    for (const p of this.puffs) {
      const cap = p.layer === 'cap', skirt = p.layer === 'skirt';
      const side = Math.sign(p.x) || 1;
      // Slow outward rolls in the dome; mostly vertical turbulence in the column.
      const roll = drift * (0.42 + p.seed * 0.2);
      if (reduced) p.art.position.set(p.x, p.y);
      else if (since === 0) p.art.position.set(...this.hotPosition(p, age));
      else {
        const speed = Math.hypot(p.v0[0], p.v0[1]), h = Math.hypot(p.heading[0], p.heading[1]);
        p.art.position.set(p.at[0] + p.v0[0] * kept + (p.heading[0] / h * speed - p.v0[0]) * turned,
          p.at[1] + p.v0[1] * kept + (p.heading[1] / h * speed - p.v0[1]) * turned);
      }
      const expansion = (1 + drift * (cap ? 0.045 : skirt ? 0.085 : 0.035)) * (1 + grown);
      p.art.scale.set(swell * expansion, swell * expansion * (skirt ? 0.35 : 1));
      p.art.rotation = reduced || skirt ? 0 : side * Math.sin(roll) * (cap ? 0.1 : 0.025);
      // While the cloud is hot, pale wisps thin first and denser gray puffs hold
      // while they lighten, so color and lifetime describe the same progression.
      const density = 1 - p.seed;
      const lightAt = 1.35 + density * 2.1;
      const lightening = EASE.smooth(Math.max(0, Math.min(1, (age - 0.45) / (lightAt - 0.45))));
      const fade = Math.max(0, Math.min(1, (Math.min(age, AFTER.whiteFrom) - lightAt) / (1.4 + density * 0.8)));
      // Once it reads white, most of each puff thins away in its turn, and a wisp, larger and longer-lived in
      // denser puffs of the cap, drifts on and fades, lightening as it goes; the stem and skirt leave next to nothing.
      const remnant = cap ? 0.06 + 0.12 * density : 0.04;
      const thinning = 1 - EASE.smooth(Math.min(1, Math.max(0, (since - p.thinAt) / AFTER.whiteThin)));
      const after = (1 - remnant) * thinning + remnant * (1 - EASE.smooth(Math.min(1, since / (AFTER.whiteLinger * (0.8 + 0.4 * density)))));
      p.art.alpha = (skirt ? 0.42 : cap ? 0.8 : 0.72) * Math.pow(1 - fade, 1.2) * after;
      p.art.tint = mix(mix(mix(mix(0xb9b6af, 0xfff0d0, p.seed), 0xf4f1e9, lightening), p.hot, 0.85 * heatAt(age)),
        0xfbf9f3, 0.6 * EASE.smooth(Math.min(1, since / 0.6)));
    }
  }
}

/** Scorched paving and the party's cartoon ash piles, retained until the newspaper covers them. */
export function drawNukeAsh(g: Graphics, x: number, y: number, radius: number,
  members: ReadonlyArray<{ x: number; y: number; size: number }>): void {
  g.label = 'nuke_ash'; g.eventMode = 'none';
  drawScorchedPaving(g, x, y, radius);
  for (const [i, a] of members.entries()) {
    const s = a.size;
    // A long smear, a low heap and loose chunks, never a body-shaped silhouette.
    g.ellipse(a.x + s * 0.7, a.y + s * 0.15, s * 2, s * 0.55).fill({ color: 0x18171b, alpha: 0.5 });
    g.poly([a.x - s * 1.3, a.y, a.x - s * 0.65, a.y - s * 0.44, a.x - s * 0.2, a.y - s * 0.55,
      a.x + s * 0.35, a.y - s * 0.35, a.x + s * 0.8, a.y - s * 0.4, a.x + s * 1.35, a.y + s * 0.08,
      a.x + s * 0.5, a.y + s * 0.38, a.x - s * 0.65, a.y + s * 0.25]).fill(0x1b191d);
    for (let j = 0; j < 12; j++) {
      const r = noise(i * 20 + j + 300), dx = (noise(j + i * 10) - 0.35) * s * 3;
      g.ellipse(a.x + dx, a.y + (r - 0.5) * s * 0.8, s * (0.04 + r * 0.09), s * 0.06)
        .fill(j % 3 ? 0x4a4447 : 0x0d0c0f);
    }
  }
}
