/** A smooth swell on the playing song's beat, with more weight on the first beat of each bar. */
export function titleBeatSwell(beat: number): number {
  const wave = (0.5 + 0.5 * Math.cos(beat * Math.PI * 2)) ** 2;
  const bar = (0.5 + 0.5 * Math.cos(beat * Math.PI / 2)) ** 12;
  return wave * (0.68 + 0.32 * bar);
}
