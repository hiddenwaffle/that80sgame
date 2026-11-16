/**
 * Renders a style's sounds for the game off its own thread (see choice.ts): an effect or a track, or a voice's takes,
 * each at the game's level for it, sent back as their channels: one when both sides are the same (the chip styles are
 * mono, and a long loop is tens of megabytes a channel), two otherwise.
 */
import type { Mix } from './dsp.ts';
import { loopGain, renderForGame, renderIntros } from './forGame.ts';

export interface GameJob {
  id: number;
  style: string;
  kind: 'sfx' | 'music' | 'voice';
  name: string;
  pitch?: number;
  /** A piece of a track's opening, this many seconds long (forGame.ts `OPENINGS`). */
  until?: number;
  /** The pieces a track plays after a fight (intros.ts), one take each, instead of its loop. */
  intros?: boolean;
  /** With `intros`: the gain the loop was given, sent back with it, so a worker that did not render the loop need not. */
  gain?: number;
  /** For the checks, in developer mode (styled.ts `SoundFail`): the render throws, or the worker throws outside any render. */
  fail?: 'render' | 'crash';
}

/** `gain`: with a track's whole loop, the gain it was given, for the pieces it plays after a fight. */
export type GameResult = { id: number; takes: Float32Array[][]; ms: number; gain?: number } | { id: number; error: string };

const channels = (m: Mix): Float32Array[] => {
  for (let i = 0; i < m.length; i++) if (m.l[i] !== m.r[i]) return [m.l, m.r];
  return [m.l];
};

self.onmessage = (e: MessageEvent<GameJob>) => {
  const j = e.data;
  const t0 = performance.now();
  // Thrown from no handler, as a worker's own failure reaches the page (its `error` event); this render is never answered.
  if (j.fail === 'crash') {
    setTimeout(() => { throw new Error('the sound worker crashed, as asked (soundfail=crash)'); });
    return;
  }
  try {
    if (j.fail === 'render') throw new Error(`the render failed, as asked (soundfail): ${j.kind} ${j.name}`);
    const takes = (j.intros ? renderIntros(j.style, j.name, j.gain) : renderForGame(j.style, j.kind, j.name, j.pitch, j.until)).map(channels);
    const gain = j.kind === 'music' && !j.intros && j.until === undefined ? loopGain(j.style, j.name) : undefined;
    const out: GameResult = { id: j.id, takes, ms: performance.now() - t0, ...(gain === undefined ? {} : { gain }) };
    (self as unknown as Worker).postMessage(out, takes.flat().map((c) => c.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: j.id, error: String(err) } satisfies GameResult);
  }
};
