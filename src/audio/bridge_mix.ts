/** The approved bridge score's tempo; the draft fallback retains its own tempo in music.ts. */
import { CONSOLE_TEMPOS } from './music_tempos.ts';

export const BRIDGE_TEMPO = CONSOLE_TEMPOS.border!;
export const BRIDGE_GAIN_RAMP = 0.02;

/** The map specifies the music's own span in tile columns, independent of perspective and cabinet movement. */
export function musicShareAt(span: unknown, column: number): number {
  const ends = typeof span === 'string' ? span.split(',').map(Number) : [];
  if (ends.length !== 2 || ends.some(v => !Number.isFinite(v)) || ends[1]! <= ends[0]!) return 0;
  return Math.max(0, Math.min(1, (column - ends[0]!) / (ends[1]! - ends[0]!)));
}

/** Constant-power mix of the two approved ends, with exact silence at each end of the window. */
export function bridgeGains(share: number): [number, number] {
  if (share <= 0.04) return [1, 0];
  if (share >= 0.96) return [0, 1];
  const x = Math.max(0, Math.min(1, (share - 0.04) / 0.92));
  if (x <= 0) return [1, 0];
  if (x >= 1) return [0, 1];
  const gap = 12 * Math.log10((1 - x) / x);
  const arcade = 1 / Math.sqrt(1 + 10 ** (-gap / 10));
  return [arcade, Math.sqrt(1 - arcade * arcade)];
}

/**
 * The buffer's channels are two mono musical ends, not left/right speakers. One source keeps them sample-locked.
 * Changes ramp from the gain actually reached, including when direction reverses before the previous ramp ends.
 * This same graph is used by live playback and the offline reference-walk check.
 */
export class BridgeMix {
  readonly input: ChannelSplitterNode;
  private readonly ends: [GainNode, GainNode];
  private start: [number, number];
  private target: [number, number];
  private from: number;
  private to: number;

  constructor(ctx: BaseAudioContext, output: AudioNode, share: number) {
    this.input = ctx.createChannelSplitter(2);
    this.ends = [ctx.createGain(), ctx.createGain()];
    this.start = this.target = bridgeGains(share);
    this.from = this.to = ctx.currentTime;
    this.ends.forEach((g, i) => {
      g.gain.value = this.target[i]!;
      this.input.connect(g, i);
      g.connect(output);
    });
  }

  setShare(share: number, at = this.input.context.currentTime): void {
    const next = bridgeGains(share);
    if (next.every((g, i) => g === this.target[i])) return;
    const shorten = at > this.from && at < this.to;
    const fraction = this.to <= this.from ? 1 : Math.max(0, Math.min(1, (at - this.from) / (this.to - this.from)));
    this.start = this.start.map((g, i) => g + (this.target[i]! - g) * fraction) as [number, number];
    this.target = next;
    this.from = at;
    this.to = at + BRIDGE_GAIN_RAMP;
    this.ends.forEach((g, i) => {
      g.gain.cancelScheduledValues(at);
      // Cancelling a ramp's future endpoint also removes the segment before `at`. Restore that segment explicitly,
      // including when several updates are scheduled ahead of the audio render quantum.
      if (shorten) g.gain.linearRampToValueAtTime(this.start[i]!, at);
      else g.gain.setValueAtTime(this.start[i]!, at);
      g.gain.linearRampToValueAtTime(next[i]!, this.to);
    });
  }
}
