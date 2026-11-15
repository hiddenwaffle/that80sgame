import type { Graphics } from 'pixi.js';
import { LOOKS } from './characters.ts';
import { INK } from '../render/palette.ts';

/**
 * "Photographs" for the credits: small vector scenes drawn into a w x h box,
 * printed through the halftone like a newspaper photo.
 */

type Draw = (g: Graphics, w: number, h: number, t: number) => void;

const ink = (width = 2) => ({ width, color: INK, join: 'round' as const });

function hero(g: Graphics, look: 'olli' | 'ronnie' | 'gorbie', x: number, y: number, r: number, facing: 'left' | 'right' | 'down' = 'right', mouth = 0.4) {
  const info = LOOKS[look];
  g.save().setTransform(r / info.size, 0, 0, r / info.size, x, y);
  info.draw(g, { facing, mouth, t: 0 }, info.size);
  g.restore();
}

const trio: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(0x7fbf4d);
  g.rect(0, h * 0.62, w, h * 0.38).fill(0xc79a5b);
  g.rect(0, 0, w * 0.3, h).fill(0x07070d);
  g.moveTo(w * 0.3, 0).lineTo(w * 0.3, h).stroke(ink(3));
  const r = h * 0.13;
  hero(g, 'gorbie', w * 0.42, h * 0.62 - r, r);
  hero(g, 'ronnie', w * 0.58, h * 0.62 - r, r);
  hero(g, 'olli', w * 0.74, h * 0.62 - r, r);
};

const curtain: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(0x7fbf4d);
  g.rect(w * 0.55, 0, w * 0.14, h).fill(0x4aa3df);
  g.rect(w * 0.52, h * 0.42, w * 0.2, h * 0.16).fill(0x9a6a3a).stroke(ink());
  g.rect(0, 0, w * 0.3, h).fill(0x07070d);
};

const tank: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(0x7fbf4d);
  g.save().setTransform(h / 60, 0, 0, h / 60, w * 0.6, h * 0.65);
  LOOKS.tank.draw(g, { facing: 'left', mouth: 0, t: 0 }, LOOKS.tank.size);
  g.restore();
  hero(g, 'olli', w * 0.22, h * 0.6, h * 0.1);
};

const wall: Draw = (g, w, h) => {
  g.rect(0, 0, w, h).fill(0xbdb8ad);
  g.rect(0, h * 0.4, w, h * 0.3).fill(0xa7a39a).stroke(ink());
  const colors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047];
  for (let i = 0; i < 7; i++) g.moveTo(w * 0.05 + i * w * 0.13, h * 0.6).bezierCurveTo(w * 0.1 + i * w * 0.13, h * 0.42, w * 0.13 + i * w * 0.13, h * 0.68, w * 0.16 + i * w * 0.13, h * 0.5).stroke({ width: 4, color: colors[i % 4]!, cap: 'round' });
};

export const PICTURE_DRAW: Record<string, Draw> = {
  trio,
  curtain,
  tank,
  wall,
};

/** Which picture a chapter's front page shows. */
export const CHAPTER_PICTURE: Record<string, string> = {
  // Trying the isometric scenes (src/world/iso_scenes.ts), the owner's 2026-11-10 picks: gearing up at home, ghostbusting in
  // the maze, crossing the bridge, the students at the water temple.
  arcade: 'house_gearup',
  curtain: 'bridge_crossing',
  field: 'maze_ghostbusting',
  berlin: 'temple_students',
};
