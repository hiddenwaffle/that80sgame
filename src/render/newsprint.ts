import { defaultFilterVert, Filter, GlProgram, UniformGroup, type FilterSystem, type RenderSurface, type Texture } from 'pixi.js';

/**
 * Early colour newsprint, for the photos on the tall front pages: the colours dulled and the range
 * squashed as on cheap paper, then cyan, magenta, yellow and black each printed as a cosine dot screen
 * at its own angle (round dots in the light tones, a checkerboard at half, white dots in the dark),
 * the dots spread a little by the paper, and three plates slightly out of register.
 * The look the owner picked on 2026-10-19 from `.scratch/photo_print/`.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;

uniform float uCell;
uniform float uRes;
uniform vec3 uPaper;

vec3 sampleRGB(vec2 uv) {
  vec4 c = texture(uTexture, uv);
  return c.a > 0.001 ? c.rgb / c.a : uPaper;
}

// The picture as the press saw it, a little soft: four taps about a quarter cell apart.
vec3 soft(vec2 uv) {
  vec2 d = uInputSize.zw * uCell * 0.25;
  return 0.25 * (sampleRGB(uv + vec2(d.x, d.y)) + sampleRGB(uv + vec2(-d.x, d.y)) + sampleRGB(uv + vec2(d.x, -d.y)) + sampleRGB(uv + vec2(-d.x, -d.y)));
}

vec4 plates(vec3 rgb) {
  float l = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = vec3(l) + (rgb - vec3(l)) * 0.8;
  rgb = vec3(0.04) + rgb * vec3(0.92, 0.92, 0.9);
  float k = (1.0 - max(max(rgb.r, rgb.g), rgb.b)) * 0.7;
  float inv = 1.0 - k;
  vec3 cmy = clamp((vec3(1.0) - rgb - vec3(k)) / inv, 0.0, 1.0);
  return vec4(cmy, k);
}

float screenAt(vec2 px, float angle, float v) {
  v = clamp(v + 0.3 * v * (1.0 - v), 0.0, 1.0);
  float s = sin(angle), c = cos(angle);
  vec2 p = mat2(c, s, -s, c) * px * (6.28318 / uCell);
  float spot = 0.5 * (cos(p.x) + cos(p.y));
  float e = clamp(1.6 / (uCell * uRes), 0.08, 0.35);
  return smoothstep(-e, e, spot - (1.0 - 2.0 * v));
}

void main() {
  float alpha = texture(uTexture, vTextureCoord).a;
  if (alpha <= 0.001) {
    finalColor = vec4(0.0);
    return;
  }
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 t = uInputSize.zw;
  float c = screenAt(px, 0.2618, plates(soft(vTextureCoord - vec2(-1.2, 0.3) * t)).x) * 0.86;
  float m = screenAt(px, 1.3090, plates(soft(vTextureCoord - vec2(1.8, 0.8) * t)).y) * 0.86;
  float y = screenAt(px, 0.0, plates(soft(vTextureCoord - vec2(0.6, -1.2) * t)).z) * 0.9;
  float k = screenAt(px, 0.7854, plates(soft(vTextureCoord)).w) * 0.92;
  vec3 col = uPaper;
  col *= 1.0 - c * (vec3(1.0) - vec3(0.0, 0.6, 0.86));
  col *= 1.0 - m * (vec3(1.0) - vec3(0.86, 0.16, 0.46));
  col *= 1.0 - y * (vec3(1.0) - vec3(0.99, 0.88, 0.14));
  col *= 1.0 - k * (vec3(1.0) - vec3(0.14, 0.13, 0.15));
  finalColor = vec4(col * alpha, alpha);
}
`;

export class NewsprintFilter extends Filter {
  /** Told of each texture Pixi draws the photo into for this filter, so its page can let it go when it closes. */
  private readonly drawnInto?: (texture: Texture) => void;

  constructor(opts: { cell: number; resolution: number; paper: number; drawnInto?: (texture: Texture) => void }) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'newsprint-filter' });
    super({
      glProgram,
      // The whole photo, even where it is off the screen as its page slides: Pixi keeps every size of texture a filter has
      // drawn into for good (TexturePool), so a size cut to the screen's edge each frame would leave one behind per size.
      clipToViewport: false,
      resources: {
        newsprintUniforms: new UniformGroup({
          uCell: { value: opts.cell, type: 'f32' },
          uRes: { value: opts.resolution, type: 'f32' },
          uPaper: { value: new Float32Array(rgb(opts.paper)), type: 'vec3<f32>' },
        }),
      },
    });
    this.resolution = opts.resolution;
    this.drawnInto = opts.drawnInto;
  }

  /** As Pixi's own (Filter.apply), after telling the page which texture the photo was drawn into: one from Pixi's TexturePool. */
  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    this.drawnInto?.(input);
    filterManager.applyFilter(this, input, output, clearMode);
  }
}

/** As many dots across a photo as a chapter page's had on a 5K screen (1001 CSS pixels wide, dots 2.66 apart). */
const DOTS_ACROSS = 376;
/** The closest the dots go, in device pixels: closer, the four screens beat into a coarse grid of their own (moiré) on a phone. */
const DOT_FLOOR = 4;
/** On a 1x screen that floor would print coarser dots than the pages always had, blurring the faces; there they stop at those. */
const DOT_FLOOR_CSS = 2.66;

/**
 * How far apart a photo's dots are, in CSS pixels, for a photo this many CSS pixels wide on screen: the same number across it on
 * any screen, so a phone's photo prints as a big screen's does, only smaller; never closer than DOT_FLOOR device pixels (the owner's
 * pick, 2026-11-10), nor than DOT_FLOOR_CSS where that is closer.
 */
export function newsprintCell(photoWidth: number, resolution: number): number {
  return Math.max(photoWidth / DOTS_ACROSS, Math.min(DOT_FLOOR / resolution, DOT_FLOOR_CSS));
}

function rgb(n: number): [number, number, number] {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
