import { AlphaFilter, Container, Graphics, Rectangle, Sprite, Text, TextStyle, TexturePool, type Texture } from 'pixi.js';
import { MISSING_PINK } from '../art/images.ts';
import { buildScene, isScene, type PictureScene } from '../world/scene_pictures.ts';
import type { GameContext } from '../game/context.ts';
import { drawDensity } from '../render/density.ts';
import { FONT } from '../render/fonts.ts';
import { NewsprintFilter, newsprintCell } from '../render/newsprint.ts';
import { PaperFilter } from '../render/paper.ts';
import { INK, PAPER, POP_YELLOW, RED_INK } from '../render/palette.ts';
import { EASE, motion, MS, onBeat } from '../render/motion.ts';
import { anim } from './anim.ts';
import { dashRect, focusLines, glove, measures, posterTag, scissors } from './print.ts';
import { MenuList, SMALL_TEXT, withSounds, type MenuItem } from './widgets.ts';
import type { Screen } from './screens.ts';
import { paperSurround } from './paperSurround.ts';
import { paperText } from './paperText.ts';

/** Newsprint: a little greyer than the game's paper. */
const NEWSPRINT = 0xe4dfd1;
const INK_TEXT = 0x1d1c1f;

/**
 * Every page, a chapter's, a lost fight's or an ending's, is drawn on one sheet of this size with the same type, and the sheet is scaled to fit
 * the window as a whole, with quieter newspapers in the space around it, so the two kinds of page print alike at every window
 * size (the owner, 2026-11-10). Wide enough that a two-line headline filling it is about as big as the old game-over page's at a
 * 1440 by 900 window; tall enough for that headline, a one-line subhead, a 3:2 photo and some lines of story.
 */
const SHEET_WIDTH = 460;
const SHEET_HEIGHT = 630;
const SHEET_UNIT = 14;
/** The photo's shape, when the page has room for it; otherwise it gives up height to the story under it. */
const PHOTO_ASPECT = 3 / 2;
/** The least depth of the lines of story under the photo: ten lines. */
const STORY_MIN = 43;
/** The masthead's red band, which the paper's name fills, and the dateline's type (the owner, 2026-11-10: both smaller, the dateline again by 15%). */
const MASTHEAD_BAND = 46;
const DATELINE = 5.95;
/**
 * An ending's page spins in from nothing in the middle of the view, as the ending pictures always have (the owner, 2026-11-13:
 * "the ending newspapers should still do the spinning animation and sounds"): it lands at full size after SPIN_LAND ms, with the
 * page's sound, then thumps down a little as its stamp slams on, all done by SPIN_MS.
 */
const SPIN_LAND = 400;
const SPIN_MS = 530;
/** Which way each ending's page spins, so the three do not come in alike. */
const SPIN_WAY: Record<string, number> = { separate_ways: -1, fireside: 1, ceo: -1 };

export interface TallPageOptions {
  headline: string;
  picture: string;
  issue: number;
  /** The map being left, drawn just before the page came in, with its backdrop colour. */
  snapshot: { texture: Texture; backdrop: number } | null;
  /** Choices on a clip-out coupon instead of the "continued" tag (the defeat page): taken once the page has landed. */
  menu?: MenuItem[];
  /** A red rubber stamp across the photo (GAME OVER). */
  stamp?: string;
  /** The story's opening words, in print a player can read (the defeat page): the rest of the story stays lines. */
  lead?: string;
  /**
   * An ending's page (the owner, 2026-11-13: the same format for all): the narration's captions lie over the foot of its story
   * instead of the "continued" tag, and every key and tap goes to them, not to the page.
   */
  narrated?: boolean;
  onDone?: () => void;
}

/**
 * A tall newsprint front page, for a chapter's map change, a lost fight and each of the endings (the owner, 2026-11-13),
 * laid out as a loud tabloid (the owner's pick, 2026-10-21): the paper's name across a red band, the dateline, the headline
 * on two lines in black and red, the photo in early colour newsprint, and the story as lines of paragraphs in two columns,
 * with a coupon of choices after a lost fight; no other words (the owner, 2026-11-10). It slides in from the
 * right and away to the left; an ending's spins in (`spinIn`). For a map change it carries a picture of the map being left, cut off at its right edge,
 * so it wipes from the old map to the new one behind it; both keep their own light.
 */
