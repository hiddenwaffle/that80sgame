import { INTROS } from './intros.ts';
import { openingFor } from './openings.ts';
import { CONSOLE_TEMPOS } from './music_tempos.ts';
import { PITCHES, allDraft, choiceFor, speakerOf, styleFor, type SoundChoice } from './synth/choice.ts';
import { SFX_NAMES } from './synth/style_names.ts';
import { SR } from './synth/dsp.ts';
import type { GameJob, GameResult } from './synth/gameWorker.ts';
import GameWorker from './synth/gameWorker.ts?worker&inline';

/**
 * Tracks kept once rendered: a long loop is tens of megabytes, so only the last few asked for, with room beside them for
 * those rendered ahead of the next fight or map (2026-10-12; four before).
 */
const KEEP_TRACKS = 6;

/**
 * Effects too slow to hold up the start, rendered first of the renders ahead instead, after the track playing: Revival's
 * choir and sparkles ring for seconds in a big room, three quarters of all the effects' rendering on their own
 * (2026-10-16). Nothing plays them in the first seconds; one asked for before it is in waits for it (audio.ts).
 */
const LATER_SFX = new Set(['revival']);

/** Renders that take long enough that a track asked for now should not wait behind one: tracks, and the later effects. */
const slow = (job: GameJob): boolean => job.kind === 'music' || LATER_SFX.has(job.name);

/**
 * How many times a main worker that fails to load or dies is made again, the new one taking its render and those waiting,
 * before the sound is given up for this visit (the owner, 15 Nov: retry the synthesizer rather than play the first draft's,
 * which "sound terrible"). A render that was under way in two workers that died is the cause, not the workers: it fails
 * alone, and the rest go on.
 */
const RESTARTS = 3;

/**
 * What went wrong with the sound for good, for the mark the game shows and the reload it offers: the synthesizer did not
 * arrive, its workers kept failing, a render failed twice, a render found no room on the page, or the browser refused sound.
 */
export type SoundProblem = 'load' | 'worker' | 'render' | 'memory' | 'refused';

/**
 * Failures made on purpose, in developer mode, for the checks (`?soundfail=`): every worker failing to start, the first
 * render's worker dying, every render failing, or each render failing once.
 */
export type SoundFail = 'worker' | 'crash' | 'render' | 'render_once';

/**
 * A render waiting for a worker, or under way in one; `track` is the music it is for, and `asked` the asking for it that
 * made it (`renderTrack`): a track let go (`trim`) and asked for again is asked anew. `deaths` counts the workers that died
 * under it, and `retried` whether a worker that could not make it has been asked again.
 */
interface Job {
  job: GameJob;
  track: string | null;
  asked: object | null;
  done: (r: GameResult) => void;
  deaths: number;
  retried: boolean;
}

/** A worker of the synthesizer's, and the render under way in it. */
interface Renderer {
  worker: Worker;
  busy: Job | null;
}

/** A piece of a long track's opening, which plays while its whole loop renders (openings.ts). */
export interface Piece {
  seconds: number;
  /** The loop's first seconds, which carry its end's folded tail: the loop takes over from a piece only past them. */
  seam: number;
  buffer: AudioBuffer;
}

/**
 * The game's sound in a style (see synth/choice.ts). The synthesizer renders off the page's thread, every effect and
 * voice at once (the slowest effects once the track playing is in) and each track when it is first asked for; until a
 * sound is in, nothing plays in its place. The renders wait here and go to the worker one at a time, so the track asked
 * for now goes ahead of them all. A render under way cannot be stopped short; if it is long and for something else, a
 * second worker renders the track beside it, and that one's render for music no longer asked for is stopped, to render
 * again later (2026-10-16; the owner, of the bridge's music waiting for Beijing's: "It would be cool if for any map
 * change it immediately repriortizes the 5 seconds of music if it has not already been rendered"). The buffers belong
 * to no audio context, so they outlive one rebuilt after the phone sleeps.
 */
