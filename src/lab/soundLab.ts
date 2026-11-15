/**
 * The sound page (`sound_lab.html`, served by the dev server only; the game's build leaves it out). Every effect, music
 * loop, and typing voice in the game's Console style beside the first draft's, each matched in loudness; Lyria's
 * reference clips for each place; and two short scenes that play music and effects together. It began as the page for
 * comparing the sketched styles; those were retired on 2026-10-13 and are kept, with this page as it was then, in
 * archive/sound_styles/. Lyria's clips are read from archive/sound/lyria/ (local, gitignored).
 */
import { TRACKS } from '../audio/music.ts';
import { SR, TARGET, loudness, normalize, type Mix } from '../audio/synth/dsp.ts';
import { SFX_NAMES } from '../audio/synth/draft.ts';
import { STYLES } from '../audio/synth/sketches.ts';
import type { RenderJob, RenderResult } from './soundWorker.ts';

type Kind = 'sfx' | 'music' | 'voice';

const EFFECTS: Record<string, string> = {
  blip: 'menu cursor (very frequent)',
  confirm: 'menu confirm',
  cancel: 'menu back',
  page: 'newspaper page turning',
  door: 'through a door, to a new map',
  buy: 'buying in a shop',
  waka: 'eating a dot (back to back)',
  pickup: 'picking up an item',
  fanfare: 'a special item',
  appear: 'something appears on the map',
  rest: 'resting at a save star',
  save: 'saving while walking past a star',
  heal: 'a heal in a fight',
  battle_start: 'a fight begins',
  hit: 'a hit on an enemy',
  miss: 'a miss',
  hurt: 'a hero hurt',
  defeat: 'an enemy beaten',
  a_star: 'A-star Maneuver, one stroke (five in a row)',
  a_star_flare: 'A-star Maneuver, the flare',
  cherry: 'Cherry Chomp',
  charge: 'the last foe charging',
  burst: 'rifle burst (the Warsaw Pac)',
  ricochet: 'a ricochet (the Warsaw Pac)',
  blast: "the last foe's blast",
  level_up: 'level up',
  win: 'a fight won',
  game_over: 'game over',
};

const PLACES: Record<string, string> = {
  title: 'title page',
  house: "the heroes' home (arcade)",
  town: 'the town (arcade)',
  maze: 'the maze (arcade)',
  border: 'the border, maze to grass',
  field: 'the square in Beijing',
  berlin: 'Berlin',
  battle: 'fights',
  boss: 'the last fight',
  ending: 'the ending',
};

const SPEAKERS: Array<[string, number]> = [
  ['Olli', 520],
  ['Ronnie', 300],
  ['Gorbie', 220],
  ['Blue Thing', 760],
  ['Shopkeeper', 600],
  ['Student', 480],
  ['Enemies', 180],
  ['Tank', 120],
  ['Boss', 140],
];

/** Blip times for a typed line at the game's default 60 letters a second, a blip every other letter, as the game does. */
const LINE = 'xxxx xxxxx xx xxxxxx xxxx xxx';
const BLIPS: number[] = (() => {
  const out: number[] = [];
  let letters = 0;
  [...LINE].forEach((ch, i) => {
    if (ch !== ' ' && letters++ % 2 === 0) out.push(i / 60);
  });
  return out;
})();

const styleNames = (kind: Kind) => Object.keys(STYLES).filter((s) => STYLES[s]![kind]);

// ---------------------------------------------------------------- audio

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: SR });
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state !== 'running') void ctx.resume();
  return ctx;
}

const worker = new Worker(new URL('./soundWorker.ts', import.meta.url), { type: 'module' });
const waiting = new Map<number, (r: RenderResult) => void>();
let nextId = 1;
worker.onmessage = (e: MessageEvent<RenderResult>) => {
  waiting.get(e.data.id)?.(e.data);
  waiting.delete(e.data.id);
};

const cache = new Map<string, Promise<AudioBuffer>>();
const limitedBy = new Map<string, number>();

function keyOf(j: Omit<RenderJob, 'id'>): string {
  return `${j.style}/${j.kind}/${j.name}/${j.pitch ?? ''}/${j.seed ?? ''}`;
}

