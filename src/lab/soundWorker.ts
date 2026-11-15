/**
 * Renders sound sketches for the comparison page off the page's own thread: a style's effect, music loop, or typing
 * blip, matched to its loudness target (`normalize`), sent back as its two channels.
 */
import { normalize, type Mix } from '../audio/synth/dsp.ts';
import { STYLES } from '../audio/synth/sketches.ts';

export interface RenderJob {
  id: number;
  style: string;
  kind: 'sfx' | 'music' | 'voice';
  name: string;
  pitch?: number;
  seed?: number;
}

export type RenderResult = { id: number; l: Float32Array; r: Float32Array; limited: number; ms: number } | { id: number; error: string };

self.onmessage = (e: MessageEvent<RenderJob>) => {
  const j = e.data;
  const t0 = performance.now();
  try {
    const s = STYLES[j.style];
    if (!s) throw new Error(`No style ${j.style}`);
    let mix: Mix;
    if (j.kind === 'sfx' && s.sfx) mix = s.sfx(j.name);
    else if (j.kind === 'music' && s.music) mix = s.music(j.name);
    else if (j.kind === 'voice' && s.voice) mix = s.voice(j.pitch ?? 440, j.seed ?? 1);
    else throw new Error(`${j.style} has no ${j.kind}`);
    const n = normalize(mix, j.kind);
    const out: RenderResult = { id: j.id, l: mix.l, r: mix.r, limited: n.limited, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(out, [mix.l.buffer, mix.r.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: j.id, error: String(err) } satisfies RenderResult);
  }
};
