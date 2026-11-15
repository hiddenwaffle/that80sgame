/**
 * Beijing's music (2026-10-12, second version), written out bar by bar. The owner heard the first version and asked
 * for a busy city street rather than slow, contemplative passages; for natural instruments only, with no console sound
 * and no synthetic bass; and for the music to grow out of its tunes instead of repeating them. Four passages they
 * liked are kept and built on: A, the main motif (the old 0:25); B, Claude's first four-bar tune (0:42); C, the patrol
 * phrases (1:51); and D, the evening (2:34). Those passages as written fill about a third of the loop.
 *
 * The groove never stops: plucked bass, hand drum and shaker play in every bar, so a fight can end anywhere and the
 * music comes back on something moving. The city is heard in how the instruments are played (a bowed fiddle that slides
 * into a few notes, a pressed zither string, flute grace notes, two instruments playing one line each its own way), in
 * the E "yu" mode (E G A B D, with F# and C passing), and in the instruments' own sounds. Every ornament is listed below.
 *
 * Each bar of a line is sixteen tokens: a note ("F#4"), "-" holding the note before (across a bar line too), or "."
 * for a rest; "|" alone is a bar of rests. Percussion rows mark "x" for a full stroke and "o" for a lighter one.
 */

export const BEIJING_BPM = 120;

/** The instruments, each modelled on a real one: fiddle (erhu), low bowed string, bamboo flute (dizi), lute (pipa), hammered dulcimer (yangqin), zither (guzheng), plucked string bass. */
export type Player = 'bowed' | 'lowbow' | 'flute' | 'lute' | 'dulcimer' | 'zither' | 'bass';

/** What a line does: the tune, a second voice beside it, an inner part, a low line, or the bass. */
export type Role = 'lead' | 'second' | 'inner' | 'low' | 'bass';

export interface BeijingLine {
  role: Role;
  player: Player;
  bars: readonly string[];
}

export type Beat = 'drum' | 'hand' | 'shaker' | 'bells';

export interface BeijingSection {
  name: string;
  bars: number;
  /** The section's level in dB, 0 the loudest. */
  level: number;
  /** One chord a bar: "Em|D" splits the bar, and "B5" is an open fifth with no third. */
  chords: readonly string[];
  lines: readonly BeijingLine[];
  beats: Partial<Record<Beat, readonly string[]>>;
}