/** The buffer for a sketch, rendered in the worker the first time it is asked for. */
function buffer(j: Omit<RenderJob, 'id'>): Promise<AudioBuffer> {
  const key = keyOf(j);
  let p = cache.get(key);
  if (!p) {
    p = new Promise<AudioBuffer>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, (r) => {
        if ('error' in r) return reject(new Error(r.error));
        limitedBy.set(key, r.limited);
        const b = audio().createBuffer(2, r.l.length, SR);
        b.copyToChannel(r.l as Float32Array<ArrayBuffer>, 0);
        b.copyToChannel(r.r as Float32Array<ArrayBuffer>, 1);
        resolve(b);
      });
      worker.postMessage({ ...j, id } satisfies RenderJob);
    });
    cache.set(key, p);
  }
  return p;
}

/** A Lyria reference clip, decoded and matched to the music's loudness target. */
const refs = new Map<string, Promise<AudioBuffer>>();
function reference(file: string): Promise<AudioBuffer> {
  let p = refs.get(file);
  if (!p) {
    p = (async () => {
      const data = await (await fetch(`/archive/sound/lyria/${file}`)).arrayBuffer();
      const b = await audio().decodeAudioData(data);
      const l = b.getChannelData(0);
      const r = b.getChannelData(b.numberOfChannels > 1 ? 1 : 0);
      const lu = loudness({ length: b.length, l, r } as unknown as Mix).integrated;
      let peak = 0;
      for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
      const g = Math.min(10 ** ((TARGET.music - lu) / 20), 10 ** (-1 / 20) / Math.max(peak, 1e-6));
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i]! *= g;
      }
      return b;
    })();
    refs.set(file, p);
  }
  return p;
}

const live = new Set<AudioBufferSourceNode>();
let musicNow: { src: AudioBufferSourceNode; button: HTMLButtonElement } | null = null;
const played: Array<{ what: string; seconds: number; rms: number; lu: number | null }> = [];

function start(b: AudioBuffer, opts: { loop?: boolean; at?: number; gain?: number; until?: number; what?: string } = {}): AudioBufferSourceNode {
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = b;
  src.loop = opts.loop ?? false;
  const g = c.createGain();
  g.gain.value = opts.gain ?? 1;
  src.connect(g).connect(master!);
  const t = c.currentTime + 0.03 + (opts.at ?? 0);
  src.start(t);
  if (opts.until !== undefined) {
    const end = c.currentTime + 0.03 + opts.until;
    g.gain.setValueAtTime(opts.gain ?? 1, end - 0.25);
    g.gain.linearRampToValueAtTime(0, end);
    src.stop(end + 0.01);
  }
  live.add(src);
  src.onended = () => live.delete(src);
  if (opts.what) {
    // For the page's own check: what played, how long, and that it is not silent.
    const d = b.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < d.length; i += 7) sum += d[i]! * d[i]!;
    // Short sounds also carry their loudest 400 ms in LUFS, so the check can see each kind is matched.
    const lu = b.duration < 5 ? loudness({ length: b.length, l: b.getChannelData(0), r: b.getChannelData(1) } as unknown as Mix).momentary : null;
    played.push({ what: opts.what, seconds: b.duration, rms: Math.sqrt(sum / Math.ceil(d.length / 7)), lu });
  }
  return src;
}

/**
 * Presses that wait for a render are told apart so a slow one cannot play late: `claims` counts presses that take the
 * speakers for themselves (music, a reference, a run of effects, a scene), `stops` counts Stop, Escape, and a playing
 * track pressed again. A press plays only if neither has moved while it waited (an effect, which may overlap others,
 * minds only `stops`).
 */
let claims = 0;
let stops = 0;

/** Stop, as the button, Escape, or a playing track pressed again ask: what waits to play is cancelled too. */
function stopPressed(): void {
  stops++;
  stopAll();
}

function stopAll(): void {
  for (const s of live) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  live.clear();
  if (musicNow) {
    musicNow.button.classList.remove('playing');
    musicNow.button.setAttribute('aria-pressed', 'false');
  }
  musicNow = null;
}

// ---------------------------------------------------------------- page

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  const { cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
};

function status(text: string): void {
  document.getElementById('status')!.textContent = text;
}