export class TallPage implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private readonly game: GameContext;
  private readonly opts: TallPageOptions;
  /** The photo's newsprint dots, made for the layout's unit and the screen's density (again on a relayout). */
  private filter: NewsprintFilter | null = null;
  private sheet = new Container();
  private surround: Container | null = null;
  /**
   * The old map's picture, shown only left of the page's right edge: the page wipes it away as it slides. The page itself
   * needs only its mask; the picture is kept for the browser checks that watch the wipe (newspaper_checks, fixcheck).
   */
  old: Container | null = null;
  private oldMask: Graphics | null = null;
  private menu: MenuList | null = null;
  /** "Continued on the next page", with the glove: on a chapter's page, shown once the page can be turned. */
  private cont: Container | null = null;
  private contShown = false;
  /** The photo on the page, as laid out: its picture, mask and frame (the checks read its fit). */
  picture: Container | null = null;
  private menuMode: Container['eventMode'] = 'passive';
  /** The page's age, in seconds, from which its menu takes choices: once it has slid in. */
  private settleAt = 0;
  private age = 0;
  private done = false;
  /** Where the sheet rests, and how far it is slid off that place. */
  private home = { x: 0, y: 0, w: 0, h: 0 };
  private slide = 0;
  /** Horizontal edges of the opaque paper stack, relative to the main sheet, for the map wipe. */
  private wipe = { left: 0, right: 0 };
  /** The printed paper's filter, on everything of the page but its photo; and where the photo sits, for the fold across it. */
  private paperFilter: PaperFilter | null = null;
  private photoBox = { x: 0, y: 0, w: 0, h: 0 };
  /** The textures the paper and the photo were drawn into, from Pixi's TexturePool: let go of when the page closes (see `destroy`). */
  private readonly poolTextures = new Set<Texture>();
  /** A filter over one pixel, drawn after the photo and showing nothing (see `layout`). */
  private tailFilter: AlphaFilter | null = null;
  /** The photo's scene, when its picture is put together from a map's pieces (src/world/scene_pictures.ts). */
  private scene: PictureScene | null = null;
  /**
   * An ending's page: what spins (the sheet and the papers round it), the focus lines and the paper's hard edge drawn under it
   * as it spins, its stamp, which slams on as it lands, and how far through its spin it is (1 at rest).
   */
  private spinner: Container | null = null;
  private spinLines: Graphics | null = null;
  private spinEdge: Graphics | null = null;
  private stampMark: Container | null = null;
  private spun = 1;
  /** With Reduce motion an ending's page fades in instead, all of it at once, while this is set. */
  private fade: AlphaFilter | null = null;
  /** Closed while still coming in: it lands without its sound or its callback. */
  private cancelled = false;

  constructor(game: GameContext, opts: TallPageOptions) {
    this.game = game;
    this.opts = opts;
    this.settleAt = opts.menu && !motion.reduced ? MS.pageIn / 1000 : 0;
    this.layout();
    // An ending's page sounds as it lands (`spinIn`).
    if (!opts.narrated) game.audio.play('page');
  }

  layout(): void {
    const g = this.game;
    const p = g.layout.panel;
    const chapter = !this.opts.menu;
    const u = SHEET_UNIT;
    // With `context`, each drawing lets go of what Pixi made of it for the screen at once; without it Pixi held that until its
    // collector found it unused, about a minute and a half later (the drawn picture, about 1 MB a page). Only a scene's figures
    // share theirs (poses kept for every figure of a look), so the scene lets go of them first, as figures leaving a map do.
    this.scene?.destroy();
    this.scene = null;
    for (const c of this.container.removeChildren()) c.destroy({ children: true, context: true });
    this.paperFilter?.destroy();
    this.paperFilter = null;
    this.filter?.destroy();
    this.filter = null;
    // The sheet's scale comes from the window alone, never from what is on the page.
    const pw = SHEET_WIDTH, ph = SHEET_HEIGHT;
    const scale = Math.min((p.w - 16) / pw, p.h / ph);
    this.home = { x: (p.w - pw * scale) / 2, y: (p.h - ph * scale) / 2, w: pw * scale, h: ph * scale };

    // The map being left, as a picture over the new map, cut off at the page's right edge: as the page slides
    // left it uncovers the new map behind it, like a wipe, and sliding away it wipes off the rest.
    // Taken at the panel's size when the page came; if the screen has changed shape since, it is left out rather than
    // stretched, and the page simply sits over the new map.
    const snap = this.opts.snapshot;
    const fits = !!snap && Math.abs(snap.texture.width - p.w) < 1 && Math.abs(snap.texture.height - p.h) < 1;
    this.old = this.oldMask = null;
    if (snap && fits) {
      const old = new Container();
      const sp = new Sprite(snap.texture);
      sp.label = 'page_snapshot';
      sp.width = p.w;
      sp.height = p.h;
      old.addChild(new Graphics().rect(0, 0, p.w, p.h).fill(snap.backdrop), sp);
      const m = new Graphics();
      old.mask = m;
      this.container.addChild(old, m);
      this.old = old;
      this.oldMask = m;
    }
    this.container.removeAllListeners('pointertap');
    if (this.opts.narrated) this.container.eventMode = 'none';
    else {
      this.container.eventMode = 'static';
      this.container.hitArea = new Rectangle(0, 0, p.w, p.h);
      this.container.on('pointertap', () => this.finish());
    }
    // An ending's page spins: the focus lines and its edge are drawn under it in the view's own space, and the sheet and the
    // papers round it turn together about the view's middle.
    let holder: Container = this.container;
    this.spinner = this.spinLines = this.spinEdge = null;
    if (this.opts.narrated) {
      this.spinLines = new Graphics();
      this.spinEdge = new Graphics();
      this.spinner = new Container();
      this.spinner.label = 'ending_spin';
      this.spinner.pivot.set(p.w / 2, p.h / 2);
      this.spinner.position.set(p.w / 2, p.h / 2);
      if (this.fade) this.spinner.filters = [this.fade];
      this.container.addChild(this.spinLines, this.spinEdge, this.spinner);
      holder = this.spinner;
    }

    this.sheet = new Container();
    this.sheet.label = this.opts.narrated ? 'ending_paper' : chapter ? 'chapter_paper' : 'defeat_paper';
    this.sheet.scale.set(scale);
    holder.addChild(this.sheet);
    this.buildSheet(pw, ph, u, scale);
    this.paperize(u);
    this.surround = null;
    this.wipe = { left: 0, right: this.home.w };
    if (this.home.y > 0.5) {
      // A width-fitted sheet leaves tall gaps. Opaque backing editions fill the whole page height and width,
      // including the narrow side margins, and travel with the sheet throughout the old/new map wipe.
      const scale = this.sheet.scale.x;
      this.surround = paperSurround(pw, this.home.h / scale, this.home.x / scale, this.home.y / scale);
      this.surround.scale.copyFrom(this.sheet.scale);
      holder.addChildAt(this.surround, holder.getChildIndex(this.sheet));
      const bounds = this.surround.getLocalBounds();
      this.wipe = { left: bounds.minX * scale, right: bounds.maxX * scale };
    }
    // Last, a filter over one pixel that shows nothing (alpha 0): Pixi's filter system keeps the last texture a filter read from bound
    // until the next one, so this way, between frames, that is never the paper's or the photo's, and both can be destroyed when the
    // page closes (`releasePoolTextures`) without Pixi's "destroyed while still bound" warning.
    this.tailFilter?.destroy();
    this.tailFilter = new AlphaFilter({ alpha: 0, clipToViewport: false });
    const tail = new Graphics().rect(0, 0, 1, 1).fill(NEWSPRINT);
    tail.label = 'pool_tail';
    tail.filters = [this.tailFilter];
    this.container.addChild(tail);
    this.place();
    this.pose(this.spun);
  }

  private buildSheet(pw: number, ph: number, u: number, scale: number): void {
    const s = this.sheet;
    this.stampMark = null;
    const chapter = !this.opts.menu;
    const drop = Math.max(3, Math.round(u * 0.3));
    const shadow = new Graphics().rect(drop, drop, pw, ph).fill({ color: INK, alpha: 0.35 });
    s.addChild(shadow);
    const face = new Graphics().rect(0, 0, pw, ph).fill(NEWSPRINT).stroke({ width: 1, color: INK, alpha: 0.6, alignment: 1 });
    face.label = 'paper_face';
    s.addChild(face);
    const pad = Math.round(u * 0.8);
    const iw = pw - pad * 2;
    let y = pad;
    const text = (t: string, style: Partial<ConstructorParameters<typeof TextStyle>[0]>) => new Text({ text: t, style: { fill: INK_TEXT, ...style } });

    // Tabloid (the owner's pick, 2026-10-21): the paper's name in white across a red band, the dateline between rules,
    // the headline on two lines that each fill the width (black, then red), the photo large, and the story in two columns;
    // no subhead (the owner, 2026-11-10).
    const white = 0xffffff;
    const bandH = MASTHEAD_BAND;
    const edge = Math.max(1, Math.round(u * 0.1));
    s.addChild(new Graphics().rect(pad, y, iw, bandH).fill(RED_INK).stroke({ width: edge, color: INK_TEXT, alignment: 1 }));
    const name = this.game.content.frame.title.toUpperCase();
    const mastStyle = { fontFamily: FONT.headline, fontWeight: '700' as const, fontSize: 100, letterSpacing: 3, fill: white, stroke: { color: INK_TEXT, width: 6 } };
    const mast = text(name, mastStyle);
    // Oswald's line box is much taller than its capitals, so the capitals fill the band when the box overhangs it a little.
    const mastSize = Math.floor(100 * Math.min((iw - u * 1.2) / mast.width, (bandH * 1.3) / mast.height));
    mast.destroy();
    const mt = text(name, { ...mastStyle, fontSize: mastSize, letterSpacing: Math.max(1, Math.round(mastSize * 0.03)), stroke: { color: INK_TEXT, width: Math.max(2, Math.round(mastSize * 0.05)) } });
    if (chapter) mt.label = 'chapter_masthead';
    mt.position.set(Math.round(pad + (iw - mt.width) / 2), Math.round(y + (bandH - mt.height) / 2));
    s.addChild(mt);
    y += bandH + u * 0.3;

    // Dateline, between a thick rule and a thin one.
    const rules = new Graphics();
    const thick = Math.max(2, Math.round(u * 0.14));
    rules.rect(pad, y, iw, thick).fill(INK_TEXT);
    y += thick + u * 0.18;
    // Small, under the game's floor for fine print: it is the page's furniture, not something to read (the owner, 2026-11-10).
    const dl = { fontFamily: FONT.body, fontWeight: '700' as const, fontSize: DATELINE, letterSpacing: 0.6 };
    const [left, right] = this.game.content.frame.dateline;
    const parts = [left.replace('{issue}', String(this.opts.issue)), 'Final Edition', right].map((t) => t.toUpperCase()).map((t) => {
      const d = text(t, dl);
      d.label = 'dateline';
      return d;
    });
    const lower = y;
    parts[0]!.position.set(pad, lower);
    parts[1]!.position.set(pad + (iw - parts[1]!.width) / 2, y);
    parts[2]!.position.set(pad + iw - parts[2]!.width, lower);
    s.addChild(...parts);
    y = lower + parts[0]!.height + u * 0.12;
    rules.rect(pad, y, iw, 1).fill(INK_TEXT);
    s.addChild(rules);
    y += u * 0.35;

    // The headline on two lines of near-equal length, each as wide as the page allows, up to a ceiling so a short line
    // does not tower over the photo. One word stays one line.
    const words = this.opts.headline.toUpperCase().split(/\s+/).filter(Boolean);
    let split = words.length;
    if (words.length > 1) {
      let best = Infinity;
      for (let k = 1; k < words.length; k++) {
        const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
        if (d < best) [best, split] = [d, k];
      }
    }
    const heads = [words.slice(0, split).join(' '), words.slice(split).join(' ')].filter(Boolean);
    // About as big as a two-line headline that fills the width, so a short one prints no bigger than a long one.
    const ceiling = 72;
    heads.forEach((line, i) => {
      const probe = text(line, { fontFamily: FONT.headline, fontWeight: '700', fontSize: 100 });
      const size = Math.min(ceiling, Math.floor((100 * iw) / probe.width));
      probe.destroy();
      const t = text(line, { fontFamily: FONT.headline, fontWeight: '700', fontSize: size, lineHeight: Math.round(size * 1.02), fill: i === 1 ? RED_INK : INK_TEXT });
      if (chapter) t.label = `chapter_headline_${i}`;
      if (t.width > iw) t.scale.set(iw / t.width);
      t.position.set(Math.round(pad + (iw - t.width) / 2), y);
      s.addChild(t);
      y += t.height - size * 0.06;
    });
    y += u * 0.45;

    // The photo, printed in colour on newsprint, then the story as lines of paragraphs; nothing else in words (the owner,
    // 2026-11-10: "a game name, the vol/edition/credit, the headline with a short subheadline below it, the photo, and then
    // lines of paragraphs after that"; later the same day: "Let's remove the subheader").
    const gap = u * 0.35;
    this.menu = null;
    // A lost fight's page has a coupon of choices over the foot of its story. It is a menu like any other, drawn at the
    // interface's own size whatever the sheet's scale, so it follows the Text size setting; the story under the photo is
    // deep enough to hold it, with its scissors over its top edge.
    const coupon = this.opts.menu ? this.coupon(this.opts.menu, this.game.layout.unit, iw * scale, this.game.layout.panel.h / 2) : null;
    const story = Math.max(STORY_MIN, coupon ? coupon.h / scale + u * 1.2 : 0);
    const photoW = iw;
    const photoH = Math.max(u * 4, Math.min(iw / PHOTO_ASPECT, ph - pad - story - gap - y));
    // The photo's dots, as many across it on any screen (newsprintCell); on screen it is the sheet's scale and the viewport's
    // times its width. The drawn pictures print with the dots a fifth bigger than the generated pictures did (the owner's pick,
    // 2026-11-08); a scene, as detailed as those were, keeps their size.
    const res = drawDensity();
    this.filter = new NewsprintFilter({ cell: newsprintCell(photoW * scale * (this.game.viewportScale ?? 1), res) * (isScene(this.opts.picture) ? 1 : 1.2), resolution: res,
      paper: NEWSPRINT, drawnInto: (t) => this.poolTextures.add(t) });
    this.picture = this.photo(this.opts.picture, pad, y, photoW, photoH, edge);
    this.photoBox = { x: pad, y, w: photoW, h: photoH };
    s.addChild(this.picture);
    if (this.opts.stamp) {
      // About the size it printed at on a 1440 by 900 window before the page became a sheet.
      const st = stamp(this.opts.stamp, 20);
      // An ending's stamp goes in the photo's top left corner, inside it, where none of the three pictures has a face; at the
      // game-over page's spot it covered Gorbie's in the separate ways picture.
      if (this.opts.narrated) st.position.set(Math.round(pad + Math.max(photoW * 0.25, st.width / 2 + 4)), Math.round(y + Math.max(photoH * 0.14, st.height / 2 + 4)));
      else st.position.set(Math.round(pad + photoW * 0.68), Math.round(y + photoH * 0.7));
      s.addChild(st);
      if (this.opts.narrated) this.stampMark = st;
    }
    y += photoH + gap;

    // The story in two columns, down to the foot of the sheet; a coupon is laid over them (the owner, 2026-11-10).
    const cols = 2;
    const gutter = Math.round(u * 0.7);
    const cw = (iw - gutter * (cols - 1)) / cols;
    // A lead opens the first column in words, at the interface's small text size whatever the sheet's scale, as the coupon
    // is drawn; the column's lines follow it (the owner, 2026-11-13: "Maybe the first line in the small article text").
    let lead = 0;
    if (this.opts.lead) {
      const size = (this.game.layout.unit * SMALL_TEXT) / scale;
      const t = new Text({ text: this.opts.lead, resolution: drawDensity() * Math.max(1, scale),
        style: { fontFamily: FONT.body, fontSize: size, lineHeight: Math.round(size * 1.25), fill: INK_TEXT, wordWrap: true, wordWrapWidth: cw } });
      t.label = 'story_lead';
      t.position.set(pad, y);
      s.addChild(t);
      lead = Math.ceil(t.height + size * 0.5);
    }
    s.addChild(paperText(pad, y, cw, gutter, [ph - pad - y - lead, ph - pad - y], [lead, 0]));
    this.cont = null;
    if (this.opts.narrated) return;
    if (coupon) {
      coupon.c.scale.set(1 / scale);
      coupon.c.position.set(pw - pad - coupon.w / scale, ph - pad - coupon.h / scale);
      s.addChild(coupon.c);
      return;
    }
    // "Continued on the next page", with the glove, once the page can be turned; laid over the story's foot as the coupon is (the
    // owner, 2026-11-10: kept, after the other words went).
    const tag = posterTag(this.game.msg('system', 'continued').toUpperCase(), u, { size: Math.round(u * 0.95), star: false });
    const gs = Math.round(u * 1.8);
    const cwid = gs + Math.round(u * 0.1) + tag.w;
    const cont = new Container();
    const hand = glove(gs, u);
    hand.position.set(0, Math.round(tag.h / 2 - gs * 0.16));
    tag.c.position.set(gs + Math.round(u * 0.1), 0);
    cont.addChild(new Graphics().rect(-u * 0.3, -u * 0.3, cwid + u * 0.6, tag.h + u * 0.6).fill(NEWSPRINT), hand, tag.c);
    cont.pivot.set(cwid / 2, tag.h / 2);
    cont.position.set(pw - pad - cwid / 2, ph - pad - tag.h / 2);
    cont.rotation = -0.03;
    cont.visible = this.contShown;
    anim.loop(this, hand, (t) => (hand.x = onBeat(t) * u * 0.22));
    s.addChild(cont);
    this.cont = cont;
  }

  /** The clip-out coupon of choices on a lost fight's page, at the interface's size `u`; its choices wait until the page has landed. */
  private coupon(items: MenuItem[], u: number, maxW: number, maxH: number): { c: Container; w: number; h: number } {
    const ms = measures(u);
    const menu = new MenuList(items, { bare: true });
    // On touch the band and the glove rest on Try again (the owner, 2026-11-12).
    menu.restOn(0, { glove: true });
    withSounds(menu, (snd) => this.game.audio.play(snd));
    const mp = ms.P;
    menu.build(u, u * 9, { w: maxW - mp * 2, h: maxH });
    const w = Math.round(menu.width + mp * 2);
    const h = Math.round(menu.height + mp);
    const c = new Container();
    const cg = new Graphics().rect(0, 0, w, h).fill(POP_YELLOW);
    dashRect(cg, 0, 0, w, h, u, INK);
    cg.eventMode = 'static';
    menu.container.position.set(mp, mp);
    this.menuMode = menu.container.eventMode;
    if (this.done || this.age < this.settleAt) menu.container.eventMode = 'none';
    const ss = Math.round(u * 1.5);
    const sc = scissors(ss, u);
    sc.position.set(Math.round(u * 0.4), Math.round(-ss / 2));
    c.addChild(cg, menu.container, sc);
    this.menu = menu;
    return { c, w, h };
  }

  private photo(name: string, x: number, y: number, w: number, h: number, frame = 1): Container {
    const out = new Container();
    const inner = new Container();
    inner.label = 'chapter_photo_content';
    this.scene = buildScene(name, w, h);
    if (this.scene) {
      this.scene.view.label = 'chapter_photo_image';
      inner.addChild(this.scene.view);
    } else {
      const gr = new Graphics();
      gr.label = 'chapter_photo_image';
      // A picture with no drawn scene shows hot pink, as a failed image does, never another picture in its place.
      gr.rect(0, 0, w, h).fill(MISSING_PINK);
      console.warn(`No drawn scene for the picture ${name}; hot pink stands in for it.`);
      inner.addChild(gr);
    }
    const mask = new Graphics().rect(0, 0, w, h).fill(0xffffff);
    mask.label = 'chapter_photo_mask';
    inner.mask = mask;
    inner.filters = [this.filter!];
    out.addChild(inner, mask, new Graphics().rect(0, 0, w, h).stroke({ width: frame, color: INK_TEXT, alignment: 1 }));
    out.position.set(x, y);
    return out;
  }

  /**
   * Makes the page look printed (the owner's pick, 2026-11-08). Everything but the photo (and a stamp over it) goes in one group
   * with the paper filter on it; the photo keeps its own newsprint dots, above, with the fold carried across it as two thin shapes.
   */
  private paperize(u: number): void {
    const s = this.sheet, photo = this.picture;
    if (!photo) return;
    const stampAt = this.opts.stamp ? s.children[s.getChildIndex(photo) + 1] : undefined;
    const group = new Container(), over = new Container();
    group.label = 'paper_group';
    over.label = 'paper_photo_layer';
    for (const k of [...s.children]) (k === photo || k === stampAt ? over : group).addChild(k);
    s.addChild(group, over);
    const face = group.getChildByLabel('paper_face')!.getLocalBounds();
    const bounds = group.getLocalBounds();
    const page: [number, number] = [face.width - 2, face.height - 2]; // the face has a 1px stroke outside it
    this.paperFilter = new PaperFilter({
      origin: [bounds.minX, bounds.minY], bounds: [bounds.width, bounds.height], page, paper: NEWSPRINT,
      cell: Math.max(2.4, u * 0.19) * 0.4, resolution: drawDensity(),
      drawnInto: (t) => this.poolTextures.add(t),
    });
    group.filters = [this.paperFilter];
    // The fold, where it crosses the photo.
    const b = this.photoBox, fy = page[1] * 0.5;
    if (fy > b.y && fy < b.y + b.h) {
      over.addChild(new Graphics().rect(b.x, fy - 0.35, b.w, 0.7).fill({ color: 0xffffff, alpha: 0.2 }).rect(b.x, fy + 0.5, b.w, 3.2).fill({ color: 0x000000, alpha: 0.12 }));
    }
  }

  private place(): void {
    const x = this.home.x + this.slide;
    this.sheet.position.set(x, this.home.y);
    this.surround?.position.set(x, this.home.y);
    if (this.oldMask) {
      const p = this.game.layout.panel;
      this.oldMask.clear().rect(0, 0, Math.max(0, Math.min(p.w, x + this.wipe.right)), p.h).fill(0xffffff);
    }
  }

  /** Slides the page in from the right over the map being left; both maps keep their own light (the owner, 2026-10-19). */
  async turnIn(): Promise<void> {
    if (motion.reduced) return;
    const p = this.game.layout.panel;
    const from = p.w - (this.home.x + this.wipe.left);
    await anim.run(this, MS.pageIn, EASE.smooth, (k) => {
      if (this.container.destroyed) return;
      this.slide = from * (1 - k);
      this.place();
    });
    this.slide = 0;
    if (!this.container.destroyed) this.place();
  }

  /** Slides the page away to the left, wiping off the rest of the old map. */
  async turnOut(): Promise<void> {
    if (motion.reduced) return;
    const to = -(this.home.x + this.wipe.right + 20);
    await anim.run(this, MS.pageOut, EASE.smooth, (k) => {
      if (this.container.destroyed) return;
      this.slide = to * k;
      this.place();
    });
  }

  get narrated(): boolean {
    return !!this.opts.narrated;
  }

  /**
   * Spins an ending's page in about the view's middle, with focus lines behind it, as the ending pictures always came; with
   * Reduce motion it fades in instead. Resolves as it lands at full size, with the page's sound (none with Reduce motion); then
   * it thumps down a little and its stamp slams on.
   */
  spinIn(): Promise<void> {
    const reduced = motion.reduced;
    if (reduced) {
      this.fade = new AlphaFilter({ alpha: 0, resolution: drawDensity() });
      if (this.spinner) this.spinner.filters = [this.fade];
    }
    this.spun = 0;
    this.pose(0);
    const duration = reduced ? MS.picture : SPIN_MS;
    return new Promise((resolve) => {
      let landed = false;
      // One run takes in the landing and the thump after it, so finishing it leaves nothing queued behind.
      void anim.run(this, duration, EASE.linear, (k) => {
        if (this.cancelled || this.container.destroyed) return;
        // Reduce motion turned on mid-spin lands it at once.
        this.spun = Math.max(this.spun, !reduced && motion.reduced ? 1 : k);
        this.pose(this.spun);
        if (!landed && (reduced ? this.spun >= 1 : this.spun * duration >= SPIN_LAND)) {
          landed = true;
          if (!reduced && !motion.reduced) this.game.audio.play('page');
          resolve();
        }
      }).then(() => {
        // Faded in: drawn without the fade from now on.
        if (!this.fade || this.container.destroyed) return;
        if (this.spinner) this.spinner.filters = null;
        this.fade.destroy();
        this.fade = null;
      });
    });
  }

  /** An ending's page `k` of the way through its spin, or its fade with Reduce motion. */
  private pose(k: number): void {
    const sp = this.spinner, lines = this.spinLines, edge = this.spinEdge, st = this.stampMark;
    if (!sp || !lines || !edge) return;
    const { panel: p, unit: u } = this.game.layout;
    lines.clear();
    edge.clear();
    if (this.fade) {
      sp.scale.set(1);
      sp.rotation = 0;
      this.fade.alpha = EASE.smooth(k);
      if (st) { st.alpha = 1; st.scale.set(1); }
      return;
    }
    const ms = k * SPIN_MS, spin = Math.min(1, ms / SPIN_LAND);
    const scale = spin < 1 ? 0.05 * 20 ** spin : 1 + 0.03 * (1 - EASE.out(Math.min(1, (ms - SPIN_LAND) / 100)));
    const turn = (SPIN_WAY[this.opts.picture] ?? -1) * Math.PI * 4 * (1 - spin);
    sp.scale.set(scale);
    sp.rotation = turn;
    if (st) {
      const slam = Math.max(0, Math.min(1, (ms - SPIN_LAND) / 130));
      st.alpha = slam;
      st.scale.set(1 + 0.8 * (1 - EASE.pop(slam)));
    }
    if (spin >= 1) return;
    focusLines(lines, { x: 0, y: 0, w: p.w, h: p.h }, [p.w / 2, p.h / 2], 0.6 * (1 - spin), u, 37);
    // The paper's hard shadow and edge, the whole view where papers fill it round the sheet; drawn in the view's own space, so
    // they keep their thickness on screen as it grows.
    const r = this.surround ? { x: 0, y: 0, w: p.w, h: p.h } : this.home;
    const cx = p.w / 2, cy = p.h / 2, cos = Math.cos(turn), sin = Math.sin(turn);
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].flatMap(([x, y]) => {
      const dx = x! - cx, dy = y! - cy;
      return [cx + (dx * cos - dy * sin) * scale, cy + (dx * sin + dy * cos) * scale];
    });
    const m = measures(u);
    edge.poly(pts.map((v) => v + m.S)).fill(INK);
    edge.poly(pts).stroke({ width: m.L * 2, color: INK });
  }

  /** A caption's press lands a spinning ending page at once; the caption still goes on. */
  finishEntry(): void {
    if (this.opts.narrated && !this.cancelled) anim.finish(this);
  }

  /** Closing screens abandon its landing, though its spin is put at rest as it goes. */
  cancelEntry(): void {
    this.cancelled = true;
  }

  /** Whether this page waits for a choice on its coupon rather than a tap, as the old front page's `hasMenu`. */
  get hasMenu(): boolean {
    return this.menu !== null;
  }

  finish(): void {
    if (this.menu || this.done || this.age < 0.5) return;
    this.done = true;
    this.opts.onDone?.();
  }

  /** The page is going (a choice was made): its coupon takes no more choices. */
  leave(): void {
    this.done = true;
    if (this.menu) this.menu.container.eventMode = 'none';
  }

  update(dt: number): void {
    this.age += dt;
    if (this.opts.narrated) return;
    if (this.cont && !this.contShown && this.age >= 0.5) {
      this.contShown = true;
      this.cont.visible = true;
      anim.play(this, this.cont, { scale: 1.5, rotation: 0.15 }, MS.notice, EASE.pop);
    }
    const input = this.game.input;
    if (this.menu) {
      if (!this.done && this.age >= this.settleAt && this.menu.container.eventMode === 'none') this.menu.container.eventMode = this.menuMode;
      // A moment's grace, so a key still being mashed from before the page cannot pick for the player.
      if (this.age >= Math.max(0.35, this.settleAt) && !this.done) this.menu.update(input);
      return;
    }
    if (input.pressed('confirm') || input.pressed('cancel')) {
      input.consume('confirm');
      input.consume('cancel');
      this.finish();
    }
  }

  /** Also lets go of the picture of the old map, which the page owns from the moment it is made. */
  destroy(): void {
    anim.unloop(this);
    this.scene?.destroy();
    this.scene = null;
    this.container.destroy({ children: true, context: true });
    this.filter?.destroy();
    this.filter = null;
    this.paperFilter?.destroy();
    this.paperFilter = null;
    this.tailFilter?.destroy();
    this.tailFilter = null;
    this.fade?.destroy();
    this.fade = null;
    this.releasePoolTextures();
    this.opts.snapshot?.texture.destroy(true);
  }

  /**
   * Pixi keeps every texture a filter has drawn into for the rest of the session, for the next filter of that size (TexturePool,
   * never collected), so the paper's and the photo's, as big as the page and the photo, would stay: 32 and 16 MB for a chapter
   * page on a 5K screen at 2x. Each is taken back out of the pool, which hands back the texture last put in for that size, and
   * destroyed. One that is not on top (held by something else, or under another of its size) is put back and kept. A size the
   * map's own filter also uses (a phone's, often) is made again for the map in the next frame. Pixi's filter system is first made
   * to forget it, as a filter inside another reads its slot's last texture as it starts (`forgetFilterInput`). See
   * docs/pixi_dependencies.md, sections 3 and 5.
   */
  private releasePoolTextures(): void {
    for (const t of this.poolTextures) {
      if (t.destroyed) continue;
      const s = t.source;
      const top = TexturePool.getOptimalTexture(s.pixelWidth, s.pixelHeight, 1, s.antialias);
      if (top === t && this.game.forgetFilterInput?.(t) !== false) t.destroy(true);
      else TexturePool.returnTexture(top);
    }
    this.poolTextures.clear();
  }
}

/** A red rubber stamp with a paper face, set crooked, as on the old defeat page. */
function stamp(text: string, u: number): Container {
  const c = new Container();
  const word = new Text({ text: text.toUpperCase(), style: { fontFamily: FONT.headline, fontWeight: '700', fontSize: Math.round(u * 1.8), fill: RED_INK, letterSpacing: 2 } });
  word.anchor.set(0.5);
  const sw = Math.round(word.width + u * 1.2);
  const sh = Math.round(word.height * 0.95 + u * 0.3);
  const ins = Math.max(3, Math.round(u * 0.18));
  const g = new Graphics().rect(-sw / 2, -sh / 2, sw, sh).fill({ color: PAPER, alpha: 0.92 }).stroke({ width: Math.max(2, Math.round(u * 0.12)), color: RED_INK });
  g.rect(-sw / 2 + ins, -sh / 2 + ins, sw - ins * 2, sh - ins * 2).stroke({ width: 1, color: RED_INK });
  c.addChild(g, word);
  c.rotation = -0.14;
  return c;
}
