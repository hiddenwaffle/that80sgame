import { BufferImageSource, Container, GlProgram, Mesh, MeshGeometry, Shader, Sprite, Texture, UniformGroup, type TextureSource } from 'pixi.js';
import { walkFacing } from '../art/geom.ts';
import { unrobinson } from '../art/robinson.ts';
import { LIGHTS, MAP_STEP } from '../art/titleMapData.ts';
import { PACIFIC_LIGHTS } from '../art/titleMapLights.ts';
import { POP_YELLOW } from '../render/palette.ts';
import type { Dir } from '../art/geom.ts';
import { projectGlobe, unprojectGlobe, type GlobeLocation } from './titleProjection.ts';
import { FACING, PAC_LAT_LIMIT, WHOLE, anchor, arcDegrees, awayFrom, crowded, lonDelta, pick, unit, type Chase, type Focus } from './titleChase.ts';
import type { DotPool } from './titleDots.ts';
import { distanceMapShader } from './title_globe_sdf.ts';
import type { GlobeField, GlobeFieldCache } from './title_globe_load.ts';

/**
 * The title's world as a turning neon globe, for upright phones where the flat map cannot fill the width (concept D).
 * The coastlines, the graticule and their glow are drawn once, flat, into a map laid out by longitude and latitude; the
 * globe is then one disc whose shader finds, for each pixel, the latitude and longitude it shows and reads that point of
 * the map. Turning it is one number a frame. The city lights and the trio are sprites placed by the same projection.
 */

/** The globe's colours: the ocean (the floor), the graticule over the sea and over land, and the neon's glow, tube
 * and pale core. */
export interface GlobeColours { floor: number; grid: number; gridLand?: number; neon: number; glow: number; core: number }
/** The house's pink neon, as the flat title map has it (src/ui/titleMap.ts). */
export const GLOBE_PINK: GlobeColours = { floor: 0x140a1a, grid: 0x4a1d47, neon: 0xff4fa3, glow: 0x7a1f52, core: 0xdfe6ff };

/** One turn a minute, westward light as on the real Earth: the longitude facing us falls by 6 degrees a second. */
const TURN_DEG_S = -6;
/** Line widths are the flat map's (src/ui/titleMap.ts), scaled to the globe as concept D drew them: K = r / 175 * 0.9. */
const LINE_K = 0.9 / 175;
/** The space round the globe for the rim's glow, in globe radii. */
const MARGIN = 1.1;
/** The trio's walk in degrees a second (the flat map's 0.315 R a second), and how near a light must be to be eaten. An eaten light is back once its place has turned out of sight. */
const WALK = 18, EAT = 2.2;
/** With Reduce motion the globe holds still, so an eaten light cannot wait to be turned out of sight: it is back after this many seconds. */
const STILL_BACK_S = 8;
/** Past this share of the way from the middle of the screen to the edge of what it shows, a pac is drawn back toward the middle, at up to DRIFT degrees a second. */
const DRIFT_FROM = 0.45, DRIFT = 16;

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const pack = (v: number[]) => (Math.min(255, Math.round(v[0]!)) << 16) | (Math.min(255, Math.round(v[1]!)) << 8) | Math.min(255, Math.round(v[2]!));
const mix = (a: number, b: number, t: number) => { const x = rgb(a), y = rgb(b); return pack(x.map((v, i) => v + (y[i]! - v) * t)); };
const plus = (a: number, b: number, k: number) => { const x = rgb(a), y = rgb(b); return pack(x.map((v, i) => v + y[i]! * k)); };
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const vec3 = (c: number) => new Float32Array(rgb(c).map((v) => v / 255));