export const BEIJING_SECTIONS: readonly BeijingSection[] = [
  // Bars 1-8: A as written on the fiddle over a running lute; the lute shadows it in 5-8.
  {
    name: 'street', bars: 8, level: -1,
    chords: ['G', 'D', 'Em', 'D', 'C', 'G', 'Am', 'B5'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'B4 - - - - - D5 - E5 - - - D5 - B4 -',
        'A4 - - - - - - - - - - - G4 - A4 -',
        'A4 - - - - - G4 - E4 - - - D4 - E4 -',
        'D4 - - - - - - - E4 - - - - - - -',
        'E4 - - - - - G4 - A4 - - - B4 - D5 -',
        'E5 - - - - - - - D5 - - - B4 - - -',
        'B4 - - - - - A4 - G4 - - - - - E4 -',
        'E4 - - - - - D4 - . . . . . . . .',
      ] },
      { role: 'inner', player: 'lute', bars: [
        'B3 B3 . D4 G4 . D4 . B3 B3 . D4 G4 . A4 .',
        'A3 A3 . D4 A4 . D4 . A3 A3 . D4 A4 . E4 .',
        'B3 B3 . . G4 . B3 . B3 B3 . . G4 . B3 .',
        'A3 A3 . . F#4 . A3 . A3 A3 . . F#4 . A3 .',
        'E4 . E4 E4 . . G4 . A4 . A4 . B4 . D5 .',
        'E5 . E5 . D5 . E5 . D5 . D5 . B4 . B4 .',
        'B4 . B4 B4 . . A4 . G4 . G4 . A4 . E4 .',
        'E4 . E4 E4 . . D4 . B3 . B3 . F#4 . A3 .',
      ] },
      { role: 'low', player: 'lowbow', bars: [
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '. . . . . . . . B3 - - - - - . .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'G2 - . G2 . . D3 . G2 - . . D3 . G2 .',
        'D2 - . D2 . . A2 . D2 - . . A2 . D2 .',
        'E2 - . E2 . . B2 . E2 - . . B2 . E2 .',
        'D2 - . D2 . . A2 . D2 - . . A2 . B1 .',
        'C2 - . C2 . . G2 . C2 - . . G2 . C2 .',
        'G2 - . G2 . . D3 . G2 - . . D3 . G2 .',
        'A2 - . A2 . . E2 . A2 - . . E2 . A2 .',
        'B1 - . B1 . . F#2 . B1 - . . F#2 . A1 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . . . x . . . o . x . o .',
        'x . . . . . x . . . o . x . o .',
        'x . . . . . x . . . o . x . o .',
        'x . . . . . x . . . o . x . o .',
        'x . . o . . x . . . o . x . o .',
        'x . . o . . x . . . o . x . o .',
        'x . . o . . x . . . o . x . o .',
        'x . . o . . x . . . o . x o o o',
      ],
      hand: [
        '. . o . x . . o . . o . x . o o',
        '. . o . x . . o . . o . x . o o',
        '. . o . x . . o . . o . x . o o',
        '. . o . x . . o . . o . x . o o',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . o o . x x o o',
      ],
      shaker: [
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
      ],
      bells: [
        'x . . . . . . . . . . . . . . .',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
      ],
    },
  },
  // Bars 9-16: new phrases on A, traded two bars at a time between fiddle and flute, over a dulcimer cross-pulse.
  {
    name: 'A grows', bars: 8, level: -1,
    chords: ['Em', 'C', 'G', 'D', 'Em', 'Am', 'C|D', 'B5'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'E4 - - - - - G4 - B4 - - - A4 - B4 -',
        'E5 - - - - - D5 - E5 - - - G5 - E5 -',
        '|',
        '|',
        '. . D5 E5 G5 - - - A5 - - - G5 - E5 -',
        'E5 - - - - - D5 - C5 - - - B4 - A4 -',
        '|',
        'F#4 - - - - - E4 - D4 - - - - - E4 -',
      ] },
      { role: 'second', player: 'flute', bars: [
        '|',
        '|',
        '. . B4 D5 E5 - - - G5 - - - E5 - D5 -',
        'E5 - - - - - D5 - A4 - - - - - . .',
        '|',
        '|',
        '. . E5 G5 A5 - - - B5 - - - A5 - G5 -',
        '|',
      ] },
      { role: 'inner', player: 'dulcimer', bars: [
        'E3 . B3 E4 . B3 E3 . B3 E4 . B3 E3 . D4 .',
        'G3 . C4 G4 . C4 G3 . C4 G4 . C4 G3 . E4 .',
        'G3 . D4 G4 . D4 G3 . D4 G4 . D4 G3 . B3 .',
        'A3 . D4 A4 . D4 A3 . D4 A4 . D4 A3 . E4 .',
        'E3 . B3 E4 . B3 E3 . B3 E4 . B3 E3 . G4 .',
        'A3 . E4 A4 . E4 A3 . E4 A4 . E4 A3 . G4 .',
        'G3 . C4 G4 . C4 G3 . D4 A4 . D4 A3 . D4 .',
        'B3 . F#4 B4 . F#4 B3 . F#4 B4 . F#4 B3 . A3 .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'E2 . . E3 . E2 B2 . E2 . . E3 . E2 D2 .',
        'C2 . . C3 . C2 G2 . C2 . . C3 . C2 A1 .',
        'G1 . . G2 . G1 D2 . G1 . . G2 . G1 F#2 .',
        'D2 . . D3 . D2 A2 . D2 . . D3 . D2 B1 .',
        'E2 . . E3 . E2 B2 . E2 . . E3 . E2 G2 .',
        'A1 . . A2 . A1 E2 . A1 . . A2 . A1 G1 .',
        'C2 . . C3 . C2 G2 . D2 . . D3 . D2 A1 .',
        'B1 . . B2 . B1 F#2 . B1 . . B2 . B1 D2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . x . . o . x . . x . . o .',
        'x . . x . . o . x . . x . . o .',
        'x . . x . . o . x . . x . . o .',
        'x . . x . . o . x . . x . . o .',
        'x . . x . . x . x . . o . . o .',
        'x . . x . . x . x . . o . . o .',
        'x . . x . . x . x . . o . . o .',
        'x . . x . . x . x . o . x o x o',
      ],
      hand: [
        '. o . . x . . o . o . . x . o o',
        '. o . . x . . o . o . . x . o o',
        '. o . . x . . o . o . . x . o o',
        '. o . . x . . o . o . . x . o o',
        '. o . . x . o o . o . . x . o .',
        '. o . . x . o o . o . . x . o .',
        '. o . . x . o o . o . . x . o .',
        '. o o . x . o o . o o . x o x x',
      ],
      shaker: [
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
        'o o o o x o o o o o o o x o o o',
      ],
    },
  },
  // Bars 17-24: B as written on the lute with the flute playing the same line its own way; then B's rhythm on A's notes, the dulcimer answering in the rests.
  {
    name: 'stalls', bars: 8, level: -1,
    chords: ['Em|D', 'C|B5', 'Em|D', 'C|B5', 'G|D', 'Am|Em', 'C|D', 'B5'],
    lines: [
      { role: 'lead', player: 'lute', bars: [
        'E4 . . E4 E4 . G4 . B4 . . . A4 . G4 .',
        'F#4 . . F#4 F#4 . A4 . B4 . . . . . . .',
        'E4 . . E4 E4 . G4 . B4 . . . D5 . C5 .',
        'B4 . A4 . G4 . F#4 . E4 . . . . . . .',
        'B4 . . B4 B4 . D5 . E5 . . . D5 . B4 .',
        'A4 . . A4 A4 . C5 . E5 . . . . . . .',
        'E5 . . E5 D5 . B4 . A4 . . . B4 . D5 .',
        'E5 . D5 . B4 . A4 . B4 . . . . . . .',
      ] },
      { role: 'second', player: 'flute', bars: [
        'E5 - - E5 - - G5 - B5 - - - A5 - G5 -',
        'F#5 - - F#5 - - A5 - B5 - - - - - . .',
        'E5 - - E5 - - G5 - B5 - - - D6 - C6 -',
        'B5 - A5 - G5 - F#5 - E5 - - - - - . .',
        '|',
        '|',
        '|',
        '|',
      ] },
      { role: 'inner', player: 'dulcimer', bars: [
        '|',
        '|',
        '|',
        '|',
        '|',
        '. . . . . . . . . . G5 . E5 . B4 .',
        '|',
        '. . . . . . . . . . F#5 . E5 . B4 .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'E2 . . E2 . . B1 . D2 . . D2 . . A1 .',
        'C2 . . C2 . . G1 . B1 . . B1 . . F#2 .',
        'E2 . . E2 . . B1 . D2 . . D2 . . A1 .',
        'C2 . . C2 . . G1 . B1 . . B1 . . F#1 .',
        'G1 . . G1 . . D2 . D2 . . D2 . . A1 .',
        'A1 . . A1 . . E2 . E2 . . E2 . . B1 .',
        'C2 . . C2 . . G2 . D2 . . D2 . . A1 .',
        'B1 . . B1 . . F#2 . B1 . . B1 . . D2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . x . . . x . . . x . . .',
        'x . . . x . . . x . . . x . . .',
        'x . . . x . . . x . . . x . . .',
        'x . . . x . . . x . . . x . . .',
        'x . . x . . x . x . . . x . . .',
        'x . . x . . x . x . . . x . . .',
        'x . . x . . x . x . . . x . . .',
        'x . . x . . x . x . . o x . o o',
      ],
      hand: [
        '. . o . . o o . . . o . . o o .',
        '. . o . . o o . . . o . . o o .',
        '. . o . . o o . . . o . . o o .',
        '. . o . . o o . . . o . . o o .',
        '. . o . o . . o . . o o . o . o',
        '. . o . o . . o . . o o . o . o',
        '. . o . o . . o . . o o . o . o',
        '. . o o . o o . o o . o x o x o',
      ],
      shaker: [
        'x . o o x . o o x . o o x . o o',
        'x . o o x . o o x . o o x . o o',
        'x . o o x . o o x . o o x . o o',
        'x . o o x . o o x . o o x . o o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
      ],
      bells: [
        'x . . . . . . . . . . . . . . .',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
      ],
    },
  },
  // Bars 25-32: A turned upside down, traded between flute and fiddle, over a low bowed counter-line.
  {
    name: 'crosscurrents', bars: 8, level: -2,
    chords: ['Em', 'Am', 'C', 'D', 'C', 'G', 'Am', 'D'],
    lines: [
      { role: 'lead', player: 'flute', bars: [
        'B5 - - - - - A5 - G5 - - - A5 - B5 -',
        'A5 - - - - - - - - - - - B5 - A5 -',
        '|',
        '|',
        'D6 - - - - - B5 - A5 - - - G5 - E5 -',
        'B4 - - - - - - - D5 - - - E5 - - -',
        '|',
        '|',
      ] },
      { role: 'second', player: 'bowed', bars: [
        '|',
        '|',
        'A4 - - - - - B4 - D5 - - - E5 - D5 -',
        'E5 - - - - - - - D5 - - - - - - -',
        '|',
        '|',
        'C5 - - - - - D5 - E5 - - - - - G5 -',
        'A5 - - - - - G5 - E5 - - - D5 - . .',
      ] },
      { role: 'inner', player: 'dulcimer', bars: [
        'E4 . B4 . E4 G4 . B4 E4 . B4 . E4 G4 . D5',
        'E4 . A4 . E4 C5 . A4 E4 . A4 . E4 . . G4',
        'E4 . G4 . E4 . . G4 E4 . G4 . E4 C5 . G4',
        'D4 . A4 . D4 F#4 . A4 D4 . A4 . D4 F#4 . A4',
        'E4 . G4 . E4 . . G4 E4 . G4 . E4 C5 . A4',
        'D4 . G4 . D4 B4 . G4 D4 . G4 . D4 B4 . A4',
        'E4 . A4 . E4 C5 . A4 E4 . A4 . E4 C5 . G4',
        'D4 . A4 . D4 E4 . A4 D4 . A4 . D4 E4 . F#4',
      ] },
      { role: 'low', player: 'lowbow', bars: [
        'G3 - - - - - - - - - - - - - - -',
        'E3 - - - - - - - A2 - - - - - - -',
        'E3 - - - - - - - G3 - - - - - - -',
        'A3 - - - - - - - F#3 - - - - - - -',
        'G3 - - - - - - - E3 - - - - - - -',
        'D3 - - - - - - - G3 - - - - - - -',
        'E3 - - - - - - - A3 - - - - - - -',
        'D3 - - - - - - - A2 - - - - - . .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'E2 - . . E2 . . . E2 - . . B1 . E2 .',
        'A1 - . . A1 . . . A1 - . . E2 . A1 .',
        'C2 - . . C2 . . . C2 - . . G2 . C2 .',
        'D2 - . . D2 . . . D2 - . . A1 . D2 .',
        'C2 - . . C2 . . . C2 - . . G2 . C2 .',
        'G1 - . . G1 . . . G1 - . . D2 . G1 .',
        'A1 - . . A1 . . . A1 - . . E2 . A1 .',
        'D2 - . . D2 . . . D2 - . . A1 . D2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . . .',
        'x . . . . . . . x . . o x . o o',
      ],
      hand: [
        '. . o . . . x . . o o . . . x .',
        '. . o . . . x . . o o . . . x .',
        '. . o . . . x . . o o . . . x .',
        '. . o . . . x . . o o . . . x .',
        '. . o . . o x . . o o . . o x .',
        '. . o . . o x . . o o . . o x .',
        '. . o . . o x . . o o . . o x .',
        '. o o . . o x . . o o . x o x o',
      ],
      shaker: [
        'o . o o o . o o o . o o o . o o',
        'o . o o o . o o o . o o o . o o',
        'o . o o o . o o o . o o o . o o',
        'o . o o o . o o o . o o o . o o',
        'x . o o x . o o x . o o x . o o',
        'x . o o x . o o x . o o x . o o',
        'x . o o x . o o x . o o x . o o',
        'x . o o x . o o x . o o x . o o',
      ],
    },
  },
  // Bars 33-40: C1-C4 on the fiddle over repeated lute notes; then the flute answers in C's rhythm, its shape turned over.
  {
    name: 'patrols', bars: 8, level: -2,
    chords: ['Em', 'C', 'D', 'Em', 'Am', 'Em', 'C', 'B5'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'B4 - - - E5 - - - - - F#5 - G5 - - -',
        '. . . . E5 - G5 - A5 - - - - - G5 -',
        'A5 - - - - - . . . . F#5 - D5 - - -',
        'E5 - - - - - . . . . . . . . . .',
        '|',
        '|',
        '|',
        '|',
      ] },
      { role: 'second', player: 'flute', bars: [
        '|',
        '|',
        '|',
        '|',
        'A5 - - - E5 - - - - - D5 - E5 - - -',
        '. . . . G5 - E5 - D5 - - - - - B4 -',
        'E5 - - - - - . . . . G5 - A5 - - -',
        'B5 - - - - - . . . . . . . . . .',
      ] },
      { role: 'inner', player: 'lute', bars: [
        'E4 E4 . B3 E4 E4 . B3 E4 E4 . B3 E4 . G4 .',
        'E4 E4 . C4 E4 E4 . C4 E4 E4 . C4 E4 . G4 .',
        'D4 D4 . A3 D4 D4 . A3 D4 D4 . A3 D4 . E4 .',
        'E4 E4 . B3 E4 E4 . B3 E4 E4 . B3 E4 . G4 .',
        'A3 A3 . E4 A3 A3 . E4 A3 A3 . E4 A3 . C4 .',
        'B3 B3 . E4 B3 B3 . E4 B3 B3 . E4 B3 . G4 .',
        'C4 C4 . G4 C4 C4 . G4 C4 C4 . G4 C4 . E4 .',
        'B3 B3 . F#4 B3 B3 . F#4 B3 B3 . F#4 B3 . A3 .',
      ] },
      { role: 'low', player: 'lowbow', bars: [
        '|',
        '|',
        '|',
        '|',
        'C3 - - - - - - - E3 - - - - - - -',
        'B2 - - - - - - - G3 - - - - - - -',
        'C3 - - - - - - - G3 - - - - - - -',
        'B2 - - - - - - - F#3 - - - - - . .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'E2 . . E2 . . B1 . E2 . . E2 . . D2 .',
        'C2 . . C2 . . G1 . C2 . . C2 . . D2 .',
        'D2 . . D2 . . A1 . D2 . . D2 . . A1 .',
        'E2 . . E2 . . B1 . E2 . . E2 . . B1 .',
        'A1 . . A1 . . E2 . A1 . . A1 . . B1 .',
        'E2 . . E2 . . B1 . E2 . . E2 . . D2 .',
        'C2 . . C2 . . G2 . C2 . . C2 . . A1 .',
        'B1 . . B1 . . F#2 . B1 . . B1 . . D2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . o . . . . x . . o . . o .',
        'x . . o . . . . x . . o . . o .',
        'x . . o . . . . x . . o . . o .',
        'x . . o . . . . x . . o . . o .',
        'x . . x . . . . x . . x x . . .',
        'x . . x . . . . x . . x x . . .',
        'x . . x . . . . x . . x x . . .',
        'x . . x . . . . x . . x x . o o',
      ],
      hand: [
        '. o . o . . o . . o . o . . o .',
        '. o . o . . o . . o . o . . o .',
        '. o . o . . o . . o . o . . o .',
        '. o . o . . o . . o . o . . o .',
        '. o . . o . o . . o . . o . o o',
        '. o . . o . o . . o . . o . o o',
        '. o . . o . o . . o . . o . o o',
        '. o . . o . o . . o . o o . o o',
      ],
      shaker: [
        'o o o o o o o o o o o o o o o o',
        'o o o o o o o o o o o o o o o o',
        'o o o o o o o o o o o o o o o o',
        'o o o o o o o o o o o o o o o o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
      ],
      bells: [
        'x . . . . . . . . . . . . . . .',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
      ],
    },
  },
  // Bars 41-48: half-bar street calls between flute and fiddle over quick repeated lute notes; they meet at 44 and 48.
  {
    name: 'alley', bars: 8, level: -1,
    chords: ['C', 'D', 'Bm', 'Em', 'Am', 'D', 'G', 'D'],
    lines: [
      { role: 'lead', player: 'flute', bars: [
        'E5 - - - D5 E5 G5 - . . . . . . . .',
        'A5 - - - G5 A5 B5 - . . . . . . . .',
        'D6 - - - B5 - A5 - . . . . . . . .',
        '. . . . G5 - A5 - B5 - - - - - . .',
        'E5 - - - D5 E5 A5 - . . . . . . . .',
        'F#5 - - - E5 F#5 A5 - . . . . . . . .',
        'B5 - - - A5 - G5 - . . . . . . . .',
        '. . . . E5 - D5 - A4 - - - - - . .',
      ] },
      { role: 'second', player: 'bowed', bars: [
        '. . . . . . . . G4 - - - E4 - G4 -',
        '. . . . . . . . A4 - - - F#4 - A4 -',
        '. . . . . . . . F#4 - - - D4 - F#4 -',
        'E4 - - - G4 - A4 - B4 - - - - - . .',
        '. . . . . . . . C5 - - - B4 - A4 -',
        '. . . . . . . . D5 - - - A4 - F#4 -',
        '. . . . . . . . D5 - - - B4 - D5 -',
        'F#5 - - - E5 - D5 - - - - - - - . .',
      ] },
      { role: 'inner', player: 'lute', bars: [
        'C4 C4 E4 . G4 G4 E4 . C4 C4 E4 . G4 G4 E4 .',
        'A3 A3 D4 . F#4 F#4 D4 . A3 A3 D4 . F#4 F#4 D4 .',
        'B3 B3 D4 . F#4 F#4 D4 . B3 B3 D4 . F#4 F#4 D4 .',
        'B3 B3 E4 . G4 G4 E4 . B3 B3 E4 . G4 G4 E4 .',
        'A3 A3 C4 . E4 E4 C4 . A3 A3 C4 . E4 E4 C4 .',
        'A3 A3 D4 . F#4 F#4 D4 . A3 A3 D4 . F#4 F#4 D4 .',
        'B3 B3 D4 . G4 G4 D4 . B3 B3 D4 . G4 G4 D4 .',
        'A3 A3 D4 . F#4 F#4 D4 . A3 A3 D4 . E4 . G4 .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'C2 . . C2 . . G2 . C2 . . C2 . . E2 .',
        'D2 . . D2 . . A2 . D2 . . D2 . . A1 .',
        'B1 . . B1 . . F#2 . B1 . . B1 . . D2 .',
        'E2 . . E2 . . B2 . E2 . . E2 . . B1 .',
        'A1 . . A1 . . E2 . A1 . . A1 . . C2 .',
        'D2 . . D2 . . A2 . D2 . . D2 . . F#2 .',
        'G2 . . G2 . . D2 . G2 . . G2 . . B1 .',
        'D2 . . D2 . . A2 . D2 . . D2 . . A1 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . . . . o .',
        'x . . . . . o . x . . o x . o o',
      ],
      hand: [
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . . o . x . o .',
        '. . o . x . o . . o o . x x o o',
      ],
      shaker: [
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
      ],
    },
  },
  // Bars 49-56: D as written on the fiddle, the zither under it, the groove kept moving.
  {
    name: 'evening', bars: 8, level: -3,
    chords: ['C', 'G', 'Am', 'Em', 'C', 'D', 'Bm', 'Em'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'E5 - - - - - - - - - D5 - E5 - - -',
        'D5 - - - - - B4 - - - - - A4 - B4 -',
        'A4 - - - - - - - E4 - - - G4 - A4 -',
        'B4 - - - - - - - - - - - - - . .',
        'E5 - - - - - - - - - D5 - E5 - G5 -',
        'A5 - - - - - - - G5 - - - E5 - - -',
        'D5 - - - B4 - - - A4 - - - - - - -',
        'G4 - - - - - - - E4 - - - - - . .',
      ] },
      { role: 'inner', player: 'zither', bars: [
        'E3 . G3 . . E4 . . G3 . E4 . . G4 . E4',
        'G3 . D4 . . G4 . . D4 . G4 . . D4 . B3',
        'A3 . E4 . . A4 . . E4 . A4 . . E4 . G4',
        'E3 . G3 . . E4 . . G3 . E4 . . . . .',
        'G3 . E4 . . G4 . . E4 . G4 . . E4 . G3',
        'D4 . A4 . . D5 . . A4 . D5 . . A4 . E4',
        'B3 . F#4 . . B4 . . D4 . B4 . . D4 . B3',
        'E3 . B3 . . G4 . . B3 . G3 . . . . .',
      ] },
      { role: 'low', player: 'lowbow', bars: [
        'G3 - - - - - - - - - - - - - - -',
        'D3 - - - - - - - - - - - - - - -',
        'A2 - - - - - - - C3 - - - - - - -',
        'B2 - - - - - - - G2 - - - - - - -',
        'C3 - - - - - - - - - - - - - - -',
        'D3 - - - - - - - - - - - - - - -',
        'F#3 - - - - - - - - - - - - - - -',
        'E3 - - - - - - - G3 - - - - - - -',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'C2 - - C2 . . G2 . C2 - - G2 . . E2 .',
        'G1 - - G1 . . D2 . G1 - - D2 . . B1 .',
        'A1 - - A1 . . E2 . A1 - - E2 . . G1 .',
        'E2 - - E2 . . E2 . E2 - - E2 . . . .',
        'C2 - - C2 . . G2 . C2 - - G2 . . A1 .',
        'D2 - - D2 . . A1 . D2 - - A1 . . A1 .',
        'B1 - - B1 . . F#2 . B1 - - F#2 . . D2 .',
        'E2 - - E2 . . B1 . E2 - - B1 . . . .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . . . . . . . . . x . . .',
        'x . . . . . . . . . . . x . . .',
        'x . . . . . . . . . . . x . . .',
        'x . . . . . . . . . . . x . . .',
        'x . . . . . o . . . . . x . . .',
        'x . . . . . o . . . . . x . . .',
        'x . . . . . o . . . . . x . . .',
        'x . . . . . . . x . . . x . o .',
      ],
      hand: [
        '. . o . . o . . . . o . . o . .',
        '. . o . . o . . . . o . . o . .',
        '. . o . . o . . . . o . . o . .',
        '. . o . . o . . . . o . . o . .',
        '. . o . . o . o . . o . . o . o',
        '. . o . . o . o . . o . . o . o',
        '. . o . . o . o . . o . . o . o',
        '. . o . . o . o . o o . . o o o',
      ],
      shaker: [
        'x o o o o o o o x o o o o o o o',
        'x o o o o o o o x o o o o o o o',
        'x o o o o o o o x o o o o o o o',
        'x o o o o o o o x o o o o o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
      ],
      bells: [
        'x . . . . . . . . . . . . . . .',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
      ],
    },
  },
  // Bars 57-64: D1's figure, then a new climb capped at A5; the flute joins in 61-64.
  {
    name: 'lanterns', bars: 8, level: -1,
    chords: ['C', 'D', 'Em', 'Bm', 'C', 'D', 'G|D', 'Em|B5'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'G5 - - - - - - - - - E5 - G5 - - -',
        'A5 - - - - - G5 - - - - - E5 - D5 -',
        '. . E5 G5 A5 - - - G5 - E5 - D5 - E5 -',
        'F#5 - - - E5 - D5 - B4 - - - - - . .',
        'E5 - - - - - G5 - A5 - - - - - G5 -',
        'A5 - - - - - - - G5 - E5 - D5 - - -',
        'G5 - - - - - E5 - D5 - - - E5 - - -',
        'E5 - - - - - D5 - B4 - - - - - . .',
      ] },
      { role: 'second', player: 'flute', bars: [
        '|',
        '|',
        '|',
        '|',
        'E5 - - - D5 E5 G5 - A5 - - - G5 A5 G5 -',
        'A5 - - - B5 A5 - - G5 - E5 - D5 - E5 D5',
        'G5 - - A5 G5 - E5 - D5 - - E5 D5 - E5 -',
        'E5 - - - - - D5 E5 B4 - - - - - . .',
      ] },
      { role: 'inner', player: 'lute', bars: [
        'E4 . G4 . C5 . G4 . E4 . G4 . C5 G4 E4 .',
        'D4 . A4 . D5 . A4 . D4 . A4 . D5 A4 D4 .',
        'E4 . B4 . D5 . B4 . E4 . B4 . D5 B4 E4 .',
        'D4 . F#4 . B4 . F#4 . D4 . F#4 . B4 F#4 D4 .',
        'E4 . G4 C5 . G4 E4 . G4 . C5 . G4 E4 G4 .',
        'D4 . A4 D5 . A4 D4 . A4 . D5 . A4 D4 A4 .',
        'D4 . G4 B4 . G4 D4 . A4 . D5 . A4 D4 A4 .',
        'E4 . B4 E5 . B4 E4 . F#4 . B4 . F#4 B3 F#4 .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'C2 . C2 . . C2 G2 . C2 . C2 . . C2 G2 .',
        'D2 . D2 . . D2 A2 . D2 . D2 . . D2 A2 .',
        'E2 . E2 . . E2 B2 . E2 . E2 . . E2 B2 .',
        'B1 . B1 . . B1 F#2 . B1 . B1 . . B1 F#2 .',
        'C2 . C2 . . C2 G2 . C2 . C2 . . C2 G2 .',
        'D2 . D2 . . D2 A2 . D2 . D2 . . D2 A2 .',
        'G1 . G1 . . G1 D2 . D2 . D2 . . D2 A2 .',
        'E2 . E2 . . E2 B2 . B1 . B1 . . B1 F#2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . x . . . x . . . x . o .',
        'x . . . x . . . x . . . x . o .',
        'x . . . x . . . x . . . x . o .',
        'x . . . x . . . x . . . x . o .',
        'x . . o x . . . x . . o x . o .',
        'x . . o x . . . x . . o x . o .',
        'x . . o x . . . x . . o x . o .',
        'x . . o x . . . x . . o x o o o',
      ],
      hand: [
        '. o . o . . o . . o . o . . o .',
        '. o . o . . o . . o . o . . o .',
        '. o . o . . o . . o . o . . o .',
        '. o . o . . o . . o . o . . o .',
        '. o . o . o o . . o . o . o o .',
        '. o . o . o o . . o . o . o o .',
        '. o . o . o o . . o . o . o o .',
        '. o . o . o o . o o o . x o x o',
      ],
      shaker: [
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
        'x o x o o o x o x o x o o o x o',
      ],
    },
  },
  // Bars 65-72: A's head at its loudest: the flute echoes the fiddle, then plays the same line its own way; the fiddle's one B5 at 69.
  {
    name: 'crowd', bars: 8, level: 0,
    chords: ['Em', 'C', 'G', 'D', 'Em', 'Am', 'C', 'B5'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'B4 - - - - - D5 - E5 - - - G5 - A5 -',
        'G5 - - - - - - - E5 - - - D5 - E5 -',
        'D5 - - - - - E5 - G5 - - - - - A5 -',
        'A5 - - - - - G5 - E5 - - - G5 - A5 -',
        'B5 - - - - - A5 - G5 - - - E5 - D5 -',
        'E5 - - - - - - - - - - - D5 - E5 -',
        'G5 - - - - - E5 - D5 - - - E5 - G5 -',
        'F#5 - - - - - E5 - D5 - - - - - B4 -',
      ] },
      { role: 'second', player: 'flute', bars: [
        '. . . . . . . . B5 - - - D6 - E6 -',
        'E6 - - - - - - - D6 - - - . . . .',
        '. . . . . . . . B5 - - - - - D6 -',
        'E6 - - - - - D6 - - - - - B5 - A5 -',
        'B5 - - - - - A5 B5 G5 - - A5 E5 - D5 E5',
        'E5 - - - G5 E5 - - D5 E5 - - D5 - E5 -',
        'G5 - - A5 G5 - E5 - D5 - E5 D5 E5 - G5 -',
        'F#5 - - - E5 F#5 E5 - D5 - - - - - B4 -',
      ] },
      { role: 'inner', player: 'dulcimer', bars: [
        'E3 B3 E4 B3 E3 B3 E4 B3 E3 B3 E4 B3 E3 B3 G4 B3',
        'G3 C4 G4 C4 G3 C4 G4 C4 G3 C4 G4 C4 G3 C4 E4 C4',
        'G3 D4 G4 D4 G3 D4 G4 D4 G3 D4 G4 D4 G3 D4 B4 D4',
        'A3 D4 A4 D4 A3 D4 A4 D4 A3 D4 A4 D4 A3 D4 E4 D4',
        'E3 B3 E4 E3 B3 E4 E3 B3 E4 E3 B3 E4 E3 B3 D4 B3',
        'A3 E4 A4 A3 E4 A4 A3 E4 A4 A3 E4 A4 A3 E4 G4 E4',
        'G3 C4 G4 G3 C4 G4 G3 C4 G4 G3 C4 G4 G3 C4 E4 C4',
        'B3 F#4 B4 B3 F#4 B4 B3 F#4 B4 B3 F#4 B4 B3 F#4 E4 F#4',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'E2 . E2 E2 . E2 B2 . E2 . E2 E2 . E2 E3 .',
        'C2 . C2 C2 . C2 G2 . C2 . C2 C2 . C2 C3 .',
        'G1 . G1 G1 . G1 D2 . G1 . G1 G1 . G1 G2 .',
        'D2 . D2 D2 . D2 A2 . D2 . D2 D2 . D2 D3 .',
        'E2 . E2 E2 . E2 B2 . E2 . E2 E2 . E2 E3 .',
        'A1 . A1 A1 . A1 E2 . A1 . A1 A1 . A1 A2 .',
        'C2 . C2 C2 . C2 G2 . C2 . C2 C2 . C2 C3 .',
        'B1 . B1 B1 . B1 F#2 . B1 . B1 B1 . B1 B2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . o x . o . x . . o x . o .',
        'x . . o x . o . x . . o x . o .',
        'x . . o x . o . x . . o x . o .',
        'x . . o x . o . x . . o x . o .',
        'x . o . x . o . x . o o x . o .',
        'x . o . x . o . x . o o x . o .',
        'x . o . x . o . x . o o x . o .',
        'x . o . x . o . x o x . x o x o',
      ],
      hand: [
        '. o . . o o . o . o . . o o . o',
        '. o . . o o . o . o . . o o . o',
        '. o . . o o . o . o . . o o . o',
        '. o . . o o . o . o . . o o . o',
        '. o o . o . . o . o o . o . o o',
        '. o o . o . . o . o o . o . o o',
        '. o o . o . . o . o o . o . o o',
        '. o o . o . . o . o o . o . o o',
      ],
      shaker: [
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
        'x o x o x o x o x o x o x o x o',
      ],
      bells: [
        'x . . . . . . . . . . . . . . .',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
        '|',
      ],
    },
  },
  // Bars 73-76: the lute calls on B's head, the dulcimer answers, a held low line.
  {
    name: 'market calls', bars: 4, level: -1,
    chords: ['Em', 'Em|D', 'C', 'B5'],
    lines: [
      { role: 'lead', player: 'lute', bars: [
        'E4 . . E4 E4 . G4 . . . . . . . . .',
        'A4 . . A4 A4 . B4 . . . . . . . . .',
        'G4 . . G4 G4 . A4 . . . . . . . . .',
        'F#4 . . F#4 F#4 . A4 . . . . . . . . .',
      ] },
      { role: 'second', player: 'dulcimer', bars: [
        '. . . . . . . . B4 . D5 . E5 . D5 .',
        '. . . . . . . . E5 . E4 . E5 . D5 .',
        '. . . . . . . . G5 . E5 . D5 . E5 .',
        '. . . . . . . . B4 - - - - - . .',
      ] },
      { role: 'low', player: 'lowbow', bars: [
        'G3 - - - - - - - - - - - - - - -',
        'G3 - - - - - - - F#3 - - - - - - -',
        'E3 - - - - - - - G3 - - - - - - -',
        'F#3 - - - - - - - - - - - - - - -',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'E2 - - E2 - - B2 - E2 - - E2 - - B2 -',
        'E2 - - E2 - - B2 - D2 - - D2 - - A2 -',
        'C2 - - C2 - - G2 - C2 - - C2 - - G2 -',
        'B1 - - B1 - - F#2 - B1 - - B1 - - F#2 -',
      ] },
    ],
    beats: {
      drum: [
        'x . . . . . . . x . . o . . . .',
        'x . . . . . . . x . . o . . . .',
        'x . . . . . . . x . . o . . . .',
        'x . . . . . . . x . . o x . o o',
      ],
      hand: [
        '. . o . x . o o . . o . x . o .',
        '. . o . x . o o . . o . x . o .',
        '. . o . x . o o . . o . x . o .',
        '. . o . x . o o . o o . x o x o',
      ],
      shaker: [
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
      ],
    },
  },
  // Bars 77-84: A's opening stepping down, the dulcimer finishing each fragment; a D chord in bar 84 leads to G in bar 1.
  {
    name: 'homeward', bars: 8, level: -1,
    chords: ['G', 'D', 'Em', 'C', 'Am', 'Em', 'C|D', 'Em|D'],
    lines: [
      { role: 'lead', player: 'bowed', bars: [
        'B4 - - - - - D5 - E5 - - - . . . .',
        'A4 - - - - - B4 - D5 - - - . . . .',
        'G4 - - - - - A4 - B4 - - - . . . .',
        'E4 - - - - - G4 - A4 - - - . . . .',
        'C5 - - - - - - - B4 - - - A4 - - -',
        'B4 - - - - - D5 - B4 - - - A4 - G4 -',
        'E4 - - - - - G4 - A4 - - - - - B4 -',
        'E4 - - - - - - - - - D4 - G4 - A4 -',
      ] },
      { role: 'second', player: 'dulcimer', bars: [
        '. . . . . . . . . . . . D5 . B4 .',
        '. . . . . . . . . . . . B4 . A4 .',
        '. . . . . . . . . . . . A4 . G4 .',
        '. . . . . . . . . . . . G4 . E4 .',
        '|',
        '|',
        '|',
        '|',
      ] },
      { role: 'inner', player: 'lute', bars: [
        'B3 . D4 G4 . D4 B3 . D4 G4 . D4 B3 . . .',
        'A3 . D4 F#4 . D4 A3 . D4 F#4 . D4 A3 . . .',
        'B3 . E4 G4 . E4 B3 . E4 G4 . E4 B3 . . .',
        'C4 . E4 G4 . E4 C4 . E4 G4 . E4 C4 . . .',
        'A3 E4 . A4 E4 . A3 E4 . A4 E4 . A3 . E4 .',
        'B3 E4 . G4 E4 . B3 E4 . G4 E4 . B3 . D4 .',
        'C4 . G4 E4 . G4 C4 . A4 D5 . A4 D4 . F#4 .',
        'B3 . E4 G4 . E4 B3 . A4 D5 . A4 D4 . F#4 .',
      ] },
      { role: 'bass', player: 'bass', bars: [
        'G1 . . G1 . . D2 . G1 . . G1 . . B1 .',
        'D2 . . D2 . . A1 . D2 . . D2 . . A1 .',
        'E2 . . E2 . . B1 . E2 . . E2 . . D2 .',
        'C2 . . C2 . . G2 . C2 . . C2 . . G1 .',
        'A1 . . A1 . . A1 . E2 . . E2 . . A1 .',
        'E2 . . E2 . . E2 . B2 . . B2 . . E2 .',
        'C2 . . C2 . . C2 . D2 . . D2 . . A1 .',
        'E2 . . E2 . . E2 . D2 . . D2 . . D2 .',
      ] },
    ],
    beats: {
      drum: [
        'x . . . . . o . x . . o . . . .',
        'x . . . . . o . x . . o . . . .',
        'x . . . . . o . x . . o . . . .',
        'x . . . . . o . x . . o . . . .',
        'x . . . . . o . x . . . x . . .',
        'x . . . . . o . x . . . x . . .',
        'x . . . . . o . x . . . x . . .',
        'x . . . . . o . x . . o x . o o',
      ],
      hand: [
        '. . o . o . . o . . o . o . . o',
        '. . o . o . . o . . o . o . . o',
        '. . o . o . . o . . o . o . . o',
        '. . o . o . . o . . o . o . . o',
        '. . o . o . o o . . o . o . o o',
        '. . o . o . o o . . o . o . o o',
        '. . o . o . o o . . o . o . o o',
        '. . o . o . o o . o o . o o o o',
      ],
      shaker: [
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'x o o o x o o o x o o o x o o o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
        'o o x o o o x o o o x o o o x o',
      ],
    },
  },
];

