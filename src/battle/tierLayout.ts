import { GLOVE_SLAB_REACH, measures, SMALL_TEXT, TAB_KEYLINE } from '../ui/print.ts';

/**
 * Where everything in the fight's member strip goes: the strip of panels along the foot of the
 * page, one card per member, and the slot where the command panel stands. Pure arithmetic from
 * sizes measured once per layout, so it can be tested at every screen shape and text size.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sizes the strip needs, measured once per layout from the words it will show. */
export interface TierMeasured {
  /** A name tab's height, and each member's tab width. */
  tabH: number;
  nameW: number[];
  /** The widest words inside each bar: Health with the low mark at the largest HP, and Energy at the most MP. */
  health: BarMeasured;
  energy: BarMeasured;
  /** The command panel's width, fixed per layout. */
  actionW: number;
}

/** A bar's label and its widest numbers, at each of `WORD_SIZES`. */
export interface BarMeasured {
  labelW: readonly [number, number, number];
  numbersW: readonly [number, number, number];
  /** Whole-pixel sizes, largest first, for fitting a narrow card without stacking. */
  pixels: ReadonlyArray<{ font: number; labelW: number; numbersW: number; shortLabelW?: number }>;
}

/** How a bar's words are set: the numbers' size, the label's, and whether the label stands over the numbers. */
export interface BarWords {
  size: number;
  labelSize: number;
  stacked: boolean;
  /** Health uses its short message only after the usual full-label sizes fail. */
  short?: boolean;
}

export interface CardGeometry {
  /** The card's body; its name tab straddles the top edge. */
  card: Rect;
  tab: { x: number; y: number };
  /** The Health bar, and the box inside it its words fill: the label at the left, the numbers at the right (or under it). */
  gauge: Rect;
  hp: Rect;
  /** The Energy bar under it, and its words' box. */
  bar: Rect;
  mp: Rect;
  /** A square for the member's portrait, on cards wide enough. */
  portrait: Rect | null;
}

export interface TierGeometry {
  /** The paper band, and the double rule along its top (its top line's top, and the lower line's bottom). */
  band: Rect;
  rule: { y1: number; y2: number; x1: number };
  /** Where the command panel stands: its foot, and its width. On a tall screen it stands on the rule; on a wide one on the strip's floor. */
  actionSlot: Rect;
  cards: CardGeometry[];
  /** How each bar's words are set, the same on every card. */
  words: { hp: BarWords; mp: BarWords };
  /** How far the acting member's card rises, in pixels. */
  raise: number;
  /** The cards and their tabs together, including the raised card. */
  statusArea: Rect;
}

/** How far the acting member's card rises, in text units. */
export const RAISE = 0.25;

/** The room at each end of a bar, inside it, before its words, in text units. */
export const BAR_PAD = 0.35;

/** The gap between a bar's label and its numbers side by side, in text units. */
export const WORDS_GAP = 0.5;

/** The sizes the bars' words may take, largest first, in text units. */
export const WORD_SIZES = [1.2, 1.05, SMALL_TEXT] as const;

/**
 * The member strip: a card per member, beside the command panel's slot on a wide screen and under it on an upright one;
 * or, on an upright screen (`rows`, its default there), a line per member across the whole band (`rowsLayout`).
 */
