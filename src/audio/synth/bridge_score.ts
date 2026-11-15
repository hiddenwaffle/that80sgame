// The approved bridge, proposal 3 with the final instrument/level revisions (2026-10-18).
// Patterns contain sixteen sixteenths per bar; '-' sustains and '.' rests.
export interface BridgePart { name: string; side: 'arcade' | 'real'; level: number; patterns: Record<string,string>; order: string[] }
export const BRIDGE_PARTS: BridgePart[] = [
  {
    "name": "Console lead",
    "side": "arcade",
    "level": 0.75,
    "patterns": {
      "m1": "G4 - - - A#4 - D5 - - - - - - - C5 -",
      "m2": "A#4 - - - - - A4 G4 A4 - - - - - - -",
      "m3": "G4 - - - - - - - A#4 - - - D#5 - - -",
      "m4": "D5 - - - - - - - - - - - . . . .",
      "m5": "C5 - - - - - D#5 - D5 - - - C5 - A#4 -",
      "m6": "D#5 - - - - - - - C5 - - - G#4 - - -",
      "m7": "A4 - - - - - - - F#4 - - - A4 - C5 -",
      "m8": "D5 - - - - - - - C5 - A4 - F#4 - - -",
      "m9": "G4 - - - A#4 - D5 - - - - - D#5 - D5 -",
      "m10": "C5 - - - - - - - A4 - - - - - F4 -",
      "m11": "G4 - - - - - A#4 - D#5 - - - - - - -",
      "m12": "D5 - - - - - C5 - A#4 - - - - - - -",
      "m13": "D#5 - - - - - - - D5 - - - C5 - - -",
      "m14": "A#4 - - - - - - - G4 - - - D#4 - - -",
      "m15": "D4 - - - F#4 - A4 - - - - - C5 - - -",
      "m16": "A4 - - - - - - - - - . . F#4 - - -"
    },
    "order": [
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "m11",
      "m12",
      "m13",
      "m14",
      "m15",
      "m16"
    ]
  },
  {
    "name": "Console bass",
    "side": "arcade",
    "level": 0.7,
    "patterns": {
      "Gm": "G2 . G3 . G2 . G3 . G2 . G3 . A#2 . D3 .",
      "D#": "D#2 . D#3 . D#2 . D#3 . D#2 . D#3 . G2 . A#2 .",
      "Cm": "C2 . C3 . C2 . C3 . C2 . C3 . D#2 . G2 .",
      "G#": "G#2 . G#3 . G#2 . G#3 . G#2 . G#3 . C3 . D#3 .",
      "D": "D2 . D3 . D2 . D3 . D2 . D3 . F#2 . A2 .",
      "D7": "D2 . D3 . D2 . D3 . D2 D2 D3 . C3 . A2 .",
      "F": "F2 . F3 . F2 . F3 . F2 . F3 . A2 . C3 .",
      "A#": "A#2 . A#3 . A#2 . A#3 . A#2 . A#3 . D3 . F3 ."
    },
    "order": [
      "Gm",
      "Gm",
      "D#",
      "D#",
      "Cm",
      "G#",
      "D",
      "D7",
      "Gm",
      "F",
      "D#",
      "A#",
      "Cm",
      "D#",
      "D",
      "D7"
    ]
  },
  {
    "name": "Console arpeggio",
    "side": "arcade",
    "level": 0.85,
    "patterns": {
      "Gm": "G3 A#3 D4 G4 A#4 D5 A#4 G4 G3 A#3 D4 G4 A#4 D5 A#4 G4",
      "D#": "G3 A#3 D#4 G4 A#4 D#5 A#4 G4 G3 A#3 D#4 G4 A#4 D#5 A#4 G4",
      "Cm": "G3 C4 D#4 G4 C5 D#5 C5 G4 G3 C4 D#4 G4 C5 D#5 C5 G4",
      "G#": "G#3 C4 D#4 G#4 C5 D#5 C5 G#4 G#3 C4 D#4 G#4 C5 D#5 C5 G#4",
      "D": "A3 D4 F#4 A4 D5 A4 F#4 D4 A3 D4 F#4 A4 D5 A4 F#4 D4",
      "D7": "A3 C4 D4 F#4 A4 C5 D5 C5 A3 C4 D4 F#4 A4 C5 D5 C5",
      "F": "A3 C4 F4 A4 C5 A4 F4 C4 A3 C4 F4 A4 C5 A4 F4 C4",
      "A#": "A#3 D4 F4 A#4 D5 A#4 F4 D4 A#3 D4 F4 A#4 D5 A#4 F4 D4"
    },
    "order": [
      "Gm",
      "Gm",
      "D#",
      "D#",
      "Cm",
      "G#",
      "D",
      "D7",
      "Gm",
      "F",
      "D#",
      "A#",
      "Cm",
      "D#",
      "D",
      "D7"
    ]
  },
  {
    "name": "Noise kick",
    "side": "arcade",
    "level": 0.55,
    "patterns": {
      "beat": "a . . . . . . . a . x . . . . ."
    },
    "order": [
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat"
    ]
  },
  {
    "name": "Noise snare",
    "side": "arcade",
    "level": 1,
    "patterns": {
      "back": ". . . . a . . . . . . . a . . .",
      "fill": ". . . . a . . . . . g . a g a a"
    },
    "order": [
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "fill",
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "fill"
    ]
  },
  {
    "name": "Noise hat",
    "side": "arcade",
    "level": 1,
    "patterns": {
      "16ths": "x g x g x g x g x g x g x g x g"
    },
    "order": [
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths"
    ]
  },
  {
    "name": "Noise crash",
    "side": "arcade",
    "level": 0.35,
    "patterns": {
      "hit": "a . . . . . . . . . . . . . . ."
    },
    "order": [
      "hit",
      "-",
      "-",
      "-",
      "-",
      "-",
      "-",
      "-",
      "hit",
      "-",
      "-",
      "-",
      "-",
      "-",
      "-",
      "-"
    ]
  },
  {
    "name": "Horn",
    "side": "real",
    "level": 0.89,
    "patterns": {
      "m1": "G4 - - - A#4 - D5 - - - - - - - C5 -",
      "m2": "A#4 - - - - - A4 G4 A4 - - - - - - -",
      "m3": "G4 - - - - - - - A#4 - - - D#5 - - -",
      "m4": "D5 - - - - - - - - - - - . . . .",
      "m5": "C5 - - - - - D#5 - D5 - - - C5 - A#4 -",
      "m6": "D#5 - - - - - - - C5 - - - G#4 - - -",
      "m7": "A4 - - - - - - - F#4 - - - A4 - C5 -",
      "m8": "D5 - - - - - - - C5 - A4 - F#4 - - -",
      "m9": "G4 - - - A#4 - D5 - - - - - D#5 - D5 -",
      "m10": "C5 - - - - - - - A4 - - - - - F4 -",
      "m11": "G4 - - - - - A#4 - D#5 - - - - - - -",
      "m12": "D5 - - - - - C5 - A#4 - - - - - - -",
      "m13": "D#5 - - - - - - - D5 - - - C5 - - -",
      "m14": "A#4 - - - - - - - G4 - - - D#4 - - -",
      "m15": "D4 - - - F#4 - A4 - - - - - C5 - - -",
      "m16": "A4 - - - - - - - - - . . F#4 - - -"
    },
    "order": [
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "m11",
      "m12",
      "m13",
      "m14",
      "m15",
      "m16"
    ]
  },
  {
    "name": "Strings upper",
    "side": "real",
    "level": 0.42,
    "patterns": {
      "D4": "D4 - - - - - - - - - - - - - - -",
      "D#4": "D#4 - - - - - - - - - - - - - - -",
      "C4": "C4 - - - - - - - - - - - - - - -",
      "A#3": "A#3 - - - - - - - - - - - - - - -",
      "A3": "A3 - - - - - - - - - - - - - - -"
    },
    "order": [
      "D4",
      "D4",
      "D#4",
      "D#4",
      "D#4",
      "D#4",
      "D4",
      "C4",
      "A#3",
      "A3",
      "A#3",
      "D4",
      "D#4",
      "D#4",
      "D4",
      "C4"
    ]
  },
  {
    "name": "Strings lower",
    "side": "real",
    "level": 0.38,
    "patterns": {
      "G3": "G3 - - - - - - - - - - - - - - -",
      "A#3": "A#3 - - - - - - - - - - - - - - -",
      "C4": "C4 - - - - - - - - - - - - - - -",
      "A3": "A3 - - - - - - - - - - - - - - -",
      "F#3": "F#3 - - - - - - - - - - - - - - -",
      "F3": "F3 - - - - - - - - - - - - - - -"
    },
    "order": [
      "G3",
      "G3",
      "A#3",
      "G3",
      "C4",
      "C4",
      "A3",
      "F#3",
      "G3",
      "F3",
      "G3",
      "F3",
      "G3",
      "A#3",
      "A3",
      "F#3"
    ]
  },
  {
    "name": "Pizzicato bass",
    "side": "real",
    "level": 0.6,
    "patterns": {
      "Gm": "G2 . G3 . G2 . G3 . G2 . G3 . A#2 . D3 .",
      "D#": "D#2 . D#3 . D#2 . D#3 . D#2 . D#3 . G2 . A#2 .",
      "Cm": "C2 . C3 . C2 . C3 . C2 . C3 . D#2 . G2 .",
      "G#": "G#2 . G#3 . G#2 . G#3 . G#2 . G#3 . C3 . D#3 .",
      "D": "D2 . D3 . D2 . D3 . D2 . D3 . F#2 . A2 .",
      "D7": "D2 . D3 . D2 . D3 . D2 D2 D3 . C3 . A2 .",
      "F": "F2 . F3 . F2 . F3 . F2 . F3 . A2 . C3 .",
      "A#": "A#2 . A#3 . A#2 . A#3 . A#2 . A#3 . D3 . F3 ."
    },
    "order": [
      "Gm",
      "Gm",
      "D#",
      "D#",
      "Cm",
      "G#",
      "D",
      "D7",
      "Gm",
      "F",
      "D#",
      "A#",
      "Cm",
      "D#",
      "D",
      "D7"
    ]
  },
  {
    "name": "Timpani",
    "side": "real",
    "level": 0.45,
    "patterns": {
      "tiG": "G2 . . . . . . . . . . . . . . .",
      "tiGs": "G#2 . . . . . . . . . . . . . . .",
      "tiD": "D2 . . . . . . . . . . . . . . .",
      "tiPick": "D2 . . . . . . . D2 . . . D2 . D2 ."
    },
    "order": [
      "tiG",
      "-",
      "-",
      "-",
      "-",
      "tiGs",
      "tiD",
      "-",
      "tiG",
      "-",
      "-",
      "-",
      "-",
      "-",
      "tiD",
      "tiPick"
    ]
  },
  {
    "name": "Harp",
    "side": "real",
    "level": 0.48,
    "patterns": {
      "Gm": "G3 A#3 D4 G4 A#4 D5 A#4 G4 G3 A#3 D4 G4 A#4 D5 A#4 G4",
      "D#": "G3 A#3 D#4 G4 A#4 D#5 A#4 G4 G3 A#3 D#4 G4 A#4 D#5 A#4 G4",
      "Cm": "G3 C4 D#4 G4 C5 D#5 C5 G4 G3 C4 D#4 G4 C5 D#5 C5 G4",
      "G#": "G#3 C4 D#4 G#4 C5 D#5 C5 G#4 G#3 C4 D#4 G#4 C5 D#5 C5 G#4",
      "D": "A3 D4 F#4 A4 D5 A4 F#4 D4 A3 D4 F#4 A4 D5 A4 F#4 D4",
      "D7": "A3 C4 D4 F#4 A4 C5 D5 C5 A3 C4 D4 F#4 A4 C5 D5 C5",
      "F": "A3 C4 F4 A4 C5 A4 F4 C4 A3 C4 F4 A4 C5 A4 F4 C4",
      "A#": "A#3 D4 F4 A#4 D5 A#4 F4 D4 A#3 D4 F4 A#4 D5 A#4 F4 D4"
    },
    "order": [
      "Gm",
      "Gm",
      "D#",
      "D#",
      "Cm",
      "G#",
      "D",
      "D7",
      "Gm",
      "F",
      "D#",
      "A#",
      "Cm",
      "D#",
      "D",
      "D7"
    ]
  },
  {
    "name": "Bass drum",
    "side": "real",
    "level": 0.35,
    "patterns": {
      "beat": "a . . . . . . . a . x . . . . ."
    },
    "order": [
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat",
      "beat"
    ]
  },
  {
    "name": "Snare drum",
    "side": "real",
    "level": 1.1,
    "patterns": {
      "back": ". . . . a . . g . . . . a . . g",
      "fill": ". . . . a . . g . . g . a g a a"
    },
    "order": [
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "fill",
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "back",
      "fill"
    ]
  },
  {
    "name": "Shaker",
    "side": "real",
    "level": 2.5,
    "patterns": {
      "16ths": "x g x g x g x g x g x g x g x g"
    },
    "order": [
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths",
      "16ths"
    ]
  }
];