export const BEIJING_BARS = BEIJING_SECTIONS.reduce((n, s) => n + s.bars, 0);

export type OrnamentKind = 'slide' | 'grace' | 'fall' | 'press' | 'roll';

/**
 * Every ornament in the loop, on the note a player sounds at that bar and step: a slide into it from `semitones` away,
 * a grace note that far away flicked before it, a fall that far at its end, a zither string pressed up from that far
 * below, or a dulcimer's two-hammer roll through the note's length. At most one a bar, each with its reason.
 */
export const BEIJING_ORNAMENTS: ReadonlyArray<readonly [bar: number, step: number, player: Player, kind: OrnamentKind, semitones: number]> = [
  [1, 0, 'bowed', 'slide', -2], // the street's voice arrives
  [6, 0, 'bowed', 'slide', -2], // the top of A
  [15, 8, 'flute', 'grace', 3], // the top of A's climb (from above: the note before is the one below)
  [17, 0, 'flute', 'grace', -2], // B comes back, the flute's way
  [19, 12, 'flute', 'grace', 2], // the top of B's line (from above, likewise)
  [25, 0, 'flute', 'grace', -2], // A upside down enters
  [33, 4, 'bowed', 'slide', -2], // the patrol's opening leap
  [36, 5, 'bowed', 'fall', -2], // the patrol line stops short
  [37, 0, 'flute', 'grace', 2], // the flute takes C's shape upside down
  [43, 0, 'flute', 'grace', 2], // the top of the alley calls
  [44, 8, 'flute', 'grace', 3], // the two callers meet on one line (from above, likewise)
  [52, 13, 'bowed', 'fall', -1], // the end of D4, a sigh
  [54, 0, 'bowed', 'slide', -2], // the peak of D
  [55, 2, 'zither', 'press', -2], // the warm B minor bar
  [56, 13, 'bowed', 'fall', -1], // the end of D, a sigh: the loop's only D#
  [61, 0, 'flute', 'grace', -2], // the flute joins the lanterns' climb
  [65, 8, 'flute', 'grace', -2], // the echo enters
  [69, 0, 'bowed', 'slide', -2], // the fiddle's one B5
  [76, 8, 'dulcimer', 'roll', 0], // the half close before A's fragments
];

