import { Container, Graphics } from 'pixi.js';
import { type BandStroke, type Point, StrokeMesh, strokeCalls } from '../render/stroke_mesh.ts';

/**
 * The strokes of a travelling band round a rectangle, clockwise from its top-left corner: short straight pieces about 2 units
 * long, each with how far round the band it sits. Exactly the arithmetic the band has always been drawn with.
 */
export function bandStrokes(x: number, y: number, w: number, h: number): BandStroke[] {
  const edges: [Point, Point][] = [[[x, y], [x + w, y]], [[x + w, y], [x + w, y + h]], [[x + w, y + h], [x, y + h]], [[x, y + h], [x, y]]];
  const strokes: BandStroke[] = [];
  let distance = 0;
  for (const [from, to] of edges) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]), steps = Math.ceil(length / 2);
    for (let k = 0; k < steps; k++) {
      const at = (distance + length * (k + .5) / steps) / (2 * (w + h));
      strokes.push({
        from: [from[0] + (to[0] - from[0]) * k / steps, from[1] + (to[1] - from[1]) * k / steps],
        to: [from[0] + (to[0] - from[0]) * (k + 1) / steps, from[1] + (to[1] - from[1]) * (k + 1) / steps],
        at,
      });
    }
    distance += length;
  }
  return strokes;
}

/** The band drawn as Graphics: the reference the mesh is checked against, and what is drawn if the mesh is unavailable. */
export function drawBandGraphics(g: Graphics, strokes: readonly BandStroke[], weight: number, colorAt: (at: number) => number): void {
  g.clear();
  strokeCalls(g, strokes, weight, s => colorAt(s.at));
}

/**
 * A card frame's travelling band. Its shape depends on the card's size and the line weight; its colours move with the animation's
 * phase. The shape is made once per size as a Mesh (src/render/stroke_mesh.ts: read docs/pixi_dependencies.md, this leans on Pixi's
 * tessellator), the colours are written into a few bytes when the phase moves; nothing is tessellated or uploaded as geometry per
 * step. Where the mesh is unavailable it is the Graphics drawing, redrawn when the phase moves, as before.
 */
export class TravellingBand {
  /** The band's slot in its card frame: put this in the frame's container where the band belongs. */
  readonly view = new Container();
  private readonly graphics = new Graphics();
  private mesh: StrokeMesh | null = null;
  private strokes: BandStroke[] = [];
  /** What the shape and the colours were last made for. Compared exactly: a stale drawing must never show. */
  private shapeFor = { x: NaN, y: NaN, w: NaN, h: NaN, weight: NaN };
  private phaseFor = NaN;

  constructor(label: string) {
    this.view.label = label;
    this.graphics.label = `${label}_graphics`;
    this.view.addChild(this.graphics);
  }

  draw(x: number, y: number, w: number, h: number, weight: number, phase: number, colorAt: (at: number) => number): void {
    const s = this.shapeFor;
    if (s.x !== x || s.y !== y || s.w !== w || s.h !== h || s.weight !== weight) {
      s.x = x; s.y = y; s.w = w; s.h = h; s.weight = weight;
      this.phaseFor = NaN;
      this.strokes = bandStrokes(x, y, w, h);
      this.mesh?.mesh.destroy();
      this.mesh = StrokeMesh.build(this.strokes, weight);
      this.graphics.clear();
      this.graphics.visible = !this.mesh;
      if (this.mesh) this.view.addChild(this.mesh.mesh);
    }
    if (this.phaseFor === phase) return;
    this.phaseFor = phase;
    if (this.mesh) this.mesh.setColors(k => colorAt(this.strokes[k]!.at));
    else drawBandGraphics(this.graphics, this.strokes, weight, colorAt);
  }

  /** Whether the mesh is in use (false: the Graphics fallback is). */
  get usesMesh(): boolean { return this.mesh !== null; }
}
