import { GlProgram, Matrix, Mesh, MeshGeometry, Shader, UniformGroup, type Renderer, type Texture } from 'pixi.js';
import { motion } from '../render/motion.ts';

/**
 * The giant ghost's body in holographic foil inside its painted ink, worked out for each pixel on the graphics card (the
 * owner, 2026-11-05: "The purple kinda blends in with the surroundings"; foil picked from six looks the same day). Its grey
 * picture is white skin and black ink, so the skin's lightness says how much foil shows: the outline and the hatching stay
 * black and the eyes, a picture of their own, are drawn over it untouched. The foil is pale silver with soft rainbow bands that
 * slide as the ghost moves across the screen, a fine sheen and twinkling glitter. Its blast's splash band is the same foil.
 * See docs/pixi_dependencies.md, section 3.
 */

/**
 * The world's clock as the figures were last drawn (Actor.render sets it), so the foil moves with the game and pauses with it;
 * and how near the giant's blast is, 0 to 1, which brightens the foil's shimmer and thickens its glitter. The fight sets it each
 * step with the clock's time then (`chargeAt`); left unset for a moment (the fight over), it counts as none.
 */
export const foilClock = { t: 0, charge: 0, chargeAt: -1 };

/** How much the blast's coming shows in the foil now, 0 to 1. */
export function foilCharge(): number {
  return foilClock.t - foilClock.chargeAt < 0.25 ? foilClock.charge : 0;
}

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

// q is the place in the picture in picture heights: 0 at its top, 1 at its feet. uPx is one screen pixel in those units, and
// uDrift the picture's left edge across the screen in the same units.
const foilGlsl = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;
uniform vec4 uColor;
uniform float uAspect;
uniform float uTime;
uniform float uPx;
uniform float uDrift;
uniform float uCharge;

const float TAU = 6.2831853;

