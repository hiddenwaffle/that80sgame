import { Container, Graphics, Text } from 'pixi.js';
import { cherryPair } from '../art/cherries.ts';
import { drawSmokeBomb } from '../art/smokeBomb.ts';
import { CUT_FROM, CUT_LAST, CUT_STEP, CUTS, NINJA_BEAT, NINJA_BEATS } from '../audio/ninjaTiming.ts';
import type { GameContext } from '../game/context.ts';
import { bannerHoldSeconds, EASE, motion } from '../render/motion.ts';
import { INK, PAPER, PAPER_DARK, POP_CYAN, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { REVIVAL_BANNER_TILT, revivalBannerSpan } from '../render/revival.ts';
import { portrait } from '../ui/portrait.ts';
import { benDay, burstPoints, focusLines, letterStyle, measures } from '../ui/print.ts';
import type { Actor } from './actor.ts';
import type { World } from './world.ts';

/** How far under the street's music the lesson's beat plays it, in decibels. */
const MUSIC_DUCK_DB = 20;
/** The cherries: how many pairs Ronnie gives up, a pair thrown this often, each flying this long. */
const PAIRS = 6, THROW_EVERY = 0.07, FLIGHT = 0.38;
/** The pile, in upright units from its spot, the bottom row first, and each cherry's radius. */
const PILE: ReadonlyArray<readonly [number, number]> = [[-11, 0], [0, 1], [11, 0], [-5.5, -6], [5.5, -6], [0, -12]];
const CHERRY_R = 3.6;
/**
 * The smoke bombs the cherries turn into, cans stacked three, two and one, each one's middle in upright units from the
 * pile's spot, the bottom row first, and its size (half its height, about; with a thin white edge, so they do not look like
 * stickers); and Ronnie taking them, the top one first, one this long after another, each this long.
 */
const CAN_R = 4;
const CANS: ReadonlyArray<readonly [number, number]> = [[-5.6, -4.4], [0, -4.4], [5.6, -4.4], [-2.8, -13.3], [2.8, -13.3], [0, -22.2]];
const TAKE_EVERY = 0.05, TAKE_FLIGHT = 0.3;
/** Each cut's line: swept across in this many seconds, then gone this many seconds later, before the next comes. */
const SWEEP = 0.1, CUT_FADE = 0.14;
/** Beats into the lesson when the lights come back up, and how long the ninjas' smoke takes to clear. */
const LIGHTS_UP = CUT_LAST + 1.5;
const POOF_S = 0.75;
const BEAMS = [POP_PINK, POP_CYAN, POP_YELLOW];

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** The lesson showing now, for the checks: the beat it is on (below 0 while the cherries fly) and the cuts made so far. */
export const kujiShown = { beat: null as number | null, cuts: 0, banner: false };

/**
 * The ninjas' lesson (the owner, 2026-11-07), after Ronnie says yes to their price: his cherries fly from him onto a pile
 * between them; a beat starts (sfx ninja_beat) and the stage lights come down onto the three; a bar in, the nine cuts of
 * the kuji-kiri slash across the screen on its eighths, each where it falls in the grid of five across and four down and
 * gone before the next (the owner: "only one catches someone's attention at a time"), each seal in Japanese, with a
 * teacher leaping and spinning and Ronnie copying; on the ninth all three leap and the NEW SPECIAL: panel slams across; the
 * lights come up, and the ninjas are gone in a puff, leaving smoke bombs where the cherries were; the panel stays until the
 * smoke has cleared. Then `after` (Ronnie's line about them), and he takes them. With Reduce motion nobody leaps or sways and the cuts and panel appear in place.
 * `stop` ends it at once.
 */
export function kujiKiri(g: GameContext, w: World, cast: { pupil: Actor; teachers: [Actor, Actor]; pile: { x: number; y: number } }, stop: () => boolean, after?: () => Promise<void>): Promise<void> {
  const { pupil, teachers, pile } = cast;
  const still = motion.reduced;
  const layer = g.uiLayer;
  const u = g.layout.unit;
  const panel = g.layout.panel;
  const players = [pupil, ...teachers];
  for (const a of players) a.scripted++;
  const restFacing = teachers.map((a) => a.facing);
  const camera = w.cameraTarget;
  // Over to the teachers for the dance (the owner, 2026-11-07), from the first of them through the talk.
  w.cameraTarget = { x: pile.x, y: pile.y };

  // In the world: the cherries in flight, over the figures, and the pile and the bombs, among them.
  const flying = new Graphics();
  const heap = new Graphics();
  const bombs = new Graphics();
  const puffs = new Graphics();
  for (const x of [flying, heap, bombs, puffs]) x.eventMode = 'none';
  w.fx.addChild(flying, puffs);
  w.behind(heap, teachers[0]);
  w.behind(bombs, teachers[0]);
  bombs.visible = false;
  // Over the map, under the dialogue: the lights, the cuts, the seals and the panel.
  const over = new Container();
  over.eventMode = 'none';
  const dim = new Graphics(), beams = new Graphics(), lines = new Graphics(), cut = new Graphics(), flash = new Graphics();
  over.addChild(dim, beams, lines, cut);
  const sealViews = g.msg('ninja', 'seal_marks').split(' ').map((mark) => {
    const view = new Text({ text: mark, style: { fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Noto Serif CJK JP", serif', fontWeight: '900', fontSize: 10, fill: 0xffffff, stroke: { color: INK, width: 3, join: 'round' }, padding: 8 } });
    view.anchor.set(0.5);
    view.visible = false;
    over.addChild(view);
    return view;
  });
  over.addChild(flash);
  // Up through the ninjas' leap and puff, and gone as their smoke clears, when Ronnie's line comes (the owner, 2026-11-08).
  const banner = learnedBanner(g, over, 'ronnie', (NINJA_BEATS - CUT_LAST) * NINJA_BEAT + POOF_S);
  layer?.addChild(over);

  // Where Ronnie throws from, and each pair's place on the pile.
  const throwFrom = { x: pupil.x + (teachers[0].x > pupil.x ? 4 : -4), y: pupil.y, up: pupil.size * 1.4 };
  const landed = new Array<boolean>(PAIRS).fill(false);
  const tossEnd = (PAIRS - 1) * THROW_EVERY + FLIGHT;
  let soundPlaying: { stop: () => void } | null = null;
  let t = 0;
  let shaken = false;
  let gone = false;

  const drawHeap = () => {
    heap.clear();
    heap.position.set(pile.x, pile.y);
    heap.scale.set(1, 1 / w.ground);
    // The back of the pile first, so the front row comes over it.
    for (let i = PAIRS - 1; i >= 0; i--) if (landed[i]) cherryPair(heap, PILE[i]![0], PILE[i]![1] - CHERRY_R, CHERRY_R, (i % 3 - 1) * 0.35);
  };

  // Drawn upright, in units of the ground's height at its spot.
  flying.scale.set(1, 1 / w.ground);
  const drawToss = () => {
    flying.clear();
    for (let i = 0; i < PAIRS; i++) {
      const k = (t - i * THROW_EVERY) / FLIGHT;
      if (k <= 0 || landed[i]) continue;
      if (k >= 1) {
        landed[i] = true;
        drawHeap();
        continue;
      }
      // Up out of Ronnie's mouth and down onto its place, turning.
      const [tx, ty] = [pile.x + PILE[i]![0], pile.y + PILE[i]![1] * w.ground - CHERRY_R];
      const x = throwFrom.x + (tx - throwFrom.x) * k;
      const y = throwFrom.y + (ty - throwFrom.y) * k - (throwFrom.up * (1 - k) + Math.sin(k * Math.PI) * 26) / w.ground;
      cherryPair(flying, x, y * w.ground, CHERRY_R, still ? 0 : k * 7);
    }
  };

  // The grid of the nine cuts round the three: five across, four down, the first across and then turn about.
  const centre = () => w.worldToPanel((pupil.x + teachers[1].x) / 2, pile.y, pupil.size);
  const spacing = Math.max(u * 2.2, Math.min(panel.w, panel.h) * 0.11);
  const cutLine = (i: number): { across: boolean; at: number } => {
    const [cx, cy] = centre();
    const across = i % 2 === 0;
    return across ? { across, at: cy + (i / 2 - 2) * spacing } : { across, at: cx + ((i - 1) / 2 - 1.5) * spacing };
  };
  const edges = g.screenEdges?.() ?? { x: 0, y: 0, w: panel.w, h: panel.h };

  const drawLights = (b: number) => {
    // Down on the first beat, up again after the panel.
    const level = still ? (b >= 0 && b < LIGHTS_UP + 1 ? 1 : 0) : clamp(b / 0.25) * (1 - clamp((b - LIGHTS_UP) / 1));
    dim.clear();
    beams.clear();
    if (level <= 0) return;
    const [cx, cy] = centre();
    const [rx, ry] = [spacing * 2.6, spacing * 1.7];
    // Dark round a soft-edged pool of light on the three.
    for (let i = 0; i < 14; i++) {
      const grow = 1 + i * 0.05;
      dim.rect(edges.x - 10, edges.y - 10, edges.w + 20, edges.h + 20).fill({ color: INK, alpha: (0.72 / 14) * level });
      dim.ellipse(cx, cy, rx * grow, ry * grow).cut();
    }
    // Coloured beams from above, swaying with the beat, the colours turning with each cut, and brightening as it lands.
    const cutsDone = Math.max(0, Math.min(CUTS, Math.floor((b - CUT_FROM) / CUT_STEP) + 1));
    const sinceCut = b >= CUT_FROM ? ((b - CUT_FROM) % CUT_STEP) * NINJA_BEAT : 1;
    const bright = still ? 0 : 0.14 * clamp(1 - sinceCut / 0.18) * (b < CUT_LAST + CUT_STEP ? 1 : 0);
    for (let j = 0; j < 3; j++) {
      const sway = still ? 0 : Math.sin((b * Math.PI) / 2 + j * 2.1) * spacing * 1.2;
      const top = edges.x + edges.w * (0.2 + j * 0.3);
      const color = BEAMS[(j + cutsDone) % 3]!;
      beams.poly([top - spacing * 0.25, edges.y - 10, top + spacing * 0.25, edges.y - 10, cx + sway + rx * 0.55, cy + ry * 0.4, cx + sway - rx * 0.55, cy + ry * 0.4])
        .fill({ color, alpha: (0.16 + bright) * level });
    }
  };

  const drawCuts = (b: number) => {
    cut.clear();
    lines.clear();
    flash.clear();
    if (b < CUT_FROM) return;
    const after = (b - CUT_LAST) * NINJA_BEAT;
    for (let i = 0; i < CUTS; i++) {
      const since = (b - (CUT_FROM + i * CUT_STEP)) * NINJA_BEAT;
      if (since < 0) break;
      // Swept across in a tenth of a second, a blade's glow at its head, then gone before the next.
      const fade = 1 - clamp((since - SWEEP) / CUT_FADE);
      if (fade <= 0) continue;
      const { across, at } = cutLine(i);
      const k = still ? 1 : EASE.out(clamp(since / SWEEP));
      const [x0, y0, x1, y1] = across
        ? (i / 2) % 2 === 0 ? [edges.x, at, edges.x + edges.w, at] : [edges.x + edges.w, at, edges.x, at]
        : [at, edges.y, at, edges.y + edges.h];
      const [hx, hy] = [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
      const width = u * 0.38;
      cut.moveTo(x0, y0).lineTo(hx, hy).stroke({ width: width + u * 0.5, color: BEAMS[i % 3]!, alpha: 0.55 * fade });
      cut.moveTo(x0, y0).lineTo(hx, hy).stroke({ width: width + 3, color: INK, alpha: 0.85 * fade });
      cut.moveTo(x0, y0).lineTo(hx, hy).stroke({ width, color: 0xffffff, alpha: 0.95 * fade });
      if (!still && k < 1) cut.poly(burstPoints(hx, hy, u * 1.1, 6, 0.35, since * 30)).fill(0xffffff).stroke({ width: 1.5, color: INK, join: 'miter' });
    }
    // The ninth cut: the focus lines on the three, a white flash.
    if (after >= 0 && !still) {
      const [cx, cy] = centre();
      const reach = 0.5 * EASE.out(clamp(after / 0.12)) * (1 - clamp((after - 0.5) / 0.4));
      if (reach > 0) focusLines(lines, edges, [cx, cy], reach, u, Math.floor(t / 0.07), POP_YELLOW);
      flash.rect(edges.x - 10, edges.y - 10, edges.w + 20, edges.h + 20).fill({ color: 0xffffff, alpha: 0.45 * clamp(1 - after / 0.22) });
    }
  };

  const drawSeals = (b: number) => {
    const [cx, cy] = centre();
    const size = Math.round(spacing * 1.85);
    for (let i = 0; i < CUTS; i++) {
      const v = sealViews[i];
      if (!v) continue;
      const since = (b - (CUT_FROM + i * CUT_STEP)) * NINJA_BEAT;
      const next = (b - (CUT_FROM + (i + 1) * CUT_STEP)) * NINJA_BEAT;
      // Each up from its cut until the next, then gone as it shrinks away; the ninth stays up under the panel a little.
      const out = i === CUTS - 1 ? (b - LIGHTS_UP) * NINJA_BEAT : next;
      v.visible = since >= 0 && out < 0.12;
      if (!v.visible) continue;
      if (v.style.fontSize !== size) {
        v.style.fontSize = size;
        v.style.stroke = { color: INK, width: Math.max(3, size * 0.09), join: 'round' };
      }
      // Alternately left and right of the three, high, the last over them.
      const side = i === CUTS - 1 ? 0 : i % 2 ? 1 : -1;
      const x = Math.max(edges.x + size * 0.6, Math.min(edges.x + edges.w - size * 0.6, cx + side * spacing * 3.1));
      v.position.set(x, cy - spacing * (i === CUTS - 1 ? 2.6 : 1.7));
      v.rotation = still ? 0 : -0.08 * (side || 1);
      const pop = still ? 1 : 1 + 0.6 * (1 - EASE.out(clamp(since / 0.12)));
      const leave = out > 0 ? clamp(out / 0.12) : 0;
      v.scale.set(pop * (1 - leave * 0.5));
      v.alpha = (still ? clamp(since / 0.1) : 1) * (1 - leave);
    }
  };

  // The three's moves: into their stances on the first beat, bobbing to it, the teachers striking on the hits, a teacher
  // leaping and spinning with each cut and Ronnie copying with a smaller hop, all three leaping on the ninth.
  const hop = (k: number, height: number) => (k >= 0 && k < 1 ? height * Math.sin(Math.PI * k) : 0);
  const pose = (a: Actor, who: number, b: number) => {
    a.lift = 0;
    a.lean = 0;
    a.squash = 1;
    if (still || b < 0) {
      // Ronnie leans into each throw.
      if (!still && who === 0 && t < tossEnd) a.lean = 0.25 * Math.abs(Math.sin((t / THROW_EVERY) * Math.PI * 0.5));
      return;
    }
    const k = b - Math.floor(b);
    a.squash = 1 - 0.08 * clamp(1 - k / 0.2);
    a.lift = hop(b / 0.5, 10) + hop((b - CUT_LAST) / 1.2, 22);
    if (b >= 0.5 && b < CUT_FROM) a.lift += hop((k - 0.5) / 0.5, 2);
    if (who > 0 && ((b >= 2.5 && b < 2.9) || (b >= 3 && b < 3.4))) a.lean = 0.35;
    if (b >= CUT_FROM && b < CUT_LAST) {
      const i = Math.floor((b - CUT_FROM) / CUT_STEP), kk = (b - CUT_FROM - i * CUT_STEP) / CUT_STEP;
      if (who === 1 + (i % 2)) {
        a.lift += hop(kk, 9);
        a.lean = 0.3;
        // A spin: turned about and back while in the air.
        const away = restFacing[who - 1] === 'left' ? 'right' : 'left';
        a.facing = kk > 0.25 && kk < 0.6 ? away : restFacing[who - 1]!;
      } else if (who === 0) a.lift += hop(kk, 4);
    }
    if (b >= CUT_LAST) for (const [j, f] of restFacing.entries()) teachers[j]!.facing = f;
  };

  // The smoke bombs the cherries became, on the pile's spots, in upright units from it; `take` seconds into Ronnie taking
  // them, each flies up and into him, shrinking, one after another.
  bombs.position.set(pile.x, pile.y);
  bombs.scale.set(1, 1 / w.ground);
  const drawBombs = (take: number | null) => {
    bombs.clear();
    const [tx, ty] = [pupil.x - pile.x, (pupil.y - pile.y) * w.ground - pupil.size];
    // Bottom row first, so each can stands over the cap of the one under it.
    for (const [i, [px, py]] of CANS.entries()) {
      const f = take === null ? 0 : clamp((take - (CANS.length - 1 - i) * TAKE_EVERY) / TAKE_FLIGHT);
      if (f >= 1) continue;
      const k = still ? f : EASE.out(f);
      drawSmokeBomb(bombs, px + (tx - px) * k, py + (ty - py) * k - Math.sin(f * Math.PI) * 14, CAN_R * (1 - f * 0.5), still ? 0 : f * 4, 1.1, null, 0.25);
    }
  };

  const lesson = new Promise<void>((resolve) => {
    w.addTask({
      step: (dt) => {
        if (stop()) return true;
        t += dt;
        const b = (t - tossEnd) / NINJA_BEAT;
        if (t < tossEnd + 0.05) drawToss();
        else flying.clear();
        if (b >= 0 && !soundPlaying) soundPlaying = g.audio.playOver('ninja_beat', MUSIC_DUCK_DB);
        kujiShown.beat = b;
        kujiShown.cuts = b < CUT_FROM ? 0 : Math.min(CUTS, Math.floor((b - CUT_FROM) / CUT_STEP) + 1);
        players.forEach((a, who) => pose(a, who, b));
        drawLights(b);
        drawCuts(b);
        drawSeals(b);
        kujiShown.banner = banner.pose((b - CUT_LAST) * NINJA_BEAT, still, centre()[1] + spacing * 2.6);
        if (b >= CUT_LAST && !shaken) {
          shaken = true;
          if (!still) w.shakeTime = Math.max(w.shakeTime, 0.4);
        }
        // The ninjas go in a puff, and the cherries are smoke bombs.
        const poof = (b - NINJA_BEATS) * NINJA_BEAT;
        if (poof >= 0 && !gone) {
          gone = true;
          g.audio.play('smoke_poof');
          for (const a of teachers) a.hidden = true;
          heap.visible = false;
          drawBombs(null);
          bombs.visible = true;
        }
        drawPuffs(puffs, w, [teachers[0], teachers[1], { x: pile.x, y: pile.y, size: teachers[0].size }], poof, still);
        return poof >= POOF_S;
      },
      resolve,
    });
  });
  const take = () => new Promise<void>((resolve) => {
    let k = 0;
    g.audio.play('pickup');
    w.addTask({
      step: (dt) => {
        if (stop()) return true;
        k += dt;
        drawBombs(k);
        return k >= (CANS.length - 1) * TAKE_EVERY + TAKE_FLIGHT;
      },
      resolve,
    });
  });
  const done = () => {
    for (const x of [flying, heap, bombs, puffs]) if (!x.destroyed) x.destroy({ children: true });
    w.cameraTarget = camera;
  };
  return lesson.then(async () => {
    // The beat rings on under Ronnie's line, the music coming back up at its end; it stops if the scene is cut short.
    if (stop()) soundPlaying?.stop();
    for (const a of players) {
      a.lift = 0;
      a.lean = 0;
      a.squash = 1;
      a.scripted = Math.max(0, a.scripted - 1);
    }
    teachers.forEach((a, j) => (a.facing = restFacing[j]!));
    kujiShown.beat = null;
    kujiShown.cuts = 0;
    kujiShown.banner = false;
    if (!over.destroyed) over.destroy({ children: true });
    if (!stop() && after) await after();
    if (!stop()) await take();
    done();
  }, (err) => {
    done();
    throw err;
  });
}

/**
 * Puffs of smoke where each of `spots` stood, `k` seconds after it went: a few billows bursting out and rising, inked and
 * shaded as Ronnienomics!'s cloud is, fading as they go.
 */
function drawPuffs(g: Graphics, w: World, spots: ReadonlyArray<{ x: number; y: number; size: number }>, k: number, still: boolean): void {
  g.clear();
  if (k < 0 || k >= POOF_S) return;
  const age = k / POOF_S;
  g.alpha = 1 - clamp((age - 0.4) / 0.6);
  for (const [n, s] of spots.entries()) {
    const sub = { x: s.x, y: s.y - (s.size * 1.1) / w.ground };
    const r = s.size * (still ? 0.8 : 0.5 + 0.6 * EASE.out(clamp(age * 2.2)));
    const rise = still ? 0 : age * s.size * 1.4;
    const blobs = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2 + n;
      return { x: sub.x + Math.cos(a) * r * 0.75, y: sub.y + (Math.sin(a) * r * 0.55 - rise) / w.ground, r: r * (0.62 + ((i * 37 + n * 11) % 10) / 40) };
    });
    const line = Math.max(1.2, s.size * 0.12);
    for (const p of blobs) g.ellipse(p.x, p.y, p.r + line, (p.r + line) / w.ground).fill(INK);
    for (const p of blobs) g.ellipse(p.x, p.y, p.r, p.r / w.ground).fill(PAPER_DARK);
    for (const p of blobs) g.ellipse(p.x - p.r * 0.12, p.y - (p.r * 0.16) / w.ground, p.r * 0.84, (p.r * 0.84) / w.ground).fill(PAPER);
    if (!still && age < 0.3) g.poly(burstPoints(sub.x, sub.y, s.size * (0.8 + age * 3), 8, 0.5, 0.3)).fill({ color: 0xffffff, alpha: 1 - age / 0.3 });
  }
}

/**
 * The panel at the end of the lesson, as Revival's "1UP!" is in a fight and in its proportions: "NEW SPECIAL:" in extruded
 * yellow poster letters beside the move's name, on an ink band printed with pink dots between yellow rules, at an angle,
 * `who`'s portrait standing on the band's top edge over the start of the words, turned against it as in a special's
 * splash (the owner, 2026-11-07), so it takes no room from the words; slammed in from the left, held, and gone to the
 * right; with Reduce motion it fades in and out where it stands. It holds long enough to read, and at least until `gone`
 * seconds after it came, when it has just left. `pose` takes the seconds since it came, and returns whether it shows.
 */
export function learnedBanner(g: GameContext, over: Container, who = 'ronnie', gone = 0): { pose: (k: number, still: boolean, cy: number) => boolean } {
  const panel = g.layout.panel;
  const u = g.layout.unit;
  const big = g.msg('ninja', 'learned');
  const small = g.content.specials.ronnienomics?.name.toUpperCase() ?? 'RONNIENOMICS!';
  const H = Math.round(Math.max(u * 2.6, Math.min(panel.h * 0.2, panel.w * 0.2)));
  const cx = panel.w / 2;
  const { long: L, reach } = revivalBannerSpan(cx, panel.w, H);
  const root = new Container();
  const inner = new Container();
  inner.rotation = REVIVAL_BANNER_TILT;
  const band = new Graphics();
  band.rect(-L / 2, -H / 2, L, H).fill(INK);
  benDay(band, { x: -L / 2, y: -H / 2, w: L, h: H }, { color: POP_PINK, alpha: 0.85, pitch: H * 0.16, from: [-panel.w * 0.1, 0], to: [panel.w * 0.35, 0] });
  for (const y of [-H / 2 - H * 0.1, H / 2]) band.rect(-L / 2, y, L, H * 0.1).fill(POP_YELLOW).stroke({ color: INK, width: 2 });
  const word = new Text({ text: big, style: letterStyle(Math.round(H * 0.82), POP_YELLOW, { outline: true, extrude: true }) });
  word.anchor.set(1, 0.5);
  const line = new Text({ text: small, style: letterStyle(Math.round(H * 0.3), 0xffffff, { outline: true }) });
  line.anchor.set(0, 0.5);
  const gap = H * 0.25;
  const fit = Math.min(1, (panel.w * 0.92) / (word.width + gap + line.width));
  word.x = (-(word.width + gap + line.width) * fit) / 2 + word.width * fit;
  word.scale.set(fit);
  line.position.set(word.x + gap * fit, H * 0.05 * fit);
  line.scale.set(fit);
  const size = Math.round(H * 0.95);
  const pic = new Container();
  pic.addChild(new Graphics().rect(measures(u).S, measures(u).S, size, size).fill(INK), portrait(who, size, u, false));
  pic.pivot.set(size / 2, size / 2);
  pic.rotation = 0.1;
  pic.position.set(Math.max(-panel.w / 2 + size * 0.6, word.x - word.width + size * 0.5), -H / 2 - size * 0.38);
  inner.addChild(band, word, line, pic);
  root.addChild(inner);
  root.visible = false;
  over.addChild(root);
  const into = 0.12, out = 0.16;
  const hold = Math.max(bannerHoldSeconds(`${big} ${small}`, into, 1.2), gone - into - out);
  return {
    pose: (k, still, cy) => {
      root.visible = k > 0 && k < into + hold + out;
      if (!root.visible) return false;
      const slide = still ? 0 : k < into ? EASE.out(k / into) - 1 : k < into + hold ? 0 : Math.min(1, (k - into - hold) / out) ** 2;
      root.alpha = still ? Math.min(1, k / into, (into + hold + out - k) / out) : 1;
      inner.position.set(cx + slide * reach, Math.min(panel.h - H, cy));
      word.scale.set(fit * (still ? 1 : 1 + 0.6 * (1 - EASE.out(Math.min(1, k / 0.18))) + 0.04 * k));
      return true;
    },
  };
}
