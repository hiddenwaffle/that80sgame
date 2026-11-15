import type { Graphics } from 'pixi.js';
import type { Dir } from '../art/geom.ts';
import { motion, onBeat } from './motion.ts';
import * as C from './palette.ts';

export interface GroundMark {
  at: [number, number];
  direction: Dir | null;
  hover: boolean;
  age: number;
  frame: { growth: number; echo: number };
  drawAt: [number, number];
}

/** Both ground shapes use the same tap clock; reduced motion is full size with no echo. */
export function groundMarkFrame(age: number): { growth: number; echo: number } {
  return { growth: motion.reduced ? 1 : Math.min(1, .5 + age * 4), echo: onBeat(age) };
}

export function drawGroundMark(g: Graphics, x: number, y: number, age: number, direction: Dir | null): GroundMark['frame'] {
  const frame = groundMarkFrame(age), { growth, echo } = frame, r = 12 * growth;
  const angle = direction ? { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[direction] : 0;
  const p = (a: number, b: number): [number, number] => [x + a * Math.cos(angle) - b * Math.sin(angle), y + a * Math.sin(angle) + b * Math.cos(angle)];
  const path = (scale: number) => {
    if (!direction) { g.circle(x, y, r * scale); return; }
    g.moveTo(...p(-r * scale, 0)).lineTo(...p(r * scale, 0));
    g.moveTo(...p(r * .22 * scale, -r * .75 * scale)).lineTo(...p(r * scale, 0)).lineTo(...p(r * .22 * scale, r * .75 * scale));
  };
  path(1); g.stroke({ width: 4.4, color: C.INK, cap: 'round', join: 'round' });
  path(1); g.stroke({ width: 2.4, color: C.POP_PINK, cap: 'round', join: 'round' });
  g.circle(...p(direction ? -r * .45 : 0, 0), r * .32).fill(C.PAPER).stroke({ width: 1.6, color: C.INK });
  if (echo > .02) {
    path(1 + .7 * (1 - echo));
    g.stroke({ width: 1.6, color: C.POP_PINK, alpha: .7 * echo, cap: 'round', join: 'round' });
  }
  return frame;
}
