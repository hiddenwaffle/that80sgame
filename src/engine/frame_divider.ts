import type { Ticker } from 'pixi.js';

/**
 * Draws one screen frame in `every`, `every` the most that still draws 60 or more a second (battery card battery_draw_cap,
 * 2026-11-14). The game's logic moves in fixed 1/60 s steps (FixedLoop), so on a 120 Hz screen every other frame drew the same
 * picture again; drawing one frame in two drops those and nothing else. A 144 Hz screen draws 72 a second, 90 and 60 Hz screens
 * every frame, and the frames drawn are evenly spaced. A frame is skipped only while less than `every` frames' time has passed
 * since the last one drawn, so a screen whose frames come unevenly is never held back: headless Chromium with its frame limit off
 * bunched its frames once some drew nothing, and counting frames alone let the game's clock fall to half speed. Pixi's own
 * `ticker.maxFPS` was not used: it rounds each frame's time down to whole milliseconds and skips frames that come early, which on
 * a 90 Hz screen draws 45 a second.
 */
export class FrameDivider {
  /** Draw one screen frame in this many. */
  every = 1;
  /** Screen frames seen and frames drawn so far, for the frame readout. */
  screenFrames = 0;
  drawnFrames = 0;
  /** Recent gaps between screen frames in ms, newest last, and the middle one of them. */
  private readonly gaps: number[] = [];
  private gap = 1000 / 60;
  private last = -1;
  private drawnAt = -Infinity;

  /** Whether the screen frame at `now` (ms, the animation frame's time) is drawn. */
  frame(now: number): boolean {
    if (this.last >= 0) {
      const gap = now - this.last;
      // A tab in the background or a stall says nothing of the screen's rate.
      if (gap > 0 && gap < 100) {
        this.gaps.push(gap);
        if (this.gaps.length > 60) this.gaps.shift();
      }
    }
    this.last = now;
    // The middle gap of the last 60, so a few late frames do not change it; a hair of allowance for a screen at 119.9 Hz.
    if (this.gaps.length >= 10) {
      this.gap = median(this.gaps);
      this.every = Math.max(1, Math.floor(1000 / this.gap / 60 + 0.01));
    }
    this.screenFrames++;
    if (this.every > 1 && now - this.drawnAt < (this.every - 0.5) * this.gap) return false;
    this.drawnAt = now;
    this.drawnFrames++;
    return true;
  }
}

/**
 * Runs `ticker` only on the screen frames `frames` draws. Pixi calls a running ticker's `update` once per animation frame
 * (docs/pixi_dependencies.md, section 6); a skipped call skips every listener, the game's step and Pixi's render alike, and the
 * next call's time spans the frames skipped. `ticker.stop()` still stops it all.
 */
export function divideTicker(ticker: Ticker, frames: FrameDivider): void {
  const update = ticker.update.bind(ticker);
  ticker.update = (now = performance.now()) => { if (frames.frame(now)) update(now); };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
