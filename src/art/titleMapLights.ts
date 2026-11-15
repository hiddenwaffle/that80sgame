/**
 * More lights for the title's world, where the map's own (a city each, from Natural Earth: titleMapData.ts) leave the sea bare. The
 * Pacific has next to none, so a pac waited on North America while Asia turned round to it (the owner, 2026-10-24); these are its
 * islands, one light each, [latitude, longitude] in degrees, each at least 7.4 degrees from every other light, which is
 * the least the title keeps between lights and dots (src/ui/titleChase.ts, tests/title_chase.test.ts).
 */
export const PACIFIC_LIGHTS: readonly (readonly [number, number])[] = [
  [21.3, -157.9], // Honolulu
  [28.2, -177.4], // Midway
  [16.7, -169.5], // Johnston
  [1.9, -157.4], // Kiritimati
  [19.3, 166.6], // Wake
  [7.1, 171.4], // Majuro
  [13.5, 144.8], // Guam
  [6.9, 158.2], // Pohnpei
  [-22.3, 166.4], // Noumea
  [-18.1, 178.4], // Suva
  [-13.8, -171.8], // Apia
  [-21.2, -159.8], // Rarotonga
  [-17.5, -149.6], // Papeete
  [-9.8, -139], // The Marquesas
  [-25, -130], // Pitcairn
  [-27.1, -109.4], // Easter Island
  [-0.7, -90.4], // The Galapagos
  [53.9, -166.5], // Dutch Harbor
  [10.3, -109.2], // Clipperton
  [18.8, -111], // Revillagigedo
];
