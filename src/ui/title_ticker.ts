import { CanvasTextGenerator, CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, Texture, type TextStyleOptions } from 'pixi.js';
import { FONT } from '../render/fonts.ts';

/**
 * The title's fine print as a news ticker along the foot of the screen (the owner, 2026-11-03: "a horizontal scrolling text
 * that isn't all on the screen at once. Like a TV ticker"): the credit, then the disclaimer, run right to left straight over
 * the picture, with no band behind them, outlined in the sky's dark ink so they read over the globe's lines, and a yellow
 * square, like the map's city lights, after each. The credit rides in the line in its own italic (the owner moved it into the
 * ticker text, 2026-11-04); it was a fixed tab over the line's left end, and the line keeps the
 * tab's room above it, so the title's compositions around it stay as they were. Under Reduce Motion nothing scrolls: the
 * credit, then the disclaimer, show a line at a time, fading from one to the next.
 *
 * A new layout keeps the ticker and the lines it has drawn (`layout`), so long as its words, size and resolution are the same,
 * and the disclaimer's letter-spaced lines are drawn fast (`drawSpaced`): drawn a letter at a time with the shadow, Firefox took
 * about four seconds for the line, so the title froze that long as it appeared and on every resize (the owner, 2026-11-12).
 */
const SKY_INK = 0x1d1038, POP = 0xffd23f, LIGHT = 0xf4e9f6;
/** Seconds each line of the still version stays up, and the fade between lines. */
const PAGE_S = 3.6, FADE_S = 0.3;

/** A letter-spaced line drawn once, as a picture, and the room it takes as text. */
interface Spaced { texture: Texture; width: number; pad: number; resolution: number }

/**
 * Draws a line of letter-spaced text in one go with the browser's own letter spacing. Pixi otherwise draws such text a letter at a
 * time, each letter with its own shadow (CanvasTextGenerator._drawLetterSpacing), which is what took Firefox seconds. Pixi still
 * draws it, in its own font, stroke, shadow and padding, with its switch for the browser's spacing on for this one drawing
 * (CanvasTextMetrics.experimentalLetterSpacing); it measures the line the same either way, so the picture is the size the text's
 * own would be. The letters may sit a fraction of a pixel differently, and the shadow is blurred for the whole line at once.
 */
function drawSpaced(text: string, options: TextStyleOptions, resolution: number): Spaced {
  const style = new TextStyle(options);
  // Measured first, as a text is: Pixi keeps the measure, so the picture is that size and the line is placed as the text was.
  const width = CanvasTextMetrics.measureText(text, style).width;
  const was = CanvasTextMetrics.experimentalLetterSpacing;
  CanvasTextMetrics.experimentalLetterSpacing = true;
  const canvas = document.createElement('canvas');
  try {
    const { canvasAndContext, frame } = CanvasTextGenerator.getCanvasAndContext({ text, style, resolution });
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')!.drawImage(canvasAndContext.canvas as unknown as HTMLCanvasElement, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    CanvasTextGenerator.returnCanvasAndContext(canvasAndContext);
  } finally {
    CanvasTextMetrics.experimentalLetterSpacing = was;
  }
  return { texture: Texture.from(canvas), width, pad: style.padding, resolution };
}

/** A drawn line's picture, placed where Pixi puts a text's own: its padding up and to the left of the text's place. */
function spacedView(s: Spaced, x: number, y: number): Sprite {
  const view = new Sprite(s.texture);
  view.scale.set(1 / s.resolution);
  view.position.set(x - s.pad, y - s.pad);
  return view;
}

/** One round of the moving line: the credit, a square, the disclaimer (from `lineX`), a square. */
interface Round { credit: Text; line: Sprite; lineX: number; squares: [Graphics, Graphics] }

export class TitleTicker {
  readonly container = new Container();
  /** The credit's text in the line's first round, for the browser checks. */
  credit!: Text;
  /** The whole thing's height: the room the credit's tab had, and the moving line under it. */
  readonly height: number;
  private readonly moving = new Container();
  private readonly paged = new Container();
  private readonly mask = new Graphics();
  private readonly rounds: Round[] = [];
  private pages: Container[] = [];
  /** The still version's lines, drawn, by their words. */
  private readonly pageLines = new Map<string, Spaced>();
  /** The disclaimer's line, drawn on the ticker's first frame (a drawing needs the browser's canvas). */
  private line: Spaced | null = null;
  private readonly style: TextStyleOptions;
  private readonly creditStyle: TextStyleOptions;
  private readonly caps: string;
  private readonly padX: number;
  private readonly ink: number;
  private readonly gap: number;
  private readonly square: number;
  private readonly creditW: number;
  private readonly lineW: number;
  private readonly lineY: number;
  private readonly lineH: number;
  private readonly viewLeft = 0;
  private readonly unitW: number;
  private readonly speed: number;
  private pos: number | null = null;
  private clock = 0;
  /** The still version's lines for the last layout (the credit's, then the disclaimer's), and its width; drawn when Reduce Motion first shows them. */
  private stillCredits: string[] = [];
  private stillLines: string[] = [];
  private stillWidth = 0;
  private stillDrawn = false;
  private readonly creditText: string;
  private readonly text: string;
  private readonly fine: number;
  private readonly resolution: number;

