import { MeshPlane, type PlaneGeometry, type Texture } from 'pixi.js';

/** Where a flag's cloth is in its picture, as shares of it: `x` where it leaves the pole, `y` its lowest point. */
export interface Cloth { x: number; y: number }

const COLS = 16;
const ROWS = 12;

/** A flag's picture as a fine mesh, so its cloth can ripple while the pole stands still (the owner, 2026-11-09: "stuck in their pose"). */
export function clothMesh(texture: Texture): MeshPlane {
  return new MeshPlane({ texture, verticesX: COLS, verticesY: ROWS });
}

/**
 * Lays the cloth out at time `t` in seconds, or at rest when null (Reduce motion): a wave runs out from the pole to the tip, growing
 * as it goes, and the tip draws in a little as the cloth bends. Left of where the cloth leaves the pole and below its lowest point,
 * the picture stays as it is, so the pole and its base never move.
 */
export function waveCloth(mesh: MeshPlane, cloth: Cloth, t: number | null): void {
  // A plane's geometry, which the mesh types only as a mesh's.
  const geometry = mesh.geometry as PlaneGeometry;
  const { width, height, verticesX, verticesY } = geometry;
  const out = geometry.positions;
  for (let i = 0; i < verticesX * verticesY; i++) {
    const [x, y] = [((i % verticesX) / (verticesX - 1)) * width, (Math.floor(i / verticesX) / (verticesY - 1)) * height];
    const along = Math.max(0, (x / width - cloth.x) / (1 - cloth.x));
    const hang = Math.max(0, Math.min(1, 1 - (y / height - cloth.y) / 0.1));
    const k = t === null ? 0 : along * hang;
    const a = along * Math.PI * 2.2 - (t ?? 0) * 5;
    out[i * 2] = x - k * width * 0.017 * (1 - Math.cos(a));
    out[i * 2 + 1] = y + k * height * 0.028 * Math.sin(a);
  }
  geometry.getBuffer('aPosition').update();
}
