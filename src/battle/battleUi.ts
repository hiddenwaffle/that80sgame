import { AlphaFilter, CanvasTextMetrics, ColorMatrixFilter, Container, FillGradient, Graphics, Text } from 'pixi.js';
import { LOOKS, type LookId } from '../art/characters.ts';
import { wholeBox } from '../art/lookArt.ts';
import { GHOST_TINTS } from '../art/ghostTints.ts';
import { foilBand } from '../art/ghostFoil.ts';
import { itemBlocked, neediest, previewItem, type Vitals } from '../game/items.ts';
import { FONT } from '../render/fonts.ts';
import { alternate, bannerHoldSeconds, cutInDurationMs, EASE, motion, MS } from '../render/motion.ts';
import { STING_S, VANISH_THIN } from '../audio/ronnienomicsTiming.ts';
import { cloud, spikyRect } from '../ui/balloon.ts';
import { INK, INK_SOFT, PAPER, PAPER_DARK, RED_INK, HEAL, POP_CYAN, POP_PINK, POP_YELLOW } from '../render/palette.ts';
import { anim, pastePanel } from '../ui/anim.ts';
import { benDay, burstPoints, confetti, focusLines, letterStyle, measures, OVERLAPPING_UI_OPACITY, panel, seeded } from '../ui/print.ts';
import { ghostPicture, portrait } from '../ui/portrait.ts';
import { brackets, button, enabledMenuIndex, MenuList, withSounds, type MenuItem, type MenuPlace } from '../ui/widgets.ts';
import type { Actor } from '../world/actor.ts';
import type { Battle, Choice, Fighter } from './battle.ts';
import { wideBattle } from './formation.ts';
import { stepTarget } from './targetNav.ts';
import { fieldBrackets, mix } from '../ui/target_box.ts';
import { defaultBindings } from '../engine/input.ts';
import { shortPhoneFight, thumbReach } from '../engine/layout.ts';
import { capName, keyCap, promptFor } from '../ui/prompts.ts';
import { barWordsRoom, Tier } from './tier.ts';
import { Tab } from '../ui/print.ts';
import { actionWidth } from './tierLayout.ts';
import { TurnStrip } from './turn_strip.ts';
import { drawFightRevival, drawRevivalDim, FIGHT_REVIVAL_DURATION, fightWingSize, REVIVAL_BANNER, REVIVAL_BANNER_TILT, revivalBannerSpan, revivalFlash } from '../render/revival.ts';
import { aimEllipse, impactReach, STRIKE, strikeReach } from '../render/nukeStrike.ts';
import { FinaleClock, tacticalNuke, type NukeFrame } from './warsawFx.ts';
import { clearIfInked } from '../render/clear_if_inked.ts';
import { cherryPair } from '../art/cherries.ts';
import { drawSmokeBomb } from '../art/smokeBomb.ts';

/** The foil giant's blast colours, through the rainbow: its rings, its glitter and its splash's letters. */
const GLITTER = [0xff4fa3, 0xff9a3c, 0xffe14d, 0x5fe0a0, 0x4fb8ff, 0xa070ff] as const;

/**
 * What the interface is doing: nothing, a list open, or choosing a target. `target_all` is a
 * move that hits a whole side, shown on all of it for one confirm, so it can still be taken back.
 */
type Mode = 'idle' | 'command' | 'special' | 'item' | 'target_enemy' | 'target_member' | 'target_all';

type Pending = { kind: 'attack' } | { kind: 'special'; id: string } | { kind: 'item'; id: string };

type Rect = { x: number; y: number; w: number; h: number };

/**
 * How far the battle music goes down under Ronnienomics!'s failure sting, in dB (the owner, 2026-11-07: "turn the battle
 * music down a little", then of 6 dB: "let's bring the battle music down a little more").
 */
const STING_DUCK_DB = 10;

/** The side column's faces never get smaller than this, in panel pixels: the smallest screen at the largest text needs about 24. */
const SIDE_QUEUE_FLOOR = 18;

/** An ordinary enemy's size: its target brackets are the thinnest. */
const PLAIN_ENEMY_SIZE = 11;
export type FightObstacle = Rect & { name: string };

/** A result line of a won fight, with its kind, so the victory box can mark it; `who` is a member's look, for a level-up's portrait. */
export interface VictoryLine {
  kind: 'xp' | 'none' | 'dots' | 'level_up' | 'level_gains';
  text: string;
  who?: string;
}

const vitals = (f: Fighter): Vitals => ({ hp: f.hp, maxHp: f.maxHp, mp: f.member?.mp ?? 0, maxMp: f.member?.maxMp ?? 0 });

/** What a list shows, to tell when it needs showing again. */
const listKey = (items: MenuItem[], title: string) => [title, ...items.map((i) => `${i.label}|${i.detail ?? ''}|${i.enabled !== false}`)].join(',');

/** The fighter in `list` standing nearest to `from`. */
const nearest = (list: Fighter[], from: Actor): Fighter => list.reduce((a, b) => (b.actor.distanceTo(from) < a.actor.distanceTo(from) ? b : a));

/** The flag's colours across a narrow path, with a two-colour cross framed by its field. */
export function starPathColours(look: LookId): number[] {
  const flag = LOOKS[look].flag;
  if (!flag) return [POP_PINK];
  const colours = [...new Set(flag(false).map(band => band.color))];
  // Gorbie's tricolour has Ronnie's three colours, so his star read the same (the owner, 2026-10-18: "Maybe if
  // Gorbie's were more red-dominant it would help distinguish them"): red outside and in the middle, his white and
  // blue as two narrow bands between.
  if (look === 'gorbie') {
    const [white, blue, red] = colours as [number, number, number];
    return [red, white, red, blue, red];
  }
  return colours.length === 2 ? [...colours, colours[0]!] : colours;
}

interface Popup {
  /** The number and its plate (a burst, a double burst, or a puff), as one piece. */
  text: Container;
  /** Its height at full size, how far above the figure it starts (clear of any number still showing there), and how far it has risen since. */
  h: number;
  lift: number;
  rise: number;
  actor: Actor;
  age: number;
  /** With reduced motion, numbers do not rise: a new one sits above any still showing on the same figure. */
  stack: number;
  /** Height above the feet in actor radii; Revival leaves room for its halo. */
  headroom: number;
}

/**
 * The battle's interface, laid out as a comic page: the party's member strip along the foot, the
 * command panel standing on it at the right (leaning, the one panel that says "act here"), the turn
 * strip on the rule at the left, the Pause tab at the top, the target list in the command panel while a
 * target is chosen, damage numbers, and the boss's countdown. Sizes are measured once per layout,
 * so the command panel never moves or changes size between members or lists.
 */
export class BattleUi {
  readonly container = new Container();
  private readonly header = new Container();
  private readonly battle: Battle;
  private readonly tier: Tier;
  /** Draws the target marks (and the keyboard's cursor); read by the checks to test the marks are on screen. */
  readonly cursor = new Graphics();
  /** Where the member's own cyan brackets on the cursor layer were drawn (x, y, half-size), when they are all it holds; else null. Drawn again only when it moves. */
  private cursorAt: [number, number, number] | null = null;
  private readonly hoverCursor = new Graphics();
  private hoverPoint: { x: number; y: number } | null = null;
  private readonly popups: Popup[] = [];
  private readonly finaleClock = new FinaleClock();
  nukeShown: NukeFrame | null = null;
  private readonly turnsView = new TurnStrip();
  private readonly turnStrip = this.turnsView.container;
  /** Visible strip geometry and order for browser verification. */
  turnStripRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  turnNames: string[] = [];
  /** Still lines about the target, drawn when the target changes, and how many times; the marks drawn this frame; for the checks. */
  private readonly focusG = new Graphics();
  private focusFor: Fighter | null = null;
  focusBuilds = 0;
  targetMarks: Rect[] = [];
  private menu: MenuList | null = null;
  private mode: Mode = 'idle';
  private active: Fighter | null = null;
  private pending: Pending | null = null;
  private target: Fighter | null = null;
  /** Where the brackets on the member acting were last drawn, for the browser checks. */
  actorMark: { x: number; y: number; w: number; h: number } | null = null;
  /** The last command given, and how many taps reached the fight, for the browser checks. */
  lastChoice: Choice | null = null;
  /** The enemy the player chose last this fight, where on touch the band rests in a list of enemies while it stands (the owner, 2026-11-12). */
  private lastEnemy: Fighter | null = null;
  tapsSeen = 0;
  /** What an open Special, Item, or target list was built from, so it can be shown again when that changes. */
  private listKey = '';
  /** The figure each row of the target list stands for: none for Back, or for a row that is a whole side. */
  private rowFighters: Array<Fighter | null> = [];
  /** The target last synchronized with the list, so an automatic target change moves its cursor too. */
  private shownTarget: Fighter | null = null;
  /** A button for touch players to pause the fight, at the top right. */
  private pauseButton: Container | null = null;
  /** The Pause button's bounds at rest, copied when it is made: a press moves its face, and placing it by its live bounds
   * lifted the whole button while held, so a press near its lower edge let go outside it (Fable review P10, 2026-11-09). */
  private pauseRest: { x: number; y: number; width: number; height: number } | null = null;
  /** What the layout was worked out for, and what it gave: the command panel's width. */
  private laidFor = '';
  private laidHeader: Rect | null = null;
  private actionW = 0;
  /**
   * Beside the side column on a narrow screen the lists take less width; those whose words need more (`wideLists`, by
   * listKind) keep the full width (`fullW`) and open in front of the column.
   */
  private fullW = 0;
  private wideLists = new Set<string>();
  /** Whether the open list is one of the wide ones. */
  private menuWide = false;
  /** The command list's height (the fight is framed above it), the most room any list may take, and where the tallest list's top comes. */
  private commandH = 0;
  private listRoom = 0;
  private tallestTop = 0;
  private clearanceMenus: Rect[] = [];
  private clearancePause: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(battle: Battle) {
    this.battle = battle;
    this.tier = new Tier(battle.game, battle.party, (f) => this.tapRow(f), (f) => this.hoverRow(f));
    this.focusG.eventMode = 'none';
    this.hoverCursor.eventMode = 'none';
    this.cursor.label = 'battle_cursor'; this.hoverCursor.label = 'battle_hover_cursor';
    this.finaleClock.container.visible = false;
    this.container.addChild(this.focusG, this.cursor, this.hoverCursor, this.tier.container, this.tier.hits, this.finaleClock.container, this.turnStrip);
    this.container.visible = false;
    this.header.visible = false;
    this.g.battleHeaderLayer?.addChild(this.header);
  }

  private get g() {
    return this.battle.game;
  }

  private get u(): number {
    return this.g.layout.unit;
  }

  /** Narrow phones and enlarged text use smaller portraits. */
  private get smallPhone(): boolean {
    const l = this.g.layout;
    return thumbReach(l) && (l.panel.w < 340 || l.panel.w < this.u * 22);
  }

  private get shortUpright(): boolean { return shortPhoneFight(this.g.layout); }

  private menuRoom(): { w: number; h: number } {
    return { w: this.actionW, h: this.listRoom };
  }

  /**
   * Whether the turn strip stands behind the command list: on a tall screen, where the list stands on the rule over
   * the cards, its left end showing; on a wide one it stands beside the list's slot.
   */
  private get stripBehind(): boolean {
    return !wideBattle(this.g.layout.panel) && !this.battle.finale;
  }

  /**
   * How far the turn strip stands above the cards' rule: on a wide screen a unit, so the eye has room between it and
   * the cards (the owner, 2026-10-15); on a tall one it stands on the rule, behind the command list.
   */
  private get stripLift(): number {
    return wideBattle(this.g.layout.panel) ? this.u : 0;
  }

  show(): void {
    this.ensureLayout();
    this.container.visible = true;
    this.header.visible = true;
    this.placePause();
    // While everyone walks in, before the clock runs, the strip slides up from the panel's foot, and focus lines
    // struck in on the fight draw back to the panel's edges.
    if (this.battle.phase === 'intro') {
      anim.play(this, this.tier.skins(), { dy: this.g.layout.panel.h - this.tier.geo.band.y }, 180, EASE.out);
      if (!motion.reduced) {
        const p = this.g.layout.panel;
        const b = this.fightBand();
        const lines = this.panelLines();
        this.openingLines = lines.g;
        void anim.run(this, MS.fightOpen, EASE.out, (k) => {
          if (lines.g.destroyed) return;
          lines.g.clear();
          focusLines(lines.g, { x: 0, y: 0, w: p.w, h: p.h }, [(b.left + b.right) / 2, (b.top + b.bottom) / 2], 0.6 * (1 - k), this.u, 3);
          if (k >= 1) lines.root.destroy({ children: true });
        });
      }
    }
  }

  /** The opening's focus lines while they show, for the checks. */
  openingLines: Graphics | null = null;

  /** A layer for lines drawn across the panel, clipped to it, over the fight and under the strip and lists. */
  private panelLines(): { root: Container; g: Graphics } {
    const p = this.g.layout.panel;
    const root = new Container();
    root.eventMode = 'none';
    const mask = new Graphics().rect(0, 0, p.w, p.h).fill(0xffffff);
    const g = new Graphics();
    root.addChild(mask, g);
    root.mask = mask;
    this.container.addChildAt(root, this.container.getChildIndex(this.tier.container));
    return { root, g };
  }

  private placePause(): void {
    this.pauseButton?.destroy({ children: true });
    this.pauseButton = this.makePause();
    const rest = this.pauseButton.getLocalBounds();
    this.pauseRest = { x: rest.x, y: rest.y, width: rest.width, height: rest.height };
    const at = this.pausePlacement(this.pauseButton);
    this.pauseButton.position.set(at.x, at.y);
    (this.useHeader ? this.header : this.container).addChild(this.pauseButton);
    this.refreshCaps();
  }

  /** Keep the finale's dedicated countdown layout unchanged. */
  private get useHeader(): boolean {
    return !this.battle.finale && !!this.g.battleHeaderLayer && !!this.g.battleHeaderBounds;
  }

  /**
   * On an upright screen the queue is a column standing on the rule just left of the command list, on every screen and at
   * every text size: never across the top (the owner, 2026-11-06).
   */
  private get sideQueue(): boolean { return this.useHeader && !wideBattle(this.g.layout.panel); }

  private pausePlacement(pause: Container): { x: number; y: number } {
    const bounds = pause === this.pauseButton && this.pauseRest ? this.pauseRest : pause.getLocalBounds();
    if (!this.useHeader) return { x: Math.round(this.g.layout.panel.w - bounds.width - this.u * 0.5), y: Math.round(this.u * 0.5) };
    const space = this.g.battleHeaderBounds!();
    return { x: space.x + space.w - bounds.x - bounds.width, y: space.y - bounds.y };
  }

  private layoutKey(): string {
    const p = this.g.layout.panel;
    return `${p.w}x${p.h}@${this.u}`;
  }

  private makePause(): Container {
    return button(this.g.msg('pause', 'button'), this.u, () => this.g.openPause(), { slab: true, size: Math.round(this.u * 1.05), light: () => this.g.audio.play('blip') });
  }

  /** The key cap beside the Pause button, and those for switching members, for keyboard and gamepad players. */
  private pauseCap: Container | null = null;
  private switchCaps: Container | null = null;
  private switchKey = '';

  /** Draws the caps again for the device in use: after a device change, and when the Pause button is made. */
  refreshCaps(): void {
    const g = this.g;
    const u = this.u;
    this.pauseCap?.destroy({ children: true });
    this.pauseCap = null;
    const b = this.pauseButton;
    const prompt = promptFor('menu', g.input.lastDevice, g.settings.keys ?? defaultBindings(), capName(g));
    if (b && prompt) {
      this.pauseCap = keyCap(prompt, u);
      this.pauseCap.position.set(Math.round(b.x - this.pauseCap.width - u * 0.3), Math.round(b.y + (b.height - this.pauseCap.height) / 2));
      (this.useHeader ? this.header : this.container).addChild(this.pauseCap);
    }
    // The switch caps too, at once: a page over the fight stops the fight's own updates.
    this.switchKey = '';
    this.placeSwitchCaps();
  }

  /** The caps for left and right beside the command panel's tab, while more than one member is ready. */
  private placeSwitchCaps(): void {
    const g = this.g;
    const keys = g.settings.keys ?? defaultBindings();
    const want = this.mode === 'command' && this.menu && this.battle.readyMembers().length > 1 ? `${g.input.lastDevice}|${keys.left[0]}|${keys.right[0]}|${this.menu.container.x},${this.menu.container.y}|${this.menu.title}` : '';
    if (want === this.switchKey) return;
    this.switchKey = want;
    this.switchCaps?.destroy({ children: true });
    this.switchCaps = null;
    const area = this.menu?.titleArea();
    if (!want || !area || !this.menu) return;
    const left = promptFor('left', g.input.lastDevice, keys, capName(g));
    const right = promptFor('right', g.input.lastDevice, keys, capName(g));
    if (!left || !right) return;
    const u = this.u;
    const c = new Container();
    const a = keyCap(left, u);
    const z = keyCap(right, u);
    z.x = a.width + u * 0.2;
    c.addChild(a, z);
    // Just right of the tab, on the same edge, but never past the panel: smaller if need be, or left out.
    const room = area.w - area.titleW - u * 0.3;
    const scale = Math.min(1, (area.h + u * 0.3) / a.height, room / c.width);
    if (scale < 0.6) {
      c.destroy({ children: true });
      return;
    }
    c.scale.set(scale);
    c.position.set(Math.round(this.menu.container.x + area.x + area.titleW + u * 0.3), Math.round(this.menu.container.y + area.y + (area.h - c.height) / 2));
    this.switchCaps = c;
    this.container.addChild(c);
  }

  /** Where the boss's countdown bar goes: under the pause button. */
  private barTop(): number {
    const u = this.u;
    if (this.shortUpright && this.battle.finale) return u * 0.5;
    if (this.useHeader) return Math.max(0, this.clearancePause.y + this.clearancePause.h) + (this.smallPhone ? 0 : u * 0.4);
    // Below the button's shadow too, which is part of how it is printed.
    return u * 0.5 + measures(u).btnH + measures(u).S + (this.smallPhone ? 0 : u * 0.4);
  }

  /** The horizontal turn queue's height. */
  private get turnH(): number {
    if (this.battle.finale || this.sideQueue) return 0;
    const icon = Math.min(Math.round(this.u * 2.2), this.smallPhone ? 32 : Infinity);
    return icon + Math.max(9, Math.round(this.u * 0.55)) * 2 + 20;
  }

  /** The boss's fuse strip's height: its words, and the cord under them. */
  private get fuseH(): number {
    if (this.shortUpright && this.battle.finale) return 60;
    return Math.round(this.u * (this.battle.finale ? 4.8 : 2.6));
  }

  // ---------------------------------------------------------------------------------------------
  // Layout

  /** Works the layout out again if the screen or the text size changed since it was last worked out. */
  private ensureLayout(): void {
    const key = this.layoutKey();
    const header = this.sideQueue ? this.g.battleHeaderBounds!() : null;
    const changed = !!header !== !!this.laidHeader || header && this.laidHeader
      && (['x', 'y', 'w'] as const).some(axis => Math.abs(header[axis] - this.laidHeader![axis]) >= 1);
    if (key === this.laidFor && !changed) return;
    // A live geometry change needs drawn cards, rebuilt lists and fight reshaping,
    // even when first noticed after this frame's tier update.
    if (this.laidFor) this.relayout();
    else this.layoutFight();
  }

