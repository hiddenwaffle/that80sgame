import { Graphics, type Container } from 'pixi.js';
import { sceneryMaterial } from '../art/map_scenery.ts';
import type { GameMap } from '../content/tiled.ts';
import { beijingStreetBands, beijingStreetCentres, type BeijingFrame } from './beijing_streets.ts';
import { WALL_INSET } from './tall_plan.ts';

/**
 * Beijing's street plan, painted over its tiles when the map names it (its `streets` property): roads,
 * curbs and sidewalks laid where they belong rather than tile by tile. Only Beijing has one: Berlin's code-drawn plan went on 2026-11-11,
 * as no map named it. Everything is laid from the map (`city`, src/world/beijing_streets.ts), so a
 * move in Tiled moves the paint with it.
 */
export function drawStreets(parent: Container, map: GameMap, city: BeijingFrame): void {
  const g = new Graphics();
  parent.addChild(g);
  drawBeijing(g, map, city);
}

/** How wide one repeat of Beijing's paving picture is, in units, wherever it is laid: the streets, the square and the tiles beside
 * them join with slabs of one size (the tiles had half, so the slabs halved at the square's frame; the 3 Nov map review). */
const PAVING = 160;

/** The paving picture, its slabs laid from where they were on 12 Nov, so they move with the city. */
const paving = (city: BeijingFrame) => sceneryMaterial('field', 'paving', PAVING, PAVING, city.moved.c * 32, city.moved.r * 32);

/** The arrival and the four neighbourhood streets, with a clear road between warm stone pavements. */
function drawBeijing(g: Graphics, map: GameMap, city: BeijingFrame): void {
  const t = 32;
  const cityWidth = map.width;
  const pave = paving(city);
  for (const centre of beijingStreetCentres(map.objects)) {
    const shift = centre - 57.25;
    const { road, sidewalks } = beijingStreetBands(centre);
    // Traffic enters and leaves every street at the map edge, with continuous pavement beneath it.
    const left = 0;
    const width = cityWidth * t;
    g.rect(left, road[0] * t, width, (road[1] - road[0]) * t).fill(0x858b85);
    // Warm stone pavements in front of the shops on either side.
    for (const [top, bottom] of sidewalks) {
      g.rect(left, top * t, width, (bottom - top) * t).fill(pave ?? 0xc8bca1);
      if (!pave) for (let x = left; x < left + width; x += 40) g.moveTo(x, top * t).lineTo(x, bottom * t);
      if (!pave) g.stroke({ width: 0.65, color: 0xa69e8a });
    }
    for (const y of road) {
      g.moveTo(left, y * t).lineTo(left + width, y * t).stroke({ width: 2, color: 0xe4d9bd });
      g.moveTo(left, y * t + 3).lineTo(left + width, y * t + 3).stroke({ width: 1, color: 0x696f6c });
    }
    // Drains and repaired asphalt give the road a surface without laying another grid over it.
    for (const x of [2.8, 8.2, 15.6, 22.8, 28.2].map((x) => x + city.moved.c).filter((x) => x < cityWidth - 1)) {
      g.rect(x * t, (57.7 + shift) * t, 14, 5).fill(0x535e5b);
      for (let k = 2; k < 14; k += 4) g.moveTo(x * t + k, (57.7 + shift) * t).lineTo(x * t + k, (57.7 + shift) * t + 5);
      g.stroke({ width: 0.7, color: 0xa5aaa0 });
    }
    const x = city.moved.c * t;
    g.poly([180 + x, 1803 + shift * t, 224 + x, 1801 + shift * t, 238 + x, 1819 + shift * t, 194 + x, 1826 + shift * t]).fill(0x7c837d);
  }
  if (city.southStreet !== undefined) {
    // The south street is its pavement in front of the shops. Past it the buildings at the foot stand over the old road and the
    // ground past it, where whoever walks there goes in behind them (the owner, 2026-11-04), with paving under it all.
    const width = cityWidth * t;
    g.rect(0, city.southStreet - t * 2, width, t * 12).fill(pave ?? 0xc8bca1);
  }
  drawLakePromenade(g, map, city);
  drawTankSquare(g, city);
}

