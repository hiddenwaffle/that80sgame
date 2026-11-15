/**
 * Screen layout. The game takes the shape of whatever space the browser gives
 * it: a game panel, framed as a newspaper page, with a masthead and side
 * columns where there is room. Everything is in CSS pixels.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Layout {
  vw: number;
  vh: number;
  orientation: 'portrait' | 'landscape';
  /** Phone-sized: the frame shrinks to a thin border. */
  compact: boolean;
  margin: number;
  masthead: Rect | null;
  panel: Rect;
  /** Side columns of the newspaper page, left to right. May be empty. */
  columns: Rect[];
  /** Space under the panel on very tall screens. */
  footer: Rect | null;
  /** Base size for interface text and spacing, in CSS pixels. */
  unit: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Widest and tallest shapes the panel may take before the page fills the rest. */
const MAX_ASPECT = 16 / 9;
const MIN_ASPECT = 9 / 20;

/** `textSize` scales the interface unit, for players who want larger text. */
export function computeLayout(vw: number, vh: number, safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 }, textSize = 1): Layout {
  const short = Math.min(vw, vh);
  const orientation = vh > vw ? 'portrait' : 'landscape';
  const compact = short < 560;
  const margin = Math.round(clamp(short * 0.02, 5, 20));
  const unit = Math.round(clamp(short / 30, 13, 22) * textSize);

  const left = safe.left + margin;
  const right = vw - safe.right - margin;
  let top = safe.top + margin;
  const bottom = vh - safe.bottom - margin;

  // The masthead goes away on short landscape windows, where height is scarce. (A phone held sideways is laid out upright.)
  let masthead: Rect | null = null;
  const mastheadH = compact ? (orientation === 'portrait' ? clamp(vh * 0.06, 30, 52) : 0) : clamp(vh * 0.085, 48, 104);
  if (mastheadH > 0) {
    masthead = { x: left, y: top, w: right - left, h: Math.round(mastheadH) };
    top += masthead.h + Math.round(margin * 0.6);
  }

  const area: Rect = { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  let panel: Rect = { ...area };
  const columns: Rect[] = [];
  let footer: Rect | null = null;
  const aspect = area.w / area.h;

  if (aspect > MAX_ASPECT) {
    // Too wide: keep a 16:9 panel in the middle and give the rest to columns.
    const w = Math.round(area.h * MAX_ASPECT);
    const spare = area.w - w;
    const gap = margin;
    const colW = Math.floor((spare - gap * 2) / 2);
    panel = { x: area.x + Math.floor(spare / 2), y: area.y, w, h: area.h };
    if (colW >= 90) {
      columns.push({ x: area.x, y: area.y, w: colW, h: area.h });
      columns.push({ x: panel.x + panel.w + gap, y: area.y, w: colW, h: area.h });
    }
  } else if (aspect < MIN_ASPECT) {
    // Extremely tall: keep the panel from becoming a sliver, put a footer below.
    const h = Math.round(area.w / MIN_ASPECT);
    panel = { x: area.x, y: area.y, w: area.w, h };
    footer = { x: area.x, y: area.y + h + margin, w: area.w, h: area.h - h - margin };
  }

  return { vw, vh, orientation, compact, margin, masthead, panel, columns, footer, unit };
}

/** Full-screen menus keep the printed view's text scale, even over the arcade or a moving border. */
export function overlayLayout(framed: Layout, safe: Insets): { layout: Layout; scale: number } {
  const { vw, vh } = framed;
  // On a phone held upright a page keeps the frame's own margin at the sides and the foot, as the title's menu does, so a sliver
  // of the world shows round its sheet (the owner, 2026-11-04); it still reaches the top of the screen.
  if (thumbReach(framed)) {
    const p = framed.panel;
    return { scale: 1, layout: { ...framed, masthead: null, columns: [], footer: null,
      panel: { x: p.x, y: safe.top, w: p.w, h: p.y + p.h - safe.top } } };
  }
  const scale = expandedPanel(framed, safe).w / framed.panel.w;
  const w = Math.max(1, vw - safe.left - safe.right), h = Math.max(1, vh - safe.top - safe.bottom);
  const margin = framed.compact ? 4 : 6;
  // Reclaim the margin on a constrained axis rather than shrink the existing logical panel.
  const mx = (w - margin * 2) / scale >= framed.panel.w ? margin : 0;
  const my = (h - margin * 2) / scale >= framed.panel.h ? margin : 0;
  return { scale, layout: { ...framed, vw: vw / scale, vh: vh / scale, margin: margin / scale,
    masthead: null, columns: [], footer: null,
    panel: { x: (safe.left + mx) / scale, y: (safe.top + my) / scale,
      w: Math.max(framed.panel.w, (w - mx * 2) / scale),
      h: Math.max(framed.panel.h, (h - my * 2) / scale) } } };
}

/** Enlarge the existing panel to the safe browser bounds without changing its aspect ratio. */
export function expandedPanel(l: Layout, safe: Insets): Rect {
  const w = Math.max(1, l.vw - safe.left - safe.right), h = Math.max(1, l.vh - safe.top - safe.bottom);
  const scale = Math.min(w / l.panel.w, h / l.panel.h);
  const pw = l.panel.w * scale, ph = l.panel.h * scale;
  return { x: safe.left + (w - pw) / 2, y: safe.top + (h - ph) / 2, w: pw, h: ph };
}

/** Reads the device's safe-area insets (notches, rounded corners) through a probe element. */
export function readSafeInsets(): Insets {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

/** The visible size of the page, ignoring browser bars that cover it. A pinch's zoom is undone (the visual viewport shrinks by
 * its scale): a trackpad pinch on a laptop re-laid the game out for the zoomed view, off-centre (Fable review P18). */
export function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  if (vv) return { w: Math.round(vv.width * vv.scale), h: Math.round(vv.height * vv.scale) };
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Whether pages sit at the bottom of the panel, within reach of a thumb: on a phone held upright.
 * Elsewhere they are centred.
 */
export function thumbReach(l: Pick<Layout, 'orientation' | 'compact'>): boolean {
  return l.orientation === 'portrait' && l.compact;
}

/** Short upright phones frame fights above complete menus and may zoom out to keep the art clear. */
export function shortPhoneFight(l: Pick<Layout, 'orientation' | 'compact' | 'vh'>): boolean {
  return thumbReach(l) && l.vh <= 700;
}