export class StyledSound {
  /** The worker renders go to first; made again when it fails (`lostMain`). */
  private main: Renderer;
  /** The second worker, while it renders music asked for (it finishes a render begun before the music changed); null otherwise. */
  private helper: Renderer | null = null;
  private helperFailed = false;
  /** Renders not yet given to a worker, the track asked for now's first. */
  private readonly queue: Job[] = [];
  /** Each loop's gain, sent back with it, for the pieces it plays after a fight (forGame.ts `renderIntros`). */
  private readonly gains = new Map<string, number>();
  /** Each kept track's asking (see `Job`). */
  private readonly asked = new Map<string, object>();
  private nextId = 1;
  private readonly effects = new Map<string, AudioBuffer>();
  /** Each pitch's takes once rendered; null while rendering or when voices are the first draft's. */
  private readonly voices = new Map<number, AudioBuffer[] | null>();
  private take = 0;
  private readonly tracks = new Map<string, Promise<AudioBuffer>>();
  /** How long each render took in the worker (for the checks). */
  readonly times: Array<{ what: string; ms: number }> = [];
  /** Every effect but the later ones (`LATER_SFX`) and the script's voices made. */
  readonly ready: Promise<void>;
  /** Every effect made, the later ones too. */
  readonly allEffects: Promise<void>;
  private readonly laterSfx: string[];
  private laterDone!: () => void;
  readonly choice: SoundChoice;

  /** What has gone wrong with the sound for good, the first thing if more than one (see `SoundProblem`); null while all is well. */
  problem: SoundProblem | null = null;
  /** Told each time something goes wrong for good. */
  onProblem: ((p: SoundProblem) => void) | null = null;
  private readonly fail: SoundFail | null;
  private restarts = 0;
  private crashed = false;

  /** `voices`: the script's typing pitches, rendered with the effects, before any track, as `PITCHES` are. */
  constructor(choice: SoundChoice, voices: readonly number[] = [], fail: SoundFail | null = null) {
    this.choice = choice;
    this.fail = fail;
    // A worker that fails to load, or dies (out of memory on a phone during a long render), is made again (`lostMain`).
    this.main = this.spawn((r) => this.lostMain(r));
    const effects = SFX_NAMES.filter((name) => !LATER_SFX.has(name)).map((name) => {
      const style = styleFor(choice, 'sfx', name);
      return style && this.render({ style, kind: 'sfx', name }).then(([b]) => void this.effects.set(name, b!), (e: Error) => void (this.disposed || this.broken || console.error(e.message)));
    });
    this.ready = Promise.all([...effects, ...[...new Set([...PITCHES, ...voices])].map((p) => this.prepareVoice(p))]).then(() => undefined);
    this.laterSfx = SFX_NAMES.filter((name) => LATER_SFX.has(name) && styleFor(choice, 'sfx', name));
    const later = new Promise<void>((resolve) => { this.laterDone = resolve; });
    if (!this.laterSfx.length) this.laterDone();
    this.allEffects = Promise.all([this.ready, later]).then(() => undefined);
  }

  /** Stops the worker; what was rendered stays playable. */
  dispose(): void {
    this.disposed = true;
    this.queued = [];
    this.laterSfx.length = 0;
    this.laterDone();
    const stopped = [this.main.busy, this.helper?.busy, ...this.queue.splice(0)];
    this.main.worker.terminate();
    this.helper?.worker.terminate();
    this.main.busy = null;
    this.helper = null;
    for (const job of stopped) job?.done({ id: 0, error: 'stopped' });
  }

  private spawn(failed: (r: Renderer) => void): Renderer {
    // The built site keeps the worker's code in this file and starts each worker from memory (Vite's `?worker&inline`), so a
    // helper or a worker made again fetches nothing, and a release that replaced the site meanwhile cannot take it away (the
    // owner, 15 Nov: "we embed the async code into the index.js and feed it to the worker as a blob when it needs it"). The dev
    // server still serves it as a file of its own.
    const worker = this.fail === 'worker'
      ? new Worker(new URL('/no_such_sound_worker.js', location.href), { type: 'module' })
      : new GameWorker({ name: 'sound_worker' });
    const r: Renderer = { worker, busy: null };
    r.worker.onmessage = (e: MessageEvent<GameResult>) => {
      const job = r.busy;
      if (job?.job.id !== e.data.id) return;
      r.busy = null;
      try {
        job.done(e.data);
      } finally {
        this.pump();
      }
    };
    r.worker.onerror = () => failed(r);
    return r;
  }