/** A modest civic forecourt: broad pale slabs, a darker frame and a quiet central inset. */
function drawTankSquare(g: Graphics, city: BeijingFrame): void {
  const pave = paving(city);
  const { x, y, w, h } = city.square;
  g.rect(x, y, w, h).fill(0x979b94);
  g.rect(x + 8, y + 8, w - 16, h - 16).fill(pave ?? 0xd2cbbb);
  if (!pave) for (let row = 0; row < 6; row++) {
    const sy = y + 8 + row * (h - 16) / 6;
    for (let col = 0; col < 9; col++) {
      const sx = x + 8 + col * (w - 16) / 9;
      g.rect(sx + 1, sy + 1, (w - 16) / 9 - 2, (h - 16) / 6 - 2).fill(pave ?? ((row + col) % 2 ? 0xd5cebf : 0xcfc9bb));
    }
  }
  // Rectangular stone inlay, four slabs by three in the middle of the square, with no emblem or lettering.
  const [ix, iy] = [x + (w - 4 * 32) / 2, y + (h - 3 * 32) / 2];
  g.rect(ix, iy, 4 * 32, 3 * 32).fill(0xb8b8aa).stroke({ width: 3, color: 0xe4ddcb });
  for (const k of [1, 2, 3]) g.moveTo(ix + k * 32, iy).lineTo(ix + k * 32, iy + 3 * 32);
  for (const k of [1, 2]) g.moveTo(ix, iy + k * 32).lineTo(ix + 4 * 32, iy + k * 32);
  g.stroke({ width: .65, color: 0xa3a797 });
}

/** The western bank curves below the temple island; keep the painted street out of its water channel. */
function drawLakePromenade(g: Graphics, map: GameMap, city: BeijingFrame): void {
  const pave = paving(city);
  const t = 32;
  // Where it was laid on 12 Nov, moved as far as the city has; it runs on to the map's edges either side.
  const X = (v: number) => (v + city.moved.c) * t, Y = (v: number) => (v + city.moved.r) * t, east = map.width * t;
  // A narrow pavement on the west widens back into the original eastern promenade, which goes on east as a street between the
  // lakeside shops and the blocks south of it (the owner, 2026-11-04: "a break in the buildings, since it's a street").
  g.moveTo(0, Y(10.35)).lineTo(X(5), Y(10.35))
    .bezierCurveTo(X(6.5), Y(10.35), X(7.25), Y(8.4), X(10), Y(8.4))
    .lineTo(X(20), Y(8.4)).lineTo(X(20), Y(10)).lineTo(east, Y(10)).lineTo(east, Y(13)).lineTo(X(20), Y(13))
    .lineTo(X(20), Y(12.9)).lineTo(0, Y(12.9)).closePath().fill(pave ?? 0xc8bca1);
  // Where the street goes in between the buildings its road narrows and bends a little south.
  const northCurb = (dy = 0) => g.moveTo(0, Y(10.65) + dy).lineTo(X(5), Y(10.65) + dy)
    .bezierCurveTo(X(6.5), Y(10.65) + dy, X(7.25), Y(8.9) + dy, X(10), Y(8.9) + dy)
    .lineTo(X(17.5), Y(8.9) + dy).bezierCurveTo(X(18.75), Y(8.9) + dy, X(18.75), Y(10.2) + dy, X(20), Y(10.2) + dy)
    .lineTo(east, Y(10.2) + dy);
  const southCurb = (dy = 0) => g.moveTo(0, Y(11.75) + dy).lineTo(X(5), Y(11.75) + dy)
    .bezierCurveTo(X(6.5), Y(11.75) + dy, X(7.25), Y(11) + dy, X(10), Y(11) + dy)
    .lineTo(X(17.5), Y(11) + dy).bezierCurveTo(X(18.75), Y(11) + dy, X(18.75), Y(11.4) + dy, X(20), Y(11.4) + dy)
    .lineTo(east, Y(11.4) + dy);
  northCurb().lineTo(east, Y(11.4)).lineTo(X(20), Y(11.4))
    .bezierCurveTo(X(18.75), Y(11.4), X(18.75), Y(11), X(17.5), Y(11)).lineTo(X(10), Y(11))
    .bezierCurveTo(X(7.25), Y(11), X(6.5), Y(11.75), X(5), Y(11.75))
    .lineTo(0, Y(11.75)).closePath().fill(0x9caa9f);
  if (!pave) {
    // Sparse paving joints stay on the broad southern sidewalk and the straight eastern bank.
    for (let x = 0; x < X(20); x += 40) g.moveTo(x, Y(11.9)).lineTo(x, Y(12.9));
    for (let x = X(10); x < X(20); x += 40) g.moveTo(x, Y(8.4)).lineTo(x, Y(8.9));
    g.stroke({ width: 0.65, color: 0xa69e8a });
  }
  for (const curb of [northCurb, southCurb]) {
    curb().stroke({ width: 2, color: 0xe4d9bd });
    curb(3).stroke({ width: 1, color: 0x696f6c });
  }
  for (const [x, y] of [[2.8, 11.45], [10.2, 10.7], [15.6, 10.7]]) {
    g.rect(X(x!), Y(y!), 14, 5).fill(0x535e5b);
    for (let k = 2; k < 14; k += 4) g.moveTo(X(x!) + k, Y(y!)).lineTo(X(x!) + k, Y(y!) + 5);
    g.stroke({ width: 0.7, color: 0xa5aaa0 });
  }
}

