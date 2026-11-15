/** The names of big numbers from a trillion up, each a thousand times the last. */
const SCALES = [
  'trillion', 'quadrillion', 'quintillion', 'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion', 'undecillion',
  'duodecillion', 'tredecillion', 'quattuordecillion', 'quindecillion', 'sexdecillion', 'septendecillion', 'octodecillion',
  'novemdecillion', 'vigintillion',
];

/**
 * An amount of a trillion or more in words, as a paper prints it: "1.9 trillion", "15.5 trillion", "127 quadrillion",
 * with a tenth under a hundred. Past the last name the figure before it just grows ("1,234 vigintillion").
 */
export function trillionsInWords(n: number): string {
  let i = 0;
  let x = n / 1e12;
  while (x >= 999.95 && i < SCALES.length - 1) {
    x /= 1000;
    i++;
  }
  const figure = x < 99.95 ? String(Math.round(x * 10) / 10) : Math.round(x).toLocaleString('en-US');
  return `${figure} ${SCALES[i]}`;
}
