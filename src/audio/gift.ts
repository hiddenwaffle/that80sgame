/** Brief NES-style item-discovery placeholder, shared by live and rendered effects. */
export const GIFT_NOTES = [523.25, 659.25, 783.99, 987.77, 1046.5].map((freq, i) => ({
  freq, at: i * 0.075, hold: i === 4 ? 0.25 : 0.07, gain: 0.15,
}));