  /** `fine` is the small text size in pixels, which the ticker's own text is never under; `resolution` the renderer's. */
  constructor(creditText: string, text: string, fine: number, resolution: number) {
    this.creditText = creditText;
    this.text = text;
    this.fine = fine;
    this.resolution = resolution;
    // The room the credit's tab took over the line: the tab's height, measured as it was drawn.
    const tabProbe = new Text({ text: creditText, style: { fontFamily: FONT.body, fontStyle: 'italic', fontSize: fine } });
    this.padX = Math.round(fine * 0.85);
    const tabH = Math.round(tabProbe.height + fine * 0.6);
    tabProbe.destroy();

    // The ticker's own text: capitals in the headline face, outlined and shadowed in the sky's ink, with the lights' yellow
    // squares between them; the credit as written, in the body face's italic and the squares' yellow.
    const ink = this.ink = Math.max(2, Math.round(fine * 0.28));
    const outline = {
      stroke: { color: SKY_INK, width: ink, join: 'round' as const },
      dropShadow: { color: SKY_INK, alpha: 0.7, blur: ink, distance: ink * 0.8, angle: Math.PI / 3 },
    };
    this.style = { fontFamily: FONT.headline, fontSize: Math.round(fine * 1.08), letterSpacing: Math.round(fine * 0.1), fill: LIGHT, ...outline };
    this.creditStyle = { fontFamily: FONT.body, fontStyle: 'italic' as const, fontSize: Math.round(fine * 1.15), fill: POP, ...outline };
    this.caps = text.toUpperCase();
    const firstCredit = new Text({ text: creditText, style: this.creditStyle });
    const first = new Text({ text: this.caps, style: this.style });
    this.gap = Math.round(fine * 2.2);
    this.square = Math.max(3, Math.round(fine * 0.55));
    this.creditW = Math.ceil(firstCredit.width);
    this.lineW = Math.ceil(first.width);
    this.unitW = this.creditW + this.lineW + this.gap * 4 + this.square * 2;
    this.lineY = tabH + Math.round(fine * 0.2);
    this.lineH = Math.ceil(first.height);
    this.height = this.lineY + this.lineH + Math.round(fine * 0.3);
    firstCredit.destroy();
    first.destroy();
    this.speed = fine * 5;
    this.container.addChild(this.mask, this.moving, this.paged);
    this.moving.mask = this.mask;
    this.paged.mask = this.mask;
    this.paged.visible = false;
  }

  /** Whether this ticker shows these words at this size and resolution, so a new layout can keep it. */
  shows(creditText: string, text: string, fine: number, resolution: number): boolean {
    return creditText === this.creditText && text === this.text && fine === this.fine && resolution === this.resolution;
  }

  /**
   * Lays the ticker out for a window `width` wide, so the line runs off both edges rather than stopping short of them; `tabX`
   * is where the tab stood from its left (the panel's edge). Rounds already made are kept, and new ones share their drawing.
   */
  layout(width: number, tabX: number): void {
    const { lineY, lineH, ink } = this;
    // A new round's credit is made while the drawn ones still stand, so it takes up the same drawing rather than a new one.
    const copies = Math.ceil(width / this.unitW) + 2;
    while (this.rounds.length < copies + 1) this.rounds.push(this.round(this.rounds.length - 1));
    for (const r of this.rounds.splice(copies + 1)) for (const c of [r.credit, r.line, ...r.squares]) c.destroy();
    this.credit = this.rounds[1]!.credit;
    this.mask.clear().rect(0, lineY - ink * 2, width, lineH + ink * 4).fill(0xffffff);
    this.pos ??= -width * 0.6;

    // The still version: the credit, then the same words in lines that each fit the width, one shown at a time. The credit
    // too wide for the room (a phone, since it gained its years) breaks at its middle dot, and by words only if a part
    // is still too wide.
    const room = width - tabX * 2 - this.padX * 2;
    const wrap = (parts: string[], sep: string, style: TextStyleOptions): string[] => {
      let current = '';
      const lines: string[] = [];
      const probe = new Text({ text: '', style });
      for (const w of parts) {
        const next = current ? `${current}${sep}${w}` : w;
        probe.text = next;
        if (probe.width > room && current) { lines.push(current); current = w; } else current = next;
      }
      if (current) lines.push(current);
      probe.destroy();
      return lines;
    };
    this.stillCredits = wrap(this.creditText.split(' · '), ' · ', this.creditStyle).flatMap((l) => wrap(l.split(' '), ' ', this.creditStyle));
    this.stillLines = wrap(this.caps.split(' '), ' ', this.style);
    this.stillWidth = width;
    this.stillDrawn = false;
  }

