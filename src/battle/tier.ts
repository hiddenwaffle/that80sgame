import { Container, Graphics, Text } from 'pixi.js';
import type { GameContext } from '../game/context.ts';
import { FONT } from '../render/fonts.ts';
import { EASE, motion, MS, onBeat } from '../render/motion.ts';
import { BOX, INK, INK_SOFT, PAPER, PAPER_DARK, POP_CYAN, RED_INK } from '../render/palette.ts';
import { driftAt, VITAL, vitalWords } from '../ui/vital_fill.ts';
import { VitalFillMesh } from '../ui/vital_fill_mesh.ts';
import { anim } from '../ui/anim.ts';
import { TargetBox, decorateTargetCard, targetCardFill, targetGain } from '../ui/target_box.ts';
import { TargetReady } from '../ui/target_ready.ts';
import { TargetItemPop } from '../ui/target_item_pop.ts';
import { benDay, measures, SMALL_TEXT, Tab } from '../ui/print.ts';
import { portrait, portraits, type Portrait } from '../ui/portrait.ts';
import type { Fighter } from './battle.ts';
import { CRITICAL_HP, statusCues } from './cues.ts';
import { BAR_PAD, tierLayout, WORD_SIZES, WORDS_GAP, type BarMeasured, type BarWords, type Rect, type TierGeometry } from './tierLayout.ts';

/** What one card shows, apart from colour, for the browser checks. */
export interface CardMarks {
  ready: boolean;
  low: boolean;
  down: boolean;
  mpFill: number;
  barColour: number;
  /** Bracketed: chosen for an item, or part of a move on the whole party, or acting. */
  marked: boolean;
  /** The red trail of HP just lost, and whether the card's edge flashes red from a blow. */
  trail: number;
  hurt: boolean;
}

interface Card {
  f: Fighter;
  root: Container;
  shadow: Graphics;
  face: Container;
  plate: Graphics;
  /** The bars' empty tracks, and the hatching of a downed member's Health bar: drawn again when the member goes down or up. */
  track: Graphics;
  trackDown: boolean | null;
  /** The fills and their drifting dots, worked out on the graphics card each frame; nothing in them is drawn again. */
  hpFill: VitalFillMesh;
  mpFill: VitalFillMesh;
  /** Over the fills: Health's red trail, both outlines, an item's gain and a blow's red edge. Drawn again when those change. */
  dyn: Graphics;
  /** What `dyn` was last drawn for. */
  dynInputs: unknown[];
  /** Where the fill ends on each bar, as the masks were last drawn for it. */
  hpEdge: number;
  mpEdge: number;
  tab: Tab;
  targetBox: TargetBox;
  readyBox: TargetReady;
  itemPop: TargetItemPop;
  /** The Health and Energy numbers, as printed over the empty part of their bars. */
  hp: Text;
  mp: Text;
  /**
   * The Health bar's words, printed twice, both with an ink outline: in the bar's own pink, lightened, over the empty part
   * and light over the fill, each clipped at the fill's edge by its mask, so the colours flip where the fill ends.
   */
  hpInk: Container;
  hpPaper: Container;
  hpPaperNumbers: Text;
  inkMask: Graphics;
  paperMask: Graphics;
  /** The Energy bar's words, printed twice the same way. */
  mpInk: Container;
  mpPaper: Container;
  mpPaperNumbers: Text;
  mpInkMask: Graphics;
  mpPaperMask: Graphics;
  hit: Graphics;
  /** What the card's plate and tab were last drawn as, so they are drawn again only when that changes. */
  state: string;
  raised: boolean;
  /** DOWN, as a rubber stamp over the empty Health bar. */
  stamp: Container;
  /** The gauge: the share shown, a red trail of HP just lost, and a heal growing in. */
  frac: number;
  trail: { top: number; age: number } | null;
  grow: { from: number; age: number } | null;
  /** Until when the card's edge flashes red from a blow. */
  flashUntil: number;
  /** The member's portrait, on a card wide enough for one. */
  portrait: Portrait | null;
}