/**
 * Beijing's street plan drawn tile by tile, in place of a tile's ordinary drawing; true when it drew the tile. Beijing's (the
 * owner, 2026-10-06: "make it look like Beijing in that Beijing has distinct architecture and colors and ornamentation
 * and signs"): its house blocks a sea of grey tiled roofs seen from above, each row of houses under its own ridge, the
 * lanes grey packed earth, the paving grey brick, the bridges stone. `fill` fills the tile as its terrain would be
 * (rounded where the look rounds it), `rnd` gives the tile's own random numbers, `at` the terrain beside it.
 */
export function streetTile(city: BeijingFrame, g: Graphics, id: string, x: number, y: number, fill: (color: number) => void, rnd: (k: number) => number, at: (dx: number, dy: number) => string): boolean {
  const X = x * 32;
  const Y = y * 32;
  switch (id) {
    case 'roofs': {
      // A tall building stands on this cell (src/world/tall_city.ts): what shows of it is the dark between buildings, and the
      // strip of lane its wall stands back from, so a figure at the cell's edge doesn't cut into the wall.
      // The few along a street lie under its shops, with no building on them.
      if (city.edges.has(y)) { g.rect(X, Y, 32, 32).fill(paving(city) ?? 0xc8bca1); return true; }
      g.rect(X, Y, 32, 32).fill(0x2f3236);
      const open = (id: string) => id === 'path' || id === 'pavement';
      for (const side of [-1, 1]) if (open(at(side, 0))) g.rect(side < 0 ? X : X + 32 - WALL_INSET, Y, WALL_INSET, 32).fill(at(side, 0) === 'path' ? 0xb7ad99 : 0xc8bca1);
      return true;
    }
    case 'pavement': {
      const pave = paving(city);
      if (pave) { g.rect(X, Y, 32, 32).fill(pave); return true; }
      // Grey brick in a running bond.
      g.rect(X, Y, 32, 32).fill(0xaaa69d);
      for (let k = 1; k < 4; k++) g.moveTo(X, Y + k * 8).lineTo(X + 32, Y + k * 8);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) g.moveTo(X + j * 16 + (k % 2) * 8, Y + k * 8).lineTo(X + j * 16 + (k % 2) * 8, Y + k * 8 + 8);
      g.stroke({ width: 0.7, color: 0x8d8a82 });
      return true;
    }
    case 'path':
      // A lane of grey packed earth.
      fill(0xb7ad99);
      for (let k = 0; k < 3; k++) g.circle(X + 5 + rnd(k) * 22, Y + 5 + rnd(k + 4) * 22, 1.1).fill(0x8d8474);
      return true;
    case 'bridge': {
      const pave = paving(city);
      if (pave) { g.rect(X, Y, 32, 32).fill(pave); return true; }
      // Stone slabs across the deck.
      g.rect(X, Y, 32, 32).fill(0xd3cfc3);
      for (let k = 1; k < 4; k++) g.moveTo(X, Y + k * 8).lineTo(X + 32, Y + k * 8);
      for (let k = 0; k < 4; k++) g.moveTo(X + (k % 2 ? 10 : 22), Y + k * 8).lineTo(X + (k % 2 ? 10 : 22), Y + k * 8 + 8);
      g.stroke({ width: 0.8, color: 0xa9a598 });
      return true;
    }
    default:
      return false;
  }
}
