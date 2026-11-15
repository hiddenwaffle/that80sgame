/** Typing text out into lines that were wrapped in advance, and how fast. */

/** The text speed the script's own pace is written against: Normal, in characters a second. */
export const SCRIPT_PACE = 60;

/**
 * The speed for a `{speed N}` in a line, in characters a second. The script's speeds are
 * written for Normal text speed, so they scale with the player's: a player on Slow stays
 * slower than the script's pace, and one on Instant (0) stays instant.
 */
export function scriptSpeed(n: number, player: number): number {
  return (n * player) / SCRIPT_PACE;
}

/**
 * For each character of `full`, where it ends in `wrapped`, the same text with
 * line breaks added by wrapping (and perhaps a space dropped at a break).
 * Null if the two do not line up.
 */
export function mapToWrapped(full: string, wrapped: string): number[] | null {
  const ends: number[] = [];
  let j = 0;
  // By UTF-16 unit, as string lengths and indexes count.
  for (let i = 0; i < full.length; i++) {
    const c = full[i]!;
    // Skip line breaks the wrapping put in.
    while (j < wrapped.length && wrapped[j] === '\n' && c !== '\n') j++;
    if (wrapped[j] === c) {
      j++;
      ends.push(j);
    } else if (c === ' ' || c === '\t') {
      // The wrapping dropped this space at a line break.
      ends.push(j);
    } else {
      return null;
    }
  }
  return ends;
}
