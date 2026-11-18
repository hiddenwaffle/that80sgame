/**
 * Where the ball is in each figure image: its circle's middle and radius, in the image's pixels. Written
 * by `node tools/art_prep.ts fits`, from the measures `tools/art_prep.ts ball` takes as it prepares each
 * image; not edited by hand.
 */
export const LOOK_FIT: Record<string, { cx: number; cy: number; r: number }> = {
  'looks/blue_thing_ko': { cx: 133.5, cy: 184.5, r: 134.5 },
  'looks/blue_thing_side': { cx: 156.5, cy: 191.5, r: 127.5 },
  'looks/german_ko': { cx: 158.5, cy: 173.6, r: 148.6 },
  'looks/german_side': { cx: 160.4, cy: 166.8, r: 154.5 },
  'looks/gorbie_front': { cx: 158, cy: 165.7, r: 152.3 },
  'looks/gorbie_ko': { cx: 158, cy: 165.7, r: 152.3 },
  'looks/gorbie_side': { cx: 157.5, cy: 165.8, r: 152.2 },
  'looks/grey_hat_back': { cx: 113, cy: 225.3, r: 94.7 },
  'looks/grey_hat_front': { cx: 112, cy: 225.7, r: 93.3 },
  'looks/grey_hat_ko': { cx: 110.5, cy: 225.6, r: 94.4 },
  'looks/grey_hat_side': { cx: 103, cy: 221.8, r: 97.2 },
  'looks/guard_cap_back': { cx: 120, cy: 199.8, r: 118.2 },
  'looks/guard_cap_front': { cx: 121.5, cy: 198, r: 121 },
  'looks/guard_cap_ko': { cx: 120, cy: 200.7, r: 118.3 },
  'looks/guard_cap_side': { cx: 132, cy: 201.3, r: 117.7 },
  'looks/guard_hat_back': { cx: 113, cy: 225.3, r: 94.7 },
  'looks/guard_hat_front': { cx: 112, cy: 225.7, r: 93.3 },
  'looks/guard_hat_ko': { cx: 110.5, cy: 225.6, r: 94.4 },
  'looks/guard_hat_side': { cx: 103, cy: 221.8, r: 97.2 },
  'looks/olli_front': { cx: 153, cy: 167, r: 152 },
  'looks/olli_ko': { cx: 153.5, cy: 166.5, r: 152.5 },
  'looks/olli_side': { cx: 156, cy: 164, r: 155 },
  'looks/ronnie_front': { cx: 160, cy: 159.3, r: 157.7 },
  'looks/ronnie_ko': { cx: 159.5, cy: 158.8, r: 158.2 },
  'looks/ronnie_side': { cx: 157, cy: 156.9, r: 155.1 },
  'looks/shopkeeper_ko': { cx: 157.5, cy: 167.1, r: 150.9 },
  'looks/shopkeeper_side': { cx: 157.5, cy: 165.6, r: 153.4 },
  'looks/soldier_back': { cx: 120, cy: 199.8, r: 118.2 },
  'looks/soldier_front': { cx: 121.5, cy: 198, r: 121 },
  'looks/soldier_ko': { cx: 120, cy: 200.7, r: 118.3 },
  'looks/soldier_side': { cx: 132, cy: 201.3, r: 117.7 },
};
