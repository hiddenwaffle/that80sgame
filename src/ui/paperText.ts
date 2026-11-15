import { Container, Graphics } from 'pixi.js';

/** Paragraphs as lines, by count and the width of their last line, repeating down the columns. */
const PARAGRAPHS: ReadonlyArray<[lines: number, last: number]> = [[6, 0.55], [3, 0.66], [4, 0.48], [5, 0.7], [3, 0.4]];

/**
 * Word-shaped ink groups suggest newspaper copy without supplying article wording: paragraphs in two columns, each column
 * filled down to its own depth from its own top (`tops`, below `y`; a lead in words above the first column's).
 */
export function paperText(x: number, y: number, column: number, gutter: number, depths: [number, number], tops: [number, number] = [0, 0]): Container {
  const out = new Container();
  out.label = 'chapter_text_blocks_columns';
  const ink = new Graphics();
  const color = 0x625e56;
  const pitch = 4.6, thick = 1.45, indent = 5;
  const line = (left: number, top: number, width: number, seed: number) => {
    let at = 0, word = 0;
    while (at < width - 3) {
      const length = Math.min(width - at, 6 + ((seed * 11 + word * 17) % 19));
      ink.rect(left + at, top, length, thick).fill({ color, alpha: 0.78 });
      at += length + 2; word++;
    }
  };
  depths.forEach((depth, c) => {
    const left = x + c * (column + gutter);
    const rows = Math.floor((depth - thick) / pitch) + 1;
    // The second column starts partway through the list, so the two never line up paragraph for paragraph.
    let row = 0, p = c * 2;
    while (row < rows) {
      const [n, last] = PARAGRAPHS[p % PARAGRAPHS.length]!;
      for (let i = 0; i < n && row < rows; i++, row++) {
        const width = i === n - 1 ? last : 1 - ((p + i) % 3) * 0.01;
        const first = i === 0 ? indent : 0;
        line(left + first, y + (tops[c] ?? 0) + row * pitch, column * width - first, p * 5 + i + 2);
      }
      row++; // a line's space between paragraphs
      p++;
    }
  });
  out.addChild(ink);
  return out;
}