export function tierLayout(o: { panel: { w: number; h: number }; u: number; wide: boolean; count: number; measured: TierMeasured; rows?: boolean }): TierGeometry {
  if (o.rows ?? !o.wide) return rowsLayout(o);
  const { panel: p, u, wide, count, measured: m } = o;
  const k = measures(u);
  const inset = Math.round(u * 0.5);
  const G = k.G;
  const P = k.P;
  const actionW = m.actionW;
  const slotX = p.w - inset - actionW;
  // The party's share of the strip: all of it on a tall screen, all but the command panel's slot on a wide one,
  // stopping short of where the panel's glove reaches at its foot.
  const x0 = inset;
  const x1 = wide ? slotX - Math.max(G * 2, Math.ceil(u * GLOVE_SLAB_REACH)) : p.w - inset;
  const cw = Math.floor(Math.min(u * 15, (x1 - x0 - (count - 1) * G) / count));
  // Option D: portraits share the name row; the status bars keep the card's full width.
  const textX = P;
  const inner = cw - textX - P;
  // Keep Health at the card's usual sizes wherever it fits. Otherwise use HP at the largest whole-pixel size
  // that fits, including the low-health warning. Energy stays written out and no larger than Health.
  // The usual-size path retains the existing desktop geometry and text placement exactly.
  const room = (pad: number) => inner - Math.round(u * pad) * 2;
  const usual = (b: BarMeasured, most: number): BarWords | null => {
    const ok = (i: number) => WORD_SIZES[i]! <= most + 1e-9;
    const beside = WORD_SIZES.findIndex((_, i) => ok(i) && b.labelW[i]! + u * WORDS_GAP + b.numbersW[i]! <= room(BAR_PAD));
    if (beside >= 0) return { size: WORD_SIZES[beside]!, labelSize: WORD_SIZES[beside]!, stacked: false };
    return null;
  };
  const shrink = (b: BarMeasured, most: number, short = false): BarWords => {
    const at = b.pixels.find(p => p.font <= Math.round(u * most)
      && (short ? p.shortLabelW ?? Infinity : p.labelW) + u * WORDS_GAP + p.numbersW <= room(BAR_PAD));
    // A tiny resized window can leave less room than the fixed gaps alone. Keep layout recoverable.
    const font = at?.font ?? 1;
    return { size: font / u, labelSize: font / u, stacked: false, ...(short ? { short: true } : {}) };
  };
  const hpWords = usual(m.health, WORD_SIZES[0]) ?? shrink(m.health, WORD_SIZES[0], true);
  const mpWords = hpWords.short ? shrink(m.energy, hpWords.size)
    : usual(m.energy, hpWords.size) ?? shrink(m.energy, hpWords.size);
  const tabInset = Math.round(u * 0.5);
  const portraitGap = Math.max(TAB_KEYLINE * 2, Math.round(u * 0.25));
  // Stay within the existing name row, even when the acting card rises. The longest name sets a common size.
  const portraitS = Math.floor(Math.min(u * 1.6, m.tabH, ...m.nameW.map(w => cw - tabInset - w - portraitGap - P)));
  const withPortrait = portraitS >= u;
  // Each bar as tall as its words' capitals with a little room above and below them.
  const barH = (w: BarWords) => (w.stacked ? Math.round(u * ((w.labelSize + w.size) * 1.12 + 0.4)) : Math.round(u * w.size * 1.3));
  const padX = (_w: BarWords) => Math.round(u * BAR_PAD);
  const hpH = barH(hpWords);
  const mpH = barH(mpWords);
  const top = Math.round(u * 0.2);
  const between = Math.round(u * 0.25);
  const foot = Math.round(u * 0.35);
  // The card's body, top to bottom: the tab's lower half, the Health bar and the Energy bar.
  const body = Math.round(m.tabH / 2) + top + hpH + between + mpH + foot;
  const H = body;
  const cardY = p.h - inset - H;
  const tabTop = cardY - Math.round(m.tabH / 2);
  const raise = Math.round(u * RAISE);
  // Leave room above the tabs for a raised card and its paper keyline.
  const rise = raise;
  // The double rule sits just above the tabs, far enough that the shadow of what stands on its top line never
  // reaches them, and that all of that stays under it.
  const y2 = tabTop - Math.max(Math.round(u * 0.15), rise + TAB_KEYLINE, Math.ceil(k.S * 1.2 - (k.L + Math.round(u * 0.2) + Math.ceil(k.l))));
  const y1 = y2 - (k.L + Math.round(u * 0.2) + Math.ceil(k.l));
  const cards: CardGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const cx = x0 + i * (cw + G);
    const tx = cx + textX;
    let y = cardY + Math.round(m.tabH / 2) + top;
    const gauge = { x: tx, y, w: inner, h: hpH };
    y += hpH + between;
    const bar = { x: tx, y, w: inner, h: mpH };
    cards.push({
      card: { x: cx, y: cardY, w: cw, h: H },
      tab: { x: cx + tabInset, y: tabTop },
      gauge,
      hp: { x: tx + padX(hpWords), y: gauge.y, w: inner - padX(hpWords) * 2, h: hpH },
      bar,
      mp: { x: tx + padX(mpWords), y: bar.y, w: inner - padX(mpWords) * 2, h: mpH },
      portrait: withPortrait ? { x: cx + tabInset + m.nameW[i]! + portraitGap, y: tabTop + (m.tabH - portraitS) / 2, w: portraitS, h: portraitS } : null,
    });
  }
  const last = cards[count - 1]!.card;
  return {
    band: { x: 0, y: y1, w: p.w, h: p.h - y1 },
    rule: { y1, y2, x1: wide ? slotX - G : p.w },
    // On a tall screen the command panel stands on the rule's top line at the right, its shadow falling on the rule and never on the cards; on a wide one, in its slot on the strip's floor.
    actionSlot: wide ? { x: slotX, y: p.h - inset, w: actionW, h: 0 } : { x: slotX, y: y1, w: actionW, h: 0 },
    cards,
    words: { hp: hpWords, mp: mpWords },
    raise,
    statusArea: { x: x0, y: tabTop - rise, w: last.x + last.w - x0, h: cardY + H - tabTop + rise },
  };
}

/**
 * On an upright screen, a line per member across the whole band: the name tab at the left, then a long Health bar and
 * Energy beside it (the owner, 2026-11-06), the bars' words at the largest size at which both fit. The command panel
 * stands on the rule's top line at the right, its shadow falling on the rule and never on the rows.
 */
