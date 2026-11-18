/**
 * Where each ball picture's talking mouth meets its outline, in the picture's pixels: the outline's weight there (`ink`),
 * so the mouth's edges are inked at the picture's own weight, and how far its outer edge is from the ball's middle
 * (`edge`), where the lips end so they join the outline (src/art/lookArt.ts). Written by
 * `node tools/art_prep.ts inks` (tools/ink_weight.ts) from the pictures and `LOOK_FIT`; not edited by hand.
 * tests/look_ink.test.ts fails while it is out of date.
 */
export const LOOK_INK: Record<string, { ink: number; edge: number }> = {
  'looks/blue_thing_side': { ink: 8.6, edge: 128.4 },
  'looks/german_side': { ink: 9.4, edge: 155.2 },
  'looks/gorbie_side': { ink: 10.7, edge: 152.8 },
  'looks/grey_hat_front': { ink: 8.4, edge: 93.5 },
  'looks/grey_hat_side': { ink: 6, edge: 97 },
  'looks/guard_cap_front': { ink: 8.6, edge: 121.1 },
  'looks/guard_cap_side': { ink: 8.8, edge: 118.1 },
  'looks/guard_hat_front': { ink: 8.4, edge: 93.5 },
  'looks/guard_hat_side': { ink: 6, edge: 97 },
  'looks/olli_side': { ink: 8.1, edge: 156.5 },
  'looks/ronnie_side': { ink: 12.4, edge: 155.4 },
  'looks/shopkeeper_side': { ink: 12, edge: 153.7 },
  'looks/soldier_front': { ink: 8.6, edge: 121.1 },
  'looks/soldier_side': { ink: 8.8, edge: 118.1 },
};