/** How the fight's interface wants the cards shown this frame. */
export interface TierView {
  itemPreview?: { target: Fighter; change: { stat: 'hp' | 'mp'; from: number; to: number }; revive: boolean } | null;
  acting: Fighter | null;
  deciding: boolean;
  /** Chosen for an item, or every member for a move on the party. */
  marked: (f: Fighter) => boolean;
  /** Faint: an item could do nothing for them. */
  out: (f: Fighter) => boolean;
}

/**
 * The fight's member strip: a paper band along the foot of the panel, under a double rule, with a
 * card per member. Each card has a name tab, and a Health bar and an Energy bar with their words inside; the member
 * acting has a raised card with a cyan tab. Cards, tabs, and words are made once per layout and
 * changed in place; only the gauges, bars, and brackets are drawn each frame. What is tapped (the
 * cards, and the band that swallows slips) never moves; the drawing may.
 */
export class Tier {
  /** The drawing: band, rule, and cards. */
  readonly container = new Container();
  /** What is tapped: the band and the cards. */
  readonly hits = new Container();
  geo!: TierGeometry;
  cards: Card[] = [];
  /** The words each card shows, by `index:part`, for the browser checks. */
  readonly texts = new Map<string, Text>();
  private readonly shown: CardMarks[] = [];
  private u = 13;
  /** A line per member rather than cards, from the last build. */
  private rows = false;

  private readonly game: GameContext;
  private readonly party: Fighter[];
  private readonly onTap: (f: Fighter) => void;
  private readonly onHover: (f: Fighter) => void;

  constructor(game: GameContext, party: Fighter[], onTap: (f: Fighter) => void, onHover: (f: Fighter) => void = () => {}) {
    this.game = game;
    this.party = party;
    this.onTap = onTap;
    this.onHover = onHover;
  }

