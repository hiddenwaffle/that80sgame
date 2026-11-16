import type { Settings } from '../game/settings.ts';
import { TRACKS, lengthAt, stepInLoop, type Track } from './music.ts';
import { INTROS, introFor, introLeadsIn, introPlan, introSteps, type Intro, type LastIntro } from './intros.ts';
import type { Piece, SoundFail, SoundProblem, StyledSound } from './styled.ts';
import { REVIVAL_VOICES } from './revival.ts';
import { GIFT_NOTES } from './gift.ts';
import { BridgeMix } from './bridge_mix.ts';
import { BlastHearing } from './blastHearing.ts';
import { BLIP_SOONEST, placeBlip, type BlipGrid } from './blip_clock.ts';
import { musicLevelGain } from './music_levels.ts';
import { SR } from './synth/dsp.ts';
import { DIVE_S, diveNotches } from './diveTiming.ts';
import { STING_BEAT, STING_HOLD, VANISH_S } from './ronnienomicsTiming.ts';
import { CUT_FROM, CUT_LAST, CUT_STEP, CUTS, NINJA_BEAT } from './ninjaTiming.ts';

/**
 * A buffer position on a whole sample frame, as every music buffer here starts: one started between frames is played
 * interpolated (WebKit does, softening it a little; a step at 120 beats a minute is 5512.5 frames at 44.1 kHz). Halves
 * round up, the same way however the position was reached, so a hand-over meets the playhead it takes over from.
 */
const onFrame = (seconds: number, rate: number) => Math.floor(seconds * rate + 0.5 + 1e-6) / rate;
/** The first whole sample frame at or after a time. */
const fromFrame = (time: number, rate: number) => Math.ceil(time * rate - 1e-6) / rate;

/**
 * Failures made on purpose for the checks, in developer mode only: styled.ts `SoundFail`, `import` (the synthesizer's file
 * missing) and `refused` (the browser refusing sound).
 */
function soundFail(): string | null {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  return import.meta.env?.DEV || params.has('dev') ? params.get('soundfail') : null;
}
const STYLED_FAILS: readonly string[] = ['worker', 'crash', 'render', 'render_once'] satisfies SoundFail[];