/** A play button for one cell: renders on first press (shown as "…"), then plays. */
function playButton(label: string, title: string, get: () => Promise<AudioBuffer>, kind: Kind | 'ref', what: string): HTMLButtonElement {
  const b = el('button', { cls: 'play', title, type: 'button' }, label);
  b.dataset.what = what;
  const long = kind === 'music' || kind === 'ref';
  if (long) b.setAttribute('aria-pressed', 'false');
  b.onclick = async () => {
    audio();
    if (long && musicNow?.button === b) {
      stopPressed();
      return;
    }
    const mine = long ? ++claims : claims;
    const stopsThen = stops;
    b.classList.add('busy');
    try {
      const buf = await get();
      // Stopped, or another track or scene asked for since: this press is cancelled.
      if (stops !== stopsThen || (long && mine !== claims)) return;
      if (long) {
        stopAll();
        const loop = (document.getElementById('loop') as HTMLInputElement).checked && kind === 'music';
        const src = start(buf, { loop, what });
        musicNow = { src, button: b };
        b.classList.add('playing');
        b.setAttribute('aria-pressed', 'true');
        src.addEventListener('ended', () => {
          if (musicNow?.src === src) {
            b.classList.remove('playing');
            b.setAttribute('aria-pressed', 'false');
            musicNow = null;
          }
        });
        status(`${what}: ${buf.duration.toFixed(1)} s${loop ? ', looping' : ''}`);
      } else {
        start(buf, { what });
        status(`${what}: ${buf.duration.toFixed(2)} s`);
      }
    } catch (err) {
      status(`${what}: ${String(err)}`);
      b.classList.add('failed');
    } finally {
      b.classList.remove('busy');
    }
  };
  return b;
}

function table(head: string[], rows: HTMLTableRowElement[]): HTMLElement {
  const t = el('table', {}, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))), el('tbody', {}, ...rows));
  return el('div', { cls: 'scroll' }, t);
}

function cell(...kids: Node[]): HTMLTableCellElement {
  return el('td', {}, ...kids);
}

function effectsSection(): HTMLElement {
  const styles = styleNames('sfx');
  const rows = SFX_NAMES.map((name) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row' }, el('span', { cls: 'name' }, name), el('span', { cls: 'meaning' }, EFFECTS[name] ?? '')),
      ...styles.map((s) => cell(playButton('▶', `${name}, ${s}`, () => buffer({ style: s, kind: 'sfx', name }), 'sfx', `sfx ${name} ${s}`))),
    ),
  );
  const all = el('tr', { cls: 'whole' }, el('th', { scope: 'row' }, 'all in turn'), ...styles.map((s) => cell(sheetButton(s))));
  return el('section', {}, el('h2', {}, 'Effects'), el('p', {}, 'Each column is one style. ', el('b', {}, 'console'), ' is the game\'s sound; ', el('b', {}, 'draft'), ' is the first draft, which plays while a sound renders.'), table(['', ...styles], [...rows, all]));
}

/** Plays every effect of a style in turn, 0.6 s apart. */
function sheetButton(style: string): HTMLButtonElement {
  const b = el('button', { cls: 'play wide', type: 'button', title: `Every effect in ${style}, one after another` }, '▶ all');
  b.dataset.what = `sheet ${style}`;
  b.onclick = async () => {
    audio();
    stopAll();
    const mine = ++claims;
    const stopsThen = stops;
    b.classList.add('busy');
    const bufs = await Promise.all(SFX_NAMES.map((name) => buffer({ style, kind: 'sfx', name })));
    b.classList.remove('busy');
    if (mine !== claims || stops !== stopsThen) return;
    stopAll();
    let at = 0;
    bufs.forEach((buf, i) => {
      start(buf, { at, what: `sheet ${style} ${SFX_NAMES[i]}` });
      at += Math.min(buf.duration, 1.6) + 0.6;
    });
    status(`Every effect in ${style}: ${at.toFixed(0)} s`);
  };
  return b;
}

