/** Placeholder subjective blast sound: silence, a soft ear ring, then the mix returning.
 * The scene supplies its elapsed time so pausing never separates sound from the image. */
export class BlastHearing {
  private readonly oscillator: OscillatorNode;
  private readonly ring: GainNode;
  private stopped = false;
  private readonly ctx: BaseAudioContext;
  private readonly scene: GainNode;
  private readonly mixOutput: AudioNode;
  private readonly muffled: BiquadFilterNode;
  private readonly rumble: AudioBufferSourceNode;
  private readonly rumbleGain: GainNode;
  private readonly rumbleLow: BiquadFilterNode;
  private readonly rumbleHigh: BiquadFilterNode;

  constructor(ctx: BaseAudioContext, scene: GainNode, mixOutput: AudioNode, ringOutput: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.scene = scene;
    this.mixOutput = mixOutput;
    // Only insert the low-pass during this effect. Ordinary playback keeps its original path.
    this.muffled = ctx.createBiquadFilter();
    this.muffled.type = 'lowpass';
    this.muffled.Q.value = 0.5;
    this.muffled.frequency.value = 500;
    scene.disconnect(mixOutput);
    scene.connect(this.muffled).connect(mixOutput);
    this.ring = ctx.createGain();
    this.ring.gain.value = 0;
    this.ring.connect(ringOutput);
    this.oscillator = ctx.createOscillator();
    this.oscillator.type = 'sine';
    // A steady high tone rather than the previous downward-pitched whistle.
    this.oscillator.frequency.value = 2600;
    this.oscillator.connect(this.ring);
    this.oscillator.start();
    // A sustained, filtered roar rather than the ordinary short blast effect.
    // Feed the effects-volume path alongside the ring, outside the stunned music mix.
    this.rumble = ctx.createBufferSource();
    this.rumble.buffer = noise; this.rumble.loop = true;
    this.rumbleLow = ctx.createBiquadFilter(); this.rumbleLow.type = 'lowpass';
    this.rumbleLow.frequency.value = 230; this.rumbleLow.Q.value = 0.65;
    this.rumbleHigh = ctx.createBiquadFilter(); this.rumbleHigh.type = 'highpass';
    this.rumbleHigh.frequency.value = 32; this.rumbleHigh.Q.value = 0.5;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumble.connect(this.rumbleLow).connect(this.rumbleHigh).connect(this.rumbleGain).connect(ringOutput);
    this.rumble.start();
    // Cut the existing music, voices and effects together, including already playing buffers.
    scene.gain.cancelScheduledValues(ctx.currentTime);
    scene.gain.setValueAtTime(0, ctx.currentTime);
  }

  update(age: number): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    const smooth = (k: number) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
    const ringIn = smooth((age - 0.35) / 0.8);
    const returning = smooth((age - 1.35) / 4.4);
    // Short smoothing avoids zipper noise as fixed simulation steps update the audio thread.
    // The sustained high tone needs less of the overall mix's new gain than the rumble.
    this.ring.gain.setTargetAtTime(0.015 * ringIn * (1 - returning), now, 0.025);
    this.scene.gain.setTargetAtTime(returning, now, 0.025);
    this.muffled.frequency.setTargetAtTime(500 * Math.pow(36, returning), now, 0.025);
    // The white hold stays silent. The roar rolls in as the picture reappears,
    // sustaining through the cloud's rise before a long, soft tail.
    const rumbleIn = smooth((age - 0.5) / 0.65);
    const rumbleOut = 1 - smooth((age - 1.8) / 3.9);
    const roll = 0.82 + Math.sin(age * 3.1) * 0.1 + Math.sin(age * 5.3 + 0.7) * 0.08;
    this.rumbleGain.gain.setTargetAtTime(0.75 * rumbleIn * rumbleOut * roll, now, 0.045);
    this.rumbleLow.frequency.setTargetAtTime(100 + 130 * rumbleOut, now, 0.045);
  }

  /** Also used for quitting, map destruction, replacement effects and audio-context recovery. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.scene.gain.cancelScheduledValues(now);
    this.scene.gain.setTargetAtTime(1, now, 0.02);
    this.scene.disconnect(this.muffled);
    this.muffled.disconnect();
    this.scene.connect(this.mixOutput);
    this.ring.gain.cancelScheduledValues(now);
    this.ring.gain.setTargetAtTime(0, now, 0.008);
    this.oscillator.onended = () => { this.oscillator.disconnect(); this.ring.disconnect(); };
    this.oscillator.stop(now + 0.05);
    this.rumbleGain.gain.cancelScheduledValues(now);
    this.rumbleGain.gain.setTargetAtTime(0, now, 0.008);
    this.rumble.onended = () => {
      this.rumble.disconnect(); this.rumbleLow.disconnect(); this.rumbleHigh.disconnect(); this.rumbleGain.disconnect();
    };
    this.rumble.stop(now + 0.05);
  }
}