  /** The still version's pages for the last layout: the credit's lines, then the disclaimer's, centred. */
  private drawStill(): void {
    const { stillLines: lines, stillWidth: width, lineY, lineH } = this;
    for (const p of this.pages) p.destroy();
    for (const [l, s] of this.pageLines) if (!lines.includes(l)) { s.texture.destroy(true); this.pageLines.delete(l); }
    this.pages = this.stillCredits.map((l) => {
      const t = new Text({ text: l, style: this.creditStyle });
      t.position.set(Math.round((width - t.width) / 2), Math.round(lineY + (lineH - t.height) / 2));
      return t;
    });
    for (const l of lines) {
      let s = this.pageLines.get(l);
      if (!s) this.pageLines.set(l, s = drawSpaced(l, this.style, this.resolution));
      this.pages.push(spacedView(s, Math.round((width - s.width) / 2), lineY));
    }
    for (const p of this.pages) { p.alpha = 0; this.paged.addChild(p); }
    this.stillDrawn = true;
  }

  /** The `i`th round of the moving line, from its left. */
  private round(i: number): Round {
    const { lineY, lineH, creditW, gap, square, ink } = this;
    const squareAt = (x: number) => {
      const sq = new Graphics().rect(0, 0, square, square).fill(POP).stroke({ color: SKY_INK, width: Math.max(1, ink * 0.6) });
      sq.position.set(x, Math.round(lineY + (lineH - square) / 2));
      return sq;
    };
    const x = i * this.unitW;
    const credit = new Text({ text: this.creditText, style: this.creditStyle });
    credit.position.set(x, Math.round(lineY + (lineH - credit.height) / 2));
    const lineX = x + creditW + gap * 2 + square;
    const line = new Sprite(Texture.EMPTY);
    const squares: [Graphics, Graphics] = [squareAt(x + creditW + gap), squareAt(lineX + this.lineW + gap)];
    this.moving.addChild(credit, squares[0], line, squares[1]);
    const r = { credit, line, lineX, squares };
    this.placeLine(r);
    return r;
  }

  /** A round's disclaimer: the drawn line, once there is one, where Pixi would put the text's own picture. */
  private placeLine(r: Round): void {
    const s = this.line;
    if (!s) return;
    r.line.texture = s.texture;
    r.line.scale.set(1 / s.resolution);
    r.line.position.set(r.lineX - s.pad, this.lineY - s.pad);
  }

  /** One frame. `still` is Reduce Motion. */
  update(dt: number, still: boolean): void {
    if (!this.line) {
      this.line = drawSpaced(this.caps, this.style, this.resolution);
      for (const r of this.rounds) this.placeLine(r);
    }
    this.clock += dt;
    this.moving.visible = !still;
    this.paged.visible = still;
    if (still) {
      if (!this.stillDrawn) this.drawStill();
      if (!this.pages.length) return;
      const n = this.pages.length;
      const at = this.clock % (PAGE_S * n);
      const i = Math.floor(at / PAGE_S), within = at - i * PAGE_S;
      const a = Math.min(1, within / FADE_S, (PAGE_S - within) / FADE_S);
      this.pages.forEach((t, k) => { t.alpha = k === i ? Math.max(0, a) : 0; });
      return;
    }
    this.pos = (this.pos ?? 0) + this.speed * dt;
    if (this.pos >= this.unitW) this.pos -= this.unitW;
    this.moving.x = this.viewLeft - this.pos;
  }

  /** The ticker and the lines it drew. */
  destroy(): void {
    this.container.destroy({ children: true });
    this.line?.texture.destroy(true);
    for (const s of this.pageLines.values()) s.texture.destroy(true);
    this.pageLines.clear();
  }
}
