import { BufferImageSource, buildContextBatches, GpuGraphicsContext, GraphicsContext, Mesh, MeshGeometry, Texture } from 'pixi.js';

/**
 * A run of separate round-capped line strokes, each its own colour, drawn as ONE Mesh instead of a Graphics. THIS LEANS ON PIXI
 * BEYOND ITS ORDINARY DRAWING API: read docs/pixi_dependencies.md before changing this file or upgrading pixi.js.
 *
 * Why. The target frames' travelling bands are some 430 strokes whose colours move with the animation. A Graphics bakes each stroke's
 * colour into its geometry, so a colour change means Pixi tessellates ~48,000 vertices again and uploads them again, every step. A
 * Mesh is Pixi's tool for a fixed shape whose colour changes: the geometry here is made once per size, and each stroke's colour is one
 * texel of a (strokes x 1) texture that is rewritten every step (a few kilobytes).
 *
 * How. The geometry is Pixi's own: a GraphicsContext gets exactly the moveTo / lineTo / stroke calls the Graphics path makes
 * (`strokeCalls`, shared with that path, in white), and Pixi's exported tessellator `buildContextBatches` turns it into triangles
 * as it does for any Graphics. The triangles are copied out, and every vertex of stroke k gets the uv of texel k. What is relied on
 * (each is a test in tests/stroke_mesh.test.ts, named for the assumption):
 *  - `buildContextBatches(context, gpuContext)` and `GpuGraphicsContext` are exported by pixi.js and fill `gpuContext.geometryData`
 *    ({ vertices: flat x,y numbers, indices }) and `gpuContext.batches`, one batch per stroke in draw order.
 *  - A batch's `attributeOffset` and `attributeSize` are its vertex range (in vertices, not numbers), and `indexOffset` and
 *    `indexSize` its range in `indices`; the ranges tile the arrays in order, and the indices are absolute vertex numbers.
 *  - MeshGeometry takes { positions, uvs, indices }; with `batchMode = 'no-batch'` a mesh is drawn as it is whatever its size.
 *  - A BufferImageSource of Uint8Array bytes, format 'rgba8unorm', nearest sampling, no mipmaps, shows texel k's bytes unchanged at
 *    uv ((k + 0.5) / count, 0.5), and `source.update()` uploads new bytes.
 * If a check here fails at run time (a Pixi that tessellates differently), `StrokeMesh.build` returns null after one console warning
 * and the caller keeps drawing the Graphics band: slower, never broken. The Graphics drawing is also the reference the tests and the
 * pixel check (tools/band_mesh_diff.ts) compare the mesh against.
 */
export const PIXI_VERIFIED_VERSION = '8.20.1';
export const PIXI_DEPENDENCIES_DOC = 'docs/pixi_dependencies.md';

export type Point = [number, number];
/** One straight stroke of a band, and how far round the band it sits (0 to 1), which sets its colour. */
export interface BandStroke { from: Point; to: Point; at: number }
/** What a Graphics and a GraphicsContext share for this: the three calls the band is made of. */
export interface StrokeSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style: { width: number; color: number; cap: 'round' }): unknown;
}

/**
 * The band's drawing calls, one moveTo, lineTo and stroke per stroke, in order. The Graphics path calls it with the real colours and
 * the mesh's geometry is made from the very same calls in white, so the two cannot drift apart.
 */
export function strokeCalls(sink: StrokeSink, strokes: readonly BandStroke[], width: number, colorOf: (stroke: BandStroke, k: number) => number): void {
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k]!;
    sink.moveTo(s.from[0], s.from[1]);
    sink.lineTo(s.to[0], s.to[1]);
    sink.stroke({ width, color: colorOf(s, k), cap: 'round' });
  }
}

/** The tessellator, as a parameter so a test can hand in a broken one and watch the fallback. */
export type Tessellate = (context: GraphicsContext, gpuContext: GpuGraphicsContext) => void;

let warned = false;
function fail(why: string): null {
  if (!warned) {
    warned = true;
    console.warn(`Stroke mesh unavailable (${why}); drawing the target bands as Graphics instead. This is the Pixi dependency described in ${PIXI_DEPENDENCIES_DOC}.`);
  }
  return null;
}
/** For tests: the warning is once per page, so a test that wants to see it again asks for it. */
export function resetStrokeMeshWarning(): void { warned = false; }

/**
 * Colour textures of destroyed bands, by strokes count, kept for the next band of that size. They are never destroyed while the game
 * runs, because Pixi's shared mesh shader (GlMeshAdaptor) keeps the texture source of the last default Mesh it drew bound, and destroying
 * a bound source makes Pixi's BindGroup print "a 'textureSource' was destroyed while still bound to a shader" (and Pixi stops printing
 * anything after 500 warnings, so those would hide real ones). The pool holds at most the most bands of a size ever alive together,
 * each count x 4 bytes. docs/pixi_dependencies.md, section 1.
 */
