import type { Graphics } from 'pixi.js';
import { INK, PAPER, POP_PINK, POP_YELLOW, RED_INK } from '../render/palette.ts';
import { benDay } from './print.ts';

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The Health and Energy fills (the owner, 2026-10-29, "5b" of the sketches, after "it's a bit drab to have the health and
 * energy bars be just black and gray"): pink for Health, yellow for Energy, red for low Health where a page marks it so,
 * each a tenth of the way to ink, with paper halftone dots fading out from the start of the fill toward its edge.
 */
export const VITAL: { hp: number; mp: number; low: number } = { hp: POP_PINK, mp: POP_YELLOW, low: RED_INK };

/**
 * The rest of the look, read as the bars are drawn: how far toward ink each fill goes, how strong its paper dots are,
 * and how far toward the cream a fight card's words go beyond the fill. bars_lab.html changes these and VITAL live. The
 * owner's values from the lab, 2026-10-29: dots 0.35 (from 0.4), words 0.8 (from 0.4), then words 0.9.
 */
export const VITAL_LOOK = { ink: 0.1, dots: 0.35, words: 0.9 };

/** `colour` the share `t` of the way to `to`. */
function toward(colour: number, to: number, t: number): number {
  const mix = (s: number) => Math.round(((to >> s) & 255) * t + ((colour >> s) & 255) * (1 - t));
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** `colour` the look's share of the way to ink (a tenth): a fill's own colour under its dots. */
export const deepened = (colour: number) => toward(colour, INK, VITAL_LOOK.ink);

/**
 * A fight card's bar words beyond the fill, outlined in ink: the bar's own pink or yellow, most of the way to the cream so
 * they are not too strong over the card (the owner, 2026-10-29). Read when the cards are built.
 */
export function vitalWords(): { hp: number; mp: number } {
  return { hp: toward(VITAL.hp, PAPER, VITAL_LOOK.words), mp: toward(VITAL.mp, PAPER, VITAL_LOOK.words) };
}

/** Seconds the dots take to drift one dot along (the owner, 2026-10-29: "can they move a little faster?" after 1.6). */
export const DRIFT_S = 1;

/** How far along one dot's pitch the drift stands at clock time `t`; none with reduced motion. */
export function driftAt(t: number, reduced: boolean): number {
  return reduced ? 0 : (t / DRIFT_S) % 1;
}

/**
 * Paints the filled share `frac` of the gauge `r` into `g` (the track and outline are the caller's). `drift` moves the dots
 * along by that share of one dot's pitch; the fade from the start to the edge stays where it is.
 */
export function vitalFill(g: Graphics, r: Rect, frac: number, colour: number, u: number, drift = 0): void {
  const w = r.w * Math.max(0, Math.min(1, frac));
  if (w <= 0) return;
  const pitch = u * 0.32;
  g.rect(r.x, r.y, w, r.h).fill(deepened(colour));
  if (w > 2) benDay(g, { x: r.x, y: r.y, w, h: r.h }, { color: PAPER, alpha: VITAL_LOOK.dots, pitch, from: [r.x + w, r.y], to: [r.x, r.y + r.h], shift: drift * pitch });
}

/**
 * The outline a gauge's number carries, in paper: it reads the same wherever the fill ends (the number used to turn light
 * over the fill and dark beyond it, a digit on the edge splitting in two; ink on the pink fill would be just under 4.5:1),
 * and the fill still runs to the gauge's true end behind the digits, so a full gauge looks full (the owner, 4 Nov: a plate
 * behind the number hid the end of a full bar). The gauge's own outline is drawn over the number, so the halo never
 * crosses it.
 */
export function numberHalo(font: number): { color: number; width: number; join: 'round' } {
  return { color: PAPER, width: Math.max(2, Math.round(font * 0.24)), join: 'round' };
}
