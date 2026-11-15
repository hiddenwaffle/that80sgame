/**
 * Each art image's size in bytes and pixels, read from the files' own headers (PNG, JPEG, WebP), for the game's
 * loading page (its share by bytes and time left) and for the hot pink box a picture that fails to load leaves in
 * its place (src/art/images.ts, through `virtual:art-files` in vite.config.ts). Plain file reading only.
 */
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';

export interface ImageFacts {
  bytes: number;
  width: number;
  height: number;
}

/** An image's width and height in pixels from its header, or null for a file that is none of the three. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  // PNG: the header chunk comes first, its width and height big-endian.
  if (b.length >= 24 && v.getUint32(0) === 0x89504e47 && ascii(12, 'IHDR')) return { width: v.getUint32(16), height: v.getUint32(20) };
  // JPEG: the first start-of-frame marker (C0 to CF but for C4, C8 and CC) has the height, then the width.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      i += 2 + v.getUint16(i + 2);
    }
    return null;
  }
  // WebP: its first chunk says which kind: extended (with alpha, as the art's copies are), lossless or lossy.
  if (b.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    if (ascii(12, 'VP8L')) {
      const bits = v.getUint32(21, true);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (ascii(12, 'VP8 ')) return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
  }
  return null;
}

/** Every PNG, JPEG and WebP under `dir` at any depth, keyed by its path from `dir` with `/` between folders. */
export function imageFactsUnder(dir: string, prefix = ''): Record<string, ImageFacts> {
  const out: Record<string, ImageFacts> = {};
  for (const d of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
    const file = path.join(dir, d.name);
    if (d.isDirectory()) Object.assign(out, imageFactsUnder(file, `${prefix}${d.name}/`));
    else if (/\.(png|jpg|webp)$/.test(d.name)) {
      const b = readFileSync(file);
      const size = imageSize(b);
      if (size) out[`${prefix}${d.name}`] = { bytes: b.length, ...size };
    }
  }
  return out;
}
