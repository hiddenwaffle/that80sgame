/**
 * Eye ellipses, lid colours sampled above them, and measured eye ink, in each source picture's pixels.
 * Written by `node tools/measure_eyes.ts` (tools/eye_finder.ts); not edited by hand.
 * Ball lids use LOOK_INK's picture outline weight; other figures use their measured eye ink.
 * The owner, 2026-10-10: "Add occasional natural eye blinks across the cast during the character-animation polish pass."
 */
export interface LookEye {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  lid: number;
  ink: number;
}

export const LOOK_EYES: Record<string, LookEye[]> = {
  'look/heads/looks/grey_hat_back': [],
  'look/heads/looks/grey_hat_front': [{ cx: 87.5, cy: 202.5, rx: 15.5, ry: 15.5, lid: 0xfcddc6, ink: 4.5 }, { cx: 136, cy: 201.5, rx: 14.9, ry: 15.4, lid: 0xfcdcc7, ink: 4.5 }],
  'look/heads/looks/grey_hat_ko': [],
  'look/heads/looks/grey_hat_side': [{ cx: 136.5, cy: 206.5, rx: 13.2, ry: 18.7, lid: 0xfddec8, ink: 4 }, { cx: 171, cy: 202, rx: 9.6, ry: 17.5, lid: 0xfcdec8, ink: 4.5 }],
  'look/heads/looks/guard_hat_back': [],
  'look/heads/looks/guard_hat_front': [{ cx: 87.5, cy: 202.5, rx: 15.5, ry: 15.5, lid: 0xfcddc6, ink: 4.5 }, { cx: 136, cy: 201.5, rx: 14.9, ry: 15.4, lid: 0xfcdcc7, ink: 4.5 }],
  'look/heads/looks/guard_hat_ko': [],
  'look/heads/looks/guard_hat_side': [{ cx: 136.5, cy: 206.5, rx: 13.2, ry: 18.7, lid: 0xfddec8, ink: 4 }, { cx: 171, cy: 202, rx: 9.6, ry: 17.5, lid: 0xfcdec8, ink: 4.5 }],
  'look/rifle/looks/boss_side': [{ cx: 149, cy: 72, rx: 16.5, ry: 16.5, lid: 0xc11c2b, ink: 3 }, { cx: 196.5, cy: 58.5, rx: 11.5, ry: 14.7, lid: 0xc01b2a, ink: 2.5 }],
  'look/wreck/looks/tank_battered': [{ cx: 138.5, cy: 40, rx: 5.1, ry: 5.6, lid: 0xe2a995, ink: 1 }, { cx: 153.5, cy: 38.5, rx: 4.3, ry: 5.4, lid: 0xf0bb9c, ink: 1 }],
  'look/wreck/looks/tank_wreck': [],
  'looks/blue_thing_ko': [],
  'looks/blue_thing_side': [{ cx: 197.5, cy: 164, rx: 25.3, ry: 33.9, lid: 0x01d3fb, ink: 4.5 }, { cx: 253.5, cy: 162.5, rx: 16, ry: 33.2, lid: 0x02d5fc, ink: 5 }],
  'looks/boss_side': [{ cx: 149.5, cy: 76, rx: 17.2, ry: 17.8, lid: 0xb71d2d, ink: 3 }, { cx: 200, cy: 61, rx: 12, ry: 16.2, lid: 0xb61c2d, ink: 3 }],
  'looks/german_ko': [],
  'looks/german_side': [{ cx: 220, cy: 113, rx: 32.6, ry: 42.9, lid: 0x101010, ink: 5 }, { cx: 290.5, cy: 110.5, rx: 22.2, ry: 42.3, lid: 0x100f10, ink: 5 }],
  'looks/ghost_blue_back': [],
  'looks/ghost_blue_front': [{ cx: 85, cy: 114, rx: 20.1, ry: 25, lid: 0x27378f, ink: 3 }, { cx: 144, cy: 113.5, rx: 20.6, ry: 25, lid: 0x2a388e, ink: 3.5 }],
  'looks/ghost_blue_side': [{ cx: 138, cy: 113.5, rx: 19.4, ry: 26.3, lid: 0x29368d, ink: 3 }, { cx: 184.5, cy: 113, rx: 13.7, ry: 24.4, lid: 0x2a368d, ink: 3 }],
  'looks/ghost_cream_back': [],
  'looks/ghost_cream_front': [{ cx: 67.5, cy: 115.5, rx: 27.3, ry: 52.7, lid: 0xf4efd6, ink: 3 }, { cx: 142, cy: 115.5, rx: 27.1, ry: 53.1, lid: 0xf0eace, ink: 3 }],
  'looks/ghost_cream_side': [{ cx: 152.5, cy: 116, rx: 26.9, ry: 52.2, lid: 0xf3ecd6, ink: 3 }, { cx: 209.5, cy: 115, rx: 15.1, ry: 50.2, lid: 0xf4eed7, ink: 4 }],
  'looks/ghost_giant_back': [],
  'looks/ghost_giant_front': [{ cx: 203, cy: 348, rx: 80.9, ry: 158.2, lid: 0xf0e7cc, ink: 10.5 }, { cx: 425, cy: 348.5, rx: 80.9, ry: 158.7, lid: 0xeee5cd, ink: 10.5 }],
  'looks/ghost_giant_side': [{ cx: 452.5, cy: 349.5, rx: 79.2, ry: 154.3, lid: 0xefe7d2, ink: 12.5 }, { cx: 620, cy: 345.5, rx: 47, ry: 153.5, lid: 0xeee7d1, ink: 15.5 }],
  'looks/ghost_green_back': [],
  'looks/ghost_green_front': [{ cx: 80.5, cy: 112, rx: 25.4, ry: 39.2, lid: 0x3d6742, ink: 4 }, { cx: 149.5, cy: 112, rx: 25.6, ry: 39.5, lid: 0x3b6641, ink: 4.5 }],
  'looks/ghost_green_side': [{ cx: 131.5, cy: 113.5, rx: 24.4, ry: 38.7, lid: 0x3c6642, ink: 5 }, { cx: 187.5, cy: 111, rx: 17.4, ry: 38.4, lid: 0x3b6541, ink: 5 }],
  'looks/ghost_orange_back': [],
  'looks/ghost_orange_front': [{ cx: 93, cy: 126, rx: 30.9, ry: 49.1, lid: 0xfa9121, ink: 4 }, { cx: 178, cy: 126, rx: 30.8, ry: 48.9, lid: 0xf99020, ink: 4.5 }],
  'looks/ghost_orange_side': [{ cx: 152, cy: 127.5, rx: 30.3, ry: 49.4, lid: 0xf89222, ink: 4 }, { cx: 222.5, cy: 126, rx: 21, ry: 47.7, lid: 0xfc9221, ink: 4.5 }],
  'looks/ghost_red_back': [],
  'looks/ghost_red_front': [{ cx: 74.5, cy: 103.5, rx: 24.9, ry: 43.5, lid: 0x881319, ink: 3 }, { cx: 139.5, cy: 102.5, rx: 24.2, ry: 44.1, lid: 0x8e141a, ink: 3 }],
  'looks/ghost_red_side': [{ cx: 128, cy: 105.5, rx: 27.1, ry: 45.7, lid: 0x89141a, ink: 3 }, { cx: 183, cy: 103.5, rx: 15.3, ry: 43.4, lid: 0x8c141c, ink: 3 }],
  'looks/gorbie_front': [],
  'looks/gorbie_ko': [],
  'looks/gorbie_side': [{ cx: 217.5, cy: 124.5, rx: 35.5, ry: 41.6, lid: 0xfeffff, ink: 5.5 }, { cx: 286.5, cy: 123, rx: 20.2, ry: 47.5, lid: 0xffffff, ink: 6.5 }],
  'looks/grey_hat_back': [],
  'looks/grey_hat_front': [],
  'looks/grey_hat_ko': [],
  'looks/grey_hat_side': [{ cx: 136.5, cy: 206.5, rx: 13.2, ry: 18.7, lid: 0xfddec8, ink: 4 }, { cx: 171, cy: 202, rx: 9.6, ry: 17.5, lid: 0xfcdec8, ink: 4.5 }],
  'looks/guard_cap_back': [],
  'looks/guard_cap_front': [{ cx: 91.5, cy: 158.5, rx: 30.2, ry: 29.2, lid: 0xfccca0, ink: 4 }, { cx: 153.5, cy: 156, rx: 29.5, ry: 29, lid: 0xfccda0, ink: 3.5 }],
  'looks/guard_cap_ko': [],
  'looks/guard_cap_side': [{ cx: 191, cy: 159, rx: 25.7, ry: 33.1, lid: 0xfdca9e, ink: 4 }, { cx: 230.5, cy: 154.5, rx: 18.6, ry: 33.8, lid: 0xfcc89d, ink: 4.5 }],
  'looks/guard_hat_back': [],
  'looks/guard_hat_front': [{ cx: 87.5, cy: 202.5, rx: 15.5, ry: 15.5, lid: 0xfcddc6, ink: 4.5 }, { cx: 136, cy: 201.5, rx: 14.9, ry: 15.4, lid: 0xfcdcc7, ink: 4.5 }],
  'looks/guard_hat_ko': [],
  'looks/guard_hat_side': [{ cx: 136.5, cy: 206.5, rx: 13.2, ry: 18.7, lid: 0xfddec8, ink: 4 }, { cx: 171, cy: 202, rx: 9.6, ry: 17.5, lid: 0xfcdec8, ink: 4.5 }],
  'looks/olli_front': [],
  'looks/olli_ko': [],
  'looks/olli_side': [{ cx: 202, cy: 145.5, rx: 34.5, ry: 39.2, lid: 0xfdfdfd, ink: 6 }, { cx: 274.5, cy: 144.5, rx: 25, ry: 36.5, lid: 0xfefdfd, ink: 6 }],
  'looks/ronnie_front': [],
  'looks/ronnie_ko': [],
  'looks/ronnie_side': [{ cx: 219.5, cy: 128, rx: 33, ry: 39.7, lid: 0xfffeff, ink: 6.5 }, { cx: 291.5, cy: 122, rx: 21.9, ry: 39, lid: 0xfcfcfc, ink: 6 }],
  'looks/shopkeeper_ko': [],
  'looks/shopkeeper_side': [{ cx: 194.5, cy: 117.5, rx: 31.2, ry: 36.4, lid: 0x76ee3d, ink: 6 }, { cx: 263, cy: 108, rx: 22.6, ry: 37.7, lid: 0x76ee3e, ink: 6 }],
  'looks/soldier_back': [],
  'looks/soldier_front': [{ cx: 91.5, cy: 158.5, rx: 30.2, ry: 29.2, lid: 0xfccca0, ink: 4 }, { cx: 153.5, cy: 156, rx: 29.5, ry: 29, lid: 0xfccda0, ink: 3.5 }],
  'looks/soldier_ko': [],
  'looks/soldier_side': [{ cx: 191, cy: 159, rx: 25.7, ry: 33.1, lid: 0xfdca9e, ink: 4 }, { cx: 230.5, cy: 154.5, rx: 18.6, ry: 33.8, lid: 0xfcc89d, ink: 4.5 }],
  'looks/tank_side': [{ cx: 132, cy: 35.5, rx: 5.5, ry: 6.1, lid: 0xe5ab92, ink: 1 }, { cx: 146, cy: 34, rx: 4.1, ry: 5.3, lid: 0xe7af95, ink: 1 }],
};
