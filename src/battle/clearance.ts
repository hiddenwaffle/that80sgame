export interface ScreenBox { left: number; right: number; top: number; bottom: number }
export interface Obstacle { x: number; y: number; w: number; h: number }

/** Area hidden by the screen or printed UI, using each fighter rather than the empty space between them. */
export function hiddenArea(boxes: ScreenBox[], panel: { w: number; h: number }, obstacles: Obstacle[], margin = 2): number {
  let area = 0;
  for (const b of boxes) {
    const w = b.right - b.left, h = b.bottom - b.top;
    area += w * h - Math.max(0, Math.min(b.right, panel.w - margin) - Math.max(b.left, margin))
      * Math.max(0, Math.min(b.bottom, panel.h - margin) - Math.max(b.top, margin));
    for (const r of obstacles) area += Math.max(0, Math.min(b.right, r.x + r.w + margin) - Math.max(b.left, r.x - margin))
      * Math.max(0, Math.min(b.bottom, r.y + r.h + margin) - Math.max(b.top, r.y - margin));
  }
  return area;
}

/** Exact geometric lower bound for one fighter, before terrain/separation. Rectangles partition
 * translation space, so its nearest clear point is zero or a screen/obstacle boundary on each axis. */
export function nearestClearPosition(b: ScreenBox, panel: { w: number; h: number }, obstacles: Obstacle[], ground: number, margin = 2) {
  const lowX = margin - b.left, highX = panel.w - margin - b.right;
  const lowY = margin - b.top, highY = panel.h - margin - b.bottom;
  const xs = [0, lowX, highX, ...obstacles.flatMap(r => [r.x - margin - b.right, r.x + r.w + margin - b.left])];
  const ys = [0, lowY, highY, ...obstacles.flatMap(r => [r.y - margin - b.bottom, r.y + r.h + margin - b.top])];
  let best: { x: number; y: number; distance: number } | null = null;
  for (const x of xs) for (const y of ys) {
    if (x < lowX - 1e-6 || x > highX + 1e-6 || y < lowY - 1e-6 || y > highY + 1e-6) continue;
    const distance = Math.hypot(x, y / ground);
    if (best && distance >= best.distance) continue;
    if (hiddenArea([{ left: b.left + x, right: b.right + x, top: b.top + y, bottom: b.bottom + y }], panel, obstacles, margin) < 1e-6) {
      best = { x, y, distance };
    }
  }
  return best;
}