/**
 * Synthesised sound: effects, typing blips, and music loops, with no sound files.
 * Each sound is rendered in the Console style (see synth/choice.ts and styled.ts)
 * off the page's thread. Until it is in, nothing plays in its place: an effect waits for its render, a voice types
 * silent, and music waits. If the sound cannot be made, it is tried again (styled.ts), and if that fails too the game is
 * told (`problem`), shows a mark and offers a reload (the owner, 15 Nov: the first draft's sound below, which played instead,
 * and its old arrangements "sound terrible ... completely unacceptable"). The first draft's, made from oscillators as it
 * goes, plays only where the address asks for it (`?sound=draft`). Audio tries to start on load; if the browser
 * blocks autoplay, a tap or key press starts it instead. It also recovers after
 * the phone is locked or a call interrupts it.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sceneGain!: GainNode;
  private ringingGain!: GainNode;
  private blast: BlastHearing | null = null;
  private blastEpoch = 0;
  private musicGain!: GainNode;
  /** Battle returns ease in independently of the player's music volume. */
  private musicFade!: GainNode;
  /** Fixed gains after the draft notes' envelopes, one per track so outgoing notes retain their own level. */
  private readonly draftMusicGains = new Map<string, GainNode>();
  private readonly fadedDraftLevels = new Map<string, number>();
  private sfxGain!: GainNode;
  private noise!: AudioBuffer;
  private readonly settings: Settings;
  private track: Track | null = null;
  private trackName: string | null = null;
  private nextStepTime = 0;
  private step = 0;
  /**
   * Interrupted tracks resume at their next musical step when a battle returns to the map (the maze plays a piece first,
   * intros.ts).
   */
  private readonly musicPositions = new Map<string, number>();
  private scheduler: number | null = null;
  /** The context stopped producing sound; it is rebuilt at the next tap or key press. */
  private stale = false;
  /**
   * Effects asked for while the browser does not yet let sound out. The gesture that unlocks sound is often the one that
   * asks for them (New Game's Enter starts the dive and its riser), and the unlock lands a moment later, when the device
   * has opened. Each is started when the context's state turns to running (`flushHeld`), that far into itself, so the riser
   * keeps step with the zoom; what has run out by then is dropped. Effects asked for before their render is in wait here
   * too, and start the same way once the style's effects are in.
   */
  private held: Array<{ name: string; rate: number; at: number }> = [];
  /** While a held effect starts late, the draft's notes due before this clock time are left out rather than piled up. */
  private skipBefore = 0;
  private checking = false;
  /** The sound in the game's style, once its effects and voices are in; null before, if it could not be had, or with `draftOnly`. */
  private styled: StyledSound | null = null;
  /** The address asks for the first draft's sound for everything (`?sound=draft`), so no style is loaded. */
  private draftOnly = false;
  /** What went wrong with the sound for good, if anything (styled.ts `SoundProblem`); the game shows a mark while it is set. */
  problem: SoundProblem | null = null;
  /** Told when `problem` is set, or cleared (a browser that refused sound has let it start after all). */
  onProblem: ((p: SoundProblem | null) => void) | null = null;
  /** Counts style changes, so one that lands late does not replace a newer one. */
  private styling = 0;
  private styleLoaded = 0;
  /** The title starts at note one once its chosen style is ready, without a draft-instrument opening. */
  private waitingForTitle = false;
  /**
   * Any other track whose loop is not rendered yet waits silent for it and then starts where it was asked to, rather than
   * opening on the first draft's instruments (the owner heard those at changes of music, 2026-10-12). `resuming` fades
   * it in as a return from a fight does.
   */
  private waitingForLoop = false;
  private resuming = false;
  /** The tracks the game may ask for next, rendered ahead (kept so a change of style renders them too). */
  private ahead: readonly string[] = [];
  /** The style's loop for the current track, playing in place of its notes: started at `at`, from step `step`. */
  /** `piece`: the loop is a piece of a long track's opening, not looping, played while its whole loop renders. */
  /** `intro`: a piece played after a fight (intros.ts), through the same gain, until the loop starts at `at`. */
  private loop: {
    src: AudioBufferSourceNode;
    gain: GainNode;
    at: number;
    step: number;
    /** The playing buffer's clock survives selection of a different style while that style loads. */
    stepDur: number;
    piece?: { seconds: number; seam: number };
    intro?: AudioBufferSourceNode;
    bridge?: BridgeMix;
  } | null = null;
  /** The outgoing transition still belongs to us until it ends or another track replaces it. */
  private fading: { gain: GainNode; src?: AudioBufferSourceNode; intro?: AudioBufferSourceNode } | null = null;
  /** The piece each track played last after a fight, for the turn through them once its map is done. */
  private readonly lastIntro = new Map<string, LastIntro>();
  /**
   * How far through its map the player is, for a track whose pieces after fights follow that (intros.ts): the game
   * counts the maze's power pellets taken, the one a fight was for included. Null plays the first piece.
   */
  introProgress: (name: string) => { done: number; total: number } | null = () => null;
  muted = false;
  /** Every speaker's typing pitch, rendered with the style's first sounds (`StyledSound`). */
  private readonly voicePitches: readonly number[];

  /**
   * `voices` are the pitches the script's speakers type at. They are rendered before any music, so a voice never waits
   * behind a long loop: a Beijing townsperson spoken to while Beijing's music rendered on a fresh page typed in the
   * first draft's square blip for about five seconds (the owner, 2026-10-13: "tinny").
   */
  constructor(settings: Settings, voices: readonly number[] = []) {
    this.settings = settings;
    this.voicePitches = voices;
    void this.setStyle('console');
    const wake = () => this.wake();
    // Browsers only let sound start inside certain gestures, and a touch's pointerdown
    // is not one of them (pointerup, touchend, and click are), so listen for them all.
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, wake, { capture: true });
    }
    document.addEventListener('visibilitychange', () => {
      // Coming back, try to resume; browsers that remember the earlier tap allow it without a new one.
      if (this.stoppedForGood) return;
      if (document.visibilityState === 'visible') void this.ctx?.resume().catch(() => undefined);
      else void this.ctx?.suspend();
    });
    // Some browsers already allow sound for this site. If not, the gesture listeners retry.
    this.wake();
  }

  /** Set by stopForGood: the game stopped on an error, and nothing brings the sound back this visit. */
  private stoppedForGood = false;

  /** The game has stopped on an error (Game.halt): the sound goes quiet and stays so; coming back to the tab or a tap does
   * not resume it. No sound is made differently: this only suspends the context. */
  stopForGood(): void {
    this.stoppedForGood = true;
    void this.ctx?.suspend().catch(() => undefined);
  }

  private create(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || soundFail() === 'refused') {
      console.warn(Ctx ? 'No sound: refused, as asked (soundfail=refused).' : 'No sound: this browser has no Web Audio.');
      this.report('refused');
      return;
    }
    // At the synthesizer's rate, where every sound is rendered and checked: the game mixes exactly that, and the browser converts
    // only the finished mix for the speakers. At the device's own rate (48 kHz on the owner's Mac) Chromium and WebKit converted
    // each sound as it played, by straight lines between samples, dulling the treble and adding false tones (the owner, 2026-11-11,
    // after a listening page of both: "I see no downside"). A browser that will not open at that rate opens at its own, as before;
    // one that refuses a context (too many open, or sound turned off) leaves the game silent, not stopped.
    try { this.ctx = new Ctx({ sampleRate: SR }); } catch {
      try { this.ctx = new Ctx(); } catch (e) { console.warn('No sound: the browser refused an audio context.', e); this.report('refused'); return; }
    }
    // Refused before, it has started now (each tap tries again): nothing is wrong any more.
    if (this.problem === 'refused') {
      this.problem = null;
      this.onProblem?.(null);
    }
    this.ctx.addEventListener('statechange', () => this.flushHeld());
    this.draftMusicGains.clear();
    this.fadedDraftLevels.clear();
    this.master = this.ctx.createGain();
    // Catch stacked battle effects without compressing the quieter parts of the mix.
    const peaks = this.ctx.createDynamicsCompressor();
    peaks.threshold.value = -6;
    peaks.knee.value = 0;
    peaks.ratio.value = 20;
    peaks.attack.value = 0.001;
    peaks.release.value = 0.15;
    // Offset the compressor's automatic makeup gain and leave room for transients.
    const output = this.ctx.createGain();
    output.gain.value = 0.7;
    this.master.connect(peaks).connect(output).connect(this.ctx.destination);
    this.sceneGain = this.ctx.createGain();
    this.sceneGain.connect(this.master);
    this.ringingGain = this.ctx.createGain();
    this.ringingGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicFade = this.ctx.createGain();
    this.musicFade.connect(this.musicGain);
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.sceneGain);
    this.sfxGain.connect(this.sceneGain);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  /**
   * Tries to start or resume audio, both on load and in the gesture's own event
   * handler. Keeping retries inside that handler lets browsers unlock sound.
   */
  private wake(): void {
    if (this.stoppedForGood) return;
    if (this.stale && this.ctx) {
      this.stopFading();
      this.blast?.stop();
      this.blast = null;
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.stale = false;
    }
    if (!this.ctx) {
      this.create();
      if (this.trackName) this.music(this.trackName, true);
    }
    const ctx = this.ctx;
    if (!ctx) return;
    if ((ctx.state as string) !== 'running') void ctx.resume().catch(() => undefined);
    // WebKit can report "running" while producing no sound after the phone sleeps.
    // If the clock does not move shortly after a gesture, the next gesture rebuilds it.
    if (this.checking) return;
    this.checking = true;
    const before = ctx.currentTime;
    window.setTimeout(() => {
      this.checking = false;
      if (this.ctx === ctx && ctx.state === 'running' && ctx.currentTime === before && document.visibilityState === 'visible') this.stale = true;
    }, 400);
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    // Rendered styles share the draft's deliberately quiet source levels. Bring
    // playback up by about 16 dB for music and 14 dB for effects, before peak control.
    // A change of volume while the music is turned down under an effect (`playOver`) ends that, at the new volume.
    if (this.ducked) this.musicGain.gain.cancelScheduledValues(0);
    this.ducked = null;
    this.musicGain.gain.value = this.muted ? 0 : this.settings.music * 2.8 * 10 ** (-2 / 20);
    this.sfxGain.gain.value = this.muted ? 0 : this.settings.effects * 2 * 10 ** (2 / 20);
    // The ringing bypasses the stunned scene mix, but still obeys Effects and mute.
    this.ringingGain.gain.value = this.sfxGain.gain.value;
  }

  /** An owned, reversible effect; volume settings and the music's position are preserved. */
  blastAftermath(): { update: (age: number) => void; stop: () => void } {
    const epoch = ++this.blastEpoch;
    this.blast?.stop();
    this.blast = null;
    let owned: BlastHearing | null = null;
    let stopped = false;
    return {
      update: age => {
        if (stopped || epoch !== this.blastEpoch || !this.ctx || this.ctx.state !== 'running') return;
        // Recreate after an interrupted audio context, at the scene's current age.
        if (!owned || this.blast !== owned) this.blast = owned = new BlastHearing(this.ctx, this.sceneGain, this.master, this.ringingGain, this.noise);
        owned.update(age);
      },
      stop: () => {
        stopped = true;
        if (this.blast === owned) { owned?.stop(); this.blast = null; }
      },
    };
  }

  private tone(type: OscillatorType, from: number, to: number, start: number, dur: number, vol = 0.3, dest?: AudioNode): void {
    if (start < this.skipBefore) return;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, start);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + dur);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g).connect(dest ?? this.sfxGain);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private hiss(start: number, dur: number, vol = 0.3, cutoff = 4000, dest?: AudioNode): void {
    if (start < this.skipBefore) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(f).connect(g).connect(dest ?? this.sfxGain);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.02);
  }

  /** A rendered sound from the tried style, from `offset` seconds into it. */
  private buffer(b: AudioBuffer, at: number, rate = 1, offset = 0): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    src.connect(this.sfxGain);
    if (offset > 0) src.start(at, offset);
    else src.start(at);
  }

  /** Starts the effects held while sound was locked, once it runs; each as if it had started when it was asked for. */
  private flushHeld(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.held.length) return;
    const now = performance.now() / 1000, held = this.held;
    this.held = [];
    for (const h of held) if (now - h.at < 6) this.sound(h.name, h.rate, now - h.at);
  }

  /** `rate` plays a style's effect faster and higher (2 is an octave up); the first draft's tones ignore it. */
  play(name: string, rate = 1): void {
    if (!this.ctx || this.ctx.state !== 'running') {
      // Kept for the unlock (see `held`).
      this.hold(name, rate, performance.now() / 1000);
      return;
    }
    this.sound(name, rate, 0);
  }

  /** An effect kept to start later, as if it had started `at` (seconds on the page's clock); only the latest few are kept. */
  private hold(name: string, rate: number, at: number): void {
    this.held.push({ name, rate, at });
    if (this.held.length > 32) this.held.shift();
  }

  /** Whether the address asks for the first draft's sound here (`?sound=draft`, or one kind of it): the only time it plays. */
  private draftAsked(kind: 'sfx' | 'music', name: string): boolean {
    return this.styled ? this.styled.chosenDraft(kind, name) : this.draftOnly;
  }

  /** Something has gone wrong with the sound for good: the first is kept, and the game told once. */
  private report(p: SoundProblem): void {
    if (this.problem) return;
    this.problem = p;
    this.held = [];
    console.error(`The sound has failed (${p}); the game shows its mark and offers a reload.`);
    this.onProblem?.(p);
  }

  /** The music turned down under an effect (`playOver`), and how to bring it back up from wherever it is. */
  private ducked: { level: number; restore: (at: number) => void } | null = null;

  /**
   * An effect played over the music turned down by `duck` decibels, the music back up through the effect's last `back`
   * seconds (Ronnienomics!'s failure sting). `stop` ends the effect at once and brings the music back up. Only the music's
   * gain moves, and only meanwhile, ending exactly where the settings put it; the music's own sound is untouched.
   * Before the style's sound is in, the effect waits for its render as any other does (`sound`), over the music as it is.
   */
  playOver(name: string, duck: number, back = 0.5): { stop: () => void } {
    const ctx = this.ctx;
    const b = ctx?.state === 'running' ? this.styled?.sfx(name) : null;
    if (!ctx || !b) {
      this.play(name);
      return { stop: () => {} };
    }
    const now = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.sfxGain);
    src.start(now);
    // Over another such effect still playing, from the level the settings put it at, not the turned-down one.
    const g = this.musicGain.gain, level = this.ducked?.level ?? g.value, low = level * 10 ** (-duck / 20);
    this.ducked?.restore(now);
    const down = now + 0.05, up = Math.max(down, now + b.duration - back);
    g.setValueAtTime(level, now);
    g.linearRampToValueAtTime(low, down);
    g.setValueAtTime(low, up);
    g.linearRampToValueAtTime(level, up + back);
    // Where the ramps have it at a time, to come back up from there rather than jump.
    const at = (s: number) => s < down ? level + (low - level) * Math.max(0, s - now) / (down - now)
      : s < up ? low : s < up + back ? low + (level - low) * (s - up) / back : level;
    const own = {
      level,
      restore: (s: number) => {
        g.cancelScheduledValues(s);
        g.setValueAtTime(at(s), s);
        g.linearRampToValueAtTime(level, s + 0.08);
        if (this.ducked === own) this.ducked = null;
      },
    };
    this.ducked = own;
    src.onended = () => { if (this.ducked === own) this.ducked = null; };
    return {
      stop: () => {
        if (this.ducked === own && this.ctx === ctx) own.restore(ctx.currentTime);
        try { src.stop(); } catch { /* already over */ }
      },
    };
  }

  /** An effect, `late` seconds after it was asked for: a rendered one from that far in. One not in yet waits for its render
   * with those held for the unlock (`held`), and starts that far in once it is (`flushHeld`); one that will never be, as the
   * sound has failed (`problem`), is not played. The draft's, without its notes due before now, only where the address asks. */
  private sound(name: string, rate: number, late: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime + 0.005;
    const styled = this.styled?.sfx(name);
    if (styled) {
      // Started late, a sound that has run out by now is left out; on time, every sound plays whatever its length.
      if (late <= 0 || late * rate < styled.duration - 0.05) this.buffer(styled, now, rate, late * rate);
      return;
    }
    if (!this.draftAsked('sfx', name)) {
      if (!this.problem) this.hold(name, rate, performance.now() / 1000 - late);
      return;
    }
    const t = now - late;
    this.skipBefore = late > 0 ? ctx.currentTime : 0;
    try {
      this.draft(name, t);
    } finally {
      this.skipBefore = 0;
    }
  }

  /** The first draft's effect, made from oscillators and noise, starting at `t`. */
  private draft(name: string, t: number): void {
    switch (name) {
      case 'blip':
        this.tone('square', 880, 880, t, 0.04, 0.12);
        break;
      case 'confirm':
        this.tone('square', 660, 990, t, 0.08, 0.15);
        break;
      case 'cancel':
        this.tone('square', 440, 300, t, 0.08, 0.15);
        break;
      case 'turn':
        this.tone('triangle', 784, 784, t, 0.07, 0.11);
        this.tone('triangle', 1175, 1175, t + 0.03, 0.09, 0.09);
        break;
      case 'waka':
        this.tone('triangle', 520, 260, t, 0.07, 0.25);
        this.tone('triangle', 260, 520, t + 0.075, 0.07, 0.25);
        break;
      case 'pickup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.05, 0.08, 0.15));
        break;
      case 'fanfare':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.08, 0.14, 0.16));
        break;
      case 'gift_reveal':
        for (const v of GIFT_NOTES) this.tone('square', v.freq, v.freq, t + v.at, v.hold, v.gain);
        break;
      case 'battle_start':
        this.tone('sawtooth', 1200, 120, t, 0.35, 0.18);
        this.hiss(t, 0.25, 0.2, 2500);
        break;
      case 'hit':
        this.hiss(t, 0.12, 0.35, 3000);
        this.tone('square', 180, 60, t, 0.12, 0.22);
        break;
      case 'miss':
        this.hiss(t, 0.18, 0.18, 1200);
        break;
      case 'hurt':
        this.tone('square', 300, 90, t, 0.18, 0.2);
        this.hiss(t, 0.1, 0.2, 2000);
        break;
      case 'defeat':
        [784, 659, 523, 392].forEach((f, i) => this.tone('square', f, f * 0.9, t + i * 0.06, 0.08, 0.14));
        break;
      case 'a_star':
        // One stroke of the star: a quick rising sweep with a hiss of air.
        this.tone('triangle', 300, 1200, t, 0.14, 0.2);
        this.hiss(t, 0.12, 0.08, 6000);
        break;
      case 'a_star_flare':
        // The star alight: a thump, a burst of noise, and a bright chord over them.
        this.tone('sine', 120, 50, t, 0.4, 0.3);
        this.hiss(t, 0.45, 0.16, 7000);
        [784, 988, 1175, 1568].forEach((f, i) => this.tone('square', f, f, t + i * 0.03, 0.4, 0.06));
        break;
      case 'cherry':
        [1319, 1568, 2093, 1568, 2093, 2637].forEach((f, i) => this.tone('sine', f, f, t + i * 0.07, 0.2, 0.14));
        break;
      case 'heal':
        this.tone('sine', 440, 880, t, 0.25, 0.18);
        break;
      case 'revival':
        // Soft, slightly detuned "aah" voices: intentionally over-reverent placeholder choir.
        for (const v of REVIVAL_VOICES) {
          const ctx = this.ctx!;
          const at = t + v.at;
          if (at < this.skipBefore) continue;
          const o = ctx.createOscillator(), gain = ctx.createGain();
          // Match the offline renderer's normalization of parallel formant filters.
          const peak = v.gain * 2.5 / Math.sqrt(v.formants.length);
          o.type = 'sawtooth';
          o.frequency.value = v.freq;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(peak, at + v.a);
          gain.gain.linearRampToValueAtTime(peak * v.s, at + v.a + v.d);
          gain.gain.setValueAtTime(peak * v.s, at + v.hold);
          gain.gain.linearRampToValueAtTime(0, at + v.hold + v.r);
          gain.connect(this.sfxGain);
          for (const frequency of v.formants) {
            const vowel = ctx.createBiquadFilter();
            vowel.type = 'bandpass';
            vowel.frequency.value = frequency;
            vowel.Q.value = v.fq;
            o.connect(vowel).connect(gain);
          }
          o.start(at);
          o.stop(at + v.hold + v.r);
        }
        break;
      case 'save':
        // The rest tune's final three notes, short enough to play while passing a star.
        [659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.09, 0.16, 0.14));
        break;
      case 'rest':
        // A short lullaby up to the light, then the heal's rise.
        [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.12, 0.22, 0.14));
        this.tone('sine', 523, 1047, t + 0.9, 0.5, 0.16);
        break;
      case 'appear':
        // Something new on the map: a soft puff, then three bright notes up.
        this.hiss(t, 0.18, 0.12, 2500);
        [1047, 1319, 1568].forEach((f, i) => this.tone('triangle', f, f, t + 0.05 + i * 0.07, 0.16, 0.13));
        break;
      case 'level_up':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.07, 0.12, 0.15));
        break;
      case 'win':
        [523, 523, 523, 659, 784].forEach((f, i) => this.tone('square', f, f, t + [0, 0.1, 0.2, 0.3, 0.45][i]!, 0.14, 0.15));
        break;
      case 'game_over':
        [392, 370, 349, 330, 311, 294, 262].forEach((f, i) => this.tone('triangle', f, f * 0.97, t + i * 0.18, 0.2, 0.2));
        break;
      case 'charge':
        this.tone('sawtooth', 80, 400, t, 0.6, 0.12);
        break;
      case 'burst':
        // The Warsaw Pac's rifle (the look's `rifle`): a short rattle of shots, each a crack of noise over a thump.
        for (let i = 0; i < 5; i++) {
          this.hiss(t + i * 0.07, 0.05, 0.16, 2500);
          this.tone('square', 140, 60, t + i * 0.07, 0.04, 0.08);
        }
        break;
      case 'ricochet':
        this.tone('sine', 2400, 900, t, 0.18, 0.05);
        break;
      case 'blast':
        this.hiss(t, 0.9, 0.5, 900);
        this.tone('square', 90, 30, t, 0.8, 0.3);
        break;
      case 'buy':
        this.tone('square', 988, 988, t, 0.05, 0.14);
        this.tone('square', 1319, 1319, t + 0.06, 0.1, 0.14);
        break;
      case 'door':
        this.hiss(t, 0.15, 0.15, 1500);
        break;
      case 'page':
        this.hiss(t, 0.3, 0.12, 5000);
        break;
      // The title's and the save code's sounds, as their drafts in synth/draft.ts have them, for while the player's
      // style is still loading (the title's sounds come first of all).
      case 'dive':
        diveNotches(21).forEach((at, i) => { const f = [196, 262, 330, 392, 523, 659, 784, 1047, 1319, 1568, 2093][Math.min(i, 10)]!; this.tone('square', f, f, t + at, 0.05, 0.075); });
        this.hiss(t + DIVE_S - 1, 1, 0.075, 6000);
        this.tone('triangle', 110, 40, t + DIVE_S, 0.2, 0.19);
        break;
      case 'neon_on':
        this.hiss(t + 0.06, 0.02, 0.2, 9000);
        this.hiss(t + 0.2, 0.02, 0.18, 9000);
        this.tone('square', 120, 120, t + 0.05, 0.4, 0.05);
        break;
      case 'key':
        this.tone('square', 1319, 1319, t, 0.02, 0.06);
        break;
      case 'dot':
        this.tone('square', 523, 523, t, 0.02, 0.05);
        this.tone('triangle', 1047, 1047, t, 0.08, 0.08);
        break;
      case 'code_ok':
        [523, 659, 784].forEach((f, i) => this.tone('square', f, f, t + i * 0.07, i === 2 ? 0.2 : 0.07, 0.15));
        break;
      case 'achievement':
        [1175, 1568].forEach((f, i) => this.tone('square', f, f, t + i * 0.085, 0.07, 0.105));
        [1047, 1319, 1568].forEach((f) => this.tone('square', f, f, t + 0.17, 0.7, 0.072));
        this.tone('triangle', 131, 131, t + 0.17, 0.5, 0.16);
        break;
      // Ronnienomics! (sfx.ts has the game's): the throw's whistle and fuse, the landing's puff and thump, the getaway's warp
      // out, and the failure's bar as square notes over drum hits. Each sets how loud the game's own plays.
      case 'smoke_throw':
        this.tone('square', 1300, 900, t, 0.3, 0.1);
        this.hiss(t, 0.3, 0.05, 9000);
        break;
      case 'smoke_poof':
        this.hiss(t, 0.5, 0.59, 2500);
        this.tone('triangle', 150, 40, t, 0.25, 0.47);
        break;
      case 'smoke_vanish':
        this.tone('square', 784, 98, t, VANISH_S, 0.07);
        this.hiss(t, VANISH_S, 0.042, 4000);
        break;
      case 'escape_sting': {
        const beat = STING_BEAT;
        for (const [b, f] of [[0, 392], [2 / 3, 392], [1, 330], [5 / 3, 440], [2, 392], [8 / 3, 330]] as const) this.tone('square', f, f, t + b * beat, b === 8 / 3 ? (STING_HOLD - b) * beat : 0.3 * beat, 0.283);
        for (const b of [0, 2, 2.5]) this.tone('triangle', 150, 45, t + b * beat, 0.25, 0.567);
        for (const b of [1, 3]) this.hiss(t + b * beat, 0.2, 0.424, 3000);
        break;
      }
      // The ninjas' lesson (sfx.ts has the game's): kicks and snares, the orchestra hits as square chords, a hiss for each cut.
      case 'ninja_beat': {
        const at = (b: number) => t + b * NINJA_BEAT;
        for (const b of [0, 0.75, 2, 2.5, 4, 4.75, 6, 6.5, CUT_LAST]) this.tone('triangle', 150, 45, at(b), 0.3, 0.65);
        for (const b of [1, 3, 5, 7]) this.hiss(at(b), 0.15, 0.42, 2500);
        for (const [b, len] of [[0, 0.5], [2.5, 0.16], [3, 0.16], [6.5, 0.16], [CUT_LAST, 0.5]] as const) for (const f of [165, 247, 330, 392]) this.tone('square', f, f, at(b), len, 0.072);
        for (let i = 0; i < CUTS; i++) this.hiss(at(CUT_FROM + i * CUT_STEP) - 0.05, 0.1, 0.24, 5000);
        break;
      }
      default:
        // A sound with no draft here is silent until the style loads: say so, rather than play nothing unnoticed.
        console.error(`No first-draft sound "${name}" in AudioSystem.play`);
        break;
    }
  }

  /** The typing sound for a speaker's voice. */
  /** The grid typing chirps keep to on the audio clock (src/audio/blip_clock.ts). */
  private blipGrid: BlipGrid | null = null;

  /** A typing chirp, its letter typed at game time `at` (Dialogue): it follows the last by the game time between them. */
  blip(pitch: number, at?: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let t = this.ctx.currentTime + BLIP_SOONEST;
    if (at !== undefined) ({ start: t, grid: this.blipGrid } = placeBlip(this.blipGrid, this.ctx.currentTime, at));
    const styled = this.styled?.voice(pitch);
    if (styled) return this.buffer(styled, t);
    // Not in yet, or never to be: the line types silent, unless the address asks for the first draft's blip.
    if (!(this.styled ? this.styled.voiceDraft(pitch) : this.draftOnly)) return;
    this.tone('square', pitch * (0.95 + Math.random() * 0.1), pitch, t, 0.035, 0.07);
  }

  private musicShare = 0;

  /** Updated from the map before starting its music and as its leader walks; battle movement does not steer it. */
  setMusicShare(share: number): void {
    this.musicShare = share;
    this.loop?.bridge?.setShare(share);
  }

  private stepDuration(): number {
    const bpm = (this.trackName && this.styled?.musicBpm(this.trackName)) || this.track!.bpm;
    return 60 / bpm / 4;
  }

  /** A selected style may still be loading, or may have failed: follow the buffer or draft notes actually playing. */
  private playingStepDuration(): number {
    return this.loop?.stepDur ?? 60 / this.track!.bpm / 4;
  }

  /** The title mosaic owns this fade on the game clock, including frame rounding and sideways pauses. */
  fadeTitle(progress: number): void {
    if (this.trackName !== 'title' || !this.ctx) return;
    const gain = this.musicFade.gain, now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(1 - Math.max(0, Math.min(1, progress)), now);
  }

  music(name: string | null, options: boolean | { force?: boolean; resume?: boolean; fadeOut?: number; startAfter?: number; close?: boolean } = false): void {
    const { force = false, resume = false, fadeOut = 0, startAfter = 0, close = false } = typeof options === 'boolean' ? { force: options } : options;
    if (name === 'stop') name = null;
    if (!force && name === this.trackName) return;
    this.stopFading();
    const resumeStep = resume && name ? (this.musicPositions.get(name) ?? 0) : 0;
    if (this.trackName && this.track && this.ctx && !this.waitingForTitle) {
      const stepDur = this.playingStepDuration();
      // A track still waiting for its loop has not moved from where it was to start.
      // During a piece played after a fight, the loop has not started: it would go on from where it is to start.
      const position = this.waitingForLoop
        ? this.step
        : this.loop
          ? this.loop.intro && this.ctx.currentTime < this.loop.at
            ? this.loop.step
            : this.loop.step + (this.ctx.currentTime - this.loop.at) / stepDur
          : this.step + (this.ctx.currentTime - this.nextStepTime) / stepDur;
      // Use the audible clock, not the scheduler's look-ahead. Styles share this step numbering.
      this.musicPositions.set(this.trackName, Math.max(0, Math.ceil(position)));
    }
    if (this.ctx && this.trackName && Number.isFinite(fadeOut) && fadeOut > 0) this.fadeOutgoing(fadeOut, close);
    this.trackName = name;
    this.track = name ? (TRACKS[name] ?? null) : null;
    this.step = resumeStep;
    this.waitingForTitle = name === 'title';
    // While the game's style is still loading (a quick Continue), or could not be had at all, a track waits for it silent
    // as for its own loop.
    const unstyled = this.styled === null && !this.draftOnly;
    this.waitingForLoop = name !== null && name !== 'title' && this.track !== null && (unstyled || (this.styled?.pending(name) ?? false));
    this.resuming = resume;
    if (this.scheduler !== null) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
    this.stopLoop();
    const now = this.ctx?.currentTime ?? 0;
    // Schedule on the audio clock: a hidden tab suspends this delay along with its music, and a later selection
    // cancels it through the normal source/scheduler path. Never advance past the first notes while waiting.
    if (this.ctx) this.nextStepTime = now + Math.max(0.05, Number.isFinite(startAfter) ? startAfter : 0);
    // Back from a fight, a track with pieces for that plays one, then its loop; otherwise it resumes where it was.
    const intro = name !== null && resume ? this.startIntro(name) : null;
    if (this.ctx) {
      // Resuming mid-tune fades in. A piece starting on its bar starts a phrase of its own, so it starts at full level
      // (the owner, 2026-10-14: "during other fights we should still fade in, but since we're starting a new musical
      // phrase it should start a full level"); one with a pickup fades in over it ("Fade in might make more sense I
      // think with some lead in notes").
      const fade = resume && this.track !== null && (!intro || introLeadsIn(intro));
      const gain = this.musicFade.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(fade ? 0 : 1, now);
      if (fade) {
        gain.setValueAtTime(0, this.nextStepTime);
        gain.linearRampToValueAtTime(1, this.nextStepTime + 0.6);
      }
    }
    if (name && !intro) this.followStyle(name);
    // Nor when followStyle has just started a piece of the track's opening: the notes would double it.
    if (!this.track || !this.ctx || name === 'title' || this.waitingForLoop || this.loop) return;
    this.scheduler = window.setInterval(() => this.schedule(), 25);
  }

  /** Renders, in the game's style, the tracks the game may ask for next, so each starts at once when it is. */
  prepare(names: readonly string[]): void {
    this.ahead = names;
    this.styled?.prepare(names);
  }

  /**
   * Plays the game's sound in a style from now on: Console, or the first draft's for checks, with the address's
   * `sound` laid over it. The style loads and renders its effects and voices while the old one goes on playing, then
   * takes over; the track playing changes over once its loop is in, at the place it had reached. Resolves once the new
   * style is playing, with whether it is still the latest asked for.
   */
  async setStyle(style: string): Promise<boolean> {
    const n = ++this.styling;
    const asked = new URLSearchParams(location.search).get('sound');
    const fail = soundFail();
    // The first draft's sound needs none of the synthesizer, so it is not even loaded. If the synthesizer cannot load,
    // nothing plays, and the game is told (`problem`).
    let next: StyledSound | null = null;
    let draftOnly = style === 'draft' && !asked;
    let problem: SoundProblem | null = null;
    try {
      if (!draftOnly) {
        problem = 'load';
        const { styledFor } = await this.loadSynth(fail === 'import');
        // A newer style asked for while the synthesizer loaded wins, so this one starts no renders to throw away (the
        // constructor asks for Console, and a tool that then asks for the draft would otherwise render Console anyway).
        if (n !== this.styling) return false;
        problem = 'worker';
        next = styledFor(style, asked, this.voicePitches, fail !== null && STYLED_FAILS.includes(fail) ? fail as SoundFail : null);
        problem = null;
        draftOnly = next === null;
        if (next) next.onProblem = (p) => this.report(p);
        await next?.ready;
      }
    } catch (e) {
      console.error(e);
      next = null;
    }
    if (n !== this.styling) {
      next?.dispose();
      return false;
    }
    this.styled?.dispose();
    this.styled = next;
    this.draftOnly = draftOnly;
    this.styleLoaded = n;
    if (problem) this.report(problem);
    else if (next?.problem) this.report(next.problem);
    const styled = next;
    if (styled) styled.onPiece = (name, piece) => this.pieceIn(name, piece, styled);
    if (this.trackName) this.followStyle(this.trackName);
    next?.prepare(this.ahead);
    // Effects asked for meanwhile start now, that far into themselves; Revival's, rendered after the first track, once in.
    this.flushHeld();
    void next?.allEffects.then(() => { if (this.styled === next) this.flushHeld(); });
    return true;
  }

  /**
   * The synthesizer's code, asked for three times, two and then five seconds apart: a file that did not arrive (a dropped
   * connection) may on a second asking (the owner, 15 Nov: try the synthesizer again). One a newer release has taken off the
   * site never will; the game's mark offers a reload then. `?soundfail=import` asks for a file that is not there.
   */
  private async loadSynth(missing: boolean): Promise<typeof import('./styled.ts')> {
    let again: string | null = null;
    for (let tries = 0; ; tries++) {
      try {
        if (missing) return await import(/* @vite-ignore */ `${location.origin}/no_such_synthesizer.js`);
        return again ? await import(/* @vite-ignore */ again) as typeof import('./styled.ts') : await import('./styled.ts');
      } catch (e) {
        if (tries === 2) throw e;
        // Chromium keeps a module that did not arrive as failed and answers its address so again without asking the site;
        // WebKit and Firefox ask again (tools/network_cut_checks.ts, 15 Nov). The address its error names, with a query, is a
        // new one to it, and reaches the same code; its own imports resolve as before. With no address named, the same.
        const url = /https?:\/\/\S+?\.[jt]s\b/.exec(String(e))?.[0];
        again = url ? `${url}?again=${tries + 1}` : null;
        await new Promise((r) => window.setTimeout(r, tries ? 5000 : 2000));
      }
    }
  }

  /**
   * The next step of the track not yet under way, and when it plays: from the loop's start, or the notes' schedule.
   */
  private nextStep(ctx: AudioContext): { at: number; step: number } {
    const stepDur = this.playingStepDuration();
    const soon = ctx.currentTime + 0.02;
    if (this.loop) {
      const k = Math.max(0, Math.ceil((soon - this.loop.at) / stepDur));
      return { at: this.loop.at + k * stepDur, step: this.loop.step + k };
    }
    let at = this.nextStepTime;
    let step = this.step;
    while (at < soon) {
      at += stepDur;
      step++;
    }
    return { at, step };
  }

  /**
   * The track in the current style: its loop once rendered (at once if it was before), or the first draft's notes.
   * Either takes over at the playing source's next step not yet under way, then follows its own tempo from that step.
   * Most styles share a tempo; the bridge and Berlin have new Console tempos (music_tempos.ts).
   */
  private followStyle(name: string): void {
    if ((this.waitingForTitle || (this.waitingForLoop && !this.styled)) && this.styleLoaded !== this.styling) return;
    const ctx = this.ctx;
    const pending = this.styled?.track(name);
    if (!ctx || !this.track) return;
    if (!pending) {
      // The first draft's notes only where the address asks for them. Otherwise the track waits silent: its style could
      // not be had, and the game's mark says so (`problem`).
      if (!this.draftAsked('music', name)) return;
      if (this.loop || this.waitingForTitle || this.waitingForLoop) this.takeOver(ctx, null);
      return;
    }
    const styled = this.styled!;
    // A long track's opening plays in pieces while its loop renders (openings.ts): one already in starts at once.
    const piece = styled.piece(name);
    if (piece) this.pieceIn(name, piece, styled);
    void pending.then(
      (b) => {
        if (this.trackName !== name || this.ctx !== ctx || this.styled !== styled || !this.track || this.loop?.src.buffer === b) return;
        if (this.loop?.piece) this.handOver(ctx, b, true);
        else this.takeOver(ctx, b);
      },
      // A render failed for good (styled.ts tried it again first): the track waits silent, and the game's mark says so.
      () => undefined,
    );
  }

  /**
   * A piece of a long track's opening has come in (styled.ts, openings.ts). While the track waits for its loop, the piece
   * plays from where the track starts, if it reaches a second past that; while a shorter piece plays, the longer one
   * takes over.
   */
  private pieceIn(name: string, piece: Piece, styled: StyledSound): void {
    const ctx = this.ctx;
    if (!ctx || this.styled !== styled || this.trackName !== name || !this.track || this.waitingForTitle) return;
    const stepDur = this.stepDuration();
    if (this.waitingForLoop) {
      if (this.step * stepDur < piece.seconds - 1) this.takeOver(ctx, piece.buffer, piece);
    } else if (this.loop?.piece && piece.seconds > this.loop.piece.seconds) this.handOver(ctx, piece.buffer, false, piece);
  }

  /**
   * Hands a playing piece of a track's opening over to a longer piece, or to the whole loop past its seam, at the same
   * moment in the music. They are the same render, so the one stops and the other starts on the same frame, through the
   * same gain, with no fade: a fade's overlap would swell the music. Too late for that, it switches on the piece's last
   * frame; if even that has passed, the piece's end hands over (`watchPiece`).
   */
  private handOver(ctx: AudioContext, b: AudioBuffer, whole: boolean, piece?: Piece): void {
    const cur = this.loop!;
    const stepDur = cur.stepDur;
    const posAt = (t: number) => cur.step * stepDur + (t - cur.at);
    let at = Math.max(ctx.currentTime + 0.1, cur.at);
    if (whole && posAt(at) < cur.piece!.seam) at += cur.piece!.seam - posAt(at);
    if (posAt(at) > cur.piece!.seconds) {
      // Where the piece playing runs out: from the whole frame it started on.
      const end = cur.at + (cur.piece!.seconds - onFrame(cur.step * stepDur, cur.src.buffer!.sampleRate));
      if (end < ctx.currentTime + 0.01) return;
      at = end;
    }
    at = fromFrame(at, ctx.sampleRate);
    const pos = posAt(at);
    // The fade a piece about to run out put on the gain (watchPiece) comes off: the music goes on.
    cur.gain.gain.cancelScheduledValues(at);
    cur.gain.gain.setValueAtTime(1, at);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = whole;
    src.connect(cur.bridge?.input ?? cur.gain);
    src.start(at, onFrame(pos % b.duration, b.sampleRate));
    cur.src.stop(at);
    this.loop = { src, gain: cur.gain, bridge: cur.bridge, at, step: pos / stepDur, stepDur, ...(piece ? { piece: { seconds: piece.seconds, seam: piece.seam } } : {}) };
    if (piece) this.watchPiece(ctx, src);
  }

  /**
   * A piece that plays to its end before more of its track is in: a quarter of a second before its end, with nothing to
   * take over, it fades over its last 30 ms (it stops mid-music, and would click); at its end the track waits there,
   * as for its loop, and goes on from that place.
   */
  private watchPiece(ctx: AudioContext, src: AudioBufferSourceNode): void {
    const loop = this.loop!;
    const end = loop.at + (loop.piece!.seconds - loop.step * loop.stepDur);
    window.setTimeout(() => {
      if (this.loop?.src !== src || this.ctx !== ctx) return;
      const g = loop.gain.gain;
      g.cancelScheduledValues(end - 0.03);
      g.setValueAtTime(1, end - 0.03);
      g.linearRampToValueAtTime(0, end);
    }, Math.max(0, (end - ctx.currentTime - 0.25) * 1000));
    src.onended = () => {
      const loop = this.loop;
      if (loop?.src !== src || this.ctx !== ctx || !this.track || !this.trackName) return;
      this.step = loop.piece!.seconds / loop.stepDur;
      this.loop = null;
      this.waitingForLoop = true;
      this.resuming = false;
      this.followStyle(this.trackName);
    };
  }

  /**
   * After a fight, a track with pieces for that (intros.ts) plays the one for how far through its map the player is
   * (`introProgress`, `introFor`), and its loop goes on from step `entry` on the frame the piece's last bar ends, both
   * through one gain: the loop is the same buffer as ever, and the piece's last notes ring on into it. Both start on
   * whole frames (`introPlan`). Until the loop and the pieces are rendered (and in the first draft's sound), the track
   * resumes where it was, as any other. Returns the piece it plays.
   */
  private startIntro(name: string): Intro | null {
    const ctx = this.ctx;
    const set = INTROS[name];
    const styled = this.styled;
    if (!ctx || !set || !this.track || !styled) return null;
    // Asked for, as followStyle asks, so the cache keeps it as the track playing.
    if (!styled.track(name)) return null;
    const rendered = styled.introsFor(name);
    if (!rendered) return null;
    const progress = this.introProgress(name) ?? { done: 0, total: 0 };
    const i = introFor(rendered.pieces.length, progress.done, progress.total, this.lastIntro.get(name));
    const stepDur = this.stepDuration();
    const plan = introPlan(this.nextStepTime, ctx.sampleRate, stepDur, introSteps(set.pieces[i]!), set.entry, rendered.loop.sampleRate);
    const gain = ctx.createGain();
    // In over a few milliseconds, as takeOver brings in a loop.
    gain.gain.setValueAtTime(0, plan.at);
    gain.gain.linearRampToValueAtTime(1, plan.at + 0.01);
    gain.connect(this.musicFade);
    const intro = ctx.createBufferSource();
    intro.buffer = rendered.pieces[i]!;
    intro.connect(gain);
    intro.start(plan.at);
    const src = ctx.createBufferSource();
    src.buffer = rendered.loop;
    src.loop = true;
    src.connect(gain);
    src.start(plan.loopAt, plan.offset);
    this.waitingForLoop = false;
    this.loop = { src, gain, at: plan.loopAt, step: set.entry, stepDur, intro };
    this.lastIntro.set(name, { i, done: progress.total > 0 && progress.done >= progress.total });
    return set.pieces[i]!;
  }

  /** Changes over to a loop, or back to the notes, at the next step. With `piece`, a piece of the track's opening. */
  private takeOver(ctx: AudioContext, b: AudioBuffer | null, piece?: Piece): void {
    const stepDur = b ? this.stepDuration() : 60 / this.track!.bpm / 4;
    // A track that waited starts when ready, respecting a requested future start, from its first step or resume point.
    const waited = this.waitingForTitle || this.waitingForLoop;
    const next = waited ? { at: Math.max(ctx.currentTime + 0.05, this.nextStepTime), step: this.waitingForTitle ? 0 : this.step } : this.nextStep(ctx);
    // A buffer starts on a whole frame; the notes keep the step's own time.
    const { at, step } = { at: b ? fromFrame(next.at, ctx.sampleRate) : next.at, step: next.step };
    if (this.waitingForLoop && this.resuming) {
      const gain = this.musicFade.gain;
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(0, at);
      gain.linearRampToValueAtTime(1, at + 0.6);
    }
    this.waitingForTitle = false;
    this.waitingForLoop = false;
    if (this.scheduler !== null) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
    this.stopLoop(at);
    if (!b) {
      this.nextStepTime = at;
      this.step = step;
      this.scheduler = window.setInterval(() => this.schedule(), 25);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = !piece;
    // A track with an opening goes round to its `loopFrom`: its last frame, less the loop's whole frames.
    const track = this.track!;
    const from = piece ? undefined : track.loopFrom;
    if (from !== undefined) {
      src.loopStart = (b.length - Math.round((track.channels[0]!.notes.length - from) * stepDur * b.sampleRate)) / b.sampleRate;
      src.loopEnd = b.duration;
    }
    const gain = ctx.createGain();
    // In over a few milliseconds, as what it replaces goes, so neither clicks.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + 0.01);
    gain.connect(this.musicFade);
    const bridge = this.trackName && this.styled?.isBridge(this.trackName) && b.numberOfChannels === 2
      ? new BridgeMix(ctx, gain, this.musicShare) : undefined;
    src.connect(bridge?.input ?? gain);
    src.start(at, onFrame(from === undefined ? (step * stepDur) % b.duration : stepInLoop(track, step) * stepDur, b.sampleRate));
    this.loop = { src, gain, at, step, stepDur, bridge, ...(piece ? { piece: { seconds: piece.seconds, seam: piece.seam } } : {}) };
    if (piece) this.watchPiece(ctx, src);
  }

  /** Fade only the already-playing source through its existing gain, leaving the incoming graph untouched. */
  /** `close`: a filter closes over the fade too, so the drums' hiss goes first (New Game's dive from the title). */
  private fadeOutgoing(seconds: number, close = false): void {
    const ctx = this.ctx!;
    const loop = this.loop;
    const destination = loop?.gain ?? this.draftMusicGains.get(this.trackName!);
    if (!destination) return;
    const now = ctx.currentTime;
    const level = destination.gain.value;
    const start = level * this.musicFade.gain.value;
    if (!loop) this.fadedDraftLevels.set(this.trackName!, level);
    destination.gain.cancelScheduledValues(now);
    destination.gain.setValueAtTime(start, now);
    destination.gain.linearRampToValueAtTime(0, now + seconds);
    // Only on a style's loop gain, made for this loop and dropped with it (the draft's gains are kept per track).
    if (close && loop) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(18000, now);
      lp.frequency.exponentialRampToValueAtTime(250, now + seconds);
      destination.disconnect();
      destination.connect(lp);
      lp.connect(this.musicFade);
    }
    this.fading = { gain: destination, src: loop?.src, intro: loop?.intro };
    this.loop = null;
    loop?.src.stop(now + seconds + 0.01);
    loop?.intro?.stop(now + seconds + 0.01);
  }

  /** A newer track replaces the whole transition, including the source already fading out. */
  private stopFading(): void {
    const fading = this.fading;
    this.fading = null;
    if (!fading) return;
    try {
      const now = fading.gain.context.currentTime;
      const gain = fading.gain.gain;
      const level = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(level, now);
      gain.linearRampToValueAtTime(0, now + 0.03);
      fading.src?.stop(now + 0.04);
      fading.intro?.stop(now + 0.04);
    } catch {
      /* its context is closed already */
    }
  }

  /** Fades the loop out from `from` (now, if not given), so it does not click off. */
  private stopLoop(from?: number): void {
    const loop = this.loop;
    this.loop = null;
    if (!loop) return;
    try {
      const now = loop.gain.context.currentTime;
      // Cancel a future loop before it can start, rather than leaving a burst at its handover time. Its shared gain
      // may still carry an opening or fight-return intro already playing, so keep that gain's normal handover fade.
      const pending = loop.at > now;
      if (pending) loop.src.stop(now);
      const at = Math.max(from ?? 0, now);
      loop.gain.gain.cancelScheduledValues(at);
      loop.gain.gain.setValueAtTime(1, at);
      loop.gain.gain.linearRampToValueAtTime(0, at + 0.03);
      if (!pending) loop.src.stop(at + 0.04);
      loop.intro?.stop(at + 0.04);
    } catch {
      /* its context is closed already */
    }
  }

  get currentMusic(): string | null {
    return this.trackName;
  }

  /** The title's music is asked for but cannot start yet: its loop is still rendering, or there is no sound at all. Leaving
   * the map title waits meanwhile (game.ts, playUnderTitle), so New Game never starts the dive before the music it fades from. */
  get titleMusicWaiting(): boolean {
    // With the sound failed (`problem`), there is nothing to wait for.
    return this.trackName === 'title' && !this.problem && (this.waitingForTitle || !this.ctx);
  }

  /** Fractional quarter-note position of the named song actually playing, or null while it is inaudible.
   * Read the source's audio clock, never the game clock or the scheduler's next (look-ahead) note. */
  musicBeat(name: string): number | null {
    const ctx = this.ctx;
    if (this.trackName !== name || !this.track || !ctx || ctx.state !== 'running' || this.stale || this.muted
      || this.settings.music <= 0 || this.musicGain.gain.value <= 0 || this.musicFade.gain.value <= 0
      || this.waitingForTitle || this.waitingForLoop) return null;
    const loop = this.loop;
    if (loop) {
      if (ctx.currentTime < loop.at || loop.gain.gain.value <= 0) return null;
      return (loop.step + (ctx.currentTime - loop.at) / loop.stepDur) / 4;
    }
    if (this.scheduler === null) return null;
    const position = this.step + (ctx.currentTime - this.nextStepTime) / this.playingStepDuration();
    return position < 0 ? null : position / 4;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const track = this.track;
    if (!ctx || !track || ctx.state !== 'running') return;
    let destination = this.draftMusicGains.get(this.trackName!);
    if (!destination) {
      destination = ctx.createGain();
      destination.gain.value = musicLevelGain('draft', this.trackName!);
      destination.connect(this.musicFade);
      this.draftMusicGains.set(this.trackName!, destination);
    }
    // A later visit reuses the same cached destination at its original fixed level.
    const level = this.fadedDraftLevels?.get(this.trackName!);
    if (level !== undefined) {
      destination.gain.cancelScheduledValues(ctx.currentTime);
      destination.gain.setValueAtTime(level, ctx.currentTime);
      this.fadedDraftLevels.delete(this.trackName!);
    }
    const stepDur = 60 / track.bpm / 4;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      const step = stepInLoop(track, this.step);
      for (const ch of track.channels) {
        const note = ch.notes[step % ch.notes.length];
        if (note === undefined || note === null) continue;
        const t = this.nextStepTime;
        const dur = stepDur * lengthAt(ch, step % ch.notes.length) * 0.95;
        if (ch.wave === 'noise') this.hiss(t, Math.min(dur, 0.08), ch.volume, note > 0 ? note : 6000, destination);
        else this.tone(ch.wave, note, note, t, dur, ch.volume, destination);
      }
      this.step++;
      this.nextStepTime += stepDur;
    }
  }
}
