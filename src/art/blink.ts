/**
 * Occasional natural eye blinks across the cast (the owner, 2026-10-10). Only the figure's name and drawing clock
 * enter this schedule: no gameplay randomness, saved state, or accumulated timers, even when frames are skipped.
 */
export const BLINK_SECONDS = .12;
const DOUBLE_GAP = .25;
const SLOT = 4.375;
const JITTER = 1.625;

function mix(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return (n ^ (n >>> 15)) >>> 0;
}

/** Eyes stay open during hurt, defeat and Reduce motion, as the other idle motion holds still there. */
export function blinking(id: string, t: number, ko = false, hurt = false, reduced = false): boolean {
  if (ko || hurt || reduced || !Number.isFinite(t) || t < 0) return false;
  let seed = 0x811c9dc5;
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193);
  const slot = Math.floor(t / SLOT);
  // Starts differ by 2.75 to 6 seconds; after a double's second closure the next gap is still at least 2.5.
  for (let i = Math.max(0, slot - 2); i <= slot; i++) {
    const h = mix(seed ^ mix(i));
    const start = (i + 1) * SLOT + (h / 4294967296 - .5) * JITTER;
    const age = t - start;
    if (age >= 0 && age < BLINK_SECONDS) return true;
    if (mix(h) % 6 === 0 && age >= DOUBLE_GAP && age < DOUBLE_GAP + BLINK_SECONDS) return true;
  }
  return false;
}