/** The flat map's neon stack, widest first, each stroke opaque as the see-through one would show over the floor. */
function coastStack(c: GlobeColours): [number, number][] {
  const c1 = plus(c.floor, c.neon, 0.07), c2 = plus(c1, c.neon, 0.12), c3 = plus(c2, c.neon, 0.22);
  return [[14, c1], [9, c2], [5.5, c3], [5, mix(c3, c.glow, 0.55)], [1.9, c.neon], [0.75, mix(c.neon, c.core, 0.85)]];
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

// Orthographic, the axis tipped toward us by uTilt. For a pixel on the disc: its point on the sphere, turned back by the
// tilt, gives latitude asin(Y) and longitude atan(X, Z) from the one facing us. That longitude jumps a whole turn behind
// the pole, so with WebGL 2 the texture's slope is taken from whichever of two readings has no jump there (no seam at
// the jump, and the map keeps its mipmaps). Pixi compiles a shader as GLSL ES 3.00 only when its fragment source starts
// with #version 300 es; WebGL 1 gets the plain reading of the older language, without mipmaps so the jump leaves no seam.
const SAMPLE_ES300 = `textureGrad(uMap, vec2(u, v),
      vec2(abs(dFdx(u)) < abs(dFdx(fract(u + 0.5))) ? dFdx(u) : dFdx(fract(u + 0.5)), dFdx(v)),
      vec2(abs(dFdy(u)) < abs(dFdy(fract(u + 0.5))) ? dFdy(u) : dFdy(fract(u + 0.5)), dFdy(v))).rgb`;
const SAMPLE_ES100 = 'texture(uMap, vec2(u, v)).rgb';
const fragmentBody = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uMap;
uniform vec4 uColor;
uniform float uLon;
uniform float uTilt;
uniform float uMargin;
uniform float uBreathe;
uniform float uPx;
uniform float uLine;
uniform vec3 uFloor;
uniform vec3 uRim0;
uniform vec3 uRim1;
uniform vec3 uRim2;
uniform vec3 uRim3;
uniform vec3 uRim4;
uniform vec3 uRim5;

const float PI = 3.14159265358979;

float band(float d, float w) { return 1.0 - smoothstep(w * 0.5 - uPx, w * 0.5 + uPx, d); }

void main() {
  vec2 p = (vUV * 2.0 - 1.0) * uMargin;
  p.y = -p.y;
  float d = length(p);
  float bloom = 0.82 + 0.18 * uBreathe;
  // Worked out for every pixel, off the disc too (clamped there), because texture slopes are only defined where all
  // four pixels of a 2x2 block take the same path.
  float zp = sqrt(max(0.0, 1.0 - d * d));
  float ct = cos(uTilt), st = sin(uTilt);
  float Y = p.y * ct + zp * st;
  float Z = zp * ct - p.y * st;
  float lat = asin(clamp(Y, -1.0, 1.0));
  float u = (uLon + atan(p.x, Z)) / (2.0 * PI) + 0.5;
  float v = 0.5 - lat / PI;
  vec3 map = SAMPLE;
  vec3 col = d < 1.0 ? uFloor + (map - uFloor) * bloom : uFloor;
  // The rim: the coastlines' neon stack as a ring round the globe, widest first.
  float r = abs(d - 1.0);
  vec3 ring = uFloor + (uRim0 - uFloor) * bloom * band(r, 14.0 * uLine);
  ring = mix(ring, uFloor + (uRim1 - uFloor) * bloom, band(r, 9.0 * uLine));
  ring = mix(ring, uFloor + (uRim2 - uFloor) * bloom, band(r, 5.5 * uLine));
  ring = mix(ring, uRim3, band(r, 5.0 * uLine));
  ring = mix(ring, uRim4, band(r, 1.9 * uLine));
  ring = mix(ring, uRim5, band(r, 0.75 * uLine));
  float onRing = band(r, 14.0 * uLine);
  col = mix(col, ring, onRing);
  float a = 1.0 - smoothstep(1.0 + 7.0 * uLine - uPx, 1.0 + 7.0 * uLine + uPx, d);
  finalColor = vec4(col, 1.0) * a * uColor.a;
}
`;

interface Light { lon: number; lat: number; s: Sprite; eatenAt: number; v: { x: number; y: number; z: number } }

/** What the globe needs of a pac: the game's Actor has all of it. */
export interface GlobePac {
  readonly view: Container;
  x: number;
  y: number;
  readonly size: number;
  facing: Dir;
  moving: boolean;
  update(dt: number): void;
  render(time: number): void;
}
interface Pac { pac: GlobePac; lon: number; lat: number; target: number }

export interface GlobeOptions {
  /** Boot's completed worker field; no synchronous map or fallback is drawn. */
  field: GlobeField;
  fields?: GlobeFieldCache;
  tiltDeg?: number;
  /** Whether the renderer's context is WebGL 2 (the shader's language and the map's mipmaps follow it). */
  webgl2?: boolean;
  /** The trio and where each starts, in degrees. */
  pacs?: { pac: GlobePac; lat: number; lon: number }[];
  /** A pac's size in globe radii, as the flat map sizes one in its R; lights are 4/22 (pellet) and 7/22 (glow) of it. */
  pacSize?: number;
  /** The chomp's speed against the game's. */
  chomp?: number;
  /** The player's dots, which the pacs chase and eat as they do the lights, and what to do when one is eaten. */
  dots?: DotPool;
  onEat?: (index: number) => void;
}

export class TitleGlobe {
  readonly view = new Container();
  /** How long drawing the map took, in milliseconds. */
  readonly buildMs: number;
  readonly bakeInfo: Record<string, number | string | boolean>;
  private source: TextureSource;
  private unsubscribe?: () => void;
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly uniforms: UniformGroup;
  private readonly lights: Light[] = [];
  private readonly pacs: Pac[] = [];
  private readonly lightLayer = new Container();
  private readonly trioLayer = new Container({ sortableChildren: true });
  private readonly lightTexture: Texture;
  private readonly pacSize: number;
  private readonly chomp: number;
  private readonly dotPool: DotPool | null;
  private readonly onEat: ((index: number) => void) | null;
  /** What a pac might chase this step, reused: the lights (ids from 0) and then the dots; and by id. */
  private readonly chases: Chase[] = [];
  private chaseCount = 0;
  private readonly chaseById: Array<Chase | undefined> = [];
  /** The middle of the screen's part of the globe, and how far that reaches (see titleChase.ts); the whole disc until it is placed. */
  private focus: Focus = WHOLE;
  private readonly middle = { lon: 0, lat: 0 };
  private readonly where: GlobeLocation = { lon: 0, lat: 0 };
  private lon0 = -20;
  private tilt = 20;
  private r = 100;
  private t = 0;
  private readonly projected = { x: 0, y: 0, z: 0 };

  constructor(colours: GlobeColours, opts: GlobeOptions) {
    const webgl2 = opts.webgl2 ?? true;
    if (opts.tiltDeg !== undefined) this.tilt = opts.tiltDeg;
    this.pacSize = opts.pacSize ?? 0.093;
    this.chomp = opts.chomp ?? 1;
    this.dotPool = opts.dots ?? null;
    this.onEat = opts.onEat ?? null;
    const t0 = performance.now();
    const field = opts.field, width = field.width;
    const style = { autoGenerateMipmaps: false, addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
      scaleMode: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha' } as const;
    this.bakeInfo = { ...field.info, startAt: t0, pending: false, readyAt: t0 };
    this.source = new BufferImageSource({ resource: field.pixels, width, height: width / 2, ...style });
    this.buildMs = performance.now() - t0;
    const stack = coastStack(colours);
    this.uniforms = new UniformGroup({
      uLon: { value: 0, type: 'f32' }, uTilt: { value: (this.tilt * Math.PI) / 180, type: 'f32' },
      uMargin: { value: MARGIN, type: 'f32' }, uBreathe: { value: 1, type: 'f32' }, uPx: { value: 0.01, type: 'f32' },
      uLine: { value: LINE_K, type: 'f32' },
      uMapSize: { value: width, type: 'f32' },
      uGrid: { value: vec3(mix(colours.floor, colours.grid, .75)), type: 'vec3<f32>' },
      uGridLand: { value: vec3(mix(colours.floor, colours.gridLand ?? colours.grid, .75)), type: 'vec3<f32>' }, uFloor: { value: vec3(colours.floor), type: 'vec3<f32>' },
      ...Object.fromEntries(stack.map(([, c], i) => [`uRim${i}`, { value: vec3(c), type: 'vec3<f32>' as const }])),
    });
    const body = fragmentBody.replace('uniform vec3 uFloor;', 'uniform vec3 uFloor;\nuniform float uMapSize;\nuniform vec3 uGrid;\nuniform vec3 uGridLand;').replace('vec3 map = SAMPLE;', distanceMapShader(webgl2));
    const fragment = webgl2 ? `#version 300 es\n${body.replace('SAMPLE', SAMPLE_ES300)}` : body.replace('SAMPLE', SAMPLE_ES100);
    const glProgram = GlProgram.from({ vertex, fragment, name: webgl2 ? 'title-globe' : 'title-globe-webgl1', preferredFragmentPrecision: 'highp' });
    const shader = new Shader({ glProgram, resources: { uMap: this.source, globeUniforms: this.uniforms } });
    const m = MARGIN;
    const geometry = new MeshGeometry({
      positions: new Float32Array([-m, -m, m, -m, m, m, -m, m]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.mesh = new Mesh({ geometry, shader });
    this.view.addChild(this.mesh, this.lightLayer, this.trioLayer);

    // A light: the game's pellet (a square 4/22 of a ball) in its soft glow (7/22 across), drawn once and shared.
    const lc = document.createElement('canvas');
    lc.width = lc.height = 64;
    const lg = lc.getContext('2d')!;
    lg.fillStyle = 'rgba(255,210,63,0.2)'; lg.beginPath(); lg.arc(32, 32, 32, 0, Math.PI * 2); lg.fill();
    const side = (32 * 4) / 7;
    lg.fillStyle = css(POP_YELLOW); lg.fillRect(32 - side / 2, 32 - side / 2, side, side);
    this.lightTexture = Texture.from(lc);
    const places: Array<readonly [number, number]> = [];
    for (let i = 0; i < LIGHTS.length; i += 2) places.push(unrobinson(LIGHTS[i]! * MAP_STEP, LIGHTS[i + 1]! * MAP_STEP));
    places.push(...PACIFIC_LIGHTS);
    for (const [lat, lon] of places) {
      const s = new Sprite(this.lightTexture);
      s.anchor.set(0.5);
      this.lightLayer.addChild(s);
      this.lights.push({ lon, lat, s, eatenAt: -1, v: unit(lon, lat, { x: 0, y: 0, z: 0 }) });
    }
    for (const { pac, lat, lon } of opts.pacs ?? []) {
      this.trioLayer.addChild(pac.view);
      this.pacs.push({ pac, lat, lon, target: -1 });
    }
    let selected = field;
    this.unsubscribe = opts.fields?.subscribe(() => {
      const next = opts.fields?.current;
      if (!next || next === selected) return;
      const source = new BufferImageSource({ resource: next.pixels, width: next.width, height: next.width / 2, ...style });
      const previous = this.source;
      shader.resources.uMap = source;
      (this.uniforms.uniforms as { uMapSize: number }).uMapSize = next.width;
      this.source = source;selected = next;
      Object.assign(this.bakeInfo, next.info, { readyAt: performance.now(), pending: false });
      previous.destroy();
    });
  }

  /**
   * Centre and radius in the parent's pixels, and the renderer's resolution (for the rim's one-pixel edge). With the window's size
   * (`view`) it knows what part of the globe is on screen, and the pacs keep to the middle of that rather than of the disc.
   */
  place(cx: number, cy: number, r: number, resolution: number, view?: { w: number; h: number }): void {
    if (view) {
      const x0 = Math.max(0, cx - r), x1 = Math.min(view.w, cx + r), y0 = Math.max(0, cy - r), y1 = Math.min(view.h, cy + r);
      this.focus = { x: ((x0 + x1) / 2 - cx) / r, y: ((y0 + y1) / 2 - cy) / r, sx: Math.max(0.2, (x1 - x0) / 2 / r), sy: Math.max(0.2, (y1 - y0) / 2 / r) };
    } else this.focus = WHOLE;
    this.r = r;
    this.mesh.position.set(cx, cy);
    this.mesh.scale.set(r);
    this.lightLayer.position.set(cx, cy);
    this.trioLayer.position.set(cx, cy);
    this.trioLayer.scale.set((this.pacSize * r) / 22);
    (this.uniforms.uniforms as { uPx: number }).uPx = 1 / (r * resolution);
  }

  /** The longitude facing us, in degrees. */
  get facingLon(): number { return this.lon0; }
  get tiltDeg(): number { return this.tilt; }
  get radius(): number { return this.r; }
  get centreX(): number { return this.mesh.x; }
  get centreY(): number { return this.mesh.y; }

  /** A point in the title layer's pixels back to the visible sphere. Outside the disc leaves out untouched. */
  unproject(x: number, y: number, out: GlobeLocation): boolean {
    return unprojectGlobe((x - this.mesh.x) / this.r, (y - this.mesh.y) / this.r, this.lon0, this.tilt, out);
  }

  /** Screen x, y in globe radii (y down) and how far the point faces us (above 0 is our side). */
  project(lon: number, lat: number): [number, number, number] {
    const p = projectGlobe(lon, lat, this.lon0, this.tilt, this.projected);
    return [p.x, p.y, p.z];
  }

  /** Steps the turn, lights and trio. A supplied swell follows the song; null holds the glow steady in silence.
   * Omitted retains the original breathing for standalone globes. Reduce motion stills the turn and the glow; the trio walk
   * either way (the owner, 2026-10-26: "If they cannot watch the pacs move, how can they play any of the game"). */
  update(dt: number, time: number, still = false, swell?: number | null): void {
    this.t += dt;
    if (!still) this.lon0 += TURN_DEG_S * dt;
    const u = this.uniforms.uniforms as { uLon: number; uBreathe: number };
    u.uLon = (this.lon0 * Math.PI) / 180;
    u.uBreathe = still || swell === null ? 0.6 : swell === undefined ? 0.5 + 0.5 * Math.sin((this.t * 2 * Math.PI) / 1.1) : 0.1 + 1.8 * swell;
    const r = this.r, ball = (this.pacSize * r) / 22;
    const throb = still || swell === null ? 1 : swell === undefined ? 1 + 0.06 * Math.sin(this.t * 5) : 0.94 + 0.22 * swell;
    // The place at the middle of the screen's part of the globe (the nearest on the disc if that part's middle is off it).
    {
      const f = this.focus, d = Math.hypot(f.x, f.y), k = d > 0.95 ? 0.95 / d : 1;
      if (unprojectGlobe(f.x * k, f.y * k, this.lon0, this.tilt, this.where)) { this.middle.lon = this.where.lon; this.middle.lat = this.where.lat; }
    }
    this.chaseCount = 0;
    this.chaseById.length = 0;
    this.lights.forEach((light, k) => {
      const [x, y, z] = this.project(light.lon, light.lat);
      // An eaten light comes back while its place is turned out of sight, so it is never seen to pop in; all of them come back once the last is eaten, as on the first globe.
      if (light.eatenAt >= 0 && (z < -0.05 || this.lights.every((l) => l.eatenAt >= 0) || (still && this.t - light.eatenAt > STILL_BACK_S))) light.eatenAt = -1;
      const shown = light.eatenAt < 0 && z > 0.05;
      light.s.visible = shown;
      if (!shown) return;
      this.chase(k, light.lon, light.lat, x, y, z);
      light.s.position.set(x * r, y * r);
      light.s.scale.set(((7 * ball) / 32) * throb);
      light.s.alpha = Math.min(1, z * 3);
    });
    // The player's dots, which a pac goes for as it does a light: where each shows, from its stored place on the sphere.
    const pool = this.dotPool;
    if (pool) {
      const fl = (this.lon0 * Math.PI) / 180, kt = (this.tilt * Math.PI) / 180;
      const cl = Math.cos(fl), sl = Math.sin(fl), ct = Math.cos(kt), st = Math.sin(kt);
      for (let i = 0; i < pool.count; i++) {
        const d = pool.dots[i]!;
        if (!d.alive) continue;
        const xv = d.x * cl - d.z * sl, zv = d.x * sl + d.z * cl;
        const z = d.y * st + zv * ct;
        if (z > 0.05) this.chase(this.lights.length + i, d.lon, d.lat, xv, -(d.y * ct - zv * st), z);
      }
    }
    const pacCount = this.pacs.length;
    this.pacs.forEach((p, index) => {
      const a = p.pac;
      a.moving = false;
      // A pac keeps what it is after unless something dearer to leave alone is better by a margin: a fresh dot near it draws it.
      p.target = pick(p.lon, p.lat, this.chases, this.chaseCount, p.target, (id) => this.pacs.some((o) => o !== p && o.target === id), this.focus);
      const goal = p.target >= 0 ? this.chaseById[p.target] : undefined;
      // Nothing worth chasing: rest at its own place round the middle of the view, which the turn carries along.
      const to = goal ?? anchor(index, pacCount, this.middle);
      const dl = lonDelta(p.lon, to.lon), df = to.lat - p.lat;
      const l = Math.hypot(dl * Math.cos((p.lat * Math.PI) / 180), df), step = WALK * dt;
      const [x0, y0] = this.project(p.lon, p.lat);
      if (l <= step) { p.lon = to.lon; p.lat = to.lat; } else { p.lon += (dl / l) * step; p.lat += (df / l) * step; }
      // And a gentle drift back toward the middle of the disc once a pac is well out from it, so none runs off to the far side.
      const away = awayFrom(this.focus, x0, y0);
      if (away > DRIFT_FROM) {
        const k = Math.min(1, (away - DRIFT_FROM) / (1 - DRIFT_FROM)) * DRIFT * dt;
        const cl = lonDelta(p.lon, this.middle.lon), cf = this.middle.lat - p.lat, cn = Math.hypot(cl, cf) || 1;
        p.lon += (cl / cn) * k; p.lat += (cf / cn) * k;
      }
      p.lon = lonDelta(0, p.lon);
      p.lat = Math.max(-PAC_LAT_LIMIT, Math.min(PAC_LAT_LIMIT, p.lat));
      const [x1, y1] = this.project(p.lon, p.lat);
      if (l > 1e-4) { a.moving = true; a.facing = walkFacing(x1 - x0, y1 - y0, a.facing); }
      // Whatever it is on, light or dot, it eats.
      for (let c = 0; c < this.chaseCount; c++) {
        const e = this.chases[c]!;
        if (e.z <= FACING || arcDegrees(e.lon, e.lat, p.lon, p.lat) >= EAT) continue;
        if (e.id < this.lights.length) this.lights[e.id]!.eatenAt = this.t;
        else { const i = e.id - this.lights.length; pool?.eat(i); this.onEat?.(i); }
      }
      const [x, y, z] = this.project(p.lon, p.lat);
      a.x = (x * r) / ball;
      a.y = (y * r) / ball + a.size;
      a.view.visible = z > 0.05;
      a.view.alpha = Math.min(1, z * 3);
      a.update(dt * this.chomp);
      a.render(time);
    });
  }

  /** Notes one thing a pac might chase this step. */
  private chase(id: number, lon: number, lat: number, x: number, y: number, z: number): void {
    const c = (this.chases[this.chaseCount] ??= { id: 0, lon: 0, lat: 0, x: 0, y: 0, z: 0 });
    c.id = id; c.lon = lon; c.lat = lat; c.x = x; c.y = y; c.z = z;
    this.chaseCount++;
    this.chaseById[id] = c;
  }

  /**
   * Whether a place on the globe is within `minArc` radians of a light that is out or a dot of the player's: the title keeps them
   * that far apart, so a tap made again in one spot, or a drag over a light, does not pile up.
   */
  crowded(lon: number, lat: number, minArc: number): boolean {
    const near = (function* (globe: TitleGlobe) {
      for (const l of globe.lights) if (l.eatenAt < 0) yield l.v;
      const pool = globe.dotPool;
      if (pool) for (let i = 0; i < pool.count; i++) if (pool.dots[i]!.alive) yield pool.dots[i]!;
    })(this);
    return crowded(lon, lat, minArc, near);
  }

  destroy(): void {
    this.unsubscribe?.();
    // Mesh.destroy drops these references; the globe owns them, but GlProgram.from caches its program.
    const { geometry, shader } = this.mesh;
    this.view.destroy({ children: true });
    geometry.destroy(true);
    shader?.destroy(false);
    this.source.destroy();
    this.lightTexture.destroy(true);
  }
}
