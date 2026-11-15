// New Game's dive from the title into the house (src/ui/titleMap.ts) and its riser (src/audio/synth/sfx.ts, 'dive')
// share this timing, so the riser's notes stay on the zoom's notches. No imports: the sound worker loads it too.

/** The dive: its length in seconds, how long it waits before rushing (a power), and a small lead so it moves at once. */
export const DIVE_S = 4, DIVE_POWER = 2.2, DIVE_LEAD = 0.06;

/** How far through the dive's zoom (0 to 1, in the zoom's logarithm) it is at a share p of its time. */
export function diveZoomShare(p: number): number {
  return DIVE_LEAD * p + (1 - DIVE_LEAD) * p ** DIVE_POWER;
}

/** The seconds at which the zoom has done k / n of its way, for k = 1 to n - 1: slow at first, very fast at the end. */
export function diveNotches(n: number): number[] {
  const out: number[] = [];
  for (let k = 1; k < n; k++) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (diveZoomShare(mid) < k / n) lo = mid; else hi = mid; }
    out.push(((lo + hi) / 2) * DIVE_S);
  }
  return out;
}
