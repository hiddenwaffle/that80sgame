import type { Dir } from '../art/geom.ts';
import type { MapObject } from '../content/tiled.ts';

/** Local travel direction, independent of the next panel's slide. Interior doors can author it. */
export function exitDirection(exit: MapObject, [left, right]: readonly [number, number], height: number): Dir | null {
  const authored = exit.props.direction;
  if (authored === 'up' || authored === 'down' || authored === 'left' || authored === 'right') return authored;
  const candidates: Dir[] = [];
  // The thin axis resolves a strip that also happens to touch a corner. Multiple edges on that axis need authoring.
  if (exit.w <= exit.h) {
    if (Math.abs(exit.x - left) < 1) candidates.push('left');
    if (Math.abs(exit.x + exit.w - right) < 1) candidates.push('right');
  } else {
    if (Math.abs(exit.y) < 1) candidates.push('up');
    if (Math.abs(exit.y + exit.h - height) < 1) candidates.push('down');
  }
  return candidates.length === 1 ? candidates[0]! : null;
}