const colourTextures = new Map<number, { texture: Texture; source: BufferImageSource; bytes: Uint8Array }[]>();
/** For tests: destroys the kept textures (the one place a test may; nothing is drawing). */
export function dropKeptColourTextures(): number {
  let n = 0;
  for (const list of colourTextures.values()) for (const kept of list) { kept.texture.destroy(true); n++; }
  colourTextures.clear();
  return n;
}
/** For tests: how many kept textures there are for a strokes count. */
export function keptColourTextures(count: number): number { return colourTextures.get(count)?.length ?? 0; }

export class StrokeMesh {
  readonly mesh: Mesh;
  /** How many strokes (and texels). */
  readonly count: number;
  private readonly bytes: Uint8Array;
  private readonly source: BufferImageSource;

  private constructor(mesh: Mesh, count: number, bytes: Uint8Array, source: BufferImageSource) {
    this.mesh = mesh; this.count = count; this.bytes = bytes; this.source = source;
  }

  /** The geometry for these strokes at this width, or null (after one warning) if Pixi's output is not what this relies on. */
  static build(strokes: readonly BandStroke[], width: number, tessellate: Tessellate = buildContextBatches): StrokeMesh | null {
    const count = strokes.length;
    if (count === 0) return fail('no strokes');
    const context = new GraphicsContext();
    const gpu = new GpuGraphicsContext();
    let positions: Float32Array, indices: Uint32Array, uvs: Float32Array;
    try {
      strokeCalls(context, strokes, width, () => 0xffffff);
      tessellate(context, gpu);
      const { vertices, indices: index } = gpu.geometryData, batches = gpu.batches;
      if (batches.length !== count) return fail(`${batches.length} batches for ${count} strokes`);
      const vertexCount = vertices.length / 2;
      if (!Number.isInteger(vertexCount) || vertexCount === 0 || index.length === 0 || index.length % 3 !== 0) return fail('vertex or index counts');
      uvs = new Float32Array(vertexCount * 2);
      let vertex = 0, triangle = 0;
      for (let k = 0; k < count; k++) {
        const b = batches[k]!;
        if (b.attributeOffset !== vertex || !(b.attributeSize > 0) || b.indexOffset !== triangle || !(b.indexSize > 0)) return fail(`batch ${k} ranges`);
        for (let i = b.attributeOffset; i < b.attributeOffset + b.attributeSize; i++) { uvs[i * 2] = (k + 0.5) / count; uvs[i * 2 + 1] = 0.5; }
        for (let i = b.indexOffset; i < b.indexOffset + b.indexSize; i++) {
          const v = index[i]!;
          if (!(v >= b.attributeOffset && v < b.attributeOffset + b.attributeSize)) return fail(`batch ${k} index ${v} outside its vertices`);
        }
        vertex += b.attributeSize; triangle += b.indexSize;
      }
      if (vertex !== vertexCount || triangle !== index.length) return fail('batches do not cover the geometry');
      positions = Float32Array.from(vertices);
      indices = Uint32Array.from(index);
    } catch (error) {
      return fail(String(error));
    } finally {
      gpu.destroy();
      context.destroy();
    }
    const geometry = new MeshGeometry({ positions, uvs, indices });
    geometry.batchMode = 'no-batch';
    const spare = colourTextures.get(count)?.pop();
    const bytes = spare ? spare.bytes.fill(255) : new Uint8Array(count * 4).fill(255);
    const source = spare ? spare.source : new BufferImageSource({ resource: bytes, width: count, height: 1, format: 'rgba8unorm', scaleMode: 'nearest', autoGenerateMipmaps: false, alphaMode: 'no-premultiply-alpha' });
    const texture = spare ? spare.texture : new Texture({ source });
    if (spare) source.update();
    const mesh = new Mesh({ geometry, texture });
    // The mesh owns its geometry (buffers too: Geometry.destroy leaves them unless asked), which goes with it; Mesh.destroy does not do
    // that by itself. Its colour texture is NOT destroyed but kept for the next band of the same size (see colourTextures).
    mesh.once('destroyed', () => {
      geometry.destroy(true);
      const kept = colourTextures.get(count);
      if (kept) kept.push({ texture, source, bytes }); else colourTextures.set(count, [{ texture, source, bytes }]);
    });
    return new StrokeMesh(mesh, count, bytes, source);
  }

  /** Writes every stroke's colour (opaque) and has Pixi upload the few bytes. */
  setColors(colorOf: (k: number) => number): void {
    const b = this.bytes;
    for (let k = 0; k < this.count; k++) {
      const c = colorOf(k);
      b[k * 4] = (c >> 16) & 255; b[k * 4 + 1] = (c >> 8) & 255; b[k * 4 + 2] = c & 255; b[k * 4 + 3] = 255;
    }
    this.source.update();
  }

  /** The colour bytes as written (for tests). */
  colorBytes(): Uint8Array { return this.bytes; }
}
