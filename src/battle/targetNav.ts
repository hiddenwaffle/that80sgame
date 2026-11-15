/**
 * Moving the target cursor with the arrow keys by where the figures are drawn, so right
 * goes to the figure on the right whichever way the fight is laid out. No drawing here,
 * so the rule can be tested on its own.
 */

export type Dir = 'left' | 'right' | 'up' | 'down';

/**
 * The index of the figure to move to from `current` when `dir` is pressed: the next figure that way in screen order,
 * wrapping round at the end, so pressing the same way visits every figure in turn. (It used to take the nearest figure
 * that way counting a step across as twice a step along, which never reached a figure standing a little off the line
 * between two others: the owner, 2026-10-29, could only switch between two of the party in a Beijing alley.) When the
 * figures stand in a rough line across the pressed direction (a row, with up pressed), the press moves along the line
 * instead: up and left go back, down and right go on. `slack` is about a figure's size.
 */
export function stepTarget(points: ReadonlyArray<readonly [number, number]>, current: number, dir: Dir, slack = 8): number {
  if (points.length < 2 || !points[current]) return current;
  let axis: 0 | 1 = dir === 'left' || dir === 'right' ? 0 : 1;
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const spread = (a: 0 | 1) => Math.max(...points.map((p) => p[a])) - Math.min(...points.map((p) => p[a]));
  const other = axis === 0 ? 1 : 0;
  if (spread(axis) <= Math.max(slack, spread(other) * 0.35)) axis = other;
  const across: 0 | 1 = axis === 0 ? 1 : 0;
  const order = points.map((_, i) => i).sort((a, b) => points[a]![axis] - points[b]![axis] || points[a]![across] - points[b]![across] || a - b);
  const at = order.indexOf(current);
  return order[(at + sign + order.length) % order.length]!;
}
