import { defaultFilterVert, Filter, GlProgram, UniformGroup, type FilterSystem, type RenderSurface, type Texture } from 'pixi.js';

/**
 * Makes the page around the photo look printed. Works in the page's own units, so it looks the same at any size:
 * the page is split into cyan, magenta, yellow and black; the three colours are printed as a fine dot screen, a touch
 * under full strength, a little out of register with the black; the black spreads a little (ink gain). Over that:
 * paper fibres and mottling, warmer edges and corners, a few faint stains, show-through from the back, and a fold.
 * Only the area inside the page's face is touched, so the page's shadow stays as it was.
 * Tuned on page captures by Sonnet (2026-11-08). Pixi internals it leans on (the filter's `defaultFilterVert`, the names
 * `vTextureCoord`, `uTexture`, `uInputSize`, `uOutputFrame` and `finalColor`, and GLSL ES 1.00: no array indexing or constructors, no `%`)
 * are listed in docs/pixi_dependencies.md beside the NewsprintFilter's.
 */
const fragment = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#endif
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;

uniform vec2 uOrigin;   // the texture's top left, in page units
uniform vec2 uBounds;   // the texture's size, in page units
uniform vec2 uPage;     // the page's face, in page units
uniform vec3 uPaper;
uniform float uCell;    // the dot pitch, in page units

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 sampleRGB(vec2 uv) {
  vec4 c = texture(uTexture, uv);
  return c.a > 0.001 ? c.rgb / c.a : uPaper;
}
// How much ink the page has at a point, 0 for bare paper to 1 for solid, as cyan, magenta and yellow.
vec3 inkOf(vec2 uv) { return vec3(1.0) - clamp(sampleRGB(uv) / uPaper, 0.0, 1.0); }
// Black takes only the neutral part, so a red or a yellow keeps its own plates and text edges stay clean.
float blackOf(vec3 ink) {
  float mn = min(min(ink.r, ink.g), ink.b), mx = max(max(ink.r, ink.g), ink.b);
  return mn * (1.0 - smoothstep(0.08, 0.4, mx - mn));
}

// A soft browned patch: centre as a share of the page, radius and strength in page units.
vec3 stain(vec2 P, vec4 s) {
  vec2 d = P - s.xy * uPage;
  float f = exp(-dot(d, d) / (2.0 * (s.z * 0.5) * (s.z * 0.5))) * s.w;
  return vec3(1.0 - f * 0.45, 1.0 - f * 0.8, 1.0 - f * 1.4);
}

// One colour plate at a point: its ink with the neutral part left to the black.
float plateOf(vec2 uv, vec3 which) {
  vec3 ink = inkOf(uv);
  return dot(ink, which) - blackOf(ink);
}

float dots(vec2 px, float cellPx, float angle, float v) {
  float fade = smoothstep(0.0, 0.05, v);
  v = clamp(v * 0.97, 0.0, 1.0);
  float s = sin(angle), c = cos(angle);
  vec2 p = mat2(c, s, -s, c) * px * (6.28318 / cellPx);
  float spot = 0.5 * (cos(p.x) + cos(p.y));
  float e = clamp(1.6 / cellPx, 0.08, 0.35);
  return smoothstep(-e, e, spot - (1.0 - 2.0 * v)) * fade;
}