  /** Measures the words the strip will show, lays it out, and makes its cards: a line per member on an upright screen unless `rows` is false. */
  build(panel: { w: number; h: number }, u: number, wide: boolean, actionW: number, rows = !wide): void {
    const g = this.game;
    this.u = u;
    this.rows = rows;
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    for (const c of this.hits.removeChildren()) c.destroy({ children: true });
    this.texts.clear();
    this.cards = [];
    const m = measures(u);
    const tabs = this.party.map((f) => new Tab(f.name, u, { keyline: true }));
    this.geo = tierLayout({
      panel,
      u,
      wide,
      rows,
      count: this.party.length,
      measured: {
        tabH: tabs[0]!.height,
        nameW: tabs.map((t) => t.width),
        health: measuredBar(g, this.party, u, 'health'),
        energy: measuredBar(g, this.party, u, 'energy'),
        actionW,
      },
    });
    const geo = this.geo;
    // The band: cyan along the foot, printed with white dots, under a double rule. It takes taps, so a slip onto it does nothing.
    const band = new Graphics().rect(geo.band.x, geo.band.y, geo.band.w, geo.band.h).fill(POP_CYAN);
    benDay(band, geo.band, { color: 0xffffff, alpha: 0.4, pitch: u * 0.7, from: [geo.band.x, geo.band.y], to: [geo.band.x + geo.band.w * 0.4, geo.band.y + geo.band.h] });
    band.rect(0, geo.rule.y1, geo.rule.x1, m.L).fill(INK);
    band.rect(0, geo.rule.y2 - Math.ceil(m.l), geo.rule.x1, Math.ceil(m.l)).fill(INK);
    this.container.addChild(band);
    const catcher = new Graphics().rect(geo.band.x, geo.band.y, geo.band.w, geo.band.h).fill({ color: 0xffffff, alpha: 0.001 });
    catcher.eventMode = 'static';
    this.hits.addChild(catcher);
    for (const [i, f] of this.party.entries()) {
      const cg = geo.cards[i]!;
      const c = cg.card;
      const root = new Container();
      const shadow = new Graphics().rect(0, 0, c.w, c.h).fill(INK);
      shadow.position.set(c.x + m.S, c.y + m.S);
      const face = new Container();
      const plate = new Graphics();
      const track = new Graphics();
      const hpFill = new VitalFillMesh(`tier_hp_fill_${i}`), mpFill = new VitalFillMesh(`tier_mp_fill_${i}`);
      const dyn = new Graphics();
      // Labels name what is redrawn, for tools/gl_profile.ts --diagnose; they change nothing on screen.
      plate.label = `tier_plate_${i}`;
      track.label = `tier_tracks_${i}`;
      dyn.label = `tier_gauges_${i}`;
      const targetBox = new TargetBox();
      const readyBox = new TargetReady();
      const itemPop = new TargetItemPop();
      face.addChild(plate, track, hpFill.mesh, mpFill.mesh, dyn, readyBox.container, targetBox.container);
      // The member's portrait, on a card wide enough for one: their own figure until the art arrives.
      let pic: Portrait | null = null;
      if (cg.portrait) {
        pic = portrait(f.actor.look, cg.portrait.w, u, f.hp <= 0);
        pic.position.set(cg.portrait.x, cg.portrait.y);
        face.addChild(pic);
      }
      const tab = tabs[i]!;
      tab.container.position.set(cg.tab.x, cg.tab.y);
      // DOWN: a red rubber stamp over the empty Health bar, set a little crooked.
      const stamp = new Container();
      const word = new Text({ text: g.msg('battle', 'down'), style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(u * Math.min(1.1, geo.words.hp.size)), fill: RED_INK, letterSpacing: 1 } });
      word.anchor.set(0.5);
      const sw = word.width + u * 0.6;
      const sh = word.height * 0.8;
      stamp.addChild(new Graphics().rect(-sw / 2, -sh / 2, sw, sh).stroke({ width: Math.max(1.5, m.l * 1.5), color: RED_INK }), word);
      stamp.rotation = -0.105;
      stamp.position.set(cg.gauge.x + cg.gauge.w / 2, cg.gauge.y + cg.gauge.h / 2);
      stamp.visible = false;
      // The words inside the bars: the label at the left, the numbers at the right.
      const words = (set: BarWords, fill: number) => {
        const label = new Text({ text: '', style: barStyle(u, set.labelSize, fill) });
        const numbers = new Text({ text: '', style: barStyle(u, set.size, fill) });
        return { label, numbers };
      };
      const beyond = vitalWords();
      const hpInk = words(geo.words.hp, beyond.hp);
      const hpPaper = words(geo.words.hp, PAPER);
      const mpWords = words(geo.words.mp, beyond.mp);
      const mpLight = words(geo.words.mp, PAPER);
      hpInk.label.text = hpPaper.label.text = g.msg('battle', geo.words.hp.short ? 'hp_short_label' : 'hp_label');
      mpWords.label.text = mpLight.label.text = g.msg('battle', 'mp_label');
      for (const w of [hpInk, hpPaper]) placeWords(w.label, w.numbers, cg.hp, u, geo.words.hp);
      for (const w of [mpWords, mpLight]) placeWords(w.label, w.numbers, cg.mp, u, geo.words.mp);
      const inkSide = new Container();
      inkSide.addChild(hpInk.label, hpInk.numbers);
      const paperSide = new Container();
      paperSide.addChild(hpPaper.label, hpPaper.numbers);
      const inkMask = new Graphics();
      const paperMask = new Graphics();
      inkMask.label = `tier_mask_hp_ink_${i}`; paperMask.label = `tier_mask_hp_paper_${i}`;
      inkSide.mask = inkMask;
      paperSide.mask = paperMask;
      const mpInkSide = new Container(), mpPaperSide = new Container(), mpInkMask = new Graphics(), mpPaperMask = new Graphics();
      mpInkMask.label = `tier_mask_mp_ink_${i}`; mpPaperMask.label = `tier_mask_mp_paper_${i}`;
      mpInkSide.addChild(mpWords.label, mpWords.numbers);
      mpPaperSide.addChild(mpLight.label, mpLight.numbers);
      mpInkSide.mask = mpInkMask;
      mpPaperSide.mask = mpPaperMask;
      face.addChild(inkSide, paperSide, inkMask, paperMask, mpInkSide, mpPaperSide, mpInkMask, mpPaperMask, stamp, tab.container, itemPop.container);
      const hp = hpInk.numbers;
      const mp = mpWords.numbers;
      root.addChild(shadow, face);
      this.container.addChild(root);
      // The card is tapped anywhere on it, its name tab included.
      const hit = new Graphics().rect(c.x, cg.tab.y, c.w, c.y + c.h - cg.tab.y).fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointertap', (e) => {
        e.stopPropagation();
        this.onTap(f);
      });
      // A mouse over the card is a mouse over the member, as over their figure (the owner, 2026-10-29). Not touch, where
      // the pointer only passes over on its way to a tap.
      hit.on('pointermove', (e) => {
        if (e.pointerType === 'mouse') this.onHover(f);
      });
      this.hits.addChild(hit);
      this.texts.set(`${i}:name`, tab.label);
      this.texts.set(`${i}:hp`, hp);
      this.texts.set(`${i}:mp`, mp);
      this.texts.set(`${i}:hpLabel`, hpInk.label);
      this.texts.set(`${i}:mpLabel`, mpWords.label);
      const frac = Math.max(0, Math.min(1, f.hp / f.maxHp));
      this.cards.push({ f, root, shadow, face, plate, track, trackDown: null, hpFill, mpFill, dyn, dynInputs: [], hpEdge: NaN, mpEdge: NaN, tab, targetBox, readyBox, itemPop, hp, mp, hpInk: inkSide, hpPaper: paperSide, hpPaperNumbers: hpPaper.numbers, inkMask, paperMask, mpInk: mpInkSide, mpPaper: mpPaperSide, mpPaperNumbers: mpLight.numbers, mpInkMask, mpPaperMask, hit, state: '', raised: false, stamp, frac, trail: null, grow: null, flashUntil: 0, portrait: pic });
    }
  }

  /** The drawing that may move (for the fight's opening), never what is tapped. */
  skins(): Container[] {
    return [this.container];
  }

  /** Shows the cards as `view` says. `still` draws them at once, with no motion, as after the cards are made again. */
  update(view: TierView, still = false): void {
    const g = this.game;
    const u = this.u;
    const m = measures(u);
    const full = g.content.battle.bar;
    const t = g.time;
    const targetingMember = this.party.some(f => view.marked(f));
    for (const [i, c] of this.cards.entries()) {
      const f = c.f;
      const cg = this.geo.cards[i]!;
      const cues = statusCues(f, full);
      cues.ready = view.acting === f && view.deciding && f.hp > 0;
      const out = view.out(f);
      const acting = view.acting === f;
      const marked = view.marked(f);
      // The plate and tab, drawn again only when the card's state changes.
      const state = `${cues.down}|${out}|${acting}|${marked}`;
      if (state !== c.state) {
        c.state = state;
        const r = cg.card;
        c.plate.clear().rect(r.x, r.y, r.w, r.h).fill(marked ? targetCardFill() : cues.down || out ? PAPER_DARK : BOX).stroke({ width: m.L, color: INK });
        if (marked) decorateTargetCard(c.plate, r, u);
        c.tab.setInk(marked ? 'pink' : acting ? 'cyan' : cues.down || out ? 'faint' : 'ink');
        // A portrait follows the member down and back up.
        if (c.portrait && c.portrait.ko !== cues.down) {
          const at = this.geo.cards[i]!.portrait!;
          const idx = c.face.getChildIndex(c.portrait);
          c.portrait.destroy({ children: true });
          c.portrait = portrait(f.actor.look, at.w, u, cues.down);
          c.portrait.position.set(at.x, at.y);
          c.face.addChildAt(c.portrait, idx);
        }
      }
      this.raise(c, acting, !still);
      // Words, in place. A member who is down shows the DOWN stamp over the Health bar instead of its words.
      c.stamp.visible = cues.down;
      c.hpInk.visible = c.hpPaper.visible = !cues.down;
      const hp = spacedSlash(g.msg('battle', 'hp_line', { hp: f.hp, max: f.maxHp }));
      if (c.hp.text !== hp) c.hp.text = c.hpPaperNumbers.text = hp;
      // Low Health keeps the same flip as any other, no red numbers and no "!": the bar itself carries the warning (the
      // owner, 2026-10-29: "Let's go ahead and remove the exclamation mark").
      const mp = g.msg('battle', 'mp_line', { mp: f.member?.mp ?? 0 });
      if (c.mp.text !== mp) c.mp.text = c.mpPaperNumbers.text = mp;
      // The Health and Energy bars, in three layers: the empty tracks, the fills with their dots, and the trail, outlines and
      // preview over them. The fills are worked out on the graphics card from numbers set every step (src/ui/vital_fill_mesh.ts,
      // the owner's pick on 5 Nov 2026). The tracks and the top layer are drawn again only when something they draw changes:
      // a Graphics drawn again makes Pixi rebuild the whole stage's draw list.
      const d = c.dyn;
      const gg = cg.gauge;
      const frac = Math.max(0, Math.min(1, f.hp / f.maxHp));
      const trail = this.gauge(c, frac, still);
      let shown = 0, driftHp = 0, wash = 0;
      if (!cues.down) {
        shown = c.grow ? c.grow.from + (frac - c.grow.from) * EASE.out(Math.min(1, c.grow.age / 0.2)) : frac;
        // The fill keeps its colour when Health is low; the pulse below carries the warning (the owner, 2026-10-16, when it
        // was ink). Pink with printed dots since 2026-10-29 (src/ui/vital_fill.ts).
        // The dots drift as on the party menu (the owner, 2026-10-29: "might be consistent"). Below CRITICAL_HP they run three
        // times as fast.
        const critical = cues.low && f.hp / f.maxHp < CRITICAL_HP;
        driftHp = driftAt(anim.clock * (critical ? 3 : 1), motion.reduced);
        // Low Health pulses on the beat, in time with the glove: a red wash over the fill that fades within the beat. Below
        // CRITICAL_HP it strobes, a sharper and stronger flash on every half beat; with reduced motion it holds a steady wash.
        wash = !cues.low ? 0 : !critical ? 0.55 * onBeat(anim.clock) : motion.reduced ? 0.4 : 0.8 * onBeat(anim.clock * 2) ** 2;
      }
      const b = cg.bar;
      const maxMp = f.member?.maxMp ?? 0;
      const mpFill = maxMp > 0 ? Math.max(0, Math.min(1, (f.member?.mp ?? 0) / maxMp)) : 0;
      const driftMp = driftAt(anim.clock, motion.reduced);
      // The bars' empty parts are the card's own paper; a downed member's Health bar is hatched.
      if (c.trackDown !== cues.down) {
        c.trackDown = cues.down;
        c.track.clear().rect(gg.x, gg.y, gg.w, gg.h).fill(BOX).rect(b.x, b.y, b.w, b.h).fill(BOX);
        if (cues.down) this.hatch(c.track, gg.x, gg.y, gg.w, gg.h);
      }
      c.hpFill.set(gg, shown, VITAL.hp, u, driftHp, shown > 0 ? wash : 0);
      c.mpFill.set(b, mpFill, VITAL.mp, u, driftMp);
      const preview = view.itemPreview?.target === f ? view.itemPreview : null;
      const stat = preview?.change.stat ?? 'hp', gr = stat === 'hp' ? cg.gauge : cg.bar;
      const r = cg.card;
      const hurt = t < c.flashUntil;
      const inputs = [cues.down, trail, frac, preview ? stat : null, preview?.change.from, preview?.change.to, preview ? (stat === 'hp' ? f.maxHp : maxMp) : null, hurt];
      if (inputs.some((v, k) => v !== c.dynInputs[k])) {
        c.dynInputs = inputs;
        d.clear();
        if (!cues.down && trail > 0) {
          d.rect(gg.x + gg.w * frac, gg.y, gg.w * trail, gg.h).fill({ color: RED_INK, alpha: 0.45 });
          d.rect(gg.x + gg.w * frac - 0.75, gg.y, 1.5, gg.h).fill(PAPER);
        }
        // Each bar's outline is drawn over its fill, so the fill sits inside the line rather than over its inner half (the
        // owner, 2026-10-29: a thin line of the border was hidden).
        d.rect(gg.x, gg.y, gg.w, gg.h).stroke({ width: m.l, color: INK });
        d.rect(b.x, b.y, b.w, b.h).stroke({ width: m.l, color: INK });
        if (preview) targetGain(d, gr, preview.change.from, preview.change.to, stat === 'hp' ? f.maxHp : maxMp, u);
        // A blow: the card's edge shows red for a moment, beside the number on the figure.
        if (hurt) d.rect(r.x, r.y, r.w, r.h).stroke({ width: m.L, color: RED_INK });
      }
      // The words' colours flip where the fill ends: light over the fill, the bar's own colour lightened over the empty part,
      // both outlined in ink (the owner, 2026-10-29: "light words, definitely", then "flip the pink and yellow, not ... black").
      // The masks are drawn again only when the fill's end moves.
      const edge = gg.x + gg.w * shown;
      if (edge !== c.hpEdge) {
        c.hpEdge = edge;
        c.paperMask.clear().rect(gg.x, gg.y, Math.max(0, edge - gg.x), gg.h).fill(0xffffff);
        c.inkMask.clear().rect(edge, gg.y, Math.max(0, gg.x + gg.w - edge), gg.h).fill(0xffffff);
      }
      const mpEdge = b.x + b.w * mpFill;
      if (mpEdge !== c.mpEdge) {
        c.mpEdge = mpEdge;
        c.mpPaperMask.clear().rect(b.x, b.y, Math.max(0, mpEdge - b.x), b.h).fill(0xffffff);
        c.mpInkMask.clear().rect(mpEdge, b.y, Math.max(0, b.x + b.w - mpEdge), b.h).fill(0xffffff);
      }
      c.mpInk.visible = c.mpPaper.visible = !(preview && stat === 'mp');
      if (preview && stat === 'hp') c.hpInk.visible = c.hpPaper.visible = false;
      const whole = !!preview?.revive;
      if (c.portrait) c.portrait.visible = !whole;
      if (whole && !cg.portrait) c.stamp.visible = false;
      // A card without a portrait pops the face over its Energy bar's end; a line, where its DOWN stamp stood, inside the line.
      const small = Math.min(u * 2.4, this.rows ? r.h - 2 : r.h * .46);
      const portraitRect = cg.portrait ?? (this.rows
        ? { x: cg.gauge.x + (cg.gauge.w - small) / 2, y: r.y + (r.h - small) / 2, w: small, h: small }
        : { x: r.x + r.w - u * .65 - small, y: cg.bar.y - u * .35 - small, w: small, h: small });
      c.itemPop.show(preview ? {
        key: `${i}:${stat}:${whole}`, kind: whole ? 'portrait' : stat, rect: whole ? portraitRect : gr, u,
        from: preview.change.from, to: preview.change.to, max: stat === 'hp' ? f.maxHp : maxMp,
        native: whole ? { kind: 'portrait', look: f.actor.look } : {
          kind: 'battle', gauge: gr, fill: stat === 'hp' ? VITAL.hp : VITAL.mp, line: m.l, splitInk: true,
          sources: stat === 'hp' ? c.hpInk.children as Text[] : [this.texts.get(`${i}:mpLabel`)!, c.mp],
        },
      } : null);
      c.targetBox.show(marked ? r : null, u);
      c.readyBox.show(acting && f.hp > 0 && !marked ? r : null, u, targetingMember);
      this.shown[i] = { ready: cues.ready, low: cues.low && !cues.down, down: c.stamp.visible && cues.down, mpFill, barColour: VITAL.mp, marked, trail, hurt };
    }
  }

  private lastT = -1;

  /**
   * The gauge's motion, from the game's clock: HP lost drops the fill at once and leaves a red trail
   * that holds a moment and shrinks away; HP gained grows in. With reduced motion, or when `still`,
   * it simply shows the new share. Returns the trail's share of the gauge.
   */
  private gauge(c: Card, frac: number, still: boolean): number {
    const t = this.game.time;
    const dt = this.lastT < 0 ? 0 : Math.max(0, t - this.lastT);
    if (c === this.cards[this.cards.length - 1]) this.lastT = t;
    if (still || motion.reduced) {
      c.trail = null;
      c.grow = null;
    } else if (frac < c.frac) {
      c.trail = { top: Math.max(c.frac, c.trail?.top ?? 0), age: 0 };
      c.grow = null;
    } else if (frac > c.frac) {
      c.grow = { from: c.frac, age: 0 };
      c.trail = null;
    }
    c.frac = frac;
    let w = 0;
    if (c.trail) {
      c.trail.age += dt;
      const full = c.trail.top - frac;
      w = c.trail.age < 0.25 ? full : full * (1 - EASE.out(Math.min(1, (c.trail.age - 0.25) / 0.3)));
      if (c.trail.age >= 0.55) c.trail = null;
    }
    if (c.grow) {
      c.grow.age += dt;
      if (c.grow.age >= 0.2) c.grow = null;
    }
    return Math.max(0, w);
  }

  /** A downed member's empty gauge, hatched at 45 degrees. */
  private hatch(d: Graphics, x: number, y: number, w: number, h: number): void {
    const pitch = Math.max(4, this.u * 0.4);
    for (let x0 = x - h; x0 < x + w; x0 += pitch) {
      let ax = x0;
      let ay = y + h;
      let bx = x0 + h;
      let by = y;
      if (ax < x) {
        ay -= x - ax;
        ax = x;
      }
      if (bx > x + w) {
        by += bx - (x + w);
        bx = x + w;
      }
      if (ax < bx) d.moveTo(ax, ay).lineTo(bx, by);
    }
    d.stroke({ width: Math.max(1, this.u * 0.06), color: INK_SOFT });
  }

  /** A blow on this member: the card's edge shows red for 300 ms. */
  flash(f: Fighter): void {
    const c = this.cards.find((x) => x.f === f);
    if (c) c.flashUntil = this.game.time + 0.3;
  }

  /** The acting member's card stands up off the page: its face lifts and its shadow lengthens. */
  private raise(c: Card, up: boolean, animate: boolean): void {
    if (up === c.raised) return;
    c.raised = up;
    const m = measures(this.u);
    const lift = this.geo.raise;
    const r = this.geo.cards[this.cards.indexOf(c)]!.card;
    anim.finish(c.face);
    c.face.y = up ? -lift : 0;
    // Half as far again, which keeps a raised card's solid shadow inside the strip's margin.
    const raisedS = Math.round(m.S * 1.5);
    const s = up ? raisedS : m.S;
    const ds = raisedS - m.S;
    c.shadow.position.set(r.x + s, r.y + s);
    if (!animate) return;
    anim.play(c.face, c.face, { dy: up ? lift : -lift }, MS.tab, EASE.out);
    anim.play(c.face, c.shadow, { dx: up ? -ds : ds, dy: up ? -ds : ds }, MS.tab, EASE.out);
  }

  /** How many portraits exist, for the checks (to see none are left behind when the strip is made again). */
  static get livePortraits(): number {
    return portraits.live;
  }

  marks(i: number): CardMarks | null {
    return this.shown[i] ?? null;
  }

  destroy(): void {
    for (const c of this.cards) {
      anim.finish(c.face);
    }
    this.container.destroy({ children: true });
    this.hits.destroy({ children: true });
  }
}

