/** Fixed final music gains measured from the approved complete loops, before the player volume setting.
 * The bridge remains the reference at its existing level. No compression or peak processing is added.
 * The same gain applies to a track's opening and post-battle intro pieces. */
export const MUSIC_TARGET_LUFS = -26.22;
export const MUSIC_PEAK_CEILING = 0.944;
export const MUSIC_LEVEL_GAINS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "console": {
    "title": 1.1941908722072123,
    "house": 1.0433495526974172,
    "town": 1.3466799884741647,
    "maze": 1.2764733336907534,
    "border": 1,
    "field": 1.1351742133412535,
    "berlin": 1.1351742132383085,
    "battle": 1.0313220960040377,
    "kumite": 1.1104165901393983,
    "boss": 1.7545567027533047,
    "ending": 0.9129338864460017
  },
  "draft": {
    "title": 1.1941908713605116,
    "house": 1.0433495522351934,
    "town": 1.3466799896028148,
    "maze": 1.2764733342937484,
    "border": 1,
    "field": 1.1351811459062773,
    "berlin": 1.1129136512993332,
    "battle": 1.031322095772508,
    "kumite": 1.1104165896001146,
    "boss": 1.7545567024211823,
    "ending": 0.9129338866100449
  }
};

export const musicLevelGain = (style: string, name: string): number => MUSIC_LEVEL_GAINS[style]?.[name] ?? 1;