void main() {
  vec4 base = texture(uTexture, vTextureCoord);
  vec2 px = vTextureCoord * uInputSize.xy;
  // Texture pixels to a page unit, by the page's own frame: the texture is a pooled one, larger than the page (TexturePool
  // rounds it up to a power of two), and by its width the fold fell at about 0.88 of a phone's page (found 8 Nov).
  float unit = uOutputFrame.z / uBounds.x;
  vec2 P = uOrigin + px / unit;
  // Outside the face (the page's shadow) nothing changes.
  if (P.x < 0.0 || P.y < 0.0 || P.x > uPage.x || P.y > uPage.y || base.a < 0.5) {
    finalColor = base;
    return;
  }
  vec2 t = uInputSize.zw;
  float cellPx = max(uCell * unit, 2.2);

  // Three colour plates a little out of register with the black one, as dot screens.
  vec2 offC = vec2(-0.31, 0.07) * unit, offM = vec2(0.47, 0.21) * unit, offY = vec2(0.16, -0.31) * unit;
  float c = dots(px, cellPx, 0.2618, plateOf(vTextureCoord + offC * t, vec3(1.0, 0.0, 0.0))) * 0.97;
  float m = dots(px, cellPx, 1.3090, plateOf(vTextureCoord + offM * t, vec3(0.0, 1.0, 0.0))) * 0.97;
  float y = dots(px, cellPx, 0.0, plateOf(vTextureCoord + offY * t, vec3(0.0, 0.0, 1.0))) * 0.97;
  // Ink gain: the black spreads a touch.
  vec2 r = vec2(0.28) * unit * t;
  float k = blackOf(inkOf(vTextureCoord)) * 2.0 + blackOf(inkOf(vTextureCoord + vec2(r.x, 0.0))) + blackOf(inkOf(vTextureCoord - vec2(r.x, 0.0)))
          + blackOf(inkOf(vTextureCoord + vec2(0.0, r.y))) + blackOf(inkOf(vTextureCoord - vec2(0.0, r.y)));
  k = smoothstep(0.1, 0.6, k / 6.0) * 0.95;
  vec3 col = uPaper;
  col *= 1.0 - c * (vec3(1.0) - vec3(0.0, 0.6, 0.86));
  col *= 1.0 - m * (vec3(1.0) - vec3(0.86, 0.16, 0.46));
  col *= 1.0 - y * (vec3(1.0) - vec3(0.99, 0.88, 0.14));
  col *= 1.0 - k * (vec3(1.0) - vec3(0.14, 0.13, 0.15));

  // Paper: fibres (grain stretched sideways), a fine speck, slow mottling.
  float fibreCell = max(0.23, 1.3 / unit);
  float g = 1.0 + (vnoise(P / vec2(1.6, fibreCell) + 5.0) - 0.5) * 0.06
              + (hash(floor(px) + 17.0) - 0.5) * 0.012
              + (vnoise(P / 16.4 + 3.0) - 0.5) * 0.035 + (vnoise(P / 61.0 + 9.0) - 0.5) * 0.04;
  // Warmer, darker edges and corners.
  vec2 e2 = vec2(min(P.x, uPage.x - P.x), min(P.y, uPage.y - P.y));
  float warm = (1.0 - smoothstep(0.0, 44.0, min(e2.x, e2.y))) * 0.55 + (1.0 - smoothstep(0.0, 67.0, length(e2))) * 0.6;
  vec3 tone = vec3(1.0 - 0.045 * warm, 1.0 - 0.085 * warm, 1.0 - 0.17 * warm) * g;
  // A few faint stains.
  vec2 u = P / uPage;
  tone *= stain(P, vec4(0.82, 0.17, 35.0, 0.07)) * stain(P, vec4(0.12, 0.63, 49.0, 0.06)) * stain(P, vec4(0.70, 0.90, 42.0, 0.08)) * stain(P, vec4(0.35, 0.04, 28.0, 0.05));
  // Show-through: the back page's dark ink, mirrored and shifted, soft and faint.
  vec2 f0 = -uOrigin / uBounds, f1 = (uPage - uOrigin) / uBounds;
  vec2 gu = vec2(1.0 - u.x, fract(u.y + 0.143));
  // As a share of the page's frame, which fills only part of the pooled texture.
  vec2 guv = (f0 + gu * (f1 - f0)) * uOutputFrame.zw * uInputSize.zw;
  vec2 sp = vec2(0.8) * unit * t;
  float ghost = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2((i < 2 ? -1.0 : 1.0) * sp.x, (mod(float(i), 2.0) < 1.0 ? -1.0 : 1.0) * sp.y);
    vec3 s = sampleRGB(guv + o);
    ghost += 1.0 - clamp(dot(s, vec3(0.3, 0.59, 0.11)) / dot(uPaper, vec3(0.3, 0.59, 0.11)), 0.0, 1.0);
  }
  tone *= 1.0 - ghost * 0.25 * 0.04;
  // The fold across the middle: a thin bright ridge and a soft shadow band under it.
  float foldY = uPage.y * 0.5 + (vnoise(vec2(P.x / 21.0, 9.0)) - 0.5) * 1.2;
  float dy = P.y - foldY;
  float sr = max(0.4, 0.8 / unit);
  float ridge = exp(-(dy * dy) / (2.0 * sr * sr)) * (0.07 + 0.1 * vnoise(vec2(P.x / 3.3, 22.0)));
  float shade = exp(-((dy - 1.6) * (dy - 1.6)) / (2.0 * 2.1 * 2.1)) * 0.1 + exp(-((dy + 1.4) * (dy + 1.4)) / (2.0 * 1.64 * 1.64)) * 0.03;
  col = col * tone * (1.0 - shade) + ridge * 0.75 * uPaper;
  // The cut edge: a darker hair of thickness, uneven along its length.
  float along = e2.x < e2.y ? P.y : P.x;
  float wob = vnoise(vec2(along / 9.4, e2.x < e2.y ? 3.1 : 11.3)) - 0.5;
  float dist = (min(e2.x, e2.y) - wob * 0.85) * unit;
  col *= 1.0 - 0.11 * (1.0 - smoothstep(0.0, 4.0, dist));
  finalColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class PaperFilter extends Filter {
  /** Told of each texture Pixi draws the page into for this filter, so the page can let it go when it closes. */
  private readonly drawnInto?: (texture: Texture) => void;

  /**
   * `origin` and `bounds` place the filtered group's texture in page units (its top left and its size); `page` is the
   * page's face; `cell` is the dot pitch in page units.
   */
  constructor(opts: { origin: [number, number]; bounds: [number, number]; page: [number, number]; paper: number; cell: number; resolution: number; drawnInto?: (texture: Texture) => void }) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'paper-filter' });
    super({
      glProgram,
      // The whole page, even where it is off the screen as it slides: the page units above assume the texture holds all of it,
      // and Pixi keeps every size of texture a filter has drawn into for good (TexturePool), so a size cut to the screen's
      // edge each frame would leave one behind per size (docs/pixi_dependencies.md).
      clipToViewport: false,
      resources: {
        paperUniforms: new UniformGroup({
          uOrigin: { value: new Float32Array(opts.origin), type: 'vec2<f32>' },
          uBounds: { value: new Float32Array(opts.bounds), type: 'vec2<f32>' },
          uPage: { value: new Float32Array(opts.page), type: 'vec2<f32>' },
          uPaper: { value: new Float32Array([((opts.paper >> 16) & 255) / 255, ((opts.paper >> 8) & 255) / 255, (opts.paper & 255) / 255]), type: 'vec3<f32>' },
          uCell: { value: opts.cell, type: 'f32' },
        }),
      },
    });
    this.resolution = opts.resolution;
    this.drawnInto = opts.drawnInto;
  }

  /** As Pixi's own (Filter.apply), after telling the page which texture the page was drawn into: one from Pixi's TexturePool. */
  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    this.drawnInto?.(input);
    filterManager.applyFilter(this, input, output, clearMode);
  }
}