/**
 * The Health numbers with a hair space either side of the slash: the words' ink outline thickens every character, and
 * without it the slash touched the digits beside it (the owner, 2026-10-29).
 */
function spacedSlash(s: string): string {
  return s.replace('/', '\u200A/\u200A');
}

/** A bar's words at `size` text units, outlined in ink: light over the fill, or the bar's own colour lightened over its empty part. */
function barStyle(u: number, size: number, fill: number) {
  return { fontFamily: FONT.headline, fontWeight: '700' as const, fontSize: Math.round(u * size), fill, stroke: { color: INK, width: Math.max(2, Math.round(u * 0.14)), join: 'round' as const } };
}

/**
 * Puts a bar's label and numbers in its words' box: side by side, the label at the left and the numbers at the right,
 * centred on the bar's height; or stacked, the label over the numbers. Capitals sit a little low in their line, so
 * each line is lifted by a twentieth of its size.
 */
function placeWords(label: Text, numbers: Text, box: Rect, u: number, set: BarWords): void {
  const lp = u * set.labelSize;
  const np = u * set.size;
  label.anchor.set(0, 0.5);
  numbers.anchor.set(1, 0.5);
  if (!set.stacked) {
    label.position.set(box.x, box.y + box.h / 2 - lp * 0.05);
    numbers.position.set(box.x + box.w, box.y + box.h / 2 - np * 0.05);
    return;
  }
  const pad = (box.h - (lp + np) * 1.12) / 2;
  label.position.set(box.x, box.y + pad + lp * 0.56 - lp * 0.05);
  numbers.position.set(box.x + box.w, box.y + pad + lp * 1.12 + np * 0.56 - np * 0.05);
}