  /**
   * Measures the command panel from the widest lists it will hold, so it keeps one width for every
   * member and list, then lays out the member strip beside or under it.
   */
  private layoutFight(): void {
    const g = this.g;
    const p = g.layout.panel;
    const u = this.u;
    const m = measures(u);
    this.laidFor = this.layoutKey();
    this.laidHeader = this.sideQueue ? { ...g.battleHeaderBounds!() } : null;
    const pause = this.makePause(), pb = pause.getLocalBounds(), at = this.pausePlacement(pause);
    this.clearancePause = { x: at.x + pb.x, y: at.y + pb.y, w: pb.width, h: pb.height };
    pause.destroy({ children: true });
    this.wideLists = new Set();
    const wide = wideBattle(p);
    const longest = this.battle.party.reduce((a, b) => (b.name.length > a.name.length ? b : a));
    // The target lists too: every enemy, every member with an item's widest preview, and each move on a whole side.
    const areas = Object.keys(g.content.specials).filter((id) => ['all_enemies', 'party'].includes(g.content.specials[id]!.target));
    const targets: Array<{ mode: Mode; pending: Pending | null }> = [
      { mode: 'target_enemy', pending: { kind: 'attack' } },
      { mode: 'target_member', pending: null },
      ...areas.map((id) => ({ mode: 'target_all' as const, pending: { kind: 'special' as const, id } })),
    ];
    const probes: Array<{ items: MenuItem[]; title: string; subtitle?: string; command: boolean; minRows?: number; rowHeight?: number }> = [
      { items: this.commandItems(), title: g.msg('menu', 'switch_title', { name: longest.name }), command: true },
      { items: this.specialRows(longest, true).items, title: longest.name, subtitle: this.specialRows(longest, true).title, command: false },
      { items: this.itemRows(true).items, title: longest.name, subtitle: this.itemRows(true).title, command: false },
      ...targets.map(({ mode, pending }) => {
        const t = this.targetRows(mode, pending, true);
        return { items: t.items, title: longest.name, subtitle: t.title, command: false, ...this.targetMenuSize(mode, pending) };
      }),
    ];
    // Which list each probe stands for, and how wide its words make it.
    const kinds = ['command', 'special', 'item', ...targets.map(({ mode, pending }) => this.listKind(mode, pending))];
    const natural = new Map<string, number>();
    let listW = 0;
    let listH = 0;
    let commandH = 0;
    for (const [i, pr] of probes.entries()) {
      const list = new MenuList(pr.items, { title: pr.title, subtitle: pr.subtitle, style: 'action', command: pr.command, titleRoom: pr.command ? u * 3.4 : 0, tabSize: this.tabSize(), minRows: pr.minRows, rowHeight: pr.rowHeight, measuring: true });
      list.build(u);
      listW = Math.max(listW, list.width);
      natural.set(kinds[i]!, Math.max(natural.get(kinds[i]!) ?? 0, list.width));
      listH = Math.max(listH, list.height);
      if (pr.command) commandH = list.height;
      list.destroy();
    }
    // A greyed row says why ('Health and Energy full'), which can be wider than the counts and previews above. Which lists
    // keep the full width goes by those rows too: the Item list with everyone standing at full and with everyone down, and
    // the members' list with each reason an item can give for one of them.
    const full = this.battle.party.map((f): Vitals => ({ hp: f.maxHp, maxHp: f.maxHp, mp: f.member?.maxMp ?? 0, maxMp: f.member?.maxMp ?? 0 }));
    const states = [full, full.map((v) => ({ ...v, hp: 0 }))];
    const reasons = new Set(Object.values(g.content.items).flatMap((it) => states.flatMap((people) => people.map((v) => itemBlocked(it, [v], 1)))));
    const greyed = [
      ...states.map((people) => ({ kind: 'item', ...this.itemRows(true, people) })),
      ...[...reasons].filter((r) => this.whyGreyed(r) !== undefined).map((r) => ({ kind: 'target_member', title: g.msg('battle', 'select_member'), items: [
        ...this.battle.party.map((f): MenuItem => ({ id: f.name, label: f.name, detail: this.whyGreyed(r), enabled: false, onChoose: () => undefined })),
        { id: 'back', label: g.msg('menu', 'back'), onChoose: () => undefined },
      ] })),
    ];
    for (const pr of greyed) {
      const list = new MenuList(pr.items, { title: longest.name, subtitle: pr.title, style: 'action', tabSize: this.tabSize(), measuring: true });
      list.build(u);
      natural.set(pr.kind, Math.max(natural.get(pr.kind) ?? 0, list.width));
      list.destroy();
    }
    // On a wide screen the slot takes no more than the member cards leave: each card keeps room for its name and its bars' words at the smallest size.
    let cardMin = barWordsRoom(g, this.battle.party, u) + m.P * 2;
    for (const f of this.battle.party) {
      const tab = new Tab(f.name, u);
      cardMin = Math.max(cardMin, tab.width + u * 0.8);
      tab.container.destroy({ children: true });
    }
    const n = this.battle.party.length;
    const wideCap = p.w - u - m.G * 2 - n * cardMin - (n - 1) * m.G;
    this.actionW = actionWidth(u, p, wide, [listW], 0, wideCap);
    this.fullW = this.actionW;
    // A second pass with the list narrowed, where the side column needs it, so that its glove on any row clears the column.
    for (let pass = 0; pass < 2; pass++) {
      // The Warsaw Pac's fight keeps its cards and its own layout: the lines' taller band would cost its figures a tenth on the smallest phone.
      this.tier.build(p, u, wide, this.actionW, !wide && !this.battle.finale);
      const geo = this.tier.geo;
      // Lists stand on the foot and rise no higher than below the Pause button and a boss's countdown.
      const counting = this.battle.enemies.some((e) => e.countdown !== null);
      const top = this.useHeader
        ? this.barTop() + (counting ? this.fuseH + m.S + u * 0.4 : 0) + u * 0.4
        : this.smallPhone
        ? this.barTop() + (counting ? this.fuseH + m.S + u * 0.4 : 0) + u * 0.4
        : Math.max(u * 0.5 + m.btnH, counting ? u * 0.4 + this.fuseH + m.S : 0) + u * 0.5;
      const foot = geo.actionSlot.y;
      // Whole pixels, rounded up, so a list that fits fits exactly and never scrolls for a fraction.
      this.listRoom = Math.floor(foot - top);
      this.commandH = Math.ceil(Math.min(commandH, this.listRoom));
      this.tallestTop = foot - Math.ceil(Math.min(listH, this.listRoom));
      // Measure the lists at the same width, scrolling height and anchor as openList/placeMenu.
      // Width/framing above deliberately retain their existing conservative probes.
      this.clearanceMenus = probes.filter(pr => wide || pr.command).map(pr => {
        const items = pr === probes[2] ? this.itemRows().items : pr.items;
        const list = new MenuList(items, { title: pr.title, subtitle: pr.subtitle, style: 'action',
          command: pr.command, titleRoom: pr.command ? u * 3.4 : 0, tabSize: this.tabSize(),
          minRows: pr.minRows, rowHeight: pr.rowHeight, width: this.actionW, measuring: true });
        list.build(u, this.actionW, this.menuRoom());
        // A lower row puts the glove farther left on the leaning panel. Reserve
        // every cursor/scroll position, including Back and later target rows (the glove's room is kept on touch too, which has none).
        const bounds = list.items.map((_, i) => {
          list.select(i);
          anim.finish(list);
          // The hand at rest, not wherever the beat has it: the room taken, and so the turn queue's faces, would change
          // by up to a fifth of a unit with the moment the fight is laid out.
          list.restGlove();
          const b = list.container.getLocalBounds();
          return { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
        });
        const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
        const b = { x, y, width: Math.max(...bounds.map(b => b.right)) - x,
          height: Math.max(...bounds.map(b => b.bottom)) - y };
        const rect = { x: Math.round(geo.actionSlot.x) + b.x,
          y: Math.round(foot - list.height) + (wide ? b.y : 0), w: b.width, h: wide ? b.height : list.height + m.S * 1.2 };
        list.destroy();
        return rect;
      });
      const left = Math.min(...this.clearanceMenus.map(r => r.x));
      const menuTop = Math.min(...this.clearanceMenus.map(r => r.y));
      const right = Math.max(...this.clearanceMenus.map(r => r.x + r.w));
      const bottom = Math.max(...this.clearanceMenus.map(r => r.y + r.h));
      this.clearanceMenus = [{ x: left, y: menuTop, w: right - left, h: bottom - menuTop }];
      this.commandLeft = left;
      if (pass || !this.sideQueue) break;
      // Room for the smallest faces at least; on a bigger phone up to half a unit more, toward the faces the height allows.
      const least = this.sideQueueBox(), want = this.sideQueuePick(Infinity).box, floor = this.sideQueueBox(SIDE_QUEUE_FLOOR);
      const needFor = (box: { x: number; width: number }) => box.x + box.width + u * 0.3 - left;
      const leastNeed = needFor(least);
      const need = Math.ceil(Math.max(leastNeed, Math.min(needFor(want), Math.max(0, leastNeed) + (this.smallPhone ? 0 : u * 0.5))));
      if (need <= 0) break;
      // The lists give up three quarters of a unit with their words whole. If the column needs more, its faces shrink a little
      // first; past that the lists narrow only as far as the smallest faces need: those whose words fit take the narrower
      // width, the others keep the full width and open in front of the column, and the command list is never narrower than
      // its own words (the faces shrink to what is left).
      const most = Math.floor(u * 0.75);
      const give = need <= most ? need : Math.max(most, Math.min(Math.ceil(needFor(floor)), this.actionW - (natural.get('command') ?? 0)));
      if (give <= 0) break;
      this.actionW -= give;
      if (give > most) this.wideLists = new Set(kinds.filter(k => (natural.get(k) ?? 0) > this.actionW));
    }
  }

  /** Only printed UI blocks a home. Tall layouts deliberately allow submenus over the fight. */
  fightObstacles(): FightObstacle[] {
    this.ensureLayout();
    const geo = this.tier.geo, m = measures(this.u);
    const rects: FightObstacle[] = [
      { name: 'Pause', ...this.clearancePause },
      { name: 'member strip', ...geo.band },
      ...this.clearanceMenus.map(r => ({ name: 'command panel', ...r })),
    ];
    const turns = this.turnGeometry();
    if (turns) rects.push({ name: 'turn strip', x: turns.x - m.L / 2, y: turns.y - m.L / 2,
      w: turns.width + m.S + m.L / 2, h: turns.height + m.S + m.L / 2 });
    const boss = this.battle.enemies.some(e => e.countdown !== null && e.hp > 0);
    if (boss && !(this.nukeShown && this.nukeShown.stage !== 'targeting')) {
      const r = this.countdownRect();
      const bounds = FinaleClock.bounds(r);
      rects.push({ name: 'countdown', ...bounds });
    }
    return rects;
  }

  private countdownRect(): Rect {
    const p = this.g.layout.panel, u = this.u;
    // Warsaw's high strip cannot move the whole column below a broad countdown without hitting the Wall.
    // Give his wide-screen clock the unused top-left corner; phone and ordinary boss layouts keep their shape.
    if (wideBattle(p) && this.battle.finale) return { x: u * 0.5, y: u * 0.5,
      w: Math.min(p.w - this.clearancePause.w - u * 2, u * 18), h: this.fuseH };
    if (this.shortUpright && this.battle.finale) return { x: u * 0.5, y: u * 0.5,
      w: p.w - this.clearancePause.w - u * 2, h: this.fuseH };
    const band = wideBattle(p) ? this.fightBand() : { left: 0, right: p.w };
    const w = this.battle.finale ? Math.min(band.right - band.left - u * 1.4, u * 27)
      : Math.min(band.right - band.left - u * 2, u * 22);
    return { x: band.left + (band.right - band.left - w) / 2, y: this.barTop(), w, h: this.fuseH };
  }

  /** The command panel's name tab: a name's size on a narrow upright panel (a phone at the larger text), where the fight needs the height. */
  private tabSize(): 'title' | 'name' {
    const p = this.g.layout.panel;
    return !wideBattle(p) && p.w < this.u * 22 ? 'name' : 'title';
  }

  /** Where the party's member cards are, in panel coordinates: what the old status box was. */
  statusRect(): Rect {
    this.ensureLayout();
    return this.tier.geo.statusArea;
  }

  /** The whole member strip, band and rule included. */
  tierRect(): Rect {
    this.ensureLayout();
    return this.tier.geo.band;
  }

  /** Each member's card, for the browser checks. */
  /** Where the status row begins, in the panel's pixels: the ground below it is hidden. */
  get statusTop(): number {
    return Math.min(...this.statusRows.map(r => r.y));
  }

  get statusRows(): Array<{ f: Fighter; x: number; y: number; w: number; h: number }> {
    this.ensureLayout();
    return this.tier.cards.map((c, i) => ({ f: c.f, ...this.tier.geo.cards[i]!.card }));
  }

  /** Each member's card and MP bar, and the narrowest bar, for the browser checks. */
  statusColumns(): { members: Array<{ card: Rect; bar: Rect }>; barW: number } {
    this.ensureLayout();
    const members = this.tier.geo.cards.map((c) => ({ card: c.card, bar: c.bar }));
    return { members, barW: Math.min(...members.map((c) => c.bar.w)) };
  }

  /** The words each card shows, by `index:part`, for the browser checks. */
  get rowTextCache(): Map<string, Text> {
    return this.tier.texts;
  }

  rowMarks(i: number) {
    return this.tier.marks(i);
  }

  /**
   * The part of the panel the fight should be framed in: below the Pause button (and the boss's
   * bar), and above the member strip; on a tall screen above the command panel, which stands over
   * the lower part of the fight, and on a wide one left of the command panel's slot.
   */
  fightBand(): { top: number; bottom: number; left: number; right: number } {
    return this.fightBands()[0]!;
  }

  /** A special's animation can use the room above the status strip without shrinking the world. */
  effectBand(afterStrike = false): { top: number; bottom: number; left: number; right: number } {
    const band = this.fightBand();
    // The spent countdown disappears at impact, giving the rising cloud its room.
    const top = afterStrike && this.battle.finale ? this.barTop() + this.u * 0.4 : band.top;
    return { ...band, top, bottom: thumbReach(this.g.layout) ? this.tier.geo.rule.y1 - this.u * 0.4 : band.bottom };
  }

  /**
   * The parts of the panel a fight may be framed in; the fight takes whichever it fits best. On a tall
   * screen: across the panel above the command list (the one open most of the fight; the other lists
   * rise a little higher while open, a Tonic's list of members over the party's right end on a phone),
   * or, for a fight too tall for that, beside the command panel down to the turn strip. On a wide screen:
   * left of the command slot, above the turn strip.
   */
  /** The fight's top edge: below Pause, a boss's countdown, and the margin. */
  private fightTop(): number {
    const u = this.u, counting = this.battle.enemies.some((e) => e.countdown !== null);
    return this.barTop() + (counting ? this.fuseH + u * 0.4 : 0) + (this.smallPhone ? 0 : u * 0.4);
  }

  /** The height a fight keeps at least on a taller phone. A column fight (the Warsaw Pac's) is only one figure deep. */
  private get fightLeast(): number { return this.battle.column ? 180 : 280; }

  /** A taller upright phone: the fight's room may run down past the command list's top, and has height to spare. */
  private get roomyUpright(): boolean {
    return thumbReach(this.g.layout) && !this.shortUpright && !(this.smallPhone && !this.battle.column);
  }

  fightBands(): Array<{ top: number; bottom: number; left: number; right: number }> {
    this.ensureLayout();
    const p = this.g.layout.panel;
    const u = this.u;
    const geo = this.tier.geo;
    const G = measures(u).G;
    const top = this.fightTop();
    // The turn strip's top: it stands on the rule, so the fight stays above it wherever the command list does not
    // cover it (the boss's fight has none).
    const strip = geo.rule.y1 - (this.turnH ? this.turnH + measures(u).S + this.stripLift : 0);
    if (this.shortUpright) return [{ top, bottom: geo.actionSlot.y - this.commandH - u * 0.4, left: 0, right: p.w }];
    if (wideBattle(p)) return [{ top, bottom: strip - u * 0.4, left: 0, right: geo.actionSlot.x - G }];
    if (thumbReach(this.g.layout)) {
      // On the shortest phones, centre and pack ordinary fights in the space
      // actually above the commands. Reserving a taller band puts the lower
      // enemies behind the menu even after the turn queue moves to the bottom.
      if (this.smallPhone && !this.battle.column) {
        return [{ top, bottom: geo.actionSlot.y - this.commandH - u * 0.4, left: 0, right: p.w }];
      }
      // Keep the 44px formation readable. Lists retain their full height and may rise over it;
      // opening a submenu must neither shrink the figures nor move the camera.
      // A column fight is only one figure deep, so it needs less height and sits above the commands.
      const least = this.fightLeast;
      // A side column taller than the list stands in the room's lower left and never shortens it (the owner, 2026-11-06):
      // a fighter there steps clear of it, as from the lists.
      const bottom = Math.min(geo.rule.y1 - u * 0.4, Math.max(geo.actionSlot.y - this.commandH - u * 0.4, top + least));
      return [{ top, bottom, left: 0, right: p.w }];
    }
    return [
      { top, bottom: geo.actionSlot.y - this.commandH - u * 0.4, left: 0, right: p.w },
      // Beside the command panel: right of the side column, where there is one.
      { top, bottom: strip - u * 0.4, left: this.sideQueue ? (b => Math.round(b.x + b.width + measures(u).S + u * 0.4))(this.sideQueueGeometry()) : 0, right: geo.actionSlot.x - G },
    ];
  }

  private placeMenu(): void {
    if (!this.menu) return;
    const slot = this.tier.geo.actionSlot;
    // Its foot on the rule (tall screens) or the strip's floor (wide), at the right; the same place for every list, a wide one reaching further left.
    const x = slot.x - (this.menuWide ? this.fullW - this.actionW : 0);
    this.menu.container.position.set(Math.round(x), Math.round(slot.y - this.menu.height));
  }

  // ---------------------------------------------------------------------------------------------
  // Menus

  /** The member cards and the turn strip leave for a mid-fight cutscene, and come back as it ends. */
  hudAway(away: boolean): void {
    if (this.hudHidden === away) return;
    this.hudHidden = away;
    const cards = this.tier.container, drop = this.u * 12;
    anim.finish(this.tier);
    this.tier.hits.visible = !away;
    if (away) {
      const rest = cards.y;
      void anim.run(this.tier, motion.reduced ? 0 : MS.nameSlam, EASE.out, (k) => { cards.y = rest + k * drop; }).then(() => {
        cards.y = rest;
        if (this.hudHidden) cards.visible = false;
      });
    } else {
      cards.visible = true;
      anim.play(this.tier, cards, { dy: drop }, MS.nameSlam, EASE.out);
    }
  }
  private hudHidden = false;

  private setActive(f: Fighter | null, opts: { paste?: boolean } = {}): void {
    this.active = f;
    this.pending = null;
    this.openCommand({ paste: opts.paste ?? true });
  }

  private closeMenu(): void {
    clearIfInked(this.hoverCursor);
    this.targetMarks = [];
    this.menu?.destroy();
    this.menu = null;
    this.switchCaps?.destroy({ children: true });
    this.switchCaps = null;
    this.switchKey = '';
  }

  /** Reserve row spaces below the first target so it stays over the action that opened it. */
  private targetMenuSize(mode: Mode, pending: Pending | null): { minRows?: number; rowHeight?: number } {
    if (mode === 'target_enemy' && pending?.kind === 'attack') {
      return { minRows: this.commandItems().length, rowHeight: measures(this.u).cmdRowH };
    }
    if (mode === 'target_all' && pending?.kind === 'special') {
      const moves = this.active ? this.battle.specialsOf(this.active) : Object.keys(this.g.content.specials);
      // Count the selected move and all rows below it, including Back. A-star needs three;
      // Cherry Chomp already aligns with its ordinary two-row confirmation.
      return { minRows: moves.length + 1 - moves.indexOf(pending.id) };
    }
    return {};
  }

  /** Which list a mode shows, as the layout measured them: a move on a whole side has its own. */
  private listKind(mode: Mode, pending: Pending | null): string {
    return mode === 'target_all' && pending?.kind === 'special' ? `target_all:${pending.id}` : mode;
  }

  /**
   * Opens a list in the command panel. It is pressed onto the page only when the player opened it
   * (not when members are switched or a list is built again quietly); either way it takes input at once.
   */
  private openList(items: MenuItem[], subtitle: string | null, onCancel: (() => void) | null, index = 0, opts: { paste?: boolean; rest?: { row: number; glove?: boolean; place?: MenuPlace } } = {}): void {
    this.closeMenu();
    this.ensureLayout();
    const f = this.active!;
    const command = this.mode === 'command';
    this.menuWide = this.wideLists.has(this.listKind(this.mode, this.pending));
    const width = this.menuWide ? this.fullW : this.actionW;
    const m = new MenuList(items, {
      // While a target is chosen, left and right move the target, so the tab does not say they switch members.
      title: this.choosing() ? f.name : this.commandTitle(f),
      subtitle: subtitle ?? undefined,
      style: 'action',
      // See-through over the turn strip; phones keep it in the boss's fight too, which has none.
      backgroundOpacity: thumbReach(this.g.layout) || this.stripBehind ? OVERLAPPING_UI_OPACITY : 1,
      command,
      // Extra heading space grows upward; reserved row spaces stay below Back.
      ...this.targetMenuSize(this.mode, this.pending),
      width,
      tabInk: 'pink',
      tabSize: this.tabSize(),
      // Room beside the tab for the keys that switch members.
      titleRoom: command ? this.u * 3.4 : 0,
    });
    m.onCancel = onCancel;
    m.index = enabledMenuIndex(items, index);
    // On touch, where the band rests; a list given none rests as any list does.
    if (opts.rest) m.restOn(opts.rest.row, opts.rest);
    withSounds(m, (s) => this.g.audio.play(s));
    this.listKey = listKey(items, subtitle ?? '');
    m.build(this.u, width, { ...this.menuRoom(), w: width });
    this.menu = m;
    this.container.addChild(m.container);
    this.placeMenu();
    if (opts.paste) pastePanel(this, m.skins(), measures(this.u).S);
  }

  private commandItems(): MenuItem[] {
    const g = this.g;
    return [
      { label: g.msg('menu', 'attack'), icon: 'burst', id: 'attack', onChoose: () => this.startTarget({ kind: 'attack' }) },
      { label: g.msg('menu', 'special'), icon: 'star', id: 'special', onChoose: () => this.openSpecial() },
      { label: g.msg('menu', 'item'), icon: 'bottle', id: 'item', onChoose: () => this.openItems() },
    ];
  }

  private openCommand(opts: { paste?: boolean; index?: number } = {}): void {
    const f = this.active;
    if (!f) {
      this.mode = 'idle';
      this.closeMenu();
      return;
    }
    this.mode = 'command';
    // On touch the band rests on Attack, with the glove in the Warsaw Pac's finale (the owner, 2026-11-12).
    this.openList(this.commandItems(), null, null, opts.index ?? 0, { paste: opts.paste, rest: { row: 0, glove: Boolean(this.battle.finale) } });
  }

  /** The command panel's tab: the member's name, marked as switchable when others are ready too. */
  private commandTitle(f: Fighter): string {
    return this.battle.readyMembers().length > 1 ? this.g.msg('menu', 'switch_title', { name: f.name }) : f.name;
  }

  /** Members who are ready, whoever became ready first leading. */
  private readyInTurn(): Fighter[] {
    return this.battle.readyMembers().sort((a, b) => (a.readyAt ?? Infinity) - (b.readyAt ?? Infinity));
  }

  private openSpecial(opts: { quiet?: boolean; index?: number } = {}): void {
    this.mode = 'special';
    if (!opts.quiet) this.g.audio.play('confirm');
    const { items, title } = this.specialRows(this.active!);
    // On touch the band rests on the A-star Maneuver, which every member has, or on Back while it is greyed (the owner, 2026-11-12).
    const star = items.findIndex((it) => it.id === 'a_star' && it.enabled !== false);
    this.openList(items, title, () => this.back(), opts.index, { paste: !opts.quiet, rest: { row: star >= 0 ? star : items.length - 1 } });
  }

  /** The Special list's rows and title, which change with the member's MP. `full` measures it at full MP. */
  private specialRows(f: Fighter, full = false): { items: MenuItem[]; title: string } {
    const g = this.g;
    const mp = full ? (f.member?.maxMp ?? 0) : (f.member?.mp ?? 0);
    const items: MenuItem[] = this.battle.specialsOf(f).map((id) => {
      const sp = g.content.specials[id]!;
      return {
        id,
        label: sp.name,
        detail: g.msg('menu', 'mp_cost', { mp: sp.mp }),
        enabled: mp >= sp.mp,
        // Every move goes through target choice: a move on a whole side shows the whole side first.
        onChoose: () => this.startTarget({ kind: 'special', id }),
      };
    });
    // A Back row, so touch players can leave the list without a keyboard.
    items.push({ id: 'back', label: g.msg('menu', 'back'), onChoose: () => this.back() });
    return { items, title: `${g.msg('menu', 'special_title')}  ${g.msg('menu', 'mp', { mp, max: f.member?.maxMp ?? 0 })}` };
  }

  private openItems(opts: { quiet?: boolean; index?: number } = {}): void {
    this.mode = 'item';
    if (!opts.quiet) this.g.audio.play('confirm');
    const { items, title } = this.itemRows();
    // On touch the band rests on Back, or on the item chosen last while it is there and not greyed (the owner, 2026-11-12).
    this.openList(items, title, () => this.back(), opts.index, { paste: !opts.quiet, rest: { row: items.length - 1, place: this.g.menuPlace?.('fight_items') } });
  }

  /** Why an item is greyed, in the fight's words; a 1UP with nobody down says nothing (the owner, 2026-11-13: "Seems like saying nothing would be better"). */
  private whyGreyed(reason: ReturnType<typeof itemBlocked>): string | undefined {
    return reason && reason !== 'needs_ko' ? this.g.msg('item_unavailable', reason) : undefined;
  }

  /** The Item list's rows and title, which change with the bag and with who is hurt. `all` measures every kind, greyed as for `people` if given. */
  private itemRows(all = false, people?: readonly Vitals[]): { items: MenuItem[]; title: string } {
    const g = this.g;
    const items: MenuItem[] = Object.entries(g.content.items)
      .filter(([id]) => all || (g.state.items[id] ?? 0) > 0)
      .map(([id, it]) => {
        const count = all ? 99 : (g.state.items[id] ?? 0);
        const reason = all && !people ? null : itemBlocked(it, people ?? this.battle.party.map(vitals), count);
        const why = this.whyGreyed(reason);
        return {
          id,
          label: it.name,
          detail: [g.msg('menu', 'count', { count }), ...(why ? [why] : [])].join(' · '),
          icon: 'bottle' as const,
          // An item that would do nothing for anyone is greyed.
          enabled: !reason,
          onChoose: () => this.startTarget({ kind: 'item', id }),
        };
      });
    if (!items.length) items.push({ id: 'none', label: g.msg('menu', 'none'), enabled: false, onChoose: () => undefined });
    items.push({ id: 'back', label: g.msg('menu', 'back'), onChoose: () => this.back() });
    return { items, title: g.msg('menu', 'item_title') };
  }

  private back(): void {
    this.g.audio.play('cancel');
    const p = this.pending;
    if (this.choosing()) {
      // Back to the list the choice came from, with the cursor on the row chosen.
      if (p?.kind === 'special') this.openSpecial({ quiet: true, index: this.battle.specialsOf(this.active!).indexOf(p.id) });
      else if (p?.kind === 'item') this.openItems({ quiet: true, index: Object.keys(this.g.content.items).filter((id) => (this.g.state.items[id] ?? 0) > 0).indexOf(p.id) });
      else this.openCommand();
      return;
    }
    this.openCommand({ index: this.commandItems().findIndex(item => item.id === this.mode) });
  }

  private choosing(): boolean {
    return this.mode === 'target_enemy' || this.mode === 'target_member' || this.mode === 'target_all';
  }

  /** The Item or Special list is open, or a target is being picked for one: the member's decision clock waits meanwhile. */
  get holdsClock(): boolean {
    return this.mode === 'special' || this.mode === 'item' || (this.choosing() && (this.pending?.kind === 'item' || this.pending?.kind === 'special'));
  }

  /** Clear pending input immediately on timeout or a boss interruption. */
  interrupt(): void {
    this.active = null;
    this.pending = null;
    this.target = null;
    this.mode = 'idle';
    this.closeMenu();
    clearIfInked(this.cursor);
    this.cursorAt = null;
    this.placeFocus(null);
    this.targetMarks = [];
    this.cutUp?.root.destroy({ children: true });
    this.cutUp = null;
    this.cutInShown = null;
    this.cutInRun = null;
  }

  /** A brief mark in the queue while the expired decision's ordinary Attack starts. */
  timeoutAction(who: Fighter): void {
    this.turnsView.timeout(`${this.battle.fighters.indexOf(who)}@${this.battle.turns.time}`);
  }

  /** Whether the move being confirmed is one on the whole party. */
  private areaOnParty(): boolean {
    const p = this.pending;
    return p?.kind === 'special' && this.g.content.specials[p.id]?.target === 'party';
  }

  /** Who can be chosen: for an item, only those it would do something for. */
  private targets(): Fighter[] {
    const p = this.pending;
    if (this.mode === 'target_member') {
      const item = p?.kind === 'item' ? this.g.content.items[p.id] : null;
      return item && p?.kind === 'item' ? this.battle.party.filter((f) => !itemBlocked(item, [vitals(f)], this.g.state.items[p.id] ?? 0)) : this.battle.party;
    }
    if (this.mode === 'target_all' && this.areaOnParty()) return this.battle.livingParty();
    return this.battle.livingEnemies();
  }

  private startTarget(p: Pending): void {
    this.pending = p;
    this.g.audio.play('confirm');
    this.closeMenu();
    const sp = p.kind === 'special' ? this.g.content.specials[p.id] : null;
    this.mode = sp?.target === 'all_enemies' || sp?.target === 'party' ? 'target_all' : p.kind === 'item' || sp?.target === 'one_member' ? 'target_member' : 'target_enemy';
    this.target = this.firstTarget(p);
    this.openTargets({ paste: true });
  }

  /**
   * Where the cursor starts: an item on whoever needs it most; an attack on the enemy this
   * member hit last, or the one standing nearest it if it has fallen.
   */
  private firstTarget(p: Pending): Fighter | null {
    const list = this.targets();
    if (!list.length) return null;
    if (p.kind === 'item') return list[Math.max(0, neediest(this.g.content.items[p.id]!, list.map(vitals)))]!;
    const last = this.active?.lastTarget;
    if (last && list.includes(last)) return last;
    return last ? nearest(list, last.actor) : list[0]!;
  }

  /**
   * The target list's rows and the line over them, what to do: a row for each figure the choice can fall on, or
   * one for a whole side, then Back. For an item every member has a row, with what it would do for them (as in the
   * party menu), greyed where it would do nothing. `fighters` holds each row's figure. `worst` measures the widest
   * the list can be: every enemy, and an item bringing each member back from DOWN.
   */
  private targetRows(mode: Mode, p: Pending | null, worst = false): { items: MenuItem[]; title: string; fighters: Array<Fighter | null> } {
    const g = this.g;
    const items: MenuItem[] = [];
    const fighters: Array<Fighter | null> = [];
    const sp = p?.kind === 'special' ? g.content.specials[p.id] : null;
    let title: string;
    if (mode === 'target_all' && sp) {
      title = g.msg('battle', 'confirm_area', { move: sp.name });
      const available = sp.target === 'party' ? this.battle.livingParty() : this.battle.livingEnemies();
      items.push({ id: 'all', label: g.msg('battle', sp.target === 'party' ? 'whole_party' : 'all_enemies'), enabled: worst || available.length > 0, onChoose: () => this.chooseTarget(this.targets()[0]!) });
      fighters.push(null);
    } else if (mode === 'target_member') {
      title = g.msg('battle', 'select_member');
      const item = p?.kind === 'item' ? g.content.items[p.id] : null;
      for (const f of this.battle.party) {
        const v = vitals(f);
        const reason = item && p?.kind === 'item' ? itemBlocked(item, [v], g.state.items[p.id] ?? 0) : null;
        const change = item ? previewItem(item, v)[0] : undefined;
        const detail = worst
          ? g.msg('party', 'preview_hp', { from: g.msg('battle', 'down'), to: f.maxHp })
          : reason
            ? this.whyGreyed(reason)
            : change
              ? g.msg('party', change.stat === 'hp' ? 'preview_hp' : 'preview_mp', { from: change.stat === 'hp' && change.from <= 0 ? g.msg('battle', 'down') : change.from, to: change.to })
              : undefined;
        items.push({ id: f.name, label: f.name, detail, enabled: !reason, onChoose: () => this.chooseTarget(f) });
        fighters.push(f);
      }
    } else {
      title = g.msg('battle', 'select_target');
      for (const f of worst ? this.battle.enemies : this.battle.livingEnemies()) {
        items.push({ id: f.name, label: f.name, onChoose: () => this.chooseTarget(f) });
        fighters.push(f);
      }
    }
    items.push({ id: 'back', label: g.msg('menu', 'back'), onChoose: () => this.back() });
    fighters.push(null);
    return { items, title, fighters };
  }

  /**
   * The list while a target is chosen, in the command panel: a row for each target, its cursor on the target.
   * The cursor on a row (the mouse over it, or a finger landing on it) puts the target on that row's figure, and
   * choosing a row chooses it. Pressed on when a choice starts, built again quietly when its rows come or go.
   */
  private openTargets(opts: { paste?: boolean } = {}): void {
    const { items, title, fighters } = this.targetRows(this.mode, this.pending);
    this.rowFighters = fighters;
    const index = this.mode === 'target_all' ? (items[0]?.enabled !== false ? 0 : items.length - 1) : fighters.indexOf(this.target);
    // On touch (the owner, 2026-11-12) a list of enemies rests on the top one until the player has chosen one this fight, then on
    // that one while it stands; an item's list of members on whoever needs it most, with the glove, or on Back when it would help no one.
    const back = items.length - 1;
    let rest: { row: number; glove?: boolean } | undefined;
    if (this.mode === 'target_enemy') {
      const at = this.lastEnemy ? fighters.indexOf(this.lastEnemy) : -1;
      const top = items.findIndex((it, i) => i < back && it.enabled !== false);
      rest = { row: at >= 0 ? at : top >= 0 ? top : back };
    } else if (this.mode === 'target_member' && this.pending?.kind === 'item') {
      const at = neediest(this.g.content.items[this.pending.id]!, this.battle.party.map(vitals));
      const helps = at >= 0 && items[at]?.enabled !== false;
      rest = { row: helps ? at : back, glove: helps };
    }
    this.openList(items, title, () => this.back(), index, { ...opts, rest });
    this.shownTarget = this.target;
    const m = this.menu!;
    const blip = m.onMove;
    m.onMove = (i) => {
      blip?.(i);
      const f = this.rowFighters[i];
      if (f && this.mode !== 'target_all' && this.targets().includes(f)) this.target = this.shownTarget = f;
    };
  }

  /**
   * Whether the target's marks show (its corners, focus lines, card frame and item preview): always with keys and the mouse; on
   * touch only while the list's band is on the row standing for the target, as every list's followers go with its band (the owner,
   * 2026-11-11). So none when the list appears, the pressed row's target while a finger is on it.
   */
  private marksShown(): boolean {
    const m = this.menu;
    if (!m?.touching || !this.choosing()) return true;
    const row = m.shown;
    if (row < 0) return false;
    return this.mode === 'target_all' ? m.items[row]?.id === 'all' : this.rowFighters[row] === this.target;
  }

  /** A field input selects its target's row even when the figure was already targeted. */
  private selectTargetRow(): void {
    const row = this.rowFighters.indexOf(this.target);
    if (this.mode !== 'target_all' && row >= 0) this.menu?.select(row);
    this.shownTarget = this.target;
  }

  private commit(choice: Choice): void {
    const f = this.active;
    if (!f || !this.battle.isReady(f)) return;
    this.g.audio.play('confirm');
    this.lastChoice = choice;
    this.battle.choose(f, choice);
    this.active = null;
    this.pending = null;
    this.mode = 'idle';
    this.closeMenu();
  }

  private chooseTarget(t: Fighter): void {
    const p = this.pending;
    if (!p || !this.targets().includes(t)) return;
    if (this.mode === 'target_enemy') this.lastEnemy = t;
    if (p.kind === 'attack') this.commit({ kind: 'attack', target: t });
    else if (p.kind === 'item') this.commit({ kind: 'item', id: p.id, target: t });
    else if (this.mode === 'target_all') this.commit({ kind: 'special', id: p.id, target: null });
    else this.commit({ kind: 'special', id: p.id, target: t });
  }

  /** A tap on a member's card: choose them, confirm a move on the party, or switch to them. */
  private tapRow(f: Fighter): void {
    if (this.mode === 'target_member') {
      if (this.targets().includes(f)) this.chooseTarget(f);
      else this.g.audio.play('cancel');
    } else if (this.mode === 'target_all' && this.areaOnParty()) this.chooseTarget(f);
    else if (this.battle.isReady(f)) this.setActive(f, { paste: false });
  }

  /**
   * The mouse over a member's card while choosing one of the party: the cursor follows it onto them, as over their
   * figure, so the card and the figure answer the mouse alike (the owner, 2026-10-29).
   */
  private hoverRow(f: Fighter): void {
    if (this.mode !== 'target_member' || !this.targets().includes(f)) return;
    if (f !== this.target) {
      this.target = f;
      this.g.audio.play('blip');
    }
    this.selectTargetRow();
  }

  /** The figure a tap at a panel point is on, if any. Neighbours' circles can overlap, so the closest wins. */
  private figureAt(list: Fighter[], px: number, py: number): Fighter | null {
    const w = this.battle.world;
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const t of list) {
      const [sx, sy] = w.worldToPanel(t.actor.x, t.actor.y, t.actor.size);
      const d = Math.hypot(sx - px, sy - py);
      if (d < t.actor.size * w.zoom + this.u * 1.2 && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (best) return best;
    // A whole figure (the tank, the boss) is drawn far larger than its body's circle, standing on its feet: anywhere
    // on its picture takes the tap (the owner, 2026-10-13: the tank's "hitbox when clicking on it is tiny, it should be
    // the whole tank"). Tried after the circles, so someone standing in front of it is still tapped themselves.
    const m = this.u * 0.3;
    for (const t of list) {
      const box = wholeBox(t.actor.look, t.actor.size);
      if (!box) continue;
      const [fx, fy] = w.worldToPanel(t.actor.x, t.actor.y);
      const hw = box.halfW * w.zoom + m;
      const top = fy - box.depth * w.zoom - m;
      if (px < fx - hw || px > fx + hw || py < top || py > fy + m) continue;
      const d = Math.hypot(fx - px, (top + fy) / 2 - py);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  /** Whether a panel point is on or just beside a part of the interface, where a slip should not attack. */
  private nearInterface(px: number, py: number): boolean {
    const u = this.u;
    const rects: Rect[] = [this.tierRect()];
    if (this.menu) rects.push({ x: this.menu.container.x, y: this.menu.container.y, w: this.menu.width, h: this.menu.height });
    if (this.turnStrip.visible) rects.push(this.turnStripRect);
    if (this.pauseButton?.visible) rects.push({ x: this.pauseButton.x, y: this.pauseButton.y, w: this.pauseButton.width, h: this.pauseButton.height });
    const m = u * 0.5;
    return rects.some((r) => px > r.x - m && px < r.x + r.w + m && py > r.y - m && py < r.y + r.h + m);
  }

  /**
   * A tap on the panel that no part of the interface took. While choosing, it picks the
   * tapped target. With the command menu open, a tap on an enemy attacks it at once.
   */
  tap(px: number, py: number): boolean {
    this.tapsSeen++;
    if (this.mode === 'command') {
      if (this.nearInterface(px, py)) return false;
      const e = this.figureAt(this.battle.livingEnemies(), px, py);
      if (e) this.commit({ kind: 'attack', target: e });
      return e !== null;
    }
    if (!this.choosing()) return false;
    const best = this.figureAt(this.targets(), px, py);
    if (best) this.chooseTarget(best);
    return best !== null;
  }

  /**
   * The mouse over the panel: while choosing one target, the cursor follows it onto a figure. Not on the
   * interface, where the target list's rows move the cursor themselves.
   */
  hover(px: number, py: number): void {
    this.hoverPoint = { x: px, y: py };
    if (this.mode !== 'target_enemy' && this.mode !== 'target_member') return;
    if (this.nearInterface(px, py)) return;
    const t = this.figureAt(this.targets(), px, py);
    if (t) {
      if (t !== this.target) {
        this.target = t;
        this.g.audio.play('blip');
      }
      this.selectTargetRow();
    }
  }

  /** A mouse that left the canvas, or another input device, no longer offers a direct attack. */
  clearHover(): void {
    this.hoverPoint = null;
    clearIfInked(this.hoverCursor);
    if (this.mode === 'command') this.targetMarks = [];
  }

  /**
   * The same four corners serve direct-attack hover and explicit target selection: red on an enemy, yellow on a
   * member of the party (the owner, 2026-10-29).
   */
  private markTarget(t: Fighter, into = this.cursor): void {
    const m = this.targetRect(t);
    const len = Math.min(m.w, m.h) * 0.225;
    if (t.side === 'party') brackets(into, m.x, m.y, m.w, m.h, len, this.allyMark(t), 3.5, INK);
    else fieldBrackets(into, m, len, this.targetLine(m), this.markAge(t), motion.reduced, RED_INK, POP_YELLOW, PAPER);
    this.targetMarks.push(m);
  }

  /** How thick an enemy's brackets are: an ordinary enemy's 3, and thicker in proportion on a bigger box (the owner, 2026-11-01). */
  private targetLine(m: Rect): number {
    return 3 * Math.max(1, Math.min(m.w, m.h) / (PLAIN_ENEMY_SIZE * this.battle.world.zoom * 3));
  }

  /** How long a figure's brackets have been up, in seconds: from when they come up, for as long as they stay. */
  private markAge(t: Fighter): number {
    const now = anim.clock;
    const mark = this.markSince.get(t);
    if (!mark || now - mark.seen > 0.1) {
      this.markSince.set(t, { from: now, seen: now });
      return 0;
    }
    mark.seen = now;
    return now - mark.from;
  }
  private readonly markSince = new Map<Fighter, { from: number; seen: number }>();

  /**
   * Where a target's brackets go on the panel: round its body as it is drawn now, and round the whole picture of a figure
   * drawn far larger than its body (the owner, 2026-11-01, of the tank: "The tank is small").
   */
  private targetRect(t: Fighter): Rect {
    const w = this.battle.world, a = t.actor;
    const size = a.size * a.grow;
    const [sx, sy] = w.worldToPanel(a.x, a.y, size);
    const r = size * w.zoom * 1.5;
    const box = wholeBox(a.look, a.size);
    if (!box) return { x: sx - r, y: sy - r, w: r * 2, h: r * 2 };
    const [fx, fy] = w.worldToPanel(a.x, a.y);
    const hw = box.halfW * w.zoom, pad = this.u * 0.3;
    const x0 = Math.min(sx - r, fx - hw - pad), x1 = Math.max(sx + r, fx + hw + pad);
    const y0 = Math.min(sy - r, fy - box.depth * w.zoom - pad), y1 = Math.max(sy + r, fy + pad);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** A member's yellow brackets turn white and back in time with the corners on their card. */
  private allyMark(t: Fighter): number {
    const card = this.tier.cards.find((c) => c.f === t);
    return mix(POP_YELLOW, 0xffffff, card?.targetBox.animation.corner ?? 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Messages and effects

  /** Every message of the fight, newest last, for the browser checks. */
  readonly messageLog: string[] = [];

  /**
   * A line of the fight, kept for the log page. The fight itself shows none (the owner, 2026-10-14, so players new to
   * the genre watch the fight): the numbers over the figures, the knockout bursts, and the victory box say it there.
   */
  message(s: string): void {
    this.messageLog.push(s);
    this.g.record({ speaker: '', text: s, kind: 'fight' });
  }

  /**
   * A number over a figure, as a sound-effect burst: damage to an enemy on a jagged white burst,
   * damage to the party in red on a double burst, a heal on a puff, and a miss with no plate.
   */
  popup(actor: Actor, s: string, kind: 'enemy' | 'party' | 'heal' | 'miss', headroom = 2): void {
    if (actor.hidden) return;
    const u = this.u;
    const m = measures(u);
    const color = kind === 'party' ? RED_INK : kind === 'heal' ? HEAL : kind === 'miss' ? INK_SOFT : INK;
    const t = new Text({ text: s, style: { fontFamily: FONT.shout, fontSize: Math.round(u * (kind === 'miss' ? 1.5 : 1.9)), fill: color, stroke: { color: 0xffffff, width: Math.round(u * 0.3) } } });
    t.anchor.set(0.5);
    const c = new Container();
    const plate = kind === 'miss' ? 'none' : kind === 'heal' ? 'puff' : kind === 'party' ? 'double' : 'burst';
    if (plate !== 'none') {
      const g = new Graphics();
      const w = t.width + u * 0.5;
      const h = t.height * 0.75 + u * 0.3;
      if (plate === 'puff') cloud(g, -w / 2, -h / 2, w, h, u * 0.55, null, m.L);
      else {
        g.poly(spikyRect(-w / 2, -h / 2, w, h, u * 0.45)).fill(0xffffff).stroke({ width: m.L, color: INK, join: 'miter' });
        // Damage to the party: a second outline inside the first.
        const i = m.L + m.l * 1.5;
        if (plate === 'double') g.poly(spikyRect(-w / 2 + i, -h / 2 + i, w - i * 2, h - i * 2, u * 0.35)).stroke({ width: m.l, color: INK, join: 'miter' });
      }
      c.addChild(g);
    }
    c.addChild(t);
    this.container.addChild(c);
    const stack = this.popups.filter((p) => p.actor === actor).reduce((n, p) => Math.max(n, p.stack + 1), 0);
    // Above the top of any number still showing on the figure, where it has risen to, with room for this one's pop past full size.
    const h = c.height;
    const lift = this.popups.filter((p) => p.actor === actor).reduce((n, p) => Math.max(n, p.lift + p.rise + p.h + u * 0.1 + h * 0.08), 0);
    this.popups.push({ text: c, h, lift, rise: 0, actor, age: 0, stack, headroom });
    this.popupLog.push({ who: this.battle.fighters.find((f) => f.actor === actor)?.name ?? '', text: s, plate });
    if (this.popupLog.length > 20) this.popupLog.shift();
  }

  /** A blow on a member: their card's edge shows red for a moment. */
  flashCard(f: Fighter): void {
    this.tier.flash(f);
  }

  /** The numbers shown lately, newest last, with the plate each was drawn on, for the browser checks. */
  readonly popupLog: Array<{ who: string; text: string; plate: string }> = [];

  /**
   * Effects are drawn upright, like the figures: each one sits at a point in the world and is
   * stretched back by the tilt, so a round burst stays round on tilted ground.
   */
  private upright(g: Graphics): void {
    g.scale.set(1, 1 / this.battle.world.ground);
  }

  /** Knockout bursts showing now, for the checks. */
  koShown = 0;

  /**
   * An enemy knocked out: a yellow starburst with a white heart pops where it stood, ink lines fly out
   * past it, and shards in the three inks are thrown off, turning as they fall; all gone in half a second.
   * It is drawn in map units, upright on tilted ground, and keeps the fight's clock. With Reduce motion the
   * burst stands at full size and fades, with no shards.
   */
  poof(actor: Actor): void {
    const w = this.battle.world;
    const g = new Graphics();
    g.eventMode = 'none';
    g.position.set(actor.x, w.upY(actor.y, actor.size));
    this.upright(g);
    w.fx.addChild(g);
    const s = actor.size;
    const rnd = seeded(Math.round(actor.x * 7 + actor.y * 13));
    const inks = [POP_PINK, POP_CYAN, POP_YELLOW];
    const shards = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2 + rnd() * 0.6, v: s * (8 + rnd() * 4), spin: (rnd() - 0.5) * 16, ink: inks[i % 3]!, z: s * (0.4 + rnd() * 0.15) }));
    const total = 0.5;
    let t = 0;
    this.koShown++;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.koShown--;
      if (!g.destroyed) g.destroy();
    };
    const draw = () => {
      g.clear();
      const still = motion.reduced;
      g.alpha = t > total * 0.55 ? Math.max(0, 1 - (t - total * 0.55) / (total * 0.45)) : 1;
      const r = s * (still ? 1.8 : 0.8 + EASE.pop(Math.min(1, t / 0.12)) * 1.0);
      const lw = Math.max(0.8, s * 0.08);
      // Ink lines thrown out past the burst.
      const r0 = r * (1.1 + (still ? 0 : t * 1.5));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * (r0 + s * 0.8), Math.sin(a) * (r0 + s * 0.8));
      }
      g.stroke({ width: lw, color: INK });
      g.poly(burstPoints(0, 0, r, 10, 0.6, 0.2)).fill(POP_YELLOW).stroke({ width: lw, color: INK, join: 'miter' });
      g.poly(burstPoints(0, 0, r * 0.55, 10, 0.62, -0.1)).fill(0xffffff);
      if (still) return;
      for (const sh of shards) {
        const d = sh.v * t;
        const cx = Math.cos(sh.a) * d;
        const cy = Math.sin(sh.a) * d + s * 10 * t * t;
        const rot = sh.a + sh.spin * t;
        const pts: number[] = [];
        for (const [px, py] of [[0, -sh.z], [sh.z * 0.9, sh.z * 0.7], [-sh.z * 0.9, sh.z * 0.7]] as const) {
          pts.push(cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot));
        }
        g.poly(pts).fill(sh.ink).stroke({ width: lw * 0.8, color: INK, join: 'miter' });
      }
    };
    draw();
    w.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || g.destroyed) return true;
        draw();
        return false;
      },
      resolve: end,
    });
  }

  /** Dizzy stars over each member who is down, by the member's figure. */
  private readonly dizzy = new Map<Actor, Graphics>();
  private dizzyTurn = 0;

  /** How many members show dizzy stars, for the checks. */
  get dizzyShown(): number {
    return this.dizzy.size;
  }

  /**
   * Three small yellow stars circle over the head of each member who is down, turning as they go; they
   * stand still with Reduce motion, and under a pause, since only the fight's own updates move them.
   */
  private drawDizzy(dt: number): void {
    const w = this.battle.world;
    if (!motion.reduced) this.dizzyTurn += dt;
    for (const f of this.battle.party) {
      const a = f.actor;
      let g = this.dizzy.get(a);
      if (!a.ko || a.hidden) {
        if (g) {
          g.destroy();
          this.dizzy.delete(a);
        }
        continue;
      }
      if (!g) {
        g = new Graphics();
        g.eventMode = 'none';
        w.fx.addChild(g);
        this.dizzy.set(a, g);
      }
      const s = a.size;
      g.clear();
      g.position.set(a.x, w.upY(a.y, s * 2.35));
      this.upright(g);
      const lw = Math.max(0.6, s * 0.05);
      // Round an ellipse over the head, the far side drawn first and a little smaller.
      const stars = [0, 1, 2]
        .map((i) => this.dizzyTurn * 3 + (i / 3) * Math.PI * 2)
        .map((ang) => ({ x: Math.cos(ang) * s * 1.0, y: Math.sin(ang) * s * 0.32, z: Math.sin(ang), ang }))
        .sort((p, q) => p.z - q.z);
      for (const p of stars) g.poly(burstPoints(p.x, p.y, s * 0.4 * (0.85 + 0.15 * p.z), 5, 0.45, p.ang * 0.5)).fill(POP_YELLOW).stroke({ width: lw, color: INK, join: 'miter' });
    }
  }

  private clearDizzy(): void {
    for (const g of this.dizzy.values()) g.destroy();
    this.dizzy.clear();
  }

  /** Speed lines and impact stars showing now, for the checks. */
  speedShown = 0;
  impactShown = 0;
  private readonly speedCleanups = new Set<() => void>();

  /**
   * Speed lines behind a fighter dashing in: three streaks, white over ink so they read on grass and on
   * the black maze, trailing from their back along the way they came and growing with the distance
   * covered. They fade in 120 ms once the returned function is called (the blow has landed). None with
   * Reduce motion. In map units, upright, just behind the figure.
   */
  speedLines(actor: Actor, boosted = false, keep = () => true): () => void {
    if (motion.reduced) return () => undefined;
    const w = this.battle.world;
    const g = new Graphics();
    g.label = boosted ? 'pellet_attack_trail' : 'attack_speed_lines';
    g.eventMode = 'none';
    w.behind(g, actor);
    const [sx, sy] = [actor.x, actor.y];
    let fading = -1;
    let ended = false;
    this.speedShown++;
    const end = () => {
      if (ended) return;
      ended = true;
      this.speedShown--;
      this.speedCleanups.delete(end);
      if (!g.destroyed) g.destroy();
    };
    this.speedCleanups.add(end);
    w.addTask({
      step: (dt) => {
        if (g.destroyed || !keep() || actor.hidden || motion.reduced) return true;
        if (fading >= 0) {
          fading += dt;
          if (fading >= 0.12) return true;
        }
        const s = actor.size;
        g.clear();
        g.zIndex = actor.view.zIndex - 0.5;
        g.position.set(actor.x, w.upY(actor.y, s));
        this.upright(g);
        // The way they came, in the effect's upright units: across unchanged, up and down by the tilt.
        const ux = actor.x - sx;
        const uy = (actor.y - sy) * w.ground;
        const d = Math.hypot(ux, uy);
        if (d < 1) return false;
        const [nx, ny] = [ux / d, uy / d];
        const len = Math.min(d, s * (boosted ? 6 : 4));
        const alpha = fading >= 0 ? 1 - fading / 0.12 : 1;
        const lw = Math.max(1, s * 0.15);
        // A soft smear and fading echoes suggest blur without a full-screen filter.
        if (boosted) {
          g.moveTo(-nx * s * 0.7, -ny * s * 0.7)
            .lineTo(-nx * (len + s), -ny * (len + s))
            .stroke({ width: s * 1.5, color: POP_CYAN, alpha: alpha * 0.14, cap: 'round' });
          for (let i = 3; i >= 1; i--) {
            const back = Math.min(len, s * i * 1.3);
            g.circle(-nx * back, -ny * back, s * (1 - i * 0.12))
              .fill({ color: PAPER, alpha: alpha * (0.3 - i * 0.06) });
          }
        }
        for (const [width, color] of [[lw * 2.2, INK], [lw, 0xffffff]] as const) {
          for (const [off, k] of [[-0.55, 0.7], [0, 1], [0.55, 0.8]] as const) {
            const x0 = -ny * off * s - nx * s * 0.9;
            const y0 = nx * off * s - ny * s * 0.9;
            g.moveTo(x0, y0).lineTo(x0 - nx * len * k, y0 - ny * len * k);
          }
          g.stroke({ width, color, alpha, cap: 'round' });
        }
        return false;
      },
      resolve: end,
    });
    return () => {
      if (fading < 0) fading = 0;
    };
  }

  /**
   * A landed blow: a white star with an ink line flashes at the side of the figure the blow came from,
   * growing a little, gone in 180 ms. None with Reduce motion (the number's burst still says it landed).
   */
  impact(actor: Actor, from: Actor | null): void {
    if (motion.reduced) return;
    const w = this.battle.world;
    const s = actor.size;
    const g = new Graphics();
    g.eventMode = 'none';
    w.fx.addChild(g);
    let [ox, oy] = [0, 0];
    if (from) {
      const dx = from.x - actor.x;
      const dy = (from.y - actor.y) * w.ground;
      const d = Math.hypot(dx, dy) || 1;
      [ox, oy] = [(dx / d) * s * 0.75, (dy / d) * s * 0.75];
    }
    const turn = seeded(Math.round(actor.x * 3 + actor.y * 5 + this.impactShown))() * Math.PI;
    let t = 0;
    this.impactShown++;
    const draw = () => {
      g.clear();
      g.position.set(actor.x, w.upY(actor.y, s));
      this.upright(g);
      g.alpha = t > 0.1 ? Math.max(0, 1 - (t - 0.1) / 0.08) : 1;
      const r = s * (1.0 + EASE.out(Math.min(1, t / 0.1)) * 0.7);
      g.poly(burstPoints(ox, oy, r, 8, 0.45, turn)).fill(0xffffff).stroke({ width: Math.max(0.8, s * 0.1), color: INK, join: 'miter' });
    };
    draw();
    w.addTask({
      step: (dt) => {
        t += dt;
        if (t >= 0.18 || g.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        this.impactShown--;
        if (!g.destroyed) g.destroy();
      },
    });
  }

  /** Rounds of the Warsaw Pac's rifle in flight or landing now, and every round fired this fight, for the checks. */
  roundsShown = 0;
  roundsFired = 0;

  /**
   * The look's `rifle`: a burst from the rifle stuck on the Warsaw Pac (its art, `look/rifle/looks/boss_side`).
   * Each round is a tracer from the muzzle; one that misses kicks up grass and earth on the ground beside a member and
   * glances off as a spark, one that hits (`hit`, the countdown's end) lands on the member with an impact. Rounds go
   * every 70 ms; resolves when the last has landed. With Reduce motion there are no tracers or flying earth, only a
   * mark where each lands, held still.
   */
  rifleBurst(boss: Actor, targets: Actor[], opts: { rounds: number; hit: boolean; seed: number }): Promise<void> {
    const w = this.battle.world;
    if (!targets.length) return Promise.resolve();
    boss.startRifleBurst(opts.rounds);
    const rand = seeded(opts.seed);
    const dir = boss.facing === 'right' ? 1 : -1;
    // The muzzle, measured in the art (x 318, y 177 of 320 by 256, the figure 2.5 sizes tall): 1.54 sizes ahead,
    // 0.77 sizes above the feet.
    const muzzle = (): [number, number] => {
      const pose = boss.riflePose, c = Math.cos(pose.turn), s = Math.sin(pose.turn);
      const x = dir * boss.size * 1.54, y = boss.size * .23;
      return [boss.x + pose.x + x * c - y * s,
        w.upY(boss.y, boss.size - pose.y - x * s - y * c)];
    };
    const rounds = Array.from({ length: opts.rounds }, (_, i) => {
      const who = targets[i % targets.length]!;
      const a = rand() * Math.PI * 2;
      const d = who.size * (1.1 + rand() * 0.9);
      // A miss lands on the ground beside the member, never under them; a hit at their middle.
      const at: [number, number] = opts.hit ? [who.x, w.upY(who.y, who.size)] : [who.x + Math.cos(a) * d, who.y + Math.abs(Math.sin(a)) * d * 0.6 + who.size * 0.3];
      return { who, at, start: i * 0.07, glance: rand() * 2 - 1 };
    });
    const g = new Graphics();
    g.eventMode = 'none';
    w.fx.addChild(g);
    const total = rounds[rounds.length - 1]!.start + 0.5;
    let t = 0;
    let landed = 0;
    this.roundsShown++;
    this.roundsFired += rounds.length;
    const ink = Math.max(0.8, boss.size * 0.06);
    const draw = () => {
      g.clear();
      const [mx, my] = muzzle();
      const still = motion.reduced;
      for (const r of rounds) {
        const k = (t - r.start) / 0.09;
        if (k < 0) continue;
        const [ix, iy] = r.at;
        // The muzzle flash while this round leaves.
        if (k < 1 && !still) g.poly(burstPoints(mx, my, boss.size * 0.35, 6, 0.4, r.glance)).fill(0xffe066).stroke({ width: ink, color: INK });
        if (k < 1) {
          // The tracer: a short bright dash running from the muzzle to where the round lands.
          if (!still) {
            const [x0, y0] = [mx + (ix - mx) * Math.max(0, k - 0.5), my + (iy - my) * Math.max(0, k - 0.5)];
            const [x1, y1] = [mx + (ix - mx) * k, my + (iy - my) * k];
            g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: boss.size * 0.24, color: INK, cap: 'round' });
            g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: boss.size * 0.13, color: 0xfff3b0, cap: 'round' });
          }
          continue;
        }
        const s = t - r.start - 0.09;
        if (s > 0.42) continue;
        if (opts.hit) {
          // A hit's star, growing as it lands; held at one size with Reduce motion.
          if (s < 0.15) g.poly(burstPoints(ix, iy, r.who.size * (still ? 0.8 : 0.7 + s * 3), 8, 0.45, r.glance)).fill(0xffffff).stroke({ width: ink, color: INK });
          continue;
        }
        if (still) {
          g.circle(ix, iy, r.who.size * 0.18).fill({ color: 0x6b4a2a, alpha: 0.8 });
          continue;
        }
        // A puff where it lands, grass and earth thrown up and falling back, and the round glancing off as a spark.
        const sz = r.who.size;
        if (s < 0.14) g.poly(burstPoints(ix, iy, sz * (0.35 + s * 2.5), 7, 0.5, r.glance)).fill({ color: 0xc9a46a, alpha: 1 - s / 0.14 }).stroke({ width: ink, color: INK, alpha: 1 - s / 0.14 });
        for (let q = 0; q < 6; q++) {
          // Each clod flies its own way: out to a side and up, falling back by the time the puff has gone.
          const spread = (q - 2.5) * (0.7 + ((q * 37 + Math.round(r.glance * 10)) % 5) * 0.15);
          const sx = ix + spread * sz * 0.35 * Math.min(1, s * 5);
          const up = sz * (7 - (q % 3) * 1.5) * s - sz * 16 * s * s;
          const d = sz * 0.2;
          g.rect(sx - d / 2, iy - Math.max(0, up) - d / 2, d, d).fill(q % 2 ? 0x5f9a38 : 0x7a5530).stroke({ width: 0.6, color: INK });
        }
        if (s < 0.12) {
          const gx = ix + r.glance * sz * 2 * (s / 0.12);
          const gy = iy - sz * 1.8 * (s / 0.12);
          g.moveTo(ix + (gx - ix) * 0.4, iy + (gy - iy) * 0.4).lineTo(gx, gy).stroke({ width: boss.size * 0.1, color: 0xffd23f, cap: 'round' });
        }
      }
    };
    draw();
    return new Promise((resolve) => {
      w.addTask({
        step: (dt) => {
          t += dt;
          // Each round's landing sound, as it lands.
          while (landed < rounds.length && t >= rounds[landed]!.start + 0.09) {
            if (!opts.hit && landed % 2 === 0) this.g.audio.play('ricochet');
            landed++;
          }
          if (t >= total || g.destroyed) return true;
          draw();
          return false;
        },
        resolve: () => {
          this.roundsShown--;
          if (!g.destroyed) g.destroy();
          resolve();
        },
      });
    });
  }

  /**
   * The countdown's end with the look's `rifle`: the members hit are blown back away from the Warsaw Pac, up and
   * down again, landing a size and a half further off. With Reduce motion they stay where they are.
   */
  blownAway(boss: Actor, members: Actor[]): Promise<void> {
    const w = this.battle.world;
    if (motion.reduced || !members.length) return Promise.resolve();
    const from = members.map((m) => [m.x, m.y] as const);
    const away = members.map((m) => {
      const dx = m.x - boss.x;
      const dy = m.y - boss.y;
      const d = Math.hypot(dx, dy) || 1;
      return [(dx / d) * m.size * 1.5, (dy / d) * m.size * 1.5] as const;
    });
    let t = 0;
    const total = 0.45;
    return new Promise((resolve) => {
      w.addTask({
        step: (dt) => {
          t = Math.min(total, t + dt);
          const k = t / total;
          members.forEach((m, i) => {
            m.x = from[i]![0] + away[i]![0] * EASE.out(k);
            m.y = from[i]![1] + away[i]![1] * EASE.out(k);
            m.lift = Math.sin(k * Math.PI) * m.size * 1.4;
          });
          return t >= total;
        },
        resolve: () => {
          for (const m of members) m.lift = 0;
          resolve();
        },
      });
    });
  }

  /**
   * Where a slanted panel can go in band `b` clear of `members` on the screen and of the target round them with its
   * brackets: just below them or just above, on the side with more room, allowing for the panel's slant where they
   * stand, and how tall it can be there, up to `height` (smaller where room is short, never under 1.8 units). Where
   * that would cut it to a corner or squeeze it under three quarters of `height`, it crosses them instead.
   */
  private clearOf(members: Actor[], height: number, b: { top: number; bottom: number; left: number; right: number }): { cy: number; height: number } {
    const w = this.battle.world, u = this.u;
    if (!members.length) return { cy: b.top + (b.bottom - b.top) * 0.3, height };
    const at = members.map((a) => {
      const [x, y] = w.worldToPanel(a.x, a.y);
      const r = w.worldToPanel(a.x + a.size, a.y)[0] - x;
      return { x, top: y - r * 2.6, bottom: y + r * 0.4 };
    });
    // The target at its largest, with its brackets, as the strike draws it (nukeStrike.ts aimEllipse).
    const aim = aimEllipse(members, -1e9, 1e9), reach = aim.ry * 1.18 + 1.3 * aim.size;
    const top = Math.min(...at.map((e) => e.top), w.worldToPanel(aim.x, aim.y - reach)[1]);
    const bottom = Math.max(...at.map((e) => e.bottom), w.worldToPanel(aim.x, aim.y + reach)[1]);
    const x = at.reduce((v, e) => v + e.x, 0) / at.length;
    // The panel's middle line is this much lower where they stand than at the band's middle (it rises to the right).
    const lift = (b.left + (b.right - b.left) / 2 - x) * Math.tan(-REVIVAL_BANNER_TILT);
    const margin = u * 0.4;
    const [below, above] = [b.bottom - bottom, top - b.top];
    // The panel with its rules is 1.2 of its height.
    let H = Math.round(Math.max(u * 1.8, Math.min(height, (Math.max(below, above) - margin * 2) / 1.2)));
    let cy = below >= above ? bottom + margin + H * 0.6 - lift : top - margin - H * 0.6 - lift;
    // A cramped target can leave less room than the minimum banner height on either side, or room for only a thin
    // panel. Then it crosses them at the height asked for, as far as the clip holds it end to end with its rules and
    // tilt, moved from beside them only as far as that needs, so it runs over their lower (or upper) part (the owner,
    // 30 Oct: cut to a corner, then skinny, at 1133x744; thin at 1440x900, where crossing them looked good).
    if (cy - H * 0.6 < b.top || cy + H * 0.6 > b.bottom || H < height * 0.75) {
      const slope = (b.right - b.left) / 2 * Math.abs(Math.tan(REVIVAL_BANNER_TILT));
      const holds = (((b.bottom - b.top) / 2 - slope) * Math.cos(REVIVAL_BANNER_TILT) - 1) / 0.6;
      H = Math.round(Math.max(H, Math.min(height, holds)));
      const edge = (H * 0.6 + 1) / Math.cos(REVIVAL_BANNER_TILT) + slope;
      const inset = Math.min(edge, (b.bottom - b.top) / 2);
      cy = Math.max(b.top + inset, Math.min(b.bottom - inset, cy));
    }
    return { cy, height: H };
  }

  /** The strike's interface while it shows, for the checks: whether its INCOMING! panel shows, and how far its focus
   * lines reach (closing in on the target, then the impact's flying out). */
  strikeShown: { banner: boolean; reach: number; root: Container } | null = null;

  /**
   * The Warsaw finale's strike (warsawFx.ts tacticalNuke, drawn in the world), with its part over the fight: the
   * INCOMING! panel slammed across on the first burst, in whichever part of the fight's band has more room clear of
   * the target, and focus lines closing in on the target a step a burst, then the impact's lines flying out as the
   * white thins. Posed from the frames the strike reports, so they keep its clock.
   */
  tacticalNuke(boss: Actor, members: Actor[], detonate: () => void, keep: () => boolean): Promise<void> {
    this.message(this.g.msg('battle', 'nuke_warning'));
    let bursts = 0;
    let parts: { banner: { root: Container; pose(t: number, still: boolean): void }; lines: { root: Container; g: Graphics } } | null = null;
    const clear = () => {
      for (const root of [parts?.banner.root, parts?.lines.root]) if (root && !root.destroyed) root.destroy({ children: true });
      parts = null;
      this.strikeShown = null;
    };
    return tacticalNuke(this.battle, boss, members, detonate, keep, () => {
      this.g.audio.play('burst');
      void this.rifleBurst(boss, members, { rounds: 4, hit: false, seed: 7919 * ++bursts });
    }, frame => {
      this.nukeShown = frame;
      if (!frame) return clear();
      const still = motion.reduced, u = this.u, p = this.g.layout.panel;
      const [px, py] = this.battle.world.worldToPanel(frame.x, frame.y);
      if (!parts) {
        // The strike has the room the specials' animations have: no list is open while it plays. On a wide screen that
        // includes the command panel's slot, so the panel runs from the left side to the right (the owner, 30 Oct: at
        // 1133x744 it stopped two thirds across; desktop looked best, stretching side to side).
        const band = this.effectBand(), b = wideBattle(p) ? { ...band, left: 0, right: p.w } : band, bh = b.bottom - b.top;
        const place = this.clearOf(members, Math.round(Math.max(u * 2.2, Math.min(bh * 0.28, p.h * 0.18, (b.right - b.left) * 0.2))), b);
        parts = {
          banner: this.slantBanner({
            big: this.g.msg('battle', 'nuke_banner'), small: this.g.msg('battle', 'nuke_countdown'),
            dots: RED_INK, hazard: true, timing: STRIKE.banner, height: place.height, cy: place.cy, band: b,
          }),
          lines: this.panelLines(),
        };
      }
      parts.banner.pose(frame.t, still);
      const aiming = frame.stage === 'targeting';
      const reach = aiming ? strikeReach(frame.beat, frame.t - frame.beat * STRIKE.beat, still) : impactReach(frame.t - STRIKE.impact, still);
      parts.lines.g.clear();
      parts.lines.root.alpha = still ? Math.min(1, frame.t / 0.3) : 1;
      focusLines(parts.lines.g, { x: 0, y: 0, w: p.w, h: p.h }, [px, py], reach, u, aiming ? 61 : 67, aiming ? RED_INK : POP_YELLOW);
      this.strikeShown = { banner: parts.banner.root.visible, reach, root: parts.banner.root };
    });
  }

  /** A-star Maneuver's star while it shows: where it is, how many strokes are lit, and how far its flare has gone (null before it), for the checks. */
  sigilShown: { cx: number; cy: number; r: number; strokes: number; flare: number | null; views: Container[] } | null = null;

  /**
   * A-star Maneuver's star, drawn on the ground round the enemies like a sign: a ring of light opens, with a
   * second ring inside it and marks between them turning slowly; each stroke the member dashes is lit behind
   * them as they go, and stays. `flare` sets the whole star alight: it fills, its lines swell, the ring spreads
   * out and away, and a column of light shoots up through each enemy; it is gone half a second later. The
   * paths carry the member's flag colours (the owner, 2026-10-14), in parallel bands inside an ink edge,
   * under a tinted glow so they read on the black maze, on grass and on the paper-coloured city alike.
   * The rings and their marks take the flag's colours too (the owner, 2026-10-15: "could the circle and diamonds be
   * flag-colored too?"). A look without a flag keeps the pink path and white highlight, and pink and yellow rings.
   * In map units, on the ground under the figures; the columns stand upright in
   * front. With Reduce motion the ring opens at once and stands still, and the flare fades where it is.
   */
  starSigil(cx: number, cy: number, r: number, keep = () => true, rate = 1): { stroke: (from: readonly [number, number], actor: Actor) => void; flare: (targets: Actor[]) => void; move: (x: number, y: number, radius: number, done: Array<[number, number, number, number]>) => void; end: () => void } {
    const w = this.battle.world;
    const ground = new Graphics();
    ground.eventMode = 'none';
    w.underFigures(ground);
    const glow = new Graphics();
    glow.eventMode = 'none';
    glow.blendMode = 'add';
    w.underFigures(glow);
    glow.zIndex = ground.zIndex + 0.5;
    const columns = new Graphics();
    columns.eventMode = 'none';
    columns.blendMode = 'add';
    w.fx.addChild(columns);
    const strokes: Array<[number, number, number, number]> = [];
    let pathColours = [POP_PINK];
    let live: { x: number; y: number; actor: Actor } | null = null;
    let targets: Actor[] = [];
    let t = 0;
    let flareAt: number | null = null;
    let ended = false;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    // The star's outline, for its fill: the five points and the five corners between them.
    const outline = (rr: number) => {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 === 0 ? rr : rr * 0.382;
        pts.push(cx + Math.cos(ang) * k, cy + Math.sin(ang) * k);
      }
      return pts;
    };
    const draw = () => {
      const still = motion.reduced;
      const fk = flareAt === null ? 0 : t - flareAt;
      const fade = flareAt === null ? 1 : 1 - clamp((fk - 0.2) / 0.3);
      const swell = flareAt === null ? 1 : 1 + (still ? 0.3 : EASE.out(clamp(fk / 0.12)) * 0.8);
      ground.clear();
      glow.clear();
      columns.clear();
      ground.alpha = fade;
      glow.alpha = fade;
      columns.alpha = fade;
      // The rings, opening; marks between them, turning. With a flag, the outer ring carries its bands as the paths
      // do, and the inner ring and the marks its colours, the marks taking them in turn.
      const open = still ? 1 : EASE.out(clamp(t / 0.15));
      const spread = flareAt === null || still ? 1 : 1 + EASE.out(clamp(fk / 0.5)) * 0.6;
      const rr = r * open * spread;
      const flagged = pathColours.length > 1;
      const colours = [...new Set(pathColours)];
      glow.circle(cx, cy, rr).stroke({ width: 10, color: flagged ? pathColours[0]! : POP_YELLOW, alpha: flagged ? 0.25 : 0.35 });
      if (flagged) {
        ground.circle(cx, cy, rr).stroke({ width: 6, color: INK });
        const band = 4.5 / pathColours.length;
        pathColours.forEach((color, i) => {
          ground.circle(cx, cy, Math.max(0, rr + (i + 0.5 - pathColours.length / 2) * band)).stroke({ width: band, color });
        });
        ground.circle(cx, cy, rr * 0.84).stroke({ width: 2.6, color: INK }).circle(cx, cy, rr * 0.84).stroke({ width: 1.4, color: colours[1]! });
      } else {
        ground.circle(cx, cy, rr).stroke({ width: 4, color: INK }).circle(cx, cy, rr).stroke({ width: 2.2, color: POP_PINK });
        ground.circle(cx, cy, rr * 0.84).stroke({ width: 1.4, color: POP_YELLOW });
      }
      const turn = still ? 0 : t * 0.9;
      // Twelve marks with a flag, so two or three colours go round evenly.
      const marks = flagged ? 12 : 10;
      for (let i = 0; i < marks; i++) {
        const ang = turn + (i * Math.PI * 2) / marks;
        const [mx, my] = [cx + Math.cos(ang) * rr * 0.92, cy + Math.sin(ang) * rr * 0.92];
        const d = rr * 0.05;
        ground.poly([mx, my - d * 1.6, mx + d, my, mx, my + d * 1.6, mx - d, my]).fill(flagged ? colours[i % colours.length]! : POP_YELLOW).stroke({ width: 1, color: INK, join: 'miter' });
      }
      // The star filled with light once it flares.
      if (flareAt !== null) glow.poly(outline(r)).fill({ color: POP_YELLOW, alpha: 0.45 * (still ? 1 : clamp(fk / 0.08)) });
      // The strokes so far, and the one being struck, to wherever the member is now.
      const lines = [...strokes];
      if (live) lines.push([live.x, live.y, live.actor.x, live.actor.y]);
      for (const [x0, y0, x1, y1] of lines) {
        glow.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 14 * swell, color: flagged ? pathColours[0]! : POP_YELLOW, alpha: flagged ? 0.25 : 0.45, cap: 'round' });
        ground.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: (flagged ? 8 : 6) * swell, color: INK, cap: 'round' });
        if (flagged) {
          const length = Math.hypot(x1 - x0, y1 - y0) || 1;
          const nx = -(y1 - y0) / length, ny = (x1 - x0) / length;
          const width = 6 * swell / pathColours.length;
          pathColours.forEach((color, i) => {
            const offset = (i + 0.5 - pathColours.length / 2) * width;
            ground.moveTo(x0 + nx * offset, y0 + ny * offset).lineTo(x1 + nx * offset, y1 + ny * offset)
              .stroke({ width, color, cap: 'butt' });
          });
        } else {
          ground.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 4 * swell, color: POP_PINK, cap: 'round' });
          glow.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.8 * swell, color: 0xffffff, cap: 'round' });
        }
      }
      // A column of light up through each enemy, upright on tilted ground.
      if (flareAt !== null) {
        const up = still ? 1 : EASE.out(clamp(fk / 0.12));
        const thin = still ? 1 : 1 - clamp((fk - 0.15) / 0.35) * 0.6;
        for (const a of targets) {
          const s = a.size;
          const h = s * 6 * up;
          const top = w.upY(a.y, h);
          const wd = s * 1.3 * thin;
          columns.rect(a.x - wd, top, wd * 2, a.y - top).fill({ color: POP_YELLOW, alpha: 0.5 });
          columns.rect(a.x - wd * 0.4, top, wd * 0.8, a.y - top).fill({ color: 0xffffff, alpha: 0.7 });
        }
      }
      this.sigilShown = { cx, cy, r, strokes: strokes.length, flare: flareAt === null ? null : fk, views: [ground, glow, columns] };
    };
    const end = () => {
      if (ended) return;
      ended = true;
      this.sigilShown = null;
      for (const g of [ground, glow, columns]) if (!g.destroyed) g.destroy();
    };
    draw();
    w.addTask({
      step: (dt) => {
        t += dt * rate;
        if (!keep() || ended || ground.destroyed || (flareAt !== null && t - flareAt >= 0.5)) return true;
        draw();
        return false;
      },
      resolve: end,
    });
    return {
      stroke: (from, actor) => {
        if (live) strokes.push([live.x, live.y, live.actor.x, live.actor.y]);
        pathColours = starPathColours(actor.look);
        live = { x: from[0], y: from[1], actor };
      },
      flare: (hit) => {
        if (live) strokes.push([live.x, live.y, live.actor.x, live.actor.y]);
        live = null;
        targets = hit;
        flareAt = t;
      },
      // Somewhere else, for a fight laid out afresh mid-move, with the strokes already struck (`done`) lit there.
      move: (x, y, radius, done) => {
        cx = x;
        cy = y;
        r = radius;
        strokes.splice(0, strokes.length, ...done);
        live = null;
      },
      end,
    };
  }

  /** How big Cherry Chomp's cherries were last drawn (each cherry's radius over the member's), for the checks. */
  cherryScale = 0;

  /**
   * Cherry Chomp's cherries: a big, shiny pair flies in from off screen to each member along an arc, turning a
   * little as it comes, with pink streaks and white sparkles behind, and is chomped where it lands with a pink
   * sparkle. Each pair is about the size of the member's head: glossy red over a dark rim, a white shine, and
   * stems joined at a leaf. With Reduce motion they come without turning, streaks, or sparkles.
   */
  cherries(targets: Actor[], keep = () => true): Promise<void> {
    const w = this.battle.world;
    const fly = 0.75;
    return Promise.all(
      targets.map(
        (a, i) =>
          new Promise<void>((resolve) => {
            const g = new Graphics();
            g.eventMode = 'none';
            w.fx.addChild(g);
            const [fx, fy] = w.panelToWorld(i % 2 ? -20 : this.g.layout.panel.w + 20, 20 + i * 30);
            const r = a.size * 0.62;
            this.cherryScale = r / a.size;
            let t = 0;
            const at = (k: number): [number, number, number] => [fx + (a.x - fx) * k, fy + (w.upY(a.y, a.size) - fy) * k, -Math.sin(k * Math.PI) * 46];
            w.addTask({
              step: (dt) => {
                if (!keep() || g.destroyed) return true;
                t += dt / fly;
                const k = Math.min(1, t);
                const [x, y, up] = at(k);
                g.clear();
                g.position.set(x, y);
                this.upright(g);
                const still = motion.reduced;
                if (!still && k < 1) {
                  // Two pink streaks behind, back along the way it flies, and sparkles left along the arc.
                  const [px, py, pu] = at(Math.max(0, k - 0.05));
                  const bx = px - x;
                  const by = (py - y) * w.ground + pu - up;
                  const bd = Math.hypot(bx, by) || 1;
                  for (const off of [-r * 0.7, r * 0.7]) {
                    const [ox, oy] = [(-by / bd) * off, (bx / bd) * off];
                    g.moveTo(ox + (bx / bd) * r * 1.6, up + oy + (by / bd) * r * 1.6).lineTo(ox + (bx / bd) * r * 4, up + oy + (by / bd) * r * 4);
                  }
                  g.stroke({ width: r * 0.4, color: POP_PINK, cap: 'round' });
                  for (const [j, back] of [0.1, 0.18, 0.26].entries()) {
                    if (k < back) continue;
                    const [sx, sy, su] = at(k - back);
                    g.poly(burstPoints(sx - x, (sy - y) * w.ground + su, r * (0.5 - j * 0.12), 4, 0.3, t * 6)).fill(0xffffff).stroke({ width: 0.8, color: INK, join: 'miter' });
                  }
                }
                cherryPair(g, 0, up, r, still ? 0 : Math.sin(t * 9) * 0.25);
                if (k >= 1) {
                  g.destroy();
                  this.sparkle(a, POP_PINK);
                  return true;
                }
                return false;
              },
              resolve: () => {
                if (!g.destroyed) g.destroy();
                resolve();
              },
            });
          }),
      ),
    ).then(() => undefined);
  }

  /** Ronnienomics!'s smoke showing now, for the checks. */
  smokeShown = false;

  /**
   * Ronnienomics!'s smoke bomb, as loud as the other specials. A big black bomb with a sparking fuse is flung high from
   * the member's hand and slams down at the party's feet. The hit stops the fight for a beat: one frame of the field in
   * negative, a white flash and a shake, the field dimmed round it, a starburst, "POOF!" in poster letters over it, two
   * rings racing out along the ground, chunks thrown up, and focus lines in from the screen's edges, twitching. Then a
   * comic cloud erupts from where it hit, billow after billow outward and up, inked as one shape with a thick line,
   * cel-shaded with pink dots on its shaded side, sparks popping on it, and big on any screen however far the fight is
   * zoomed out; two white swooshes whip round it once and small puffs skid clear along the ground. It never settles:
   * it goes on spreading and rising the whole time. `thick` settles once the party is hidden in it; straight after, the
   * cloud breaks up, the billows at its foot first, each pushed out its own way to every side and a little up, and it
   * fades as one, so the ground shows through it only once it has spread thin. `thin` settles a beat after that, while it
   * is still half there, so the flashback's blocks come over a cloud still moving; `gone` when the party, if still
   * there, stands clear, as the last of it fades. With Reduce motion there is no throw, flash, shake, whirl or flying,
   * and the cloud fades in at full size and fades out where it is.
   */
  smokeBomb(from: Actor, party: Actor[], keep = () => true): { thick: Promise<void>; thin: Promise<void>; gone: Promise<void>; clear: () => void } {
    const w = this.battle.world;
    const still = motion.reduced;
    const [dim, g] = ['smoke_dim', 'smoke'].map((label) => {
      const x = new Graphics();
      x.label = label;
      x.eventMode = 'none';
      return x;
    }) as [Graphics, Graphics];
    w.fx.addChild(dim, g);
    // The cloud fades as one piece, so its billows' ink does not show through each other, as Revival's wings do.
    const fade = new AlphaFilter({ alpha: 1, resolution: 'inherit', antialias: 'inherit' });
    fade.enabled = false;
    g.filters = [fade];
    // Over the whole screen and under the fight's lists, as Revival's flash is: the focus lines, the flash over them, and
    // the letters over that.
    const lines = new Graphics();
    const flash = new Graphics().rect(-1e4, -1e4, 2e4, 2e4).fill(0xffffff);
    const panel = this.g.layout.panel;
    const letterSize = Math.round(Math.max(this.u * 3, Math.min(panel.h * 0.15, panel.w * 0.16)));
    const poof = new Text({ text: this.g.msg('battle', 'smoke_poof'), style: letterStyle(letterSize, POP_YELLOW, { outline: true, extrude: true }) });
    poof.anchor.set(0.5);
    poof.visible = false;
    for (const x of [lines, flash, poof]) x.eventMode = 'none';
    flash.alpha = 0;
    this.container.addChildAt(poof, 0);
    this.container.addChildAt(flash, 0);
    this.container.addChildAt(lines, 0);
    // The hit's frame in negative, over the field only.
    const negative = new ColorMatrixFilter({ resolution: 'inherit', antialias: 'inherit' });
    negative.negative(false);
    const unfiltered = w.view.filters ? [...w.view.filters] : null;
    let inverted = false;
    const invert = (on: boolean) => {
      if (on === inverted) return;
      inverted = on;
      w.view.filters = on ? [...(unfiltered ?? []), negative] : unfiltered;
    };
    this.smokeShown = true;
    const s = Math.max(...party.map((a) => a.size), from.size);
    const cx = party.reduce((t, a) => t + a.x, 0) / party.length;
    const cy = party.reduce((t, a) => t + a.y, 0) / party.length;
    // The effect's own size: a member's, or a twentieth of the screen's height where the fight is zoomed out further.
    const zoom = w.worldToPanel(cx + 1, cy)[0] - w.worldToPanel(cx, cy)[0] || 1;
    const b = Math.max(s, (panel.h * 0.05) / zoom);
    // In upright units from the party's middle on the ground (ground offsets times the tilt, as the figures stand): the
    // oval the cloud fills, bigger than every member (a figure is about two sizes tall), and never small on the screen.
    const spots = party.map((a) => [a.x - cx, (a.y - cy) * w.ground] as const);
    const [l0, r0] = [Math.min(...spots.map(([x]) => x)) - s * 1.5, Math.max(...spots.map(([x]) => x)) + s * 1.5];
    const foot = Math.max(...spots.map(([, y]) => y)) + s * 0.4, head = Math.min(...spots.map(([, y]) => y)) - s * 2.7;
    const rx = Math.max((r0 - l0) / 2, (panel.w * 0.12) / zoom), ry = Math.max((foot - head) / 2, (panel.h * 0.16) / zoom);
    const [mx, my] = [(l0 + r0) / 2, foot - ry];
    // A cumulus: billows round the oval, flatter along the ground, two big ones on top, five filling it and three along the
    // base so it sits whole on the ground; each starts after the hit by how far it is from where the bomb landed, so the
    // cloud erupts from there. The same every time.
    const rnd = seeded(31);
    const billows: Array<{ x: number; y: number; r: number; at: number; lift: number; drift: number; climb: number }> = [];
    const ring = 11;
    for (let i = 0; i < ring; i++) {
      const a = ((i + rnd() * 0.3) / ring) * Math.PI * 2;
      const low = Math.sin(a) > 0;
      billows.push({ x: mx + Math.cos(a) * rx * (low ? 1.04 : 0.95), y: my + Math.sin(a) * ry * (low ? 0.62 : 0.92), r: ry * (low ? 0.32 + rnd() * 0.14 : 0.4 + rnd() * 0.14), at: 0, lift: 0, drift: 0, climb: 1 });
    }
    for (const side of [-1, 1]) billows.push({ x: mx + side * rx * 0.28, y: my - ry * 0.72, r: ry * (0.5 + rnd() * 0.06), at: 0, lift: 0, drift: 0, climb: 1 });
    for (let i = 0; i < 5; i++) billows.push({ x: mx + (i / 4 - 0.5) * rx + (rnd() - 0.5) * rx * 0.1, y: my + (i % 2 ? 0.3 : -0.05) * ry, r: ry * (0.44 + rnd() * 0.06), at: 0, lift: 0, drift: 0, climb: 1 });
    for (let i = 0; i < 3; i++) billows.push({ x: mx + (i - 1) * rx * 0.55 + (rnd() - 0.5) * rx * 0.1, y: my + ry * (0.6 + rnd() * 0.08), r: ry * (0.36 + rnd() * 0.06), at: 0, lift: 0, drift: 0, climb: 1 });
    const reachOut = Math.max(...billows.map((p) => Math.hypot(p.x, p.y))) || 1;
    for (const p of billows) p.at = 0.02 + (Math.hypot(p.x, p.y) / reachOut) * 0.26;
    // The top ones first, so the lower ones' lumps come over them.
    billows.sort((p, q) => p.y - q.y);
    // Puffs thrown clear along the ground from the hit, each its own way.
    const flung = Array.from({ length: 7 }, (_, i) => {
      const a = Math.PI * (0.05 + (i / 6) * 0.9) + (rnd() - 0.5) * 0.25;
      return { dx: -Math.cos(a), dy: Math.sin(a) * 0.35, far: rx + b * (1.4 + rnd() * 1.4), r: b * (0.4 + rnd() * 0.2) };
    });
    // Chunks thrown up from the hit, both ways, tumbling, until they come down again.
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      vx: (i % 2 ? 1 : -1) * b * (2 + rnd() * 8), vy: -b * (8 + rnd() * 7), r: b * (0.12 + rnd() * 0.14), spin: (rnd() - 0.5) * 24, white: rnd() < 0.35,
    }));
    const fall = b * 48;
    // Lifting off, the billows at the cloud's foot first, so the feet show before the heads, each drifting its own way
    // and rising at its own speed, so the pieces scatter.
    const [topY, baseY] = [billows[0]!.y, billows.at(-1)!.y];
    for (const p of billows) {
      p.lift = Math.max(0, Math.min(1, (baseY - p.y) / (baseY - topY || 1) + (rnd() - 0.5) * 0.16));
      p.drift = (rnd() - 0.5) * 2;
      p.climb = 0.6 + rnd() * 0.9;
    }
    const throwTime = still ? 0 : 0.32, swell = 0.22, last = Math.max(...billows.map((p) => p.at));
    // After the hit: when the cloud is whole (`thick`), and its breaking up, a billow at a time, until it is gone. It
    // fades from whole to gone; the ground starts to show through about a third of a second in, and `thin` gives the
    // player a beat to see who is (or is not) left before the flashback's blocks; `gone` is when it is faint.
    const whole = last + swell + 0.15, stagger = 0.35, life = 1.05, end = whole + stagger + life;
    const thinAt = whole + VANISH_THIN, goneAt = whole + 1.1;
    const [hx, hy] = [from.x - cx, (from.y - cy) * w.ground - from.size * 1.2];
    const line = Math.max(1.5, b * 0.16);
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    let t = 0;
    let shaken = false;
    let thick!: () => void, thin!: () => void, gone!: () => void;
    const thickened = new Promise<void>((resolve) => (thick = resolve));
    const thinned = new Promise<void>((resolve) => (thin = resolve));
    const cleared = new Promise<void>((resolve) => (gone = resolve));
    const done = () => {
      this.smokeShown = false;
      invert(false);
      negative.destroy();
      for (const x of [dim, g, lines, flash, poof]) if (!x.destroyed) x.destroy();
      fade.destroy();
      thick();
      thin();
      gone();
    };
    const bomb = (x: number, y: number, k: number) => drawSmokeBomb(g, x, y, b * 0.62, k * 9, line, t);
    const draw = () => {
      g.clear();
      dim.clear();
      lines.clear();
      for (const x of [dim, g]) {
        x.position.set(cx, cy);
        this.upright(x);
      }
      if (t < throwTime) {
        // Flung up from the hand and down at the party's feet, spinning, white streaks behind.
        const at = (k: number): [number, number] => [hx * (1 - k), hy * (1 - k) - Math.sin(k * Math.PI) * b * 4];
        const k = t / throwTime;
        for (const back of [0.18, 0.12, 0.06]) {
          if (k < back) continue;
          const [px, py] = at(k - back);
          g.circle(px, py, b * 0.62 * (1 - back * 2.5)).fill({ color: 0xffffff, alpha: 0.75 - back * 3 });
        }
        bomb(...at(k), k);
        return;
      }
      const since = t - throwTime;
      if (!still && !shaken) {
        shaken = true;
        w.shakeTime = Math.max(w.shakeTime, 0.4);
      }
      invert(!still && since < 0.05);
      flash.alpha = still || since < 0.05 ? 0 : 0.9 * clamp(1 - (since - 0.05) / 0.12);
      const clearing = clamp((since - whole) / (end - whole));
      dim.rect(-1e4, -1e4, 2e4, 2e4).fill({ color: INK, alpha: 0.42 * (still ? clamp(since / 0.2) : clamp(since / 0.08)) * (1 - clearing) });
      // Focus lines at the cloud's middle, struck afresh every few frames so they twitch, drawn back as it lifts.
      const edges = this.g.screenEdges?.() ?? { x: 0, y: 0, w: panel.w, h: panel.h };
      const reach = 0.5 * (still ? 1 : EASE.out(clamp(since / 0.12))) * (1 - clamp((since - whole) / 0.4));
      if (reach > 0) focusLines(lines, edges, w.worldToPanel(cx + mx, cy, -my), reach, this.u, still ? 1 : Math.floor(t / 0.07), POP_PINK);
      this.posePoof(poof, since, w.worldToPanel(cx + mx, cy, -(my - ry)), t);
      for (const [j, color] of [0xffffff, POP_PINK].entries()) {
        // Two rings racing out along the ground from the hit, white and then pink.
        const k = clamp((since - j * 0.07) / 0.4);
        if (still || k <= 0 || k >= 1) continue;
        const R = b + EASE.out(k) * rx * 2.2, width = b * 0.45 * (1 - k);
        g.ellipse(0, 0, R, R * w.ground).stroke({ width: width + line * 1.4, color: INK });
        g.ellipse(0, 0, R, R * w.ground).stroke({ width, color });
      }
      if (!still && since < 0.24) {
        // The hit: a white starburst round a yellow one, opening fast.
        const k = EASE.out(clamp(since / 0.24));
        g.poly(burstPoints(0, -b * 0.4, b * (1.2 + k * 3.4), 12, 0.55, 0.2)).fill(0xffffff).stroke({ width: line * 1.2, color: INK, join: 'miter' });
        g.poly(burstPoints(0, -b * 0.4, b * (0.7 + k * 2), 8, 0.5, 0.5)).fill(POP_YELLOW).stroke({ width: line, color: INK, join: 'miter' });
      }
      fade.alpha = (still ? clamp(since / 0.2) : 1) * (1 - clearing);
      fade.enabled = fade.alpha < 1;
      for (const p of flung) {
        // Small puffs skidding out along the ground, shrinking as they go.
        if (still) break;
        const k = clamp((since - 0.04) / 0.5);
        if (k <= 0 || k >= 1) continue;
        const d = p.far * EASE.out(k), r = p.r * (1 - k * 0.7);
        g.circle(mx + p.dx * d, p.dy * d - r, r + line * 0.7).fill(INK);
        g.circle(mx + p.dx * d, p.dy * d - r, r).fill(PAPER);
      }
      // The cloud, boiling, spreading and rising the whole time it shows, never settling; a billow bursts out fast and
      // goes on swelling, and when the cloud breaks up it is pushed out from the middle, each its own way off straight,
      // and a little up, shrinking some as the whole fades.
      const grow = still ? 1 : 1 + since * 0.4;
      const rise = still ? 0 : since * b * 0.9;
      const shown = billows.map((p, i) => {
        const age = since - p.at;
        const puff = still ? 1 : 1.1 * (1 - Math.exp(-age * 9)) + age * 0.3;
        const boil = 1 + Math.sin(since * 5 + i * 1.9) * 0.04;
        const d = still ? 0 : clamp((since - whole - p.lift * stagger) / life), off = d * d;
        const way = Math.atan2(p.y - my, p.x - mx) + p.drift * 0.4;
        return {
          x: mx + (p.x - mx) * grow * (1 + off * 0.6) + Math.cos(way) * b * 2.4 * off,
          y: my + (p.y - my) * grow * (1 + off * 0.6) + Math.sin(way) * b * 2.4 * off - rise - off * b * 1.2 * p.climb,
          r: !still && age <= 0 ? 0 : p.r * puff * boil * (1 - off * 0.6),
        };
      }).filter((p) => p.r > 0);
      // Inked as one: every billow's ink a line bigger, then its shade, then its lit part up and to the left of it, so
      // the shade shows only along the cloud's lower right and the lumps' undersides.
      for (const p of shown) g.circle(p.x, p.y, p.r + line).fill(INK);
      for (const p of shown) g.circle(p.x, p.y, p.r).fill(PAPER_DARK);
      const lit = shown.map((p) => ({ x: p.x - p.r * 0.12, y: p.y - p.r * 0.16, r: p.r * 0.86 }));
      for (const p of lit) g.circle(p.x, p.y, p.r).fill(PAPER);
      if (shown.length) {
        const top = Math.min(...shown.map((p) => p.y - p.r)), bottom = Math.max(...shown.map((p) => p.y + p.r));
        const left = Math.min(...shown.map((p) => p.x - p.r)), right = Math.max(...shown.map((p) => p.x + p.r));
        benDay(g, { x: left, y: top, w: right - left, h: bottom - top }, {
          color: POP_PINK, alpha: 0.8, pitch: b * 0.4, from: [mx, top + (bottom - top) * 0.2], to: [mx, bottom],
          inside: (x, y) => shown.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r) && !lit.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r),
        });
      }
      // Sparks popping on the cloud's edge while it boils, a new one every few frames, each its own place and size.
      for (let n = Math.max(0, Math.floor((since - 0.2) / 0.07)); !still && n * 0.07 <= since && n * 0.07 < whole + 0.5; n++) {
        const age = since - n * 0.07;
        if (n * 0.07 < 0.2 || age > 0.2) continue;
        const h = seeded(1000 + n), p = shown[Math.floor(h() * shown.length)];
        if (!p) continue;
        const a = h() * Math.PI * 2, r = b * (0.35 + h() * 0.3) * Math.sin((age / 0.2) * Math.PI);
        g.poly(burstPoints(p.x + Math.cos(a) * p.r * 0.9, p.y + Math.sin(a) * p.r * 0.9, r, 4, 0.28, h())).fill(h() < 0.5 ? 0xffffff : POP_YELLOW).stroke({ width: line * 0.6, color: INK, join: 'miter' });
      }
      for (const c of chunks) {
        // Thrown up and falling back, tumbling.
        const y = c.vy * since + 0.5 * fall * since * since;
        if (still || y > 0) continue;
        const [x, turn] = [c.vx * since, c.spin * since];
        const corners = [[1, 0.7], [-0.8, 1], [-1, -0.6], [0.7, -1]].map(([u, v]) => [x + (u! * Math.cos(turn) - v! * Math.sin(turn)) * c.r, y + (u! * Math.sin(turn) + v! * Math.cos(turn)) * c.r]).flat();
        g.poly(corners).fill(c.white ? 0xffffff : INK).stroke({ width: line * 0.5, color: INK, join: 'miter' });
      }
      const whip = clamp((since - 0.06) / 0.6);
      if (!still && whip > 0 && whip < 1) {
        // Two white swooshes whipping round the cloud once, their tails shortening until they are gone.
        for (const [j, band] of [0.25, -0.3].entries()) {
          const headAt = j * Math.PI + EASE.out(whip) * Math.PI * 3, tail = 2.6 * (1 - whip) + 0.2, n = 16;
          const pt = (a: number): [number, number] => [mx + Math.cos(a) * rx * 1.18 * grow, my + ry * band + Math.sin(a) * ry * 0.42 - rise];
          for (const ink of [true, false]) {
            for (let i = 0; i < n; i++) {
              const a0 = headAt - tail * (1 - i / n), a1 = headAt - tail * (1 - (i + 1) / n);
              const width = ry * (0.02 + (i / n) * 0.13) * (1 - whip * 0.4);
              g.moveTo(...pt(a0)).lineTo(...pt(a1)).stroke({ width: ink ? width + line * 1.6 : width, color: ink ? INK : 0xffffff, cap: 'round' });
            }
          }
        }
      }
    };
    draw();
    // The throw's whistle and fuse (none with Reduce motion, which has no throw), then the landing's puff on the hit.
    if (!still) this.g.audio.play('smoke_throw');
    let landed = false;
    w.addTask({
      step: (dt) => {
        if (!keep() || g.destroyed) return true;
        t += dt;
        if (!landed && t >= throwTime) {
          landed = true;
          this.g.audio.play('smoke_poof');
        }
        if (t >= throwTime + whole) thick();
        if (t >= throwTime + thinAt) thin();
        if (t >= throwTime + goneAt) gone();
        if (t >= throwTime + end) return true;
        draw();
        return false;
      },
      resolve: done,
    });
    return { thick: thickened, thin: thinned, gone: cleared, clear: done };
  }

  /**
   * "POOF!" over the smoke bomb's cloud, `since` seconds after the hit, `at` the cloud's top on the panel: slammed in
   * from big past its size, jittering, then blown up and away. Kept within the fight. With Reduce motion it only fades
   * in and out.
   */
  private posePoof(poof: Text, since: number, at: [number, number], t: number): void {
    const k = since - 0.04;
    poof.visible = k > 0 && k < 0.8;
    if (!poof.visible) return;
    const band = this.fightBand();
    const [hw, hh] = [poof.width / 2, poof.height / 2];
    const x = Math.max(band.left + hw, Math.min(band.right - hw, at[0]));
    const y = Math.max(band.top + hh, at[1] - hh * 0.4);
    if (motion.reduced) {
      poof.position.set(x, y);
      poof.rotation = -0.16;
      poof.alpha = Math.min(1, k / 0.15, (0.8 - k) / 0.2);
      return;
    }
    const jitter = alternate(t, 50) ? 1 : -1;
    const away = Math.max(0, (k - 0.55) / 0.25);
    poof.scale.set(2.2 - 1.2 * EASE.pop(Math.min(1, k / 0.16)) + away * 0.35);
    poof.rotation = -0.16 + (away > 0 ? 0 : jitter * 0.03);
    poof.position.set(x + (away > 0 ? 0 : jitter * this.u * 0.15), y - away * hh * 0.5);
    poof.alpha = 1 - away;
  }

  /** Ronnienomics!'s failure panel while it shows, for the checks. */
  failShown = false;

  /**
   * Ronnienomics! failing, once the smoke has lifted off the party: "FAILED" and `debt` ("DEBT: 1.9
   * TRILLION") slammed across the fight on Revival's slanted panel, printed with cyan dots, with a jolt as it lands, for as
   * long as such a panel shows.
   * From the jolt a bar of mocking synth pop is blasted over the battle music, turned down for it (sfx.ts escape_sting),
   * and goes on after the panel. Settles once the panel has gone, so the member's excuse comes after it, clear of it, over
   * the bar's end; a fight cut short before the bar is over stops it and brings the music back.
   */
  escapeFailed(debt: string, keep: () => boolean): Promise<void> {
    const w = this.battle.world;
    const still = motion.reduced;
    const big = this.g.msg('battle', 'escape_banner'), small = debt.toUpperCase();
    const timing = { ...REVIVAL_BANNER, from: 0 };
    const banner = this.slantBanner({ big, small, dots: POP_CYAN, hazard: false, timing, ...this.bannerPlace() });
    const gone = timing.in + bannerHoldSeconds(`${big} ${small}`, timing.in, timing.hold) + timing.out;
    let t = 0;
    this.failShown = true;
    banner.pose(0, still);
    return new Promise((resolve) => w.addTask({
      step: (dt) => {
        const was = t;
        t += dt;
        if (was < timing.in && t >= timing.in) {
          if (!still) w.shakeTime = Math.max(w.shakeTime, 0.15);
          const sting = this.g.audio.playOver('escape_sting', STING_DUCK_DB);
          let heard = 0;
          w.addTask({
            step: (dt) => {
              heard += dt;
              if (!keep()) sting.stop();
              return !keep() || heard >= STING_S;
            },
            resolve: () => {},
          });
        }
        if (!keep() || banner.root.destroyed || t >= gone) return true;
        banner.pose(t, still);
        return false;
      },
      resolve: () => {
        this.failShown = false;
        if (!banner.root.destroyed) banner.root.destroy({ children: true });
        resolve();
      },
    }));
  }

  /**
   * Revival on the recovered fighter, following them (drawFightRevival): the rest of the field goes darker and flashes
   * once as a column of light lands on them, a "1UP!" panel slams across the fight, a halo drops onto their head and a
   * big pair of wings opens behind them, then flaps up and away as it fades. The figure stands in front of its light
   * and wings, under its halo, while it plays. Settles when it is over (or the fight moves on without it): the turn
   * waits for it (Battle.useItem), so the next blow does not land on top of it. The boss's fuse is not held.
   */
  revivalGlow(actor: Actor, keep: () => boolean): Promise<void> {
    const w = this.battle.world;
    const still = motion.reduced;
    const [dim, back, wings, front] = ['revival_dim', 'revival_glow', 'revival_wings', 'revival_front'].map((label) => {
      const g = new Graphics();
      g.label = label;
      g.eventMode = 'none';
      return g;
    }) as [Graphics, Graphics, Graphics, Graphics];
    // The wings fade as one piece, so their overlapping feathers do not show through each other: drawn off screen at the
    // screen's own resolution and smoothing (a filter's default is one pixel per point, unsmoothed, soft on a phone),
    // and only while they are not wholly there.
    const fade = new AlphaFilter({ alpha: 0, resolution: 'inherit', antialias: 'inherit' });
    wings.filters = [fade];
    w.fx.addChild(dim, back, wings, front);
    const lower = w.raise(actor, front);
    // The flash covers the whole screen, past the panel's edges where the map runs on, under the fight's lists.
    const flash = new Graphics().rect(-1e4, -1e4, 2e4, 2e4).fill(0xfffbe8);
    flash.alpha = 0;
    flash.eventMode = 'none';
    this.container.addChildAt(flash, 0);
    const banner = this.revivalBanner(this.battle.party.find((f) => f.actor === actor)?.name ?? '');
    // The wings as big as the screen has room for beside the fighter, both sides alike (a phone's fight is zoomed in
    // close), and never under about half size.
    const [px] = w.worldToPanel(actor.x, actor.y);
    const radius = w.worldToPanel(actor.x + actor.size, actor.y)[0] - px;
    const wingSize = fightWingSize(Math.min(px, this.g.layout.panel.w - px) / radius);
    let t = 0;
    const draw = () => {
      for (const g of [dim, back, wings, front]) {
        g.position.set(actor.x, actor.y);
        this.upright(g);
      }
      drawRevivalDim(dim, t, actor.size);
      fade.alpha = drawFightRevival({ back, wings, front }, t, actor.size, still, wingSize);
      fade.enabled = fade.alpha < 1;
      flash.alpha = revivalFlash(t, still);
      banner.pose(t, still);
    };
    draw();
    return new Promise((resolve) => w.addTask({
      step: dt => {
        t += dt;
        if (t >= FIGHT_REVIVAL_DURATION || back.destroyed || dim.destroyed || actor.hidden || !keep()) return true;
        draw();
        return false;
      },
      resolve: () => {
        lower();
        for (const g of [dim, back, wings, front, flash, banner.root]) if (!g.destroyed) g.destroy({ children: true });
        fade.destroy();
        resolve();
      },
    }));
  }

  /**
   * Revival's panel across the fight: "1UP!" and who is back, on an ink band printed with pink dots between yellow
   * rules, at an angle. It slams in from the left as the light lands, holds, and is gone to the right; with Reduce
   * motion it stands still and only fades in and out. Shown where the special moves' splash is, under the lists.
   */
  private revivalBanner(name: string): { root: Container; pose(t: number, still: boolean): void } {
    return this.slantBanner({
      big: this.g.msg('battle', 'revival_banner'),
      small: this.g.msg('battle', 'revival_back', { name }).toUpperCase(),
      dots: POP_PINK, hazard: false, timing: REVIVAL_BANNER,
      ...this.bannerPlace(),
    });
  }

  /**
   * Where Revival's panel goes across the fight, and Ronnienomics!'s failure: about a quarter of the screen's height, as in
   * the concept the owner chose, kept within a narrow or short fight, its middle a third of the way down the fight.
   */
  private bannerPlace(): { height: number; cy: number } {
    const u = this.u, b = this.fightBand(), p = this.g.layout.panel;
    const [bw, bh] = [b.right - b.left, b.bottom - b.top];
    return { height: Math.round(Math.max(u * 2.6, Math.min(bh * 0.5, p.h * 0.24, bw * 0.22))), cy: b.top + bh * 0.3 };
  }

  /**
   * A panel slammed across the fight at an angle (Revival's "1UP!", the strike's "INCOMING!"): an ink band printed with
   * `dots` between yellow rules (hazard-striped with `hazard`), the `big` word in extruded poster letters beside the
   * `small` line, `height` tall with its middle at `cy`. It slams in from the left, holds and is gone to the right, on
   * `timing`; with Reduce motion it stands still and only fades in and out. Under the strip and the lists.
   */
  private slantBanner(o: { big: string; small: string; dots: number; hazard: boolean; timing: { from: number; in: number; hold: number; out: number }; height: number; cy: number; band?: { top: number; bottom: number; left: number; right: number } }): { root: Container; pose(t: number, still: boolean): void } {
    const b = o.band ?? this.fightBand();
    const bw = b.right - b.left;
    const p = this.g.layout.panel;
    const H = o.height;
    // Just long enough to cover the panel while it holds, and slid far enough to start and end wholly off it.
    const [cx, cy] = [b.left + bw / 2, o.cy];
    const { long: L, reach } = revivalBannerSpan(cx, p.w, H);
    const root = this.splashRoot(b);
    const inner = new Container();
    inner.rotation = REVIVAL_BANNER_TILT;
    const band = new Graphics();
    band.rect(-L / 2, -H / 2, L, H).fill(INK);
    benDay(band, { x: -L / 2, y: -H / 2, w: L, h: H }, { color: o.dots, alpha: 0.85, pitch: H * 0.16, from: [-bw * 0.1, 0], to: [bw * 0.35, 0] });
    for (const y of [-H / 2 - H * 0.1, H / 2]) {
      band.rect(-L / 2, y, L, H * 0.1).fill(POP_YELLOW);
      // Hazard stripes slanting across the rule.
      if (o.hazard) for (let x = -L / 2; x < L / 2; x += H * 0.3) band.poly([x, y, x + H * 0.13, y, x + H * 0.03, y + H * 0.1, x - H * 0.1, y + H * 0.1]).fill(INK);
      band.rect(-L / 2, y, L, H * 0.1).stroke({ color: INK, width: 2 });
    }
    const streaks = new Graphics();
    const big = new Text({ text: o.big, style: letterStyle(Math.round(H * 0.82), POP_YELLOW, { outline: true, extrude: true }) });
    big.anchor.set(1, 0.5);
    const small = new Text({ text: o.small, style: letterStyle(Math.round(H * 0.3), 0xffffff, { outline: true }) });
    small.anchor.set(0, 0.5);
    // Side by side across the middle, both smaller if the fight is too narrow for them.
    const gap = H * 0.25;
    const fit = Math.min(1, (bw * 0.92) / (big.width + gap + small.width));
    big.x = (-(big.width + gap + small.width) * fit) / 2 + big.width * fit;
    small.position.set(big.x + gap * fit, H * 0.05 * fit);
    small.scale.set(fit);
    inner.label = 'banner_inner'; band.label = 'banner_band';
    inner.addChild(band, streaks, big, small);
    root.addChild(inner);
    // Under the strip and the lists, over the fight.
    this.container.addChildAt(root, this.container.getChildIndex(this.tier.container));
    const { from, in: into, out } = o.timing;
    const hold = bannerHoldSeconds(`${o.big} ${o.small}`, into, o.timing.hold);
    return {
      root,
      pose: (t, still) => {
        const k = t - from;
        root.visible = k > 0 && k < into + hold + out;
        if (!root.visible) return;
        const slide = still ? 0 : k < into ? EASE.out(k / into) - 1 : k < into + hold ? 0 : Math.min(1, (k - into - hold) / out) ** 2;
        root.alpha = still ? Math.min(1, k / into, (into + hold + out - k) / out) : 1;
        inner.position.set(cx + slide * reach, cy);
        // Speed lines running along the band, held with Reduce motion.
        streaks.clear();
        for (let i = 0; i < 9; i++) {
          const y = (((i * 53) % 90) / 90 - 0.5) * H * 0.8;
          const x = (((still ? 0 : t * 2.2) + i * 0.29) % 1) * bw * 1.6 - bw * 0.8;
          streaks.moveTo(x, y).lineTo(x + bw * 0.12, y).stroke({ color: 0xffffff, width: Math.max(1.5, H * 0.025), alpha: 0.7 });
        }
        // The big letters slam in a little behind the band and push on slowly.
        big.scale.set(fit * (still ? 1 : 1 + 0.6 * (1 - EASE.out(Math.min(1, k / 0.18))) + 0.04 * k));
      },
    };
  }

  /** Cherry Chomp's light while it shows, and what draws it, for the checks (which test that it is on screen). */
  healShown = 0;
  healViews: Container[] = [];

  /**
   * Cherry Chomp's heal, in the save star's light: a column of light rising through each member with green
   * pluses, and a bob, over a little more than a second (World.healLight). It keeps the fight's clock.
   */
  healGlow(actors: Actor[]): void {
    const w = this.battle.world;
    const total = 1.2;
    const light = w.healLight(actors, { start: 0, rise: 0.7, total });
    let t = 0;
    this.healShown++;
    this.healViews.push(...light.views);
    light.draw(0);
    w.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total) return true;
        light.draw(t);
        return false;
      },
      resolve: () => {
        this.healShown--;
        this.healViews = this.healViews.filter((v) => !light.views.includes(v as Graphics));
        light.destroy();
      },
    });
  }

  /** The special move's splash while it is up: the move's name and how long it has shown, for the checks. */
  cutInShown: { name: string; age: number } | null = null;
  /** Identity of the animation task, retained when resizing rebuilds its display objects. */
  private cutInRun: object | null = null;
  private cutUp: { f: Fighter; name: string; groups: ReadonlyArray<{ kinds: string[]; on: boolean }>; root: Container; inner: Container; pic: Container; words: Text; picX: number; wordsX: number; reach: number } | null = null;

  /**
   * A special move's splash, as the move begins: a pink band (red/black/gold for the boss) across the
   * fight at an angle over yellow dots, the member's portrait sliding in from the left and the move's
   * name in poster capitals from the right; it snaps open, holds a moment, and snaps shut. It stays in
   * the fight's band, under the strip and the lists, and takes no taps. The finale fuse keeps running.
   * Its animation keeps the fight's own clock,
   * so it stands still under the pause page. With Reduce motion it stands still and only fades out.
   */
  cutIn(f: Fighter, name: string, keep = () => true, groups: ReadonlyArray<{ kinds: string[]; on: boolean }> = []): Promise<void> {
    this.cutUp?.root.destroy({ children: true });
    this.buildCutIn(f, name, groups);
    this.poseCutIn(0);
    this.cutInShown = { name, age: 0 };
    const total = cutInDurationMs(name) / 1000;
    const own = this.cutInRun = {};
    let t = 0;
    return new Promise((resolve) => {
      this.battle.world.addTask({
        step: (dt) => {
          t += dt;
          // A timed-out party splash may still have a queued task after the boss replaces it.
          if (this.cutInRun !== own) return true;
          const c = this.cutUp;
          if (!keep() || !c || c.root.destroyed || t >= total) {
            if (c && !c.root.destroyed) c.root.destroy({ children: true });
            this.cutUp = null;
            this.cutInShown = null;
            this.cutInRun = null;
            return true;
          }
          this.cutInShown = { name, age: t };
          this.poseCutIn(t);
          return false;
        },
        resolve,
      });
    });
  }

  /** Draws the splash for the panel as it is now, at rest; the motion is set on each step by `poseCutIn`. */
  private buildCutIn(f: Fighter, name: string, groups: ReadonlyArray<{ kinds: string[]; on: boolean }> = []): void {
    const u = this.u;
    const m = measures(u);
    const b = this.fightBand();
    const bw = b.right - b.left;
    const bh = b.bottom - b.top;
    const H = Math.round(Math.min(bh * 0.8, Math.max(u * 2.6, Math.min(u * 4.4, bh * 0.5))));
    const p = this.g.layout.panel;
    // Long enough to run past the panel's edges at its angle.
    const L = Math.hypot(p.w, p.h) * 2;
    const root = this.splashRoot();
    const inner = new Container();
    inner.position.set(b.left + bw / 2, b.top + bh * 0.46);
    inner.rotation = -0.12;
    const band = new Graphics();
    const boss = f.actor.look === 'boss';
    // The foil giant's band is its own foil, glittering, under rainbow letters (the owner, 2026-11-05: "could its special
    // attack be even more fabulous?").
    const foil = GHOST_TINTS[f.actor.look as LookId]?.foil === true ? foilBand(L, H, 0.4) : null;
    // The Warsaw Pac keeps the same composition in its red, black and gold.
    band.rect(-L / 2, -H / 2 - Math.round(u * 0.4), L, H).fill(boss ? POP_YELLOW : POP_CYAN);
    band.rect(-L / 2, -H / 2 + m.S, L, H).fill(INK);
    if (foil) foil.position.set(-L / 2, -H / 2);
    else {
      band.rect(-L / 2, -H / 2, L, H).fill(boss ? RED_INK : POP_PINK);
      benDay(band, { x: -L / 2, y: -H / 2, w: L, h: H }, { color: boss ? INK : POP_YELLOW, pitch: Math.max(6, u * 0.9), from: [-bw * 0.1, 0], to: [bw / 2, 0] });
    }
    const over = foil ? new Graphics() : band;
    // Speed lines, as if the band were still flying in.
    for (const [x, y, len] of [[-0.3, -0.28, 0.35], [0.05, 0.3, 0.25], [0.25, -0.12, 0.2]] as const) over.rect(x * bw, y * H, len * bw, Math.max(2, m.l)).fill({ color: 0xffffff, alpha: 0.85 });
    over.moveTo(-L / 2, -H / 2).lineTo(L / 2, -H / 2).moveTo(-L / 2, H / 2).lineTo(L / 2, H / 2).stroke({ width: m.L, color: INK });
    // The portrait juts past the band's edges, turned against it, on its own hard shadow.
    const size = Math.round(H * 1.15);
    const pic = new Container();
    pic.addChild(new Graphics().rect(m.S, m.S, size, size).fill(INK));
    pic.addChild(portrait(f.actor.look, size, u, false));
    pic.pivot.set(size / 2, size / 2);
    pic.rotation = 0.1;
    const picX = -bw / 2 + u + size / 2;
    pic.y = 0;
    const lettering = letterStyle(Math.round(H * 0.5), POP_YELLOW, { outline: true, extrude: true });
    // A gradient needs a canvas, which a fight built off screen (the unit tests) has none of.
    if (foil && typeof document === 'object') lettering.fill = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: 'local', colorStops: GLITTER.map((color, i) => ({ offset: i / (GLITTER.length - 1), color })) });
    const words = new Text({ text: name.toUpperCase(), style: lettering });
    words.anchor.set(0, 0.5);
    const wordsX = picX + size / 2 + u * 0.8;
    const room = bw / 2 - u * 1.2 - wordsX;
    if (words.width > room) words.scale.set(Math.max(0.4, room / words.width));
    words.y = 0;
    inner.label = 'banner_inner'; band.label = 'banner_band';
    inner.addChild(band, ...(foil ? [foil, over] : []), words, pic);
    if (groups.length) inner.addChild(this.helpGroups(groups, H, bw));
    root.addChild(inner);
    // Under the strip and the lists, over the fight.
    this.container.addChildAt(root, this.container.getChildIndex(this.tier.container));
    this.cutUp = { f, name, groups, root, inner, pic, words, picX, wordsX, reach: bw * 0.6 };
  }

  /** A call for help's slip under the band: each group's tiny pictures, lit if one of them answers, grey if none is left to. */
  private helpGroups(groups: ReadonlyArray<{ kinds: string[]; on: boolean }>, H: number, bw: number): Container {
    const u = this.u, m = measures(u);
    const count = groups.reduce((n, g) => n + g.kinds.length, 0);
    const pad = Math.round(u * 0.35);
    const across = (groups.length - 1) * 0.6 + count * 0.8 + 0.4;
    const tiny = Math.round(Math.min(H * 0.8, (bw * 0.86 - pad * 2) / across));
    const wide = Math.round(tiny * across) + pad * 2;
    const slip = new Container();
    slip.addChild(new Graphics().rect(m.S - wide / 2, m.S, wide, tiny + pad * 2).fill(INK));
    slip.addChild(new Graphics().rect(-wide / 2, 0, wide, tiny + pad * 2).fill(PAPER).stroke({ width: m.L, color: INK }));
    let x = -wide / 2 + pad + tiny * 0.2;
    for (const g of groups) {
      for (const kind of g.kinds) {
        const one = ghostPicture(this.g.content.enemies[kind]?.look as LookId, tiny, g.on);
        one.position.set(x + tiny * 0.4, pad + tiny / 2);
        slip.addChild(one);
        x += tiny * 0.8;
      }
      x += tiny * 0.6;
    }
    slip.y = H / 2 + m.G;
    return slip;
  }

  /** A splash's root, masked to where splashes show: the fight's band and, on a wide screen, on across the panel above
   * the command slot and its tab. It takes no taps. */
  private splashRoot(b: { top: number; bottom: number; left: number; right: number } = this.fightBand()): Container {
    const m = measures(this.u);
    const p = this.g.layout.panel;
    const root = new Container();
    root.eventMode = 'none';
    const mask = new Graphics().rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    const slotTop = this.tallestTop - m.titleTabH - m.G;
    if (b.right < p.w && slotTop > b.top) mask.rect(b.right, b.top, p.w - b.right, slotTop - b.top);
    mask.fill(0xffffff);
    root.addChild(mask);
    root.mask = mask;
    return root;
  }

  /** Sets the splash `t` seconds in: snapping open (past full and back), the portrait and name sliding in, a slow push, and snapping shut. */
  private poseCutIn(t: number): void {
    const c = this.cutUp;
    if (!c) return;
    const open = MS.cutInOpen / 1000;
    const close = MS.cutInClose / 1000;
    const total = cutInDurationMs(c.name) / 1000;
    const shut = Math.max(0, Math.min(1, (t - (total - close)) / close));
    c.root.alpha = 1 - EASE.out(shut);
    if (motion.reduced) {
      c.inner.scale.y = 1;
      c.pic.x = c.picX;
      c.words.x = c.wordsX;
      return;
    }
    c.inner.scale.y = shut > 0 ? 1 - EASE.out(shut) : EASE.pop(Math.min(1, t / open));
    const slide = EASE.out(Math.min(1, t / (open * 1.6)));
    c.pic.x = c.picX - (1 - slide) * c.reach;
    c.words.x = c.wordsX + (1 - slide) * c.reach - (t / total) * this.u * 0.8;
  }

  /** Whether the final blow's lines are showing, and how many sparkles are, for the checks. */
  finalShown = false;
  sparkleShown = 0;

  /**
   * The blow that wins a fight: focus lines, every third yellow, strike in on where the last enemy stood
   * and draw back to the panel's edges while the results are pressed on, under them. The fight is over,
   * so nothing is being chosen. None with Reduce motion.
   */
  finalBlow(actor: Actor): void {
    if (motion.reduced) return;
    const w = this.battle.world;
    const lines = this.panelLines();
    const [x, y, size] = [actor.x, actor.y, actor.size];
    this.finalShown = true;
    void anim.run(this, MS.finalBlow, EASE.out, (k) => {
      if (lines.root.destroyed) return;
      const p = this.g.layout.panel;
      lines.g.clear();
      if (k >= 1) {
        this.finalShown = false;
        lines.root.destroy({ children: true });
        return;
      }
      focusLines(lines.g, { x: 0, y: 0, w: p.w, h: p.h }, w.worldToPanel(x, y, size), 0.55 * (1 - k), this.u, 9, POP_YELLOW);
    });
  }

  /**
   * Four-point stars pop around a member's head and rise as they shrink away: yellow when a member is
   * brought back from DOWN, pink where Cherry Chomp's cherries land. With Reduce motion they stand still
   * at full size and fade. They keep the fight's clock.
   */
  sparkle(actor: Actor, ink: number): void {
    const w = this.battle.world;
    const g = new Graphics();
    g.eventMode = 'none';
    w.fx.addChild(g);
    const s = actor.size;
    const total = MS.sparkle / 1000;
    let t = 0;
    this.sparkleShown++;
    const draw = () => {
      g.clear();
      g.position.set(actor.x, w.upY(actor.y, s * 1.6));
      this.upright(g);
      const k = t / total;
      const still = motion.reduced;
      g.alpha = still ? Math.max(0, 1 - k) : 1;
      for (const [i, [ox, oy, r]] of ([[-1.0, 0.1, 0.6], [0.95, -0.2, 0.5], [0.1, -0.95, 0.7]] as const).entries()) {
        const kk = Math.max(0, Math.min(1, k * 1.3 - i * 0.12));
        const grow = still ? 1 : kk < 0.35 ? EASE.pop(kk / 0.35) : 1 - (kk - 0.35) / 0.65;
        if (grow <= 0) continue;
        const rise = still ? 0 : kk * s * 0.6;
        g.poly(burstPoints(ox * s, oy * s - rise, r * s * grow, 4, 0.3)).fill(ink).stroke({ width: Math.max(0.6, s * 0.05), color: INK, join: 'miter' });
      }
    };
    draw();
    w.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || g.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        this.sparkleShown--;
        if (!g.destroyed) g.destroy();
      },
    });
  }

  /** Whether the blast's rings are showing, for the checks. */
  ringsShown = false;

  /**
   * The boss's blast sends rings out across the fight from where it stands: a red one with an ink edge
   * and a yellow one inside it, growing past the panel's corners and thinning as they go, under the strip
   * and the lists. They keep the fight's clock, so they stand still under the pause page. None with
   * Reduce motion, which keeps the faint flash.
   */
  blastRings(actor: Actor): void {
    if (motion.reduced) return;
    const w = this.battle.world;
    const u = this.u;
    const lines = this.panelLines();
    const total = MS.blastRing / 1000;
    let t = 0;
    this.ringsShown = true;
    // The foil giant's rings run through the rainbow, one close behind another, and it throws glitter.
    const fab = GHOST_TINTS[actor.look as LookId]?.foil === true;
    const rings: ReadonlyArray<readonly [number, number, number]> = fab
      ? GLITTER.map((color, i) => [i * 0.045, color, u * (1.0 - i * 0.07)] as const)
      : [[0, RED_INK, u * 1.4], [0.12, POP_YELLOW, u * 0.9]];
    if (fab) this.glitterBurst(actor);
    const draw = () => {
      const p = this.g.layout.panel;
      const [cx, cy] = w.worldToPanel(actor.x, actor.y, actor.size);
      const far = Math.max(...[[0, 0], [p.w, 0], [0, p.h], [p.w, p.h]].map(([x, y]) => Math.hypot(x! - cx, y! - cy)));
      const g = lines.g.clear();
      const m = measures(u);
      for (const [lag, color, width] of rings) {
        const k = Math.max(0, Math.min(1, (t - lag * total) / (total * (1 - lag))));
        if (k <= 0 || k >= 1) continue;
        const r = actor.size + k * far;
        const wd = width * (1 - k * 0.7);
        g.circle(cx, cy, r).stroke({ width: wd + m.L * 2, color: INK, alpha: 1 - k * 0.5 });
        g.circle(cx, cy, r).stroke({ width: wd, color, alpha: 1 - k * 0.5 });
      }
    };
    draw();
    w.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || lines.root.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        this.ringsShown = false;
        if (!lines.root.destroyed) lines.root.destroy({ children: true });
      },
    });
  }

  /** Glitter pieces showing, for the checks. */
  glitterShown = 0;

  /**
   * The foil giant's blast throws glitter: four-point stars in the foil's colours fly out from it across the fight, twinkling,
   * and drift down as they fade. Over the fight, under the strip and the lists; on the fight's clock. None with Reduce motion.
   */
  private glitterBurst(actor: Actor): void {
    const w = this.battle.world;
    const u = this.u;
    const lines = this.panelLines();
    const total = MS.glitter / 1000;
    const rand = seeded(Math.round(actor.x * 7 + actor.y * 13));
    const stars = Array.from({ length: 36 }, () => ({
      a: rand() * Math.PI * 2, reach: 0.2 + rand() * 0.6, r: u * (0.5 + rand() * 0.6), color: GLITTER[Math.floor(rand() * GLITTER.length)]!, phase: rand() * Math.PI * 2,
    }));
    let t = 0;
    const draw = () => {
      const p = this.g.layout.panel;
      const [cx, cy] = w.worldToPanel(actor.x, actor.y, actor.size);
      const far = Math.hypot(p.w, p.h) * 0.5;
      const g = lines.g.clear();
      const m = measures(u);
      const k = t / total;
      const out = EASE.out(Math.min(1, k * 1.8));
      const fade = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
      let shown = 0;
      for (const s of stars) {
        const r = s.r * fade * (0.55 + 0.45 * Math.sin(t * 16 + s.phase)) * Math.min(1, k * 8);
        if (r < 1) continue;
        const x = cx + Math.cos(s.a) * s.reach * far * out;
        const y = cy + Math.sin(s.a) * s.reach * far * out + k * k * far * 0.3;
        g.poly(burstPoints(x, y, r, 4, 0.3)).fill(s.color).stroke({ width: Math.max(0.8, m.l * 0.8), color: INK, join: 'miter' });
        shown++;
      }
      this.glitterShown = shown;
    };
    draw();
    w.addTask({
      step: (dt) => {
        t += dt;
        if (t >= total || lines.root.destroyed) return true;
        draw();
        return false;
      },
      resolve: () => {
        this.glitterShown = 0;
        if (!lines.root.destroyed) lines.root.destroy({ children: true });
      },
    });
  }

  /** The brightest the last flash got, for the browser checks. */
  flashPeak = 0;

  /**
   * A white flash over the panel, fading over `length` seconds: the boss's blast at full strength, A-star
   * Maneuver's flare fainter and quicker. With reduced motion it is fainter still and short.
   */
  flash(strength = 1, length = 0.5): void {
    const p = this.g.layout.panel;
    const g = new Graphics().rect(0, 0, p.w, p.h).fill(0xffffff);
    this.container.addChild(g);
    const peak = (motion.reduced ? 0.35 : 1) * strength;
    const fade = motion.reduced ? Math.min(0.25, length) : length;
    this.flashPeak = peak;
    let t = 0;
    g.alpha = peak;
    this.battle.world.addTask({
      step: (dt) => {
        t += dt;
        g.alpha = Math.max(0, peak * (1 - t / fade));
        if (t > 0.5) {
          g.destroy();
          return true;
        }
        return false;
      },
      resolve: () => undefined,
    });
  }

  /** The victory box, its words, and each line's kind, for the browser checks. */
  victoryText = '';
  victoryKinds: string[] = [];
  /** Where the ribbon, its burst, and the box score stand together, in the panel. */
  victoryBox: { x: number; y: number; w: number; h: number } | null = null;
  /** The ribbon's scale on its first frame (it grows in from larger, or is at rest with reduced motion). */
  ribbonScaleAtStart = 0;
  /** The victory while it is up: its lines, its layer, the still catcher that takes a tap anywhere, and the box on it. */
  private victoryUp: { lines: VictoryLine[]; c: Container; catcher: Graphics; root: Container | null } | null = null;

  /**
   * The victory: "Won the Battle!" on an ink ribbon with a burst at its end, over a box score of the
   * results, each line with a drawn mark by kind (XP, none for those down, Dots, a level with the
   * member's small portrait, and what the level added, set in under it). It stands above the member
   * strip when it fits, printed smaller if need be, and only reaches over the strip when nothing else fits.
   * A tap anywhere or a key continues, after 0.4 s.
   */
  async victory(lines: VictoryLine[]): Promise<void> {
    const g = this.g;
    for (const l of lines) g.record({ speaker: '', text: l.text, kind: 'fight' });
    this.closeMenu();
    this.mode = 'idle';
    this.placeFocus(null);
    this.victoryText = lines.map((l) => l.text).join('\n');
    this.victoryKinds = lines.map((l) => l.kind);
    const c = new Container();
    const catcher = new Graphics();
    catcher.eventMode = 'static';
    c.addChild(catcher);
    this.container.addChild(c);
    this.victoryUp = { lines, c, catcher, root: null };
    const built = this.placeVictory();
    const m = measures(this.u);
    // The ribbon lands with its burst (from a little larger); the results are pressed on just after.
    anim.play(this, built.ribbon, { scale: 1.25 }, 140, EASE.out);
    anim.play(this, built.face, { dx: m.S, dy: m.S }, MS.paste, EASE.out, { delay: 60 });
    // Each level is slapped on after the results, one after another.
    built.levels.forEach((l, i) => anim.play(this, l, { scale: 1.35, rotation: -0.06, alpha: 0 }, MS.levelSlap, EASE.pop, { delay: 170 + i * 100 }));
    this.ribbonScaleAtStart = built.ribbon.scale.x;
    if (!motion.reduced) this.throwConfetti(c);
    await new Promise<void>((resolve) => {
      let t = 0;
      let done = false;
      const finish = () => {
        if (done || t < 0.4) return;
        done = true;
        resolve();
      };
      catcher.on('pointertap', finish);
      this.battle.world.addTask({
        step: (dt) => {
          t += dt;
          if (g.input.pressed('confirm') || g.input.pressed('cancel')) finish();
          if (g.dev.fastText && t > 0.5) finish();
          return done;
        },
        // If the map goes away (the player quits), the box is done with, and the fight can end.
        resolve: () => {
          if (!done) {
            done = true;
            resolve();
          }
        },
      });
    });
    anim.finish(this);
    this.victoryUp = null;
    c.destroy({ children: true });
  }

  /** How many pieces of the win's confetti are in the air, for the checks. */
  confettiFlying = 0;

  /**
   * Confetti thrown up from the victory's ribbon, both ways, turning as it falls, fading at the end. Drawn
   * behind the box, in one Graphics, on the stepper; a relayout ends it at once.
   */
  private throwConfetti(layer: Container): void {
    const v = this.victoryBox;
    if (!v) return;
    const u = this.u;
    const line = Math.max(1.5, measures(u).l);
    const g = new Graphics();
    g.eventMode = 'none';
    layer.addChildAt(g, 1);
    const rnd = seeded(41);
    const inks = [POP_PINK, POP_CYAN, POP_YELLOW];
    const pieces = Array.from({ length: 22 }, (_, i) => {
      const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.1;
      const speed = u * (10 + rnd() * 9);
      return { x: v.x + v.w / 2 + (rnd() - 0.5) * v.w * 0.6, y: v.y + u, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, spin: (rnd() - 0.5) * 14, s: u * (0.35 + rnd() * 0.3), ink: inks[i % 3]!, kind: i % 3 };
    });
    const secs = MS.confetti / 1000;
    this.confettiFlying = pieces.length;
    void anim.run(this, MS.confetti, EASE.linear, (k) => {
      if (g.destroyed) return;
      g.clear();
      if (k >= 1) {
        g.destroy();
        this.confettiFlying = 0;
        return;
      }
      const t = k * secs;
      const fall = u * 32;
      for (const p of pieces) {
        const x = p.x + p.vx * t;
        const y = p.y + p.vy * t + (fall * t * t) / 2;
        const a = p.spin * t;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const at = (px: number, py: number) => [x + px * c - py * s, y + px * s + py * c];
        const pts = p.kind === 0 ? [...at(-p.s, -p.s * 0.45), ...at(p.s, -p.s * 0.45), ...at(p.s, p.s * 0.45), ...at(-p.s, p.s * 0.45)] : p.kind === 1 ? [...at(0, -p.s), ...at(p.s * 0.9, p.s * 0.6), ...at(-p.s * 0.9, p.s * 0.6)] : [...at(-p.s, 0), ...at(0, -p.s * 0.5), ...at(p.s, 0), ...at(0, p.s * 0.5)];
        g.poly(pts).fill(p.ink).stroke({ width: line, color: INK, join: 'miter' });
      }
      g.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    });
  }

  /**
   * Fits the victory box to the panel as it is now and stands it there, over everything else in the
   * fight, with the catcher covering the whole panel. Called when it opens and again on a relayout.
   */
  private placeVictory(): { ribbon: Container; face: Container; levels: Container[] } {
    const v = this.victoryUp!;
    const p = this.g.layout.panel;
    const u = this.u;
    v.root?.destroy({ children: true });
    const floor = this.tierRect().y - u * 0.5;
    // Full size above the strip if it fits, else smaller, and only at the smallest over the strip.
    let built = this.buildVictory(v.lines, 1);
    for (const k of [0.85, 0.72]) {
      if (u * 0.5 + built.h <= floor) break;
      built.root.destroy({ children: true });
      built = this.buildVictory(v.lines, k);
    }
    const limit = u * 0.5 + built.h <= floor ? floor : p.h - u * 0.5;
    const x = Math.round((p.w - built.w) / 2);
    const y = Math.round(Math.max(u * 0.5, Math.min(p.h * 0.18 - built.ribbonH / 2, limit - built.h)));
    built.root.position.set(x, y);
    v.c.addChild(built.root);
    v.root = built.root;
    v.catcher.clear().rect(0, 0, p.w, p.h).fill({ color: 0xffffff, alpha: 0.001 });
    this.container.addChild(v.c);
    this.victoryBox = { x, y, w: built.w, h: built.h };
    return built;
  }

  /**
   * The victory's ribbon and box score at `k` times full size: the pieces, and how big they are
   * together, the burst past the ribbon's end included. Nothing in it takes a tap: the catcher
   * behind it does, so a tap anywhere continues.
   */
  private buildVictory(lines: VictoryLine[], k: number): { root: Container; ribbon: Container; face: Container; levels: Container[]; w: number; h: number; ribbonH: number } {
    const g = this.g;
    const p = g.layout.panel;
    const u = this.u;
    const m = measures(u);
    const root = new Container();
    root.eventMode = 'none';
    // The ribbon: yellow poster lettering, outlined and extruded, on a pink band with swallow-tailed ends, and a burst behind its right end.
    const title = new Text({ text: g.msg('battle', 'won').toUpperCase(), style: letterStyle(Math.round(u * 2.8 * k), POP_YELLOW, { outline: true, extrude: true }) });
    const rh = Math.round(title.height * 0.9 + u * 0.3 * k);
    const cut = rh * 0.3;
    const burst = Math.round(rh * 1.2);
    // How far the burst and its spikes reach past the ribbon's end; the same room is kept at the other end, so the whole stays centred.
    const over = Math.ceil(burst * 0.45 + u * 0.45 * k + m.L);
    const rw = Math.min(p.w - u - over * 2, Math.round(title.width + u * 2.4 * k));
    // The words stay on the ink, clear of the notches cut in each end.
    const room = rw - cut * 2 - u * 0.4 * k;
    if (title.width > room) title.scale.set(room / title.width);
    const ribbon = new Container();
    const band = new Graphics();
    band.poly(spikyRect(rw - burst * 0.55, (rh - burst) / 2, burst, burst, u * 0.45 * k)).fill(POP_YELLOW).stroke({ width: m.L, color: INK, join: 'miter' });
    const tails = [0, 0, rw, 0, rw - cut, rh / 2, rw, rh, 0, rh, cut, rh / 2];
    band.poly(tails.map((v) => v + m.S)).fill(INK);
    band.poly(tails).fill(POP_PINK).stroke({ width: m.L, color: INK, join: 'miter' });
    confetti(band, { x: -over * 0.6, y: -u * 1.2 * k, w: over * 0.9, h: rh * 0.6 }, u * k, 3);
    title.anchor.set(0.5);
    title.position.set(rw / 2, rh / 2);
    ribbon.addChild(band, title);
    // The box score.
    const size = Math.round(u * 1.0 * k);
    const mark = Math.round(u * 0.6 * k);
    const pad = m.P;
    const slot = mark + Math.round(u * 0.5 * k);
    const pic = Math.round(u * 1.6 * k);
    const textRoom = p.w - u - pad * 2 - slot;
    // A level is printed loud: white poster lettering on a pink band. The other lines are set in the body face.
    const rows: Array<{ line: VictoryLine; text: Text }> = lines.map((line) => ({
      line,
      text: new Text({
        text: line.text,
        style:
          line.kind === 'level_up'
            ? { ...letterStyle(Math.round(size * 1.15), 0xffffff, { outline: true }), wordWrap: true, wordWrapWidth: textRoom - pic - u * 0.3 }
            : { fontFamily: FONT.body, fontSize: line.kind === 'level_gains' ? Math.round(size * 0.92) : size, fill: line.kind === 'level_gains' ? INK_SOFT : INK, wordWrap: true, wordWrapWidth: textRoom - (line.kind === 'level_gains' ? slot : 0) },
      }),
    }));
    const levels: Container[] = [];
    const textW = Math.max(...rows.map((r) => r.text.width + (r.line.kind === 'level_up' ? pic + u * 0.3 : 0) + (r.line.kind === 'level_gains' ? slot : 0)));
    const pw = Math.round(Math.min(p.w - u, Math.max(rw, textW + slot + pad * 2)));
    // The whole: the box, or the ribbon with room for its burst, whichever is wider.
    const W = Math.max(pw, rw + over * 2);
    const face = new Container();
    const drawn = new Graphics();
    face.addChild(drawn);
    let y = Math.round(rh * 0.5) + pad;
    for (const r of rows) {
      const kind = r.line.kind;
      const rowH = Math.max(r.text.height, kind === 'level_up' ? pic : 0);
      // A level's band reaches a little past its row; the rows around it keep clear of it.
      const bandPad = kind === 'level_up' ? Math.round(u * 0.3 * k) : 0;
      y += bandPad;
      let tx = pad + slot;
      if (kind === 'level_gains') tx += slot;
      // A level's pieces are one piece, so it can be slapped on after the box.
      const into = kind === 'level_up' ? new Container() : face;
      if (kind === 'level_up') {
        const band = new Graphics();
        band.rect(pad * 0.4 + m.S * 0.6, y - bandPad + m.S * 0.6, pw - pad * 0.8, rowH + bandPad * 2).fill(INK);
        band.rect(pad * 0.4, y - bandPad, pw - pad * 0.8, rowH + bandPad * 2).fill(POP_PINK).stroke({ width: m.l, color: INK });
        into.addChild(band);
        face.addChild(into);
        levels.push(into);
      }
      if (kind === 'level_up' && r.line.who) {
        // The member's portrait on a yellow starburst.
        const star = new Graphics().poly(burstPoints(tx + pic / 2, y + rowH / 2, pic * 0.78, 10, 0.72, 0.15)).fill(POP_YELLOW).stroke({ width: m.l, color: INK, join: 'miter' });
        const face2 = portrait(r.line.who, pic, u, false);
        face2.position.set(tx, y + (rowH - pic) / 2);
        into.addChild(star, face2);
        tx += pic + u * 0.3;
      }
      r.text.position.set(tx, y + (rowH - r.text.height) / 2);
      into.addChild(r.text);
      // Each mark is centred on its line's first line of words.
      const first = r.text.height / Math.max(1, CanvasTextMetrics.measureText(r.line.text, r.text.style).lines.length);
      const cx = pad + mark / 2;
      const cy = r.text.y + first / 2;
      if (kind === 'xp') drawn.rect(cx - mark / 2, cy - mark / 2, mark, mark).fill(INK);
      else if (kind === 'none') drawn.rect(cx - mark / 2, cy - mark / 2, mark, mark).stroke({ width: m.l, color: INK });
      else if (kind === 'dots') drawn.circle(cx, cy, mark / 2).fill(0xffd23f).stroke({ width: m.l, color: INK });
      else if (kind === 'level_up') into.addChild(new Graphics().poly(burstPoints(cx, y + rowH / 2, mark * 0.7, 5, 0.42)).fill(POP_YELLOW).stroke({ width: m.l, color: INK, join: 'miter' }));
      if (kind === 'level_up') {
        // Turned about its own middle when it is slapped on.
        const b = into.getLocalBounds();
        into.pivot.set(b.x + b.width / 2, b.y + b.height / 2);
        into.position.set(b.x + b.width / 2, b.y + b.height / 2);
      }
      y += rowH + bandPad + Math.round(u * 0.25 * k);
    }
    // The finished-line mark: the results wait for the player.
    const tri = Math.round(u * 0.55);
    const ph = Math.round(y + pad * 0.6 + tri);
    drawn.poly([pw - pad - tri, ph - pad - tri * 0.8, pw - pad, ph - pad - tri * 0.8, pw - pad - tri / 2, ph - pad]).fill(INK);
    const board = panel(pw, ph, u);
    board.plate.eventMode = 'none';
    board.face.addChild(face);
    const top = Math.round(rh * 0.5);
    board.root.position.set(Math.round((W - pw) / 2), top);
    // The ribbon sits across the board's top edge, turned about its middle so it lands where it stands.
    ribbon.pivot.set(rw / 2, rh / 2);
    ribbon.position.set(W / 2, rh / 2);
    root.addChild(board.root, ribbon);
    return { root, ribbon, face: board.face, levels, w: W, h: top + ph + m.S, ribbonH: rh };
  }

  // ---------------------------------------------------------------------------------------------

  private turnGeometry() {
    if (this.battle.finale) return null;
    if (this.sideQueue) return this.sideQueueGeometry();
    const b = this.battle;
    const u = this.u;
    const p = this.g.layout.panel;
    const small = this.smallPhone;
    const rule = this.tier.geo.rule;
    const pad = Math.max(9, Math.round(u * 0.55));
    const gap = Math.max(10, Math.round(u * 0.7));
    // Across the panel behind the command list, or left of its slot, where the rule ends, beside it.
    const room = (this.stripBehind ? p.w : rule.x1) - u * 2;
    // Portraits need not grow with text. Keep at least three on small phones even at enlarged text.
    const icon = Math.min(Math.round(u * 2.2), small ? Math.max(12, Math.min(32, Math.floor((room - pad * 2 - gap * 2) / 3))) : Infinity);
    const count = Math.max(1, Math.min(7, Math.floor((room - pad * 2 + gap) / (icon + gap))));
    const width = b.turnForecast(count).length * (icon + gap) - gap + pad * 2;
    const height = this.turnH;
    // Over the cards, near the commands and the members they are for: on a tall screen at the left, on the rule; on a
    // wide one in the middle of the screen, a little above the rule, and short of the command list's slot, so the
    // eye travels less between it and the commands (the owner, 2026-10-15).
    const x = Math.round(this.stripBehind ? u * 0.5 : Math.max(u * 0.5, Math.min((p.w - width) / 2, rule.x1 - u * 0.5 - width)));
    const y = Math.round(rule.y1 - height - measures(u).S - this.stripLift);
    return { x, y, width, height, count, icon, pad, gap, compact: false };
  }

  /** The command list's left edge with the glove on any of its rows, from the layout. */
  private commandLeft = 0;

  /** The side column's usual smallest faces: the size at which the smallest phone fits six beside the list. Tighter screens go down to SIDE_QUEUE_FLOOR. */
  private get sideQueueLeast(): number { return Math.min(32, Math.round(this.u * 1.7)); }

  /**
   * The side column for a face size: its left edge a few pixels in from the screen's (never left of the panel, so in
   * the arcade view it lines up with the cards), its padding and clock growing a little with the faces.
   */
  private sideQueueBox(icon = this.sideQueueLeast) {
    const edges = this.g.screenEdges?.() ?? this.g.battleHeaderBounds!();
    const pad = Math.max(4, Math.round(icon * 0.18)), meter = Math.max(8, Math.round(icon * 0.25));
    return { x: Math.max(0, Math.round(edges.x + 3)), width: icon + pad * 2 + meter + 4, icon, pad, gap: pad };
  }

  /**
   * The side column's faces for the room beside the list: as large as fit beside it and, on a taller phone, above it
   * too, up to three and a half units; six of them if they fit, else five, else as many of the smallest as fit. Below the
   * usual smallest size only where nothing else fits beside the command list.
   */
  private sideQueuePick(room: number) {
    const u = this.u, foot = this.tier.geo.actionSlot.y, listTop = foot - this.commandH;
    // On a taller phone the column may rise above the list into height the fight does not need.
    const ceiling = this.roomyUpright ? Math.min(listTop, this.fightTop() + this.fightLeast + measures(u).S + u * 0.4) : listTop;
    const tall = (icon: number, pad: number, n: number) => n * (icon + pad) + pad;
    // The usual sizes first, six faces or five; only a screen with no room for those goes below them, toward SIDE_QUEUE_FLOOR.
    const least = this.sideQueueLeast;
    for (const [top, bottom] of [[Math.round(u * 3.5), least], [least - 1, SIDE_QUEUE_FLOOR]] as const) {
      for (const n of [6, 5]) {
        for (let icon = top; icon >= bottom; icon--) {
          const box = this.sideQueueBox(icon);
          if (box.x + box.width <= room && tall(icon, box.pad, n) <= foot - ceiling) return { box, count: n };
        }
      }
    }
    const box = this.sideQueueBox(SIDE_QUEUE_FLOOR);
    return { box, count: Math.max(1, Math.min(6, Math.floor((foot - ceiling - box.pad) / (box.icon + box.gap)))) };
  }

  /** Standing on the rule just left of the command list, the current turn at the top and the clock beside the faces. */
  private sideQueueGeometry() {
    const { box: { x, width, icon, pad, gap }, count } = this.sideQueuePick(this.commandLeft - this.u * 0.3);
    const height = this.battle.turnForecast(count).length * (icon + gap) - gap + pad * 2;
    return { x, y: Math.round(this.tier.geo.actionSlot.y - height), width, height, count, icon, pad, gap, compact: true };
  }

  private drawTurns(dt: number): void {
    this.ensureLayout();
    if (this.useHeader && this.pauseButton) {
      const at = this.pausePlacement(this.pauseButton);
      this.pauseButton.position.set(at.x, at.y);
      if (this.pauseCap) this.pauseCap.position.set(Math.round(at.x - this.pauseCap.width - this.u * 0.3),
        Math.round(at.y + ((this.pauseRest?.height ?? this.pauseButton.height) - this.pauseCap.height) / 2));
    }
    const geometry = this.turnGeometry();
    if (!geometry) {
      this.turnStrip.visible = false;
      this.turnNames = [];
      this.turnStripRect = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    const { x, y, width, height, count, icon, pad, gap, compact } = geometry;
    const b = this.battle, u = this.u;
    const forecast = b.turnForecast(count);
    const turns = forecast.map(entry => entry.who);
    this.turnStripRect = { x, y, w: width, h: height };
    this.turnStrip.position.set(x, y);
    this.turnStrip.visible = b.phase === 'active' && !this.hudHidden;
    // The queue sits last in the header on an upright screen, except under a list too wide to stand beside it, which opens in
    // front of it (the owner, 2026-11-06); elsewhere the strip goes directly before the menu, or last when there is no menu. The
    // header is aligned with the panel, so the column keeps its place in either. Moved only when that is not so: Pixi rebuilds
    // the whole stage's draw list for every addChild, even of a child already in place.
    if (this.sideQueue && !(this.menuWide && this.menu)) {
      if (this.header.children[this.header.children.length - 1] !== this.turnStrip) this.header.addChild(this.turnStrip);
    } else if (this.menu) {
      const at = this.container.children.indexOf(this.menu.container);
      if (this.container.children[at - 1] !== this.turnStrip) {
        this.container.addChild(this.turnStrip);
        this.container.setChildIndex(this.turnStrip, this.container.getChildIndex(this.menu.container));
      }
    } else if (this.container.children[this.container.children.length - 1] !== this.turnStrip) this.container.addChild(this.turnStrip);
    const current = b.bossInterrupting ? null : b.currentTurn;
    this.turnNames = turns.map(f => f.name);
    // Lists over the queue let it show through, so the decision bar can keep its
    // full width instead of shrinking to the sliver left beside the menu. A column's clock stands beside the faces, as thick as it leaves.
    const meterWidth = this.sideQueue ? width - icon - pad * 2 - 4 : Math.max(16, width - pad * 2);
    const blastAt = forecast.findIndex(entry => entry.who === b.blastDue);
    this.turnsView.draw(forecast.map(({ who: f, at }, i) => ({
      key: `${b.fighters.indexOf(f)}@${at}`, look: f.actor.look, enemy: f.side === 'enemy', active: i === 0 && f === current, danger: i === blastAt,
    })), { u, icon, pad, gap, width, height, compact, meterWidth, dt, time: this.g.time,
      fraction: b.deciding ? b.decisionLeft / b.decisionSeconds : null,
      urgent: b.decisionUrgent, vertical: this.sideQueue,
      // While the member's own lists are open, as the cyan corners round their figure.
      choosing: (this.mode === 'command' || this.mode === 'special' || this.mode === 'item') && !!this.active && this.active === current,
    });
  }

  /**
   * The Warsaw finale's placard: the fuse's seconds as they burn. The fight's update draws it, and the game draws it under a
   * page too, where the fuse burns on (the owner, 2026-11-11: there is no way to stop the timer).
   */
  drawFinaleClock(): void {
    const g = this.g;
    const boss = this.battle.enemies.find((e) => e.countdown !== null && e.hp > 0);
    const finale = this.battle.finale;
    const aftermath = this.nukeShown && this.nukeShown.stage !== 'targeting';
    if (!boss || !finale || this.battle.phase !== 'active' || aftermath) {
      this.finaleClock.container.visible = false;
      return;
    }
    this.finaleClock.container.visible = true;
    const overpowered = !finale.timed;
    // The pellet grants more real time without advertising a larger countdown.
    const shownMax = finale.route === 'pellet' ? (boss.enemy?.countdown ?? boss.countdownMax) : boss.countdownMax;
    const shownLeft = boss.countdown! * shownMax / boss.countdownMax;
    this.finaleClock.draw(this.countdownRect(), this.u, shownLeft, shownMax, g.time,
      g.msg('battle', overpowered ? 'finale_overpowered' : this.battle.bossInterrupting ? 'nuke_locked' : 'nuke_countdown'), overpowered,
      this.battle.bossInterrupting && !overpowered, this.shortUpright);
  }

  update(dt: number): void {
    clearIfInked(this.hoverCursor);
    this.targetMarks = [];
    const g = this.g;
    const w = this.battle.world;
    this.header.visible = this.container.visible;
    if (this.pauseButton) this.pauseButton.visible = this.battle.phase === 'active' || this.battle.phase === 'intro';
    if (this.pauseCap) this.pauseCap.visible = this.pauseButton?.visible ?? false;
    // The member cards: who is acting, who is chosen, and who an item cannot help.
    const listOpen = this.mode === 'command' || this.mode === 'special' || this.mode === 'item';
    this.tier.update(this.tierView());
    this.drawTurns(dt);
    this.drawDizzy(dt);
    // Floating numbers: each pops in (half size, past full, then full) in 160 ms, rises a little, and fades
    // over its last quarter second. With reduced motion it sits at full size where it lands, above any
    // number still showing on the same figure, and fades.
    for (const p of [...this.popups]) {
      p.text.visible = !p.actor.hidden;
      p.age += dt;
      const [sx, sy] = w.worldToPanel(p.actor.x, p.actor.y, p.actor.size * p.headroom);
      const pop = MS.numberPop / 1000;
      if (motion.reduced) {
        p.text.scale.set(1);
        p.text.position.set(sx, sy - p.h / 2 - p.lift);
        p.text.alpha = p.age > 0.8 ? Math.max(0, 1 - (p.age - 0.8) / 0.3) : 1;
      } else {
        p.text.scale.set(0.5 + 0.5 * EASE.pop(Math.min(1, p.age / pop)));
        const up = p.age > pop ? EASE.out(Math.min(1, (p.age - pop) / 0.7)) * this.u * 0.6 : 0;
        p.rise = up;
        p.text.position.set(sx, sy - p.h / 2 - p.lift - up);
        p.text.alpha = p.age > 0.85 ? Math.max(0, 1 - (p.age - 0.85) / 0.25) : 1;
      }
      if (p.age > 1.1) {
        p.text.destroy({ children: true });
        this.popups.splice(this.popups.indexOf(p), 1);
      }
    }
    // The Warsaw finale's placard.
    this.drawFinaleClock();

    if (this.battle.phase !== 'active') {
      if (this.mode !== 'idle') {
        this.mode = 'idle';
        this.closeMenu();
      }
      clearIfInked(this.cursor);
      this.cursorAt = null;
      this.placeFocus(null);
      this.targetMarks = [];
      return;
    }

    // Who gets the menu: the member chosen by the player, or whoever became ready first.
    if (!this.active || !this.battle.isReady(this.active)) {
      const ready = this.readyInTurn();
      if (ready.length) {
        this.setActive(ready[0]!);
        // A member's turn has just begun: the chime, a step higher for each member (the owner's pick, 2026-11-02).
        g.audio.play('turn', [1, 2 ** (2 / 12), 2 ** (5 / 12)][Math.max(0, this.battle.party.indexOf(ready[0]!))]);
      } else if (this.mode !== 'idle') {
        this.active = null;
        this.mode = 'idle';
        this.closeMenu();
      }
    }
    // Left and right switch between members who are ready, from the command menu or its lists (not
    // while a target is chosen, where they move the cursor). The panel stays where it is.
    if (listOpen && (g.input.pressed('left') || g.input.pressed('right'))) {
      const ready = this.battle.readyMembers();
      if (ready.length > 1 && this.active) {
        const i = ready.indexOf(this.active);
        const next = ready[(i + (g.input.pressed('right') ? 1 : ready.length - 1)) % ready.length]!;
        g.audio.play('blip');
        this.setActive(next, { paste: false });
      }
    }
    // With more than one member ready, the command panel's tab says so; its words change in place.
    if (listOpen && this.menu && this.active) {
      const title = this.commandTitle(this.active);
      if (this.menu.title !== title) this.menu.setTab(title);
    }

    this.actorMark = null;
    if (!this.choosing()) this.placeFocus(null);
    // The member acting gets cyan brackets while their menus are open, distinct from the red and yellow target brackets.
    // They are all the layer holds in these modes (a target's marks are drawn in the target modes, which are not these), so when
    // they have not moved they stay as drawn: a Graphics cleared and drawn again, even to the same picture, makes Pixi rebuild the
    // whole stage's draw list. Any other step draws the layer afresh.
    if ((this.mode === 'command' || this.mode === 'special' || this.mode === 'item') && this.active) {
      const a = this.active.actor;
      const [sx, sy] = w.worldToPanel(a.x, a.y, a.size);
      const r = a.size * w.zoom * 1.25;
      const at = this.cursorAt;
      if (!(at && at[0] === sx && at[1] === sy && at[2] === r)) {
        this.cursor.clear();
        brackets(this.cursor, sx - r, sy - r, r * 2, r * 2, r * 0.4, POP_CYAN, 2.5, PAPER);
      }
      this.cursorAt = [sx, sy, r];
      this.actorMark = { x: sx - r, y: sy - r, w: r * 2, h: r * 2 };
    } else {
      clearIfInked(this.cursor);
      this.cursorAt = null;
    }
    // Hover offers the same direct attack as a click, without changing the command row or playing a sound.
    // Recheck the pointer each frame so moving figures, menu bounds and a new turn cannot leave a stale mark.
    if (this.mode === 'command' && this.menu && this.active && this.battle.isReady(this.active) && this.hoverPoint && !g.screensOpen()) {
      const { x, y } = this.hoverPoint;
      const enemy = this.nearInterface(x, y) ? null : this.figureAt(this.battle.livingEnemies(), x, y);
      if (enemy) this.markTarget(enemy, this.hoverCursor);
    }
    if (this.choosing()) {
      const list = this.targets();
      if (!list.length) {
        this.target = null;
      }
      if (this.mode !== 'target_all' && list.length) {
        // The cursor stays on the same figure while others fall; if its own target falls, it moves to the nearest.
        if (!this.target || !list.includes(this.target)) this.target = this.target ? nearest(list, this.target.actor) : list[0]!;
        // Left and right choose by screen position. Up and down follow the menu, including Back.
        const dir = (['right', 'left'] as const).find((d) => g.input.pressedOrRepeat(d));
        if (dir) {
          const next = list[stepTarget(list.map((f) => w.worldToPanel(f.actor.x, f.actor.y, f.actor.size)), list.indexOf(this.target), dir, this.u)]!;
          if (next !== this.target) {
            this.target = next;
            g.audio.play('blip');
          }
          this.selectTargetRow();
        }
      }
      // The list shows what changes while it is open (an enemy falls, someone is hurt), in place when it can.
      const rows = this.targetRows(this.mode, this.pending);
      const key = listKey(rows.items, rows.title);
      if (key !== this.listKey) {
        this.listKey = key;
        this.rowFighters = rows.fighters;
        if (!this.menu?.refresh(rows.items, undefined, rows.title)) this.openTargets();
        else this.menu.select(enabledMenuIndex(rows.items, this.menu.index));
      }
      // A newly usable row under the pointer must not silently change Enter's recipient. Keep the
      // selected usable row on the bracketed target; Back and greyed rows may still hold the cursor.
      const selected = this.menu ? this.rowFighters[this.menu.index] : null;
      if (this.target !== this.shownTarget || (selected && selected !== this.target && this.menu?.items[this.menu.index]?.enabled !== false)) this.selectTargetRow();
      // A move on a whole side marks each figure on it, and the side as a whole. On touch, only while the band is on the target's row.
      const shown = this.marksShown();
      for (const t of !shown ? [] : this.mode === 'target_all' ? list : this.target ? [this.target] : []) this.markTarget(t);
      if (this.mode === 'target_all' && this.targetMarks.length) {
        const pad = this.u * 0.5;
        const x0 = Math.min(...this.targetMarks.map((r) => r.x)) - pad;
        const y0 = Math.min(...this.targetMarks.map((r) => r.y)) - pad;
        const x1 = Math.max(...this.targetMarks.map((r) => r.x + r.w)) + pad;
        const y1 = Math.max(...this.targetMarks.map((r) => r.y + r.h)) + pad;
        if (list[0]!.side === 'party') brackets(this.cursor, x0, y0, x1 - x0, y1 - y0, this.u * 1.2, this.allyMark(list[0]!), 3.5, INK);
        else fieldBrackets(this.cursor, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, this.u * 1.2, 3, this.markAge(list[0]!), motion.reduced, RED_INK, POP_YELLOW, PAPER);
        this.targetMarks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      // One target: still lines about it, drawn when the target changes, and only moved with it.
      this.placeFocus(this.mode === 'target_all' || !shown ? null : this.target);
      // The menu handles Up/Down, confirm and cancel for every targeting mode, including whole-side moves.
      if (this.menu) this.menu.update(g.input);
      else if (g.input.pressed('confirm') && list.length) this.chooseTarget(this.target ?? list[0]!);
      else if (g.input.pressed('cancel')) this.back();
      return;
    }
    // A list open while what it shows changes (an Ether lands, an item comes back, someone is hurt) shows
    // the change, in place when it can, so a finger already on a row still taps it.
    if ((this.mode === 'special' || this.mode === 'item') && this.menu) {
      const rows = this.mode === 'special' ? this.specialRows(this.active!) : this.itemRows();
      const key = listKey(rows.items, rows.title);
      if (key !== this.listKey) {
        this.listKey = key;
        if (!this.menu.refresh(rows.items, undefined, rows.title)) {
          // Rows came or went (an item came back to the bag): the cursor stays on what it was on, the Back row included.
          const was = this.menu.items[this.menu.index]?.id;
          const found = rows.items.findIndex((i) => i.id === was);
          const index = found >= 0 ? found : Math.min(this.menu.index, rows.items.length - 1);
          if (this.mode === 'special') this.openSpecial({ quiet: true, index });
          else this.openItems({ quiet: true, index });
        } else this.menu.select(enabledMenuIndex(rows.items, this.menu.index));
      }
    }
    this.menu?.update(g.input);
    this.placeSwitchCaps();
  }

  /**
   * The focus lines about a single target: twelve short strokes in a ring, ink on printed ground and
   * paper on the arcade floor. Drawn when the target changes (closing in from a little wider), and only
   * moved while it stays; hidden when there is no single target.
   */
  private placeFocus(t: Fighter | null): void {
    const g = this.focusG;
    if (!t || t.side === 'party') {
      g.visible = false;
      this.focusFor = null;
      return;
    }
    const w = this.battle.world;
    const m = this.targetRect(t);
    const sx = m.x + m.w / 2, sy = m.y + m.h / 2;
    if (t !== this.focusFor) {
      anim.finish(g);
      g.position.set(sx, sy);
      this.focusFor = t;
      this.focusBuilds++;
      const r = t.actor.size * w.zoom;
      const colour = w.world === 'arcade' ? { color: PAPER, alpha: 0.6 } : { color: INK, alpha: 0.3 };
      g.clear();
      // From just outside the brackets, out by about the figure's own size.
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
        const cos = Math.cos(a), sin = Math.sin(a);
        g.moveTo(cos * (m.w / 2 + r * 0.1), sin * (m.h / 2 + r * 0.1)).lineTo(cos * (m.w / 2 + r * 1.1), sin * (m.h / 2 + r * 1.1));
      }
      g.stroke({ width: Math.max(1.5, this.u * 0.1) * this.targetLine(m) / 3, ...colour, cap: 'round' });
      g.scale.set(1);
      anim.play(g, g, { scale: 1.25 }, 90, EASE.out);
    }
    // Moved with its target; the motion only scales it.
    if (!anim.busy(g)) g.position.set(sx, sy);
    g.visible = true;
  }

  /** How the member cards should look now: who is acting, who is chosen, and who an item cannot help. */
  private tierView() {
    const item = this.mode === 'target_member' && this.pending?.kind === 'item' ? this.g.content.items[this.pending.id] : null;
    const change = item && this.target ? previewItem(item, vitals(this.target))[0] : null;
    const shown = this.marksShown();
    return {
      itemPreview: shown && item && change && this.target ? { target: this.target, change, revive: !!item.revive } : null,
      acting: this.battle.currentTurn,
      deciding: this.battle.deciding,
      marked: (f: Fighter) => shown && (this.mode === 'target_member' ? f === this.target : this.mode === 'target_all' && this.areaOnParty()),
      out: (f: Fighter) => this.mode === 'target_member' && !this.targets().includes(f),
    };
  }

  relayout(): void {
    // A new size measures the panels again and lines the fight up for the new shape.
    this.focusFor = null;
    this.layoutFight();
    // The cards are made again: drawn at once, since a page over the fight stops its own updates.
    this.tier.update(this.tierView(), true);
    // The turn strip too, which stands on the cards' rule.
    this.drawTurns(0);
    this.battle.reshape();
    if (this.container.visible) this.placePause();
    // A list open is made again at the new size, on the same row, without being pressed on again.
    const index = this.menu?.index ?? 0;
    if (this.mode === 'command') this.openCommand({ paste: false, index });
    else if (this.mode === 'special') this.openSpecial({ quiet: true, index });
    else if (this.mode === 'item') this.openItems({ quiet: true, index });
    else if (this.choosing()) this.openTargets();
    // The victory box is fitted to the new panel, at rest, and stays over everything else.
    if (this.victoryUp) this.placeVictory();
    // A special's splash is drawn again for the new panel, at the same moment of its motion.
    if (this.cutUp) {
      // The call for help's slip of pictures is kept through a resize or a text-size change (Fable review P12).
      const { f, name, groups } = this.cutUp;
      this.cutUp.root.destroy({ children: true });
      this.buildCutIn(f, name, groups);
      this.poseCutIn(this.cutInShown?.age ?? 0);
    }
  }

  /**
   * A lost fight: its cards stay up over the fallen party while the game-over sound plays, with no menu, as nobody is left to
   * choose (the owner, 2026-11-04), and take no more taps. The game takes them down once the defeat page has its choice.
   */
  settleLost(): void {
    this.closeMenu();
    this.container.eventMode = 'none';
    this.header.eventMode = 'none';
  }

  destroy(): void {
    // Game Over can stop world tasks immediately, before a trail gets its next fade step.
    for (const end of this.speedCleanups) end();
    this.closeMenu();
    anim.finish(this);
    anim.finish(this.focusG);
    this.tier.destroy();
    this.clearDizzy();
    for (const p of this.popups) p.text.destroy({ children: true });
    this.header.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}

