/**
 * The bars page (`bars_lab.html`, served by the dev server only; the game's build leaves it out). Four copies of the game,
 * muted: a Beijing patrol fight and the party menu, each on a desktop and an upright phone. The controls change the
 * game's own bar values (VITAL and VITAL_LOOK in src/ui/vital_fill.ts) in each copy and lay it out again, so what shows is
 * what the game draws. Fights run for real with god mode on, so Health stays where the levels put it; a fight that ends
 * starts again. The values to keep are printed at the foot of the controls.
 */
import { VITAL, VITAL_LOOK } from '../ui/vital_fill.ts';

type Look = { hp: number; mp: number; low: number; ink: number; dots: number; words: number; hpLevel: number; mpLevel: number };
type Frame = { title: string; w: number; h: number; scale: number; kind: 'fight' | 'menu'; el?: HTMLIFrameElement; ready?: boolean; mod?: unknown };

const DEFAULTS: Look = { ...VITAL, ...VITAL_LOOK, hpLevel: 80, mpLevel: 70 };
// The three members' share of the levels, so one setting shows a full bar, a middle one and a low one.
const SPREAD = [1, 0.55, 0.2];
const FIGHT = '/?dev&map=field&battle=field_1&level=4&god';
const MENU = '/?dev&map=field&level=4&god&peace';
const FRAMES: Frame[] = [
  { title: 'Fight, desktop', w: 1280, h: 800, scale: 0.6, kind: 'fight' },
  { title: 'Fight, phone', w: 390, h: 664, scale: 0.85, kind: 'fight' },
  { title: 'Party menu, desktop', w: 1280, h: 800, scale: 0.6, kind: 'menu' },
  { title: 'Party menu, phone', w: 390, h: 664, scale: 0.85, kind: 'menu' },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const num = (s: string) => parseInt(s.slice(1), 16);

let look: Look = { ...DEFAULTS };
try {
  const kept = JSON.parse(localStorage.getItem('bars_lab') ?? 'null');
  if (kept) look = { ...DEFAULTS, ...kept };
} catch { /* a private window keeps nothing */ }

const colours = ['hp', 'mp', 'low'] as const;
const shares = ['ink', 'dots', 'words'] as const;
const levels = ['hpLevel', 'mpLevel'] as const;

function show(): void {
  for (const k of colours) {
    $<HTMLInputElement>(k).value = hex(look[k]);
    $(`${k}Hex`).textContent = hex(look[k]);
  }
  for (const k of shares) {
    $<HTMLInputElement>(k).value = String(Math.round(look[k] * 100));
    $(k).nextElementSibling!.textContent = `${Math.round(look[k] * 100)}%`;
  }
  for (const k of levels) {
    $<HTMLInputElement>(k).value = String(look[k]);
    $(k).nextElementSibling!.textContent = `${look[k]}%`;
  }
  const f = (n: number) => n.toFixed(2);
  $<HTMLTextAreaElement>('values').value =
    `VITAL = { hp: 0x${look.hp.toString(16).padStart(6, '0')}, mp: 0x${look.mp.toString(16).padStart(6, '0')}, low: 0x${look.low.toString(16).padStart(6, '0')} }\n` +
    `VITAL_LOOK = { ink: ${f(look.ink)}, dots: ${f(look.dots)}, words: ${f(look.words)} }`;
  try { localStorage.setItem('bars_lab', JSON.stringify(look)); } catch { /* nothing kept */ }
}

/** Puts the look and the levels into one copy of the game and lays it out again. */
async function apply(fr: Frame): Promise<void> {
  const win = fr.el?.contentWindow as (Window & { dev?: any; eval(code: string): any }) | null;
  const g = win?.dev?.game;
  if (!fr.ready || !g) return;
  // The copy's own instance of the module, the one its game draws with.
  fr.mod ??= await win!.eval(`import('/src/ui/vital_fill.ts')`);
  const m = fr.mod as { VITAL: typeof VITAL; VITAL_LOOK: typeof VITAL_LOOK };
  Object.assign(m.VITAL, { hp: look.hp, mp: look.mp, low: look.low });
  Object.assign(m.VITAL_LOOK, { ink: look.ink, dots: look.dots, words: look.words });
  g.state.order.forEach((id: string, i: number) => {
    const mm = g.state.members[id];
    const share = SPREAD[i] ?? 1;
    mm.hp = Math.max(1, Math.round(mm.maxHp * share * look.hpLevel / 100));
    mm.mp = Math.round(mm.maxMp * share * look.mpLevel / 100);
  });
  for (const f of g.battle?.party ?? []) if (f.member) f.hp = f.member.hp;
  g.relayout();
}

let pending = 0;
function applyAll(): void {
  show();
  clearTimeout(pending);
  pending = window.setTimeout(() => { for (const fr of FRAMES) void apply(fr); }, 80);
}

/** Readies each copy: muted, the fight running or the party menu open; a fight that ends starts again. */
function watch(fr: Frame): void {
  const win = fr.el!.contentWindow as (Window & { dev?: any }) | null;
  const g = win?.dev?.game;
  if (!g) return;
  if (g.audio && !g.audio.muted) { g.audio.muted = true; g.audio.applyVolumes(); }
  if (fr.kind === 'fight') {
    const active = g.battle?.phase === 'active';
    if (!fr.ready && active) { fr.ready = true; win!.dev.overlay?.(false); void apply(fr); }
    else if (fr.ready && !g.battle) { fr.ready = false; fr.mod = undefined; fr.el!.src = FIGHT; }
    return;
  }
  if (!fr.ready && g.world && !g.storyBusy() && !g.screensOpen()) {
    win!.dev.overlay?.(false);
    g.openPartyMenu();
    fr.ready = true;
    void apply(fr);
  } else if (fr.ready && !g.screensOpen()) {
    g.openPartyMenu();
    void apply(fr);
  }
}

const main = $('frames');
for (const fr of FRAMES) {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = fr.title;
  const box = document.createElement('div');
  box.className = 'frame';
  box.style.width = `${Math.round(fr.w * fr.scale)}px`;
  box.style.height = `${Math.round(fr.h * fr.scale)}px`;
  const el = document.createElement('iframe');
  el.width = String(fr.w);
  el.height = String(fr.h);
  el.style.transform = `scale(${fr.scale})`;
  el.src = fr.kind === 'fight' ? FIGHT : MENU;
  el.addEventListener('load', () => { fr.ready = false; fr.mod = undefined; });
  fr.el = el;
  box.append(el);
  fig.append(cap, box);
  main.append(fig);
  window.setInterval(() => watch(fr), 500);
}

for (const k of colours) $<HTMLInputElement>(k).addEventListener('input', (e) => { look[k] = num((e.target as HTMLInputElement).value); applyAll(); });
for (const k of shares) $<HTMLInputElement>(k).addEventListener('input', (e) => { look[k] = Number((e.target as HTMLInputElement).value) / 100; applyAll(); });
for (const k of levels) $<HTMLInputElement>(k).addEventListener('input', (e) => { look[k] = Number((e.target as HTMLInputElement).value); applyAll(); });
$('copy').addEventListener('click', () => void navigator.clipboard?.writeText($<HTMLTextAreaElement>('values').value));
$('reset').addEventListener('click', () => { look = { ...DEFAULTS }; applyAll(); });
show();
