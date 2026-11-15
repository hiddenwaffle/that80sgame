import { defaultFilterVert, Filter, GlProgram, UniformGroup } from 'pixi.js';

/**
 * The newspaper print look: flat colours are separated into cyan, magenta,
 * yellow, and black, and each ink is printed as a screen of dots at its own
 * angle, slightly out of register, on paper with a little grain. Dark areas
 * such as ink outlines stay solid.
 */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;

// uInputSize is in CSS pixels, so the dot size and shift are too. uRes is
// device pixels per CSS pixel, used to keep edges about one device pixel soft.
uniform float uDot;
uniform float uRes;
uniform vec3 uPaper;
uniform float uStrength;
uniform vec2 uShift;
uniform float uGrain;

// Colour without premultiplied alpha. Fully transparent pixels read as bare paper,
// so they print no ink.
vec3 sampleRGB(vec2 uv) {
  vec4 c = texture(uTexture, uv);
  return c.a > 0.001 ? c.rgb / c.a : uPaper;
}

vec4 toCMYK(vec3 rgb) {
  float k = 1.0 - max(max(rgb.r, rgb.g), rgb.b);
  float inv = 1.0 - k;
  vec3 cmy = inv > 0.0001 ? (vec3(1.0) - rgb - vec3(k)) / inv : vec3(0.0);
  return vec4(cmy, k);
}

float screenDot(vec2 px, float angle, float value) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 p = mat2(c, s, -s, c) * px / uDot;
  vec2 cell = fract(p) - 0.5;
  float d = length(cell);
  // A dot of radius 0.564 * sqrt(v) covers v of its cell; a little more reads punchier.
  float r = sqrt(clamp(value, 0.0, 1.0)) * 0.6;
  float aa = 0.8 / (uDot * uRes);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float alpha = texture(uTexture, vTextureCoord).a;
  if (alpha <= 0.001) {
    finalColor = vec4(0.0);
    return;
  }
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 texel = uInputSize.zw;
  vec3 base = sampleRGB(vTextureCoord);
  vec4 plateC = toCMYK(sampleRGB(vTextureCoord + uShift * texel));
  vec4 plateM = toCMYK(sampleRGB(vTextureCoord - uShift * texel));
  vec4 plate = toCMYK(base);

  float cyan = screenDot(px, 0.2618, plateC.x);
  float magenta = screenDot(px, 1.3090, plateM.y);
  float yellow = screenDot(px, 0.0, plate.z);
  // Black prints solid for dark lines and only screens in darker tones, so
  // bright flat colours stay clean.
  float kv = plate.w;
  float black = max(smoothstep(0.62, 0.78, kv), screenDot(px, 0.7854, smoothstep(0.3, 1.0, kv) * 0.8));

  vec3 col = uPaper;
  col *= mix(vec3(1.0), vec3(0.0, 0.62, 0.88), cyan);
  col *= mix(vec3(1.0), vec3(0.93, 0.12, 0.52), magenta);
  col *= mix(vec3(1.0), vec3(1.0, 0.93, 0.08), yellow);
  col *= mix(vec3(1.0), vec3(0.11, 0.10, 0.12), black);
  col += (hash(floor(px * uRes)) - 0.5) * uGrain;

  finalColor = vec4(mix(base, col, uStrength) * alpha, alpha);
}
`;

/**
 * How hard the print screen prints, for the world and the pictures alike. The owner chose these on
 * 2026-09-30 (sample d3), light enough that the art shows as drawn, to tune from the art up:
 * `strength` mixes the printed look over the art (0 is the art alone); `dotScale` sizes the dots
 * against the size each user picks; `grain` is noise over the paper; `shift` is how far the cyan and
 * magenta plates sit out of register, as a share of the full shift.
 */
export const PRINT = { strength: 0.15, dotScale: 0.55, grain: 0, shift: 0.1 };

export interface HalftoneOptions {
  /** Dot cell size in CSS pixels. */
  dot: number;
  /** Device pixels per CSS pixel. */
  resolution: number;
  paper: number;
  strength: number;
}

export class HalftoneFilter extends Filter {
  /** Device pixels per CSS pixel. */
  deviceRes: number;

  constructor(opts: HalftoneOptions) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'halftone-filter' });
    super({
      glProgram,
      resources: {
        halftoneUniforms: new UniformGroup({
          uDot: { value: opts.dot * PRINT.dotScale, type: 'f32' },
          uRes: { value: opts.resolution, type: 'f32' },
          uPaper: { value: new Float32Array(rgb(opts.paper)), type: 'vec3<f32>' },
          uStrength: { value: opts.strength, type: 'f32' },
          uShift: { value: new Float32Array([0.6 * PRINT.shift, 0.35 * PRINT.shift]), type: 'vec2<f32>' },
          uGrain: { value: PRINT.grain, type: 'f32' },
        }),
      },
    });
    this.resolution = opts.resolution;
    this.deviceRes = opts.resolution;
  }

  private get u() {
    return this.resources.halftoneUniforms.uniforms as {
      uDot: number;
      uRes: number;
      uStrength: number;
      uShift: Float32Array;
      uGrain: number;
    };
  }

  /** Sets the dot size (scaled by `PRINT.dotScale`) in CSS pixels, and the device pixels per CSS pixel. */
  setDot(cssPx: number, resolution: number): void {
    this.u.uDot = cssPx * PRINT.dotScale;
    this.u.uRes = resolution;
    this.resolution = resolution;
    this.deviceRes = resolution;
  }

  get strength(): number {
    return this.u.uStrength;
  }

  set strength(v: number) {
    this.u.uStrength = v;
  }
}

function rgb(n: number): [number, number, number] {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