  private render(job: Omit<GameJob, 'id'>, asked: object | null = null): Promise<AudioBuffer[]> {
    // Asked for once this style is let go (a step already on its way): settled as stopped, not left waiting.
    if (this.disposed) return Promise.reject(new Error('stopped'));
    if (this.broken) return Promise.reject(new Error('the sound worker failed'));
    return new Promise((resolve, reject) => {
      const queued: Job = {
        job: { ...job, id: this.nextId++ },
        track: job.kind === 'music' ? job.name : null,
        asked,
        deaths: 0,
        retried: false,
        done: (r) => {
          if ('error' in r) {
            // A render the worker could not make is asked for once more, in its place in the queue.
            if (r.id !== 0 && !queued.retried && !this.disposed) {
              queued.retried = true;
              queued.job = { ...queued.job, id: this.nextId++ };
              this.queue.splice(this.isCurrent(queued) ? this.leading() : this.queue.length, 0, queued);
              return;
            }
            // Stopped with the style, or let go with its track: nothing wrong.
            if (r.error !== 'stopped' && r.error !== 'let go') this.report(r.id === 0 ? 'worker' : 'render');
            return reject(new Error(r.error));
          }
          if (r.gain !== undefined) this.gains.set(`${job.style} ${job.name}`, r.gain);
          this.times.push({ what: `${job.style} ${job.kind} ${job.name}${job.until === undefined ? '' : ` (its first ${job.until} s)`}${job.intros ? ' (its intros)' : ''}`, ms: r.ms });
          try {
            resolve(
              r.takes.map((channels) => {
                // One channel plays on both sides.
                const b = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0]!.length, sampleRate: SR });
                channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
                return b;
              }),
            );
          } catch (e) {
            // No room on the page for it (a phone short of memory): it fails, and the game says so.
            this.report('memory');
            reject(e as Error);
          }
        },
      };
      // The track asked for now's renders go first, in the order asked for; any other's go last.
      if (this.isCurrent(queued)) this.queue.splice(this.leading(), 0, queued);
      else this.queue.push(queued);
      this.pump();
    });
  }

  private isCurrent(j: Job): boolean {
    return j.track !== null && j.track === this.current;
  }

  /** How many renders at the queue's head are the track asked for now's. */
  private leading(): number {
    const i = this.queue.findIndex((j) => !this.isCurrent(j));
    return i < 0 ? this.queue.length : i;
  }

  /**
   * A render taken back from a worker: first if it is the track asked for now's, otherwise right after that's. One for a
   * track let go since is dropped, as `trim` drops those waiting; unless its track is asked for again now, when it is
   * rendered still, so the music waiting for it is not left silent.
   */
  private giveBack(job: Job): void {
    if (job.asked && this.asked.get(job.track!) !== job.asked && !this.isCurrent(job)) return job.done({ id: 0, error: 'let go' });
    this.queue.splice(this.isCurrent(job) ? 0 : this.leading(), 0, job);
  }

  /** The track asked for now's renders waiting go ahead of every other, in the order they were asked for. */
  private promote(name: string): void {
    const first = this.queue.filter((j) => j.track === name);
    if (first.length) this.queue.splice(0, this.queue.length, ...first, ...this.queue.filter((j) => j.track !== name));
    this.pump();
  }

  /**
   * Whether the second worker may take a render: the track asked for now's, but not a long track's whole loop, whose
   * opening's pieces play while it waits; so two of those, the largest renders, never run at once on a phone.
   */
  private forHelper(j: Job | undefined): j is Job {
    return j !== undefined && this.isCurrent(j) && !(j.job.style === 'console' && openingFor(j.track!) && j.job.until === undefined);
  }

  /**
   * Whether the main worker's render keeps the track asked for now's next waiting long: a long one for something else,
   * or a longer one of the same track's (its 30 s piece or its loop) while an earlier piece waits, given back after a
   * visit elsewhere (Codex's review, 2026-10-16).
   */
  private holdsUp(busy: Job, next: Job): boolean {
    if (!this.isCurrent(busy)) return slow(busy.job);
    return next.job.until !== undefined && (busy.job.until === undefined || busy.job.until > next.job.until);
  }

  /**
   * Gives the next render waiting to the main worker once it is free. The track asked for now does not wait while that
   * worker is busy with a long render (`holdsUp`): the second worker takes it beside that, and is let go once it has
   * none of the track's left to take. Its own render, if for music no longer asked for, is stopped and waits again
   * behind the track's. One that fails to load gives its render back to the main worker.
   */
  private pump(): void {
    if (this.disposed) return;
    if (!this.broken && !this.main.busy && this.queue.length) this.send(this.main, this.queue.shift()!);
    const first = this.queue[0], busy = this.main.busy;
    const blocked = !this.broken && !this.helperFailed && this.forHelper(first) && busy !== null && this.holdsUp(busy, first);
    const old = this.helper;
    if (blocked && old?.busy && !this.isCurrent(old.busy)) {
      old.worker.terminate();
      this.helper = null;
      this.giveBack(old.busy);
      old.busy = null;
    }
    if (blocked && !this.helper) {
      try {
        this.helper = this.spawn((r) => this.lostHelper(r));
      } catch {
        // A browser that will not make a second worker at all: the main worker renders everything in turn, as before
        // (Astra's review, 2026-10-16).
        this.helperFailed = true;
      }
    }
    if (blocked && this.helper) {
      if (!this.helper.busy) this.send(this.helper, this.queue.shift()!);
    } else if (this.helper && !this.helper.busy) {
      this.helper.worker.terminate();
      this.helper = null;
    }
  }

  /**
   * The main worker failed to load or died. Up to `RESTARTS` times a new one takes over its render (unless that render was
   * under way in a worker that died before, when it fails alone) and those waiting. After that, or once the browser will make
   * no more, every render fails and the game is told, rather than waiting for ever.
   */
  private lostMain(r: Renderer): void {
    if (this.main !== r || this.disposed || this.broken) return;
    r.worker.terminate();
    const job = r.busy;
    r.busy = null;
    if (job && ++job.deaths >= 2) job.done({ id: 0, error: 'the sound worker failed' });
    else if (job) this.giveBack(job);
    if (this.restarts < RESTARTS) {
      this.restarts++;
      try {
        this.main = this.spawn((w) => this.lostMain(w));
        this.pump();
        return;
      } catch {
        // A browser that will make no more workers: given up below.
      }
    }
    this.broken = true;
    for (const j of this.queue.splice(0)) j.done({ id: 0, error: 'the sound worker failed' });
    this.report('worker');
  }

  /** Something has gone wrong with the sound for good; the first thing is the one kept. Nothing is wrong once it is let go. */
  private report(p: SoundProblem): void {
    if (this.disposed) return;
    this.problem ??= p;
    this.onProblem?.(p);
  }

  /** Whether the address asks for the first draft's sound for this one (`?sound=draft`, or one kind of it), rather than a style's. */
  chosenDraft(kind: 'sfx' | 'music', name: string): boolean {
    return styleFor(this.choice, kind, name) === null;
  }

  /** Whether the address asks for the first draft's typing sound at this pitch. */
  voiceDraft(pitch: number): boolean {
    return styleFor(this.choice, 'voice', speakerOf(pitch)) === null;
  }

  /** The second worker failed to load or died: its render goes back to the main worker, and no second one is made again. */
  private lostHelper(r: Renderer): void {
    this.helperFailed = true;
    r.worker.terminate();
    if (this.helper === r) this.helper = null;
    const job = r.busy;
    r.busy = null;
    // With the main worker gone too, nothing is left to render it.
    if (job && this.broken) job.done({ id: 0, error: 'the sound worker failed' });
    else if (job) this.giveBack(job);
    this.pump();
  }

  private send(r: Renderer, job: Job): void {
    r.busy = job;
    // The failures asked for on purpose (`SoundFail`): the first render's worker dies once; renders fail always, or first time.
    const crash = this.fail === 'crash' && !this.crashed && r === this.main;
    if (crash) this.crashed = true;
    const fail = crash ? 'crash' : this.fail === 'render' || (this.fail === 'render_once' && !job.retried) ? 'render' : undefined;
    r.worker.postMessage(fail ? { ...job.job, fail } : job.job);
  }

  private prepareVoice(pitch: number): Promise<void> | null {
    this.voices.set(pitch, null);
    const speaker = speakerOf(pitch);
    const style = styleFor(this.choice, 'voice', speaker);
    if (!style) return null;
    return this.render({ style, kind: 'voice', name: speaker, pitch }).then(
      (takes) => void this.voices.set(pitch, takes),
      (e: Error) => void (this.disposed || this.broken || console.error(e.message)),
    );
  }

  /** An effect in the style, or null while it is not in (or is the first draft's, as the address asks). */
  sfx(name: string): AudioBuffer | null {
    return this.effects.get(name) ?? null;
  }

  /** The next take of a voice in the style, or null while it is not in (or is the first draft's, as the address asks). */
  voice(pitch: number): AudioBuffer | null {
    if (!this.voices.has(pitch)) void this.prepareVoice(pitch);
    const takes = this.voices.get(pitch);
    return takes ? takes[this.take++ % takes.length]! : null;
  }

  /** A track's loop in the style, once rendered, or null when the track is the first draft's. */
  track(name: string): Promise<AudioBuffer> | null {
    const style = styleFor(this.choice, 'music', name);
    if (!style) return null;
    // Asked for now: out of the queue rendered ahead, and its renders go first (see `pump`).
    this.queued = this.queued.filter((n) => n !== name);
    this.current = name;
    let p = this.tracks.get(name);
    if (p) {
      this.tracks.delete(name);
      this.promote(name);
    } else p = this.renderTrack(name, style);
    // The most recent last; the oldest let go, never the one asked for last.
    this.tracks.set(name, p);
    this.trim();
    return p;
  }

  /** The bridge's Console buffer carries two synchronized mono ends, split and mixed by position during playback. */
  isBridge(name: string): boolean {
    return name === 'border' && styleFor(this.choice, 'music', name) === 'console';
  }

  /** The selected arrangement's tempo; undefined keeps the draft track's tempo. Playing sources retain their own. */
  musicBpm(name: string): number | undefined {
    return styleFor(this.choice, 'music', name) === 'console' ? CONSOLE_TEMPOS[name] : undefined;
  }

  /** Called as a piece of a long track's opening comes in longer than any before it (openings.ts). */
  onPiece: ((name: string, piece: Piece) => void) | null = null;
  private readonly pieces = new Map<string, Piece[]>();

  /** The longest piece of a track's opening that is in, while its whole loop is not. */
  piece(name: string): Piece | null {
    return this.done.has(name) ? null : (this.pieces.get(name)?.at(-1) ?? null);
  }

  /** Each track's loop once in, and the pieces it plays after a fight (intros.ts) once in. */
  private readonly loops = new Map<string, AudioBuffer>();
  private readonly introPieces = new Map<string, AudioBuffer[]>();

  /** A track's loop and the pieces it plays after a fight, once both are in; null before, or for a track with none. */
  introsFor(name: string): { loop: AudioBuffer; pieces: AudioBuffer[] } | null {
    const loop = this.loops.get(name);
    const pieces = this.introPieces.get(name);
    return this.done.has(name) && loop && pieces ? { loop, pieces } : null;
  }

  /** Whether a track is played in the style but its loop is not in yet, so starting it now would mean waiting. */
  pending(name: string): boolean {
    return styleFor(this.choice, 'music', name) !== null && !this.done.has(name);
  }

  /**
   * Renders tracks that may be asked for next (the map's fights, scripted music and neighbours), in the order given and
   * one at a time, after the later effects; a track asked for meanwhile goes ahead of them (see `pump`). Ones already
   * kept stay kept; a new list replaces the old one's renders not yet begun.
   */
  prepare(names: readonly string[]): void {
    this.wanted = new Set(names.filter((n) => styleFor(this.choice, 'music', n) !== null));
    for (const name of this.wanted) {
      const p = this.tracks.get(name);
      if (!p) continue;
      this.tracks.delete(name);
      this.tracks.set(name, p);
    }
    this.queued = [...this.wanted].filter((n) => !this.tracks.has(n));
    this.next();
  }

  private readonly done = new Set<string>();
  private current: string | null = null;
  /** The tracks asked to be ready next, kept over older ones; those of them not yet sent to the worker. */
  private wanted = new Set<string>();
  private queued: string[] = [];
  private aheadBusy = false;
  private disposed = false;
  private broken = false;

  private next(): void {
    if (this.aheadBusy || this.disposed) return;
    const effect = this.laterSfx.shift();
    if (effect !== undefined) {
      this.aheadBusy = true;
      void this.render({ style: styleFor(this.choice, 'sfx', effect)!, kind: 'sfx', name: effect })
        // Stopped on purpose when this style is let go: not an error.
        .then(([b]) => void this.effects.set(effect, b!), (e: Error) => void (this.disposed || this.broken || console.error(e.message)))
        .finally(() => {
          this.aheadBusy = false;
          if (!this.laterSfx.length) this.laterDone();
          this.next();
        });
      return;
    }
    const name = this.queued.shift();
    if (name === undefined) return;
    const style = styleFor(this.choice, 'music', name);
    if (!style || this.tracks.has(name)) return this.next();
    const p = this.renderTrack(name, style);
    this.tracks.set(name, p);
    this.trim();
    this.aheadBusy = true;
    void p.catch(() => undefined).finally(() => {
      this.aheadBusy = false;
      this.next();
    });
  }

  private renderTrack(name: string, style: string): Promise<AudioBuffer> {
    const asked = {};
    this.asked.set(name, asked);
    // A long track's opening first, in pieces, so the game can play it while the whole loop renders (openings.ts).
    const opening = style === 'console' ? openingFor(name) : undefined;
    if (opening) {
      const list: Piece[] = [];
      this.pieces.set(name, list);
      for (const seconds of opening.pieces) {
        this.render({ style, kind: 'music', name, until: seconds }, asked).then(([b]) => {
          // Two workers may finish them out of turn: a shorter piece in after a longer one is no use.
          if (this.pieces.get(name) !== list || this.done.has(name) || list.some((q) => q.seconds >= seconds)) return;
          const piece = { seconds, seam: opening.seam, buffer: b! };
          list.push(piece);
          this.onPiece?.(name, piece);
          // Stopped with this style, or with the track let go (`trim`): not an error.
        }, (e: Error) => void (this.disposed || this.pieces.get(name) !== list || this.broken || console.error(e.message)));
      }
    }
    const p: Promise<AudioBuffer> = this.render({ style, kind: 'music', name }, asked).then(
      ([b]) => {
        if (this.tracks.get(name) === p) {
          this.done.add(name);
          this.pieces.delete(name);
          this.loops.set(name, b!);
        }
        return b!;
      },
      (e: unknown) => {
        // No loop to hand over to: its pieces go too, so a later visit does not start a piece that nothing follows.
        if (this.tracks.get(name) === p) this.pieces.delete(name);
        throw e;
      },
    );
    // A render asked for ahead may fail with no one waiting on it; whoever asks for it later sees the failure.
    p.catch(() => undefined);
    // The pieces it plays after a fight, once its loop is in, at the loop's gain, which comes back with it: whichever
    // worker takes them then need not render the loop again for it. Until they are in, a return from a fight resumes
    // the loop where it was.
    if (style === 'console' && INTROS[name]) {
      p.then(() => {
        if (this.disposed || this.tracks.get(name) !== p) return;
        this.render({ style, kind: 'music', name, intros: true, gain: this.gains.get(`${style} ${name}`) }, asked).then(
          (pieces) => void (this.tracks.get(name) === p && this.introPieces.set(name, pieces)),
          (e: Error) => void (this.disposed || this.tracks.get(name) !== p || this.broken || console.error(e.message)),
        );
      }, () => undefined);
    }
    return p;
  }

  private trim(): void {
    while (this.tracks.size > KEEP_TRACKS) {
      // The oldest that is neither playing nor wanted next; failing that, the oldest not playing.
      const keys = [...this.tracks.keys()];
      const oldest = keys.find((k) => k !== this.current && !this.wanted.has(k)) ?? keys.find((k) => k !== this.current)!;
      this.tracks.delete(oldest);
      this.done.delete(oldest);
      this.pieces.delete(oldest);
      this.loops.delete(oldest);
      this.introPieces.delete(oldest);
      this.asked.delete(oldest);
      // Its renders still waiting go too: nothing waits for a track let go.
      const gone = this.queue.filter((j) => j.track === oldest);
      if (gone.length) this.queue.splice(0, this.queue.length, ...this.queue.filter((j) => j.track !== oldest));
      for (const job of gone) job.done({ id: 0, error: 'let go' });
    }
  }
}

/** The sound in a style, with the address's `sound` value laid over it; null when every sound is the first draft's. */
export function styledFor(style: string, asked: string | null, voices: readonly number[] = [], fail: SoundFail | null = null): StyledSound | null {
  const { choice, unknown } = choiceFor(style, asked);
  if (unknown.length) console.warn(`Sound: no style or kind is called ${unknown.join(', ')}`);
  return allDraft(choice) ? null : new StyledSound(choice, voices, fail);
}