function rowsLayout(o: { panel: { w: number; h: number }; u: number; count: number; measured: TierMeasured }): TierGeometry {
  const { panel: p, u, count, measured: m } = o;
  const k = measures(u);
  const inset = Math.round(u * 0.5);
  const x0 = inset, x1 = p.w - inset, cw = x1 - x0;
  const gap = Math.round(u * 0.4);
  const textX = Math.round(u * 0.3) + Math.max(...m.nameW) + gap;
  const inner = cw - textX - Math.round(u * 0.3);
  const pad = Math.round(u * BAR_PAD);
  const beside = (label: number, numbers: number) => label + u * WORDS_GAP + numbers + pad * 2;
  const fits = (i: number) => beside(m.energy.labelW[i]!, m.energy.numbersW[i]!) + gap + beside(m.health.labelW[i]!, m.health.numbersW[i]!) <= inner;
  const at = WORD_SIZES.findIndex((_, i) => fits(i));
  let hpWords: BarWords, mpWords: BarWords, mpW: number;
  if (at >= 0) {
    hpWords = mpWords = { size: WORD_SIZES[at]!, labelSize: WORD_SIZES[at]!, stacked: false };
    mpW = Math.ceil(beside(m.energy.labelW[at]!, m.energy.numbersW[at]!));
  } else {
    // Too narrow at the usual sizes (a small phone at the larger text): as on a card, Health as HP, at the largest whole-pixel
    // size at which both fit, Energy still written out. A tiny window can leave less than the gaps alone; keep it recoverable.
    const pick = m.health.pixels.map(hp => ({ hp, mp: m.energy.pixels.find(e => e.font === hp.font) })).find(({ hp, mp }) =>
      mp && beside(mp.labelW, mp.numbersW) + gap + beside(hp.shortLabelW ?? hp.labelW, hp.numbersW) <= inner);
    const font = pick?.hp.font ?? 1, mp = pick?.mp;
    hpWords = { size: font / u, labelSize: font / u, stacked: false, short: true };
    mpWords = { size: font / u, labelSize: font / u, stacked: false };
    mpW = Math.ceil(mp ? beside(mp.labelW, mp.numbersW) : inner / 3);
  }
  const hpW = inner - gap - mpW;
  const barH = Math.round(u * hpWords.size * 1.3);
  const rowPad = Math.round(u * 0.2);
  const rowH = Math.max(m.tabH, barH) + rowPad * 2;
  const raise = Math.round(u * RAISE);
  const pitch = rowH + raise + Math.max(2, Math.round(u * 0.15));
  const firstY = p.h - inset - rowH - (count - 1) * pitch;
  // The double rule sits just above the first row's tab, as above the cards.
  const y2 = firstY - Math.max(Math.round(u * 0.15), raise + TAB_KEYLINE, Math.ceil(k.S * 1.2 - (k.L + Math.round(u * 0.2) + Math.ceil(k.l))));
  const y1 = y2 - (k.L + Math.round(u * 0.2) + Math.ceil(k.l));
  const cards: CardGeometry[] = [];
  for (let n = 0; n < count; n++) {
    const cy = firstY + n * pitch;
    const gy = cy + Math.round((rowH - barH) / 2);
    const gauge = { x: x0 + textX, y: gy, w: hpW, h: barH };
    const bar = { x: gauge.x + hpW + gap, y: gy, w: mpW, h: barH };
    cards.push({
      card: { x: x0, y: cy, w: cw, h: rowH },
      tab: { x: x0 + Math.round(u * 0.3), y: cy + Math.round((rowH - m.tabH) / 2) },
      gauge, hp: { x: gauge.x + pad, y: gy, w: hpW - pad * 2, h: barH },
      bar, mp: { x: bar.x + pad, y: gy, w: mpW - pad * 2, h: barH },
      portrait: null,
    });
  }
  const last = cards[count - 1]!.card;
  return {
    band: { x: 0, y: y1, w: p.w, h: p.h - y1 },
    rule: { y1, y2, x1: p.w },
    actionSlot: { x: p.w - inset - m.actionW, y: y1, w: m.actionW, h: 0 },
    cards,
    words: { hp: hpWords, mp: mpWords },
    raise,
    statusArea: { x: x0, y: firstY - raise, w: cw, h: last.y + last.h - firstY + raise },
  };
}

/**
 * The command panel's width, the same for every member and list so it never moves: wide enough for
 * the widest list and, on a wide screen where the target caption takes its place, the widest caption.
 */
export function actionWidth(u: number, panel: { w: number; h: number }, wide: boolean, listWidths: number[], captionWorst: number, wideCap = panel.w * 0.4): number {
  const want = Math.max(...listWidths, wide ? captionWorst : 0);
  // On a wide screen, never more than the member cards leave (`wideCap`), and never less than eleven units.
  return Math.round(wide ? Math.max(Math.min(want, wideCap), u * 11) : Math.min(Math.max(want, u * 10), panel.w - u));
}