const REST_BAR: readonly string[] = Array<string>(16).fill('.');
const tokensOf = (bar: string): readonly string[] => (bar.trim() === '|' ? REST_BAR : bar.trim().split(/\s+/));

/** A role's line through the whole loop, sixteen tokens a bar, resting where the role does not play. */
export function lineTokens(role: Role): string[] {
  return BEIJING_SECTIONS.flatMap((sec) => {
    const line = sec.lines.find((l) => l.role === role);
    return Array.from({ length: sec.bars }, (_, i) => (line ? tokensOf(line.bars[i]!) : REST_BAR)).flat();
  });
}

/** A percussion row through the whole loop. */
export function beatTokens(beat: Beat): string[] {
  return BEIJING_SECTIONS.flatMap((sec) => {
    const row = sec.beats[beat];
    return Array.from({ length: sec.bars }, (_, i) => (row ? tokensOf(row[i]!) : REST_BAR)).flat();
  });
}

const isNote = (t: string | undefined) => t !== undefined && t !== '.' && t !== '-';

let leadTokens: string[] | null = null;

/** Whether a note a role starts at step `s` carries the tune: the lead's, or the second voice's where the lead rests. */
export function carriesTune(role: Role, s: number): boolean {
  leadTokens ??= lineTokens('lead');
  return role === 'lead' || (role === 'second' && leadTokens[s] === '.');
}

/**
 * The tune as the first draft plays it (and the other styles arrange it): each note that carries the tune, on its first
 * step.
 */
export function draftLeadRow(): string {
  const lead = lineTokens('lead');
  const second = lineTokens('second');
  return lead.map((t, s) => (isNote(t) ? t : isNote(second[s]) && carriesTune('second', s) ? second[s]! : '.')).join(' ');
}

/** The bass as the first draft plays it: each note on its first step. */
export function draftBassRow(): string {
  return lineTokens('bass').map((t) => (isNote(t) ? t : '.')).join(' ');
}

/** The drums as the first draft plays them: the low drum's full strokes ("x") and lighter ones ("o"). */
export function draftDrumRow(): string {
  return beatTokens('drum').join(' ');
}
