import { TACKLE_REACH, TACKLE_SECONDS, TACKLE_SPEED } from './patrol.ts';

/** Rectangles describe visible guard-foot positions in world units. */
export interface WarningBounds { x0: number; y0: number; x1: number; y1: number }
export interface WarningTiming {
  scale: number;
  hesitation: number;
  offscreen: boolean;
  currentDistance: number;
  referenceDistance: number;
  referenceSeconds: number;
}

/** Direct stationary-party approach, including the limited-duration 1.8x tackle followed by ordinary running. */
export function approachSeconds(distance: number, speed: number, contact: number, tackle: boolean): number {
  if (distance <= contact) return 0;
  if (!tackle) return (distance - contact) / speed;
  const reach = TACKLE_REACH, jumpSeconds = TACKLE_SECONDS, jumpSpeed = speed * TACKLE_SPEED;
  const running = Math.max(0, distance - reach) / speed;
  const closing = Math.max(0, Math.min(distance, reach) - contact);
  const jumped = Math.min(closing, jumpSpeed * jumpSeconds);
  return running + jumped / jumpSpeed + (closing - jumped) / speed;
}

/** Distance from the party to the far edge of the visible rectangle on the incoming guard's ray. */
export function visibleDistance(bounds: WarningBounds, x: number, y: number, dx: number, dy: number): number {
  const h = dx > 1e-9 ? (bounds.x1 - x) / dx : dx < -1e-9 ? (bounds.x0 - x) / dx : Infinity;
  const v = dy > 1e-9 ? (bounds.y1 - y) / dy : dy < -1e-9 ? (bounds.y0 - y) / dy : Infinity;
  return Math.max(0, Math.min(h, v));
}

/** Freeze this result when a new pursuit starts; do not recalculate it as the guard steers around bends. */
export function warningTiming(input: {
  current: WarningBounds; reference: WarningBounds;
  target: { x: number; y: number }; guard: { x: number; y: number };
  speed: number; contact: number; tackle: boolean;
}): WarningTiming {
  const { target, guard, speed, contact, tackle } = input;
  const distance = Math.hypot(guard.x - target.x, guard.y - target.y);
  const dx = distance ? (guard.x - target.x) / distance : 1;
  const dy = distance ? (guard.y - target.y) / distance : 0;
  const currentDistance = Math.min(distance, visibleDistance(input.current, target.x, target.y, dx, dy));
  const referenceDistance = Math.min(distance, visibleDistance(input.reference, target.x, target.y, dx, dy));
  const referenceSeconds = approachSeconds(referenceDistance, speed, contact, tackle);
  const offscreen = currentDistance < distance - .5;
  const unchanged = { scale: 1, hesitation: 0, offscreen, currentDistance, referenceDistance, referenceSeconds };
  if (referenceDistance <= currentDistance + .5 || referenceSeconds <= 0) return unchanged;
  // A tiny sliver cannot supply a useful visible approach. The edge cue remains the warning in that case.
  let lower = .05, upper = 1;
  // Allow three simulation frames for sprite edges, contact stepping, and the tackle handoff.
  const wanted = referenceSeconds + .05;
  for (let i = 0; i < 28; i++) {
    const scale = (lower + upper) / 2;
    if (approachSeconds(currentDistance, speed * scale, contact, tackle) >= wanted) lower = scale;
    else upper = scale;
  }
  // Both requested mechanisms are explicit: this pause adds to total warning; it is not an exact-total-time claim.
  const hesitation = offscreen ? Math.min(.35, Math.max(.2, (referenceDistance - currentDistance) / speed)) : 0;
  return { scale: lower, hesitation, offscreen, currentDistance, referenceDistance, referenceSeconds };
}
