import { GlProgram, Mesh, MeshGeometry, Shader, UniformGroup, type Renderer } from 'pixi.js';
import { PAPER, RED_INK } from '../render/palette.ts';
import { deepened, VITAL_LOOK } from './vital_fill.ts';

type Rect = { x: number; y: number; w: number; h: number };

/**
 * A gauge's fill and its drifting paper dots, worked out for each pixel on the graphics card by the rule `vitalFill` and
 * print.ts's `benDay` draw them with (the owner picked this on 5 Nov 2026 for the fight cards, whose bars were drawn again
 * every frame because the dots drift: 1.5 to 2 ms of a fight's 3 ms frame). The dots' rows, pitch, drift, fade toward the
 * fill's end and shrinking at its edges are the same; their edges are smoothed here per pixel rather than by Pixi's
 * triangles, so pixels along the dots' rims differ a little. Overlapping dots darken twice, as two drawn dots do.
 * Nothing is rebuilt as the dots move: `set` only changes numbers. See docs/pixi_dependencies.md, section 3.
 */
const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vPos;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aUV;
}
`;

// In the gauge's own units: uRect is the whole bar, uFill the filled width from its left end. uShift is the drift already
// wrapped into one pitch as benDay wraps it, and uPx is how many units one screen pixel spans, for the smoothing.
const fragment = /* glsl */ `
in vec2 vPos;
out vec4 finalColor;
uniform vec4 uColor;
uniform vec4 uRect;
uniform float uFill;
uniform float uPitch;
uniform float uShift;
uniform float uPx;
uniform vec3 uFillColour;
uniform vec3 uDotColour;
uniform float uDotAlpha;
uniform vec3 uWashColour;
uniform float uWash;

float inside(float d) { return clamp(d / uPx + 0.5, 0.0, 1.0); }

void main() {
  vec2 p = uRect.xy + vPos * uRect.zw;
  float x0 = uRect.x, y0 = uRect.y, w = uFill, h = uRect.w;
  float cover = inside(p.x - x0) * inside(x0 + w - p.x) * inside(p.y - y0) * inside(y0 + h - p.y);
  if (cover <= 0.0) discard;
  vec3 colour = uFillColour;
  if (w > 2.0) {
    float halfPitch = uPitch * 0.5, rMax = uPitch * 0.42;
    vec2 fade = vec2(-w, h);
    float len2 = max(1.0, dot(fade, fade));
    float near = floor((p.y - y0 - uPitch * 0.25) / halfPitch + 0.5);
    for (int k = -1; k <= 1; k++) {
      float row = near + float(k);
      float cy = y0 + uPitch * 0.25 + row * halfPitch;
      if (row < 0.0 || cy >= y0 + h) continue;
      float start = x0 + (mod(row, 2.0) > 0.5 ? halfPitch : 0.0) + uPitch * 0.25 + uShift;
      float cx = start + max(0.0, floor((p.x - start) / uPitch + 0.5)) * uPitch;
      if (cx >= x0 + w) continue;
      float along = clamp(((cx - x0 - w) * fade.x + (cy - y0) * fade.y) / len2, 0.0, 1.0);
      float r = min(min(rMax * along, min(cx - x0, x0 + w - cx)), min(cy - y0, y0 + h - cy));
      if (r < 0.6) continue;
      colour = mix(colour, uDotColour, uDotAlpha * inside(r - distance(p, vec2(cx, cy))));
    }
  }
  colour = mix(colour, uWashColour, uWash);
  finalColor = vec4(colour * cover, cover) * uColor;
}
`;

const rgb = (c: number): Float32Array => new Float32Array([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);

/** One square, scaled to each bar: every gauge shares it. */
const SQUARE = new MeshGeometry({
  positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

let program: GlProgram | null = null;

export class VitalFillMesh {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private shaded = false;
  private readonly uniforms = new UniformGroup({
    uRect: { value: new Float32Array(4), type: 'vec4<f32>' },
    uFill: { value: 0, type: 'f32' },
    uPitch: { value: 1, type: 'f32' },
    uShift: { value: 0, type: 'f32' },
    uPx: { value: 1, type: 'f32' },
    uFillColour: { value: rgb(0), type: 'vec3<f32>' },
    uDotColour: { value: rgb(PAPER), type: 'vec3<f32>' },
    uDotAlpha: { value: VITAL_LOOK.dots, type: 'f32' },
    uWashColour: { value: rgb(RED_INK), type: 'vec3<f32>' },
    uWash: { value: 0, type: 'f32' },
  });

  constructor(label: string) {
    this.mesh = new Mesh<MeshGeometry, Shader>({ geometry: SQUARE });
    this.mesh.label = label;
    // Pixi calls this before it lists the frame's drawing. The shader is made at the first one: making its program asks the
    // browser for a test canvas, which a fight card built off screen (the unit tests) has none of. The smoothing needs the
    // screen's pixels in the gauge's units, known only as it is drawn.
    this.mesh.onRender = (renderer: Renderer) => {
      if (!this.shaded) {
        this.shaded = true;
        program ??= GlProgram.from({ vertex, fragment, name: 'vital-fill', preferredFragmentPrecision: 'highp' });
        this.mesh.shader = new Shader({ glProgram: program, resources: { vitalUniforms: this.uniforms } });
      }
      const wt = this.mesh.parent?.worldTransform;
      const scale = wt ? Math.hypot(wt.a, wt.b) : 1;
      (this.uniforms.uniforms as { uPx: number }).uPx = 1 / Math.max(1e-6, scale * renderer.resolution);
    };
  }

  /**
   * Shows the filled share `frac` of the gauge `r` in `colour`, its dots drifted `drift` of a pitch along, under a red
   * wash of strength `wash`, as `vitalFill` plus the fight card's wash rectangle would draw them.
   */
  set(r: Rect, frac: number, colour: number, u: number, drift = 0, wash = 0): void {
    const w = r.w * Math.max(0, Math.min(1, frac));
    this.mesh.visible = w > 0;
    if (w <= 0) return;
    this.mesh.position.set(r.x, r.y);
    this.mesh.scale.set(r.w, r.h);
    const pitch = u * 0.32;
    const s = this.uniforms.uniforms as Record<string, number | Float32Array>;
    (s.uRect as Float32Array).set([r.x, r.y, r.w, r.h]);
    s.uFill = w;
    s.uPitch = pitch;
    s.uShift = ((((drift * pitch) % pitch) + pitch) % pitch) - pitch;
    (s.uFillColour as Float32Array).set(rgb(deepened(colour)));
    s.uDotAlpha = VITAL_LOOK.dots;
    s.uWash = wash;
  }

  destroy(): void {
    this.mesh.destroy();
  }
}