function voicesSection(): HTMLElement {
  const styles = styleNames('voice');
  const line = (style: string, pitch: number, who: string) =>
    playButton(
      '▶',
      `${who}, ${style}`,
      async () => {
        // The line's blips, rendered one by one (each letter's own detune), laid into one buffer, and the whole line
        // matched to the voices' loudness (blips matched one by one would add up to about 10 dB more).
        const blips = await Promise.all(BLIPS.map((_, i) => buffer({ style, kind: 'voice', name: who, pitch, seed: i + 1 })));
        const length = Math.ceil((BLIPS.at(-1)! + 0.3) * SR);
        const out = audio().createBuffer(2, length, SR);
        for (let c = 0; c < 2; c++) {
          const dst = out.getChannelData(c);
          blips.forEach((b, i) => {
            const src = b.getChannelData(c);
            const o = Math.round(BLIPS[i]! * SR);
            for (let k = 0; k < src.length && o + k < length; k++) dst[o + k]! += src[k]!;
          });
        }
        normalize({ length, l: out.getChannelData(0), r: out.getChannelData(1) } as unknown as Mix, 'voice');
        return out;
      },
      'voice',
      `voice ${who} ${style}`,
    );
  const rows = SPEAKERS.map(([who, pitch]) => el('tr', {}, el('th', { scope: 'row' }, el('span', { cls: 'name' }, who), el('span', { cls: 'meaning' }, `${pitch} Hz`)), ...styles.map((s) => cell(line(s, pitch, who)))));
  return el('section', {}, el('h2', {}, 'Typing voices'), el('p', {}, 'A line of letters typed at the default text speed, a blip every other letter as in the game.'), table(['', ...styles], rows));
}

interface Ref {
  file: string;
  place: string;
  style: string;
  note: string;
}

function musicSection(refList: Ref[]): HTMLElement {
  const styles = styleNames('music');
  const rows = Object.keys(TRACKS).map((name) => {
    const mine = refList.filter((r) => r.place === name);
    return el(
      'tr',
      {},
      el('th', { scope: 'row' }, el('span', { cls: 'name' }, name), el('span', { cls: 'meaning' }, PLACES[name] ?? '')),
      ...styles.map((s) => cell(playButton('▶', `${name}, ${s}`, () => buffer({ style: s, kind: 'music', name }), 'music', `music ${name} ${s}`))),
      el('td', { cls: 'refs' }, ...mine.map((r) => playButton(r.style, r.note || r.style, () => reference(r.file), 'ref', `ref ${r.file}`))),
    );
  });
  const extra = refList.filter((r) => !TRACKS[r.place]);
  return el(
    'section',
    {},
    el('h2', {}, 'Music'),
    el('p', {}, 'Each style plays the draft\'s own tunes, arranged: the tune, then harmony, then a counter-voice, then a lighter part before it loops. Press again to stop. The last column is Lyria\'s clips, made from a description of each place, for ideas only; hover one for what the listening model heard in it.'),
    table(['', ...styles, 'Lyria references'], rows),
    extra.length ? el('p', { cls: 'extra' }, 'Also from Lyria: ', ...extra.map((r) => playButton(`${r.place} ${r.style}`, r.note || '', () => reference(r.file), 'ref', `ref ${r.file}`))) : '',
  );
}

interface Scene {
  title: string;
  about: string;
  music: string;
  musicFrom: number;
  musicUntil: number;
  events: Array<[string, number]>;
}

const SCENES: Scene[] = [
  {
    title: 'Walking the maze',
    about: 'Eating dots, an item, something appearing, then through a door.',
    music: 'maze',
    musicFrom: 0,
    musicUntil: 6.4,
    events: [...Array.from({ length: 10 }, (_, i) => ['waka', 0.5 + i * 0.29] as [string, number]), ['pickup', 3.6], ['appear', 4.7], ['door', 6.3]],
  },
  {
    title: 'A fight',
    about: 'A fight begins, menu moves, hits, a hurt, a miss, A-star Maneuver, an enemy beaten, the fight won.',
    music: 'battle',
    musicFrom: 0.35,
    musicUntil: 7.5,
    events: [['battle_start', 0], ['blip', 1.4], ['blip', 1.65], ['confirm', 1.95], ['hit', 2.4], ['hit', 3.05], ['hurt', 3.75], ['miss', 4.45], ...Array.from({ length: 5 }, (_, i) => ['a_star', 5.1 + i * 0.15] as [string, number]), ['a_star_flare', 5.9], ['defeat', 6.6], ['win', 7.5]],
  },
];

