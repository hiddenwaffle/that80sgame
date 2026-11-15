import type { Content } from '../content/content.ts';
import type { GameState } from './state.ts';

/**
 * How a save is described to the player: where it is and how long it has been played. No
 * drawing here, so the title page and the save code page say it the same way, and it can be
 * tested on its own.
 */

/** Seconds of play as h:mm:ss, or m:ss under an hour. */
export function playTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The name of the place a save is in: its map's title, or the map's id if it has none. */
export function placeOf(c: Content, s: GameState): string {
  return String(c.maps.get(s.map)?.props.title ?? s.map);
}

export function saveSummary(c: Content, s: GameState): { place: string; time: string } {
  return { place: placeOf(c, s), time: playTime(s.playTime) };
}