float inside(float d) { return clamp(d / uPx + 0.5, 0.0, 1.0); }
// Without sin, whose large arguments some graphics cards round to the same few values.
float hash(vec2 c) { vec3 p = fract(vec3(c.xyx) * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }

// Charged for a blast, its colours deepen, bright ripples run up through it and the glitter thickens.
vec3 foil(vec2 q) {
  float s = q.x * 1.1 + q.y * 0.5 + uDrift * 0.35 + uTime * 0.04;
  vec3 c = mix(vec3(0.84, 0.86, 0.91), hue(fract(s * 1.4)), 0.42 + 0.2 * uCharge);
  c += 0.08 * sin((q.x - q.y) * 60.0 + uDrift * 3.0);
  c += uCharge * 0.4 * pow(max(0.0, sin(q.y * 14.0 + q.x * 4.0 + uTime * 16.0)), 6.0);
  vec2 cellId = floor(q / 0.05);
  vec2 at = (cellId + 0.25 + 0.5 * vec2(hash(cellId + 2.2), hash(cellId + 4.4))) * 0.05;
  float shine = max(0.0, sin(uTime * (2.5 + 6.0 * uCharge) + hash(cellId) * TAU + uDrift * 4.0));
  float r = (0.006 + 0.004 * uCharge) * shine;
  float speck = step(0.8 - 0.4 * uCharge, hash(cellId + 9.4)) * inside(r - length(q - at));
  return min(vec3(1.0), c + speck * 0.75);
}
`;

const fragment = /* glsl */ `${foilGlsl}
uniform sampler2D uTexture;
uniform vec4 uFrame;
uniform float uSkin;

void main() {
  vec4 tex = texture(uTexture, uFrame.xy + vUV * uFrame.zw);
  if (tex.a <= 0.0) discard;
  vec3 c = foil(vec2(vUV.x * uAspect, vUV.y));
  // Premultiplied: a white skin's green is its cover, black ink's is none. The eyelids are skin alone.
  float light = uSkin > 0.5 ? tex.a : tex.g;
  finalColor = vec4(c * light, tex.a) * uColor;
}
`;

// A flat strip of the foil, its height uBand of the units the ghost's own foil is measured in, so its pattern is larger.
const bandFragment = /* glsl */ `${foilGlsl}
uniform float uBand;

void main() {
  finalColor = vec4(foil(vec2(vUV.x * uAspect, vUV.y) * uBand), 1.0) * uColor;
}
`;

let program: GlProgram | null = null;
let bandProgram: GlProgram | null = null;
const shapes = new WeakMap<Texture, MeshGeometry>();

/** The picture's quad, standing on its feet and centred across (a sprite's anchor at 0.5, 1), in the picture's own units. */
function shape(tex: Texture): MeshGeometry {
  let g = shapes.get(tex);
  if (!g) {
    const w = tex.width, h = tex.height;
    g = new MeshGeometry({
      positions: new Float32Array([-w / 2, -h, w / 2, -h, w / 2, 0, -w / 2, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    shapes.set(tex, g);
  }
  return g;
}

export type FoilMesh = Mesh<MeshGeometry, Shader>;
type Moving = { uTime: number; uPx: number; uDrift: number; uCharge: number };

/**
 * The giant's picture in foil: placed as a sprite anchored at its feet would be. `skin` draws the foil alone, without the
 * picture's ink, for the eyelids that cover its painted eyes as it blinks.
 */
export function foilGhost(tex: Texture, skin = false): FoilMesh {
  const mesh = new Mesh<MeshGeometry, Shader>({ geometry: shape(tex) });
  mesh.label = skin ? 'ghost_foil_skin' : 'ghost_foil';
  const uvs = tex.uvs;
  const uniforms = new UniformGroup({
    uFrame: { value: new Float32Array([uvs.x0, uvs.y0, uvs.x2 - uvs.x0, uvs.y2 - uvs.y0]), type: 'vec4<f32>' },
    uAspect: { value: tex.width / tex.height, type: 'f32' },
    uSkin: { value: skin ? 1 : 0, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
    uPx: { value: 0.01, type: 'f32' },
    uDrift: { value: 0, type: 'f32' },
    uCharge: { value: 0, type: 'f32' },
  });
  const u = uniforms.uniforms as Moving;
  let shaded = false;
  // Pixi calls this before it lists the frame's drawing. The shader is made at the first one: making its program asks the
  // browser for a test canvas, which a figure drawn off screen (the unit tests) has none of.
  let shader: Shader | null = null;
  // The shader listens on the picture's source, which lives for the session: destroyed with its mesh, or every rebuilt ghost
  // left a listener there (Fable review P15, 2026-11-09).
  mesh.once('destroyed', () => { shader?.destroy(false); shader = null; });
  mesh.onRender = (renderer: Renderer) => {
    if (!shaded) {
      shaded = true;
      program ??= GlProgram.from({ vertex, fragment, name: 'ghost-foil', preferredFragmentPrecision: 'highp' });
      mesh.shader = shader = new Shader({ glProgram: program, resources: { uTexture: tex.source, foilUniforms: uniforms } });
    }
    move(u, mesh, tex.height, renderer);
  };
  return mesh;
}

/**
 * A strip `w` by `h` of the giant's foil, from its top left corner, for the band of its blast's splash. `band` is how many of
 * the ghost's foil heights it spans: the smaller, the larger its glitter and colour bands.
 */
export function foilBand(w: number, h: number, band: number): FoilMesh {
  const mesh = new Mesh<MeshGeometry, Shader>({
    geometry: new MeshGeometry({
      positions: new Float32Array([0, 0, w, 0, w, h, 0, h]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }),
  });
  mesh.label = 'ghost_foil_band';
  const uniforms = new UniformGroup({
    uAspect: { value: w / h, type: 'f32' },
    uBand: { value: band, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
    uPx: { value: 0.01, type: 'f32' },
    uDrift: { value: 0, type: 'f32' },
    uCharge: { value: 0, type: 'f32' },
  });
  const u = uniforms.uniforms as Moving;
  let shaded = false;
  mesh.onRender = (renderer: Renderer) => {
    if (!shaded) {
      shaded = true;
      bandProgram ??= GlProgram.from({ vertex, fragment: bandFragment, name: 'ghost-foil-band', preferredFragmentPrecision: 'highp' });
      mesh.shader = new Shader({ glProgram: bandProgram, resources: { foilUniforms: uniforms } });
    }
    move(u, mesh, h / band, renderer);
  };
  return mesh;
}

const PLACED = new Matrix();

/**
 * The numbers that change as it is drawn: foil `tall` of its own units high, as on screen now. Its place is worked out from its
 * parents here: Pixi runs this before it updates the frame's transforms, so a picture just made (a walking ghost's, about 20
 * times a second) would read none, and its foil would jump for a frame (the owner, 2026-11-05: "its colors would go flicker
 * really fast, like a white flickering").
 */
function move(u: Moving, mesh: FoilMesh, tall: number, renderer: Renderer): void {
  const wt = mesh.getGlobalTransform(PLACED, false);
  const px = tall * Math.hypot(wt.c, wt.d) * renderer.resolution;
  u.uPx = 1 / Math.max(1, px);
  u.uTime = motion.reduced ? 0 : foilClock.t;
  u.uDrift = (wt.tx * renderer.resolution) / Math.max(1, px);
  u.uCharge = foilCharge();
}