/**
 * The label and the widest numbers a bar may hold, per member, at `size` text units: Health at full HP; Energy at the
 * most MP.
 */
export function barWords(g: GameContext, party: Fighter[], u: number, size: number, bar: 'health' | 'energy'): { label: number; numbers: number } {
  const t = new Text({ text: '', style: barStyle(u, size, PAPER) });
  const width = (s: string) => {
    t.text = s;
    return t.width;
  };
  const label = width(g.msg('battle', bar === 'health' ? 'hp_label' : 'mp_label'));
  let numbers = 0;
  for (const f of party) {
    numbers = Math.max(numbers, ...(bar === 'health'
      ? [width(spacedSlash(g.msg('battle', 'hp_line', { hp: f.maxHp, max: f.maxHp })))]
      : [width(g.msg('battle', 'mp_line', { mp: f.member?.maxMp ?? 0 }))]));
  }
  t.destroy();
  return { label, numbers };
}

/** A bar's words measured at each of the word sizes. */
function measuredBar(g: GameContext, party: Fighter[], u: number, bar: 'health' | 'energy'): BarMeasured {
  const at = WORD_SIZES.map((size) => barWords(g, party, u, size, bar));
  const short = new Text({ text: bar === 'health' ? g.msg('battle', 'hp_short_label') : '', style: barStyle(u, 1, PAPER) });
  const pixels = Array.from({ length: Math.round(u * WORD_SIZES[0]) }, (_, i) => {
    const font = Math.round(u * WORD_SIZES[0]) - i;
    const words = barWords(g, party, u, font / u, bar);
    short.style.fontSize = font;
    return { font, labelW: words.label, numbersW: words.numbers, ...(bar === 'health' ? { shortLabelW: short.width } : {}) };
  });
  short.destroy();
  return { labelW: [at[0]!.label, at[1]!.label, at[2]!.label], numbersW: [at[0]!.numbers, at[1]!.numbers, at[2]!.numbers], pixels };
}

/**
 * The narrowest a card's Health words may be and still sit side by side at the smallest size, past the bar's own inner
 * margins: what a wide screen keeps each card when it can, so its command slot does not squeeze them onto two lines.
 */
export function barWordsRoom(g: GameContext, party: Fighter[], u: number): number {
  const w = barWords(g, party, u, SMALL_TEXT, 'health');
  return w.label + u * WORDS_GAP + w.numbers + Math.round(u * BAR_PAD) * 2;
}
