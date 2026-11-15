import { touchScreen } from '../game/settings.ts';

/**
 * How many pixels the game draws for each CSS pixel: the screen's own, up to 3, or up to 2 with Battery saver on (the
 * owner, 14 Nov: a phone-only setting in More Settings). At 3x a phone fills 2.25 times the pixels it does at 2x.
 * Everything that sizes its own drawing by the screen's density reads it here, so all of it follows the setting together.
 */
let saver: () => boolean = () => false;

export const density = {
  /** Battery saver's setting as it is now; false until bound, as in unit tests. */
  bind(fn: () => boolean): void {
    saver = fn;
  },
};

/** Battery saver's cap. */
export const SAVER_DENSITY = 2;

export function drawDensity(): number {
  return Math.min(globalThis.devicePixelRatio || 1, saver() ? SAVER_DENSITY : 3);
}

/** Whether Battery saver would draw fewer pixels here, so More Settings offers it: a touch screen denser than 2x. */
export function saverOffered(): boolean {
  return touchScreen() && (globalThis.devicePixelRatio || 1) > SAVER_DENSITY;
}
