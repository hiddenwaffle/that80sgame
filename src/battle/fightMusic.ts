/** The music a fight plays: its encounter's, else the boss's own, else the usual fight music. The game renders it ahead.
 *  A fight that names the music already playing leaves it playing, without a break. */
export function battleMusic(enc: { boss?: boolean; music?: string } | undefined): string {
  return enc?.music ?? (enc?.boss ? 'boss' : 'battle');
}