function scenesSection(): HTMLElement {
  const pick = (kind: Kind, id: string) => {
    const s = el('select', { id });
    for (const name of styleNames(kind)) s.append(el('option', { value: name }, name));
    return s;
  };
  const musicStyle = pick('music', 'scene-music');
  const sfxStyle = pick('sfx', 'scene-sfx');
  const blocks = SCENES.map((sc) => {
    const b = el('button', { cls: 'play wide', type: 'button' }, `▶ ${sc.title}`);
    b.dataset.what = `scene ${sc.music}`;
    b.onclick = async () => {
      audio();
      stopAll();
      const mine = ++claims;
      const stopsThen = stops;
      // The styles as chosen when pressed, whatever the pickers say by the time the sounds are ready.
      const music = musicStyle.value;
      const effects = sfxStyle.value;
      b.classList.add('busy');
      const [m, ...fx] = await Promise.all([buffer({ style: music, kind: 'music', name: sc.music }), ...sc.events.map(([name]) => buffer({ style: effects, kind: 'sfx', name }))]);
      b.classList.remove('busy');
      if (mine !== claims || stops !== stopsThen) return;
      stopAll();
      // Music sits under the effects, as in the game: 6 dB below its comparison level.
      start(m!, { loop: true, at: sc.musicFrom, until: sc.musicUntil, gain: 0.5, what: `scene ${sc.title} music ${music}` });
      sc.events.forEach(([name, at], i) => start(fx[i]!, { at, what: `scene ${sc.title} ${name} ${effects}` }));
      status(`${sc.title}: music ${music}, effects ${effects}`);
    };
    return el('div', { cls: 'scene' }, b, el('span', { cls: 'meaning' }, sc.about));
  });
  return el('section', {}, el('h2', {}, 'Together'), el('p', {}, 'Music in one style under effects in another, as they would sound in play.'), el('div', { cls: 'pickers' }, el('label', {}, 'Music ', musicStyle), el('label', {}, 'Effects ', sfxStyle)), ...blocks);
}

function stylesSection(): HTMLElement {
  return el('section', {}, el('h2', {}, 'The styles'), el('dl', {}, ...Object.entries(STYLES).flatMap(([name, s]) => [el('dt', {}, name), el('dd', {}, s.about)])));
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  let refList: Ref[] = [];
  try {
    refList = (await (await fetch('/archive/sound/lyria/manifest.json')).json()) as Ref[];
  } catch {
    /* no references on this machine */
  }
  const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(volume), id: 'volume' });
  vol.oninput = () => {
    volume = Number(vol.value);
    if (master) master.gain.value = volume;
  };
  const stop = el('button', { type: 'button', id: 'stop' }, '■ Stop');
  stop.onclick = stopPressed;
  const loop = el('input', { type: 'checkbox', id: 'loop', checked: true });
  app.append(
    el('header', {}, el('h1', {}, 'Sounds'), el('p', {}, 'The game\'s Console sound beside the first draft\'s, every version matched in loudness, so they differ by how they sound, not how loud. The other sketched styles were retired on 2026-10-13; they are kept in archive/sound_styles/.'), el('div', { cls: 'controls' }, el('label', {}, 'Volume ', vol), stop, el('label', {}, loop, ' loop music'), el('span', { id: 'status', role: 'status' }))),
    effectsSection(),
    musicSection(refList),
    voicesSection(),
    scenesSection(),
    stylesSection(),
  );
  // The column names stick below the page's own sticky header, however tall it wraps.
  const head = document.querySelector('header')!;
  new ResizeObserver(() => document.documentElement.style.setProperty('--head', `${head.getBoundingClientRect().height}px`)).observe(head);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopPressed();
  });
  // For the page's check (tools/soundlab_check.ts): what has played, and a way to silence a sound as its control.
  (window as unknown as { __lab: unknown }).__lab = {
    ready: true,
    played,
    limitedBy,
    stopAll: stopPressed,
    buffer: (j: Omit<RenderJob, 'id'>) => buffer(j).then((b) => ({ seconds: b.duration, channels: b.numberOfChannels })),
    silence: async (j: Omit<RenderJob, 'id'>) => {
      const b = await buffer(j);
      for (let c = 0; c < b.numberOfChannels; c++) b.getChannelData(c).fill(0);
    },
  };
}

void main();
