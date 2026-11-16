import { Application, Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent, type Texture } from 'pixi.js';
import { FONT } from '../render/fonts.ts';
import { dirVector, type Dir } from '../art/geom.ts';
import { artForGroup, artForMap, artProgress, artReady, onArtFailed, prefetchArt, whenArtReady } from '../art/images.ts';
import { CHAPTER_PICTURE } from '../art/pictures.ts';
import { CreditsScreen } from '../ui/credits.ts';
import { AudioSystem } from '../audio/audio.ts';
import { Battle } from '../battle/battle.ts';
import { battleMusic } from '../battle/fightMusic.ts';
import { freeSpot } from '../battle/formation.ts';
import { hashSeed, mulberry32 } from '../battle/formula.ts';
import type { Content } from '../content/content.ts';
import { TILE } from '../content/terrain.ts';
import { Input } from '../engine/input.ts';
import { computeLayout, overlayLayout, expandedPanel, readSafeInsets, viewportSize, type Insets, type Layout, type Rect } from '../engine/layout.ts';
import { chooseTurn, readingIsFresh, readScreen, rootPlacement, screenTurn, turnInsets, uprightSize, type Turn } from '../engine/turn.ts';
import { FixedLoop } from '../engine/loop.ts';
import { ViewLift } from '../render/viewLift.ts';
import { HalftoneFilter, PRINT } from '../render/halftone.ts';
import { INK, PAPER } from '../render/palette.ts';
import { Dialogue } from '../story/dialogue.ts';
import { Story, type SceneOptions } from '../story/story.ts';
import { ControlsScreen } from '../ui/controls.ts';
import { PartyMenu } from '../ui/partyMenu.ts';
import { SaveCodeIn, SaveCodeOut } from '../ui/saveCode.ts';
import { ConfirmScreen, finGround, Hud, PauseScreen, SettingsScreen, type Screen } from '../ui/screens.ts';
import { SoundMark } from '../ui/soundMark.ts';
import { releaseWatch } from '../release_check.ts';
import { AchievementDetails, AchievementsScreen, AchievementToast } from '../ui/achievements.ts';
import { earned, hundredList, loadProgress, saveProgress, type AchievementId, type Progress } from './achievements.ts';
import { TallPage } from '../ui/tallPage.ts';
import { endingCaptionSlot } from '../ui/balloon.ts';
import { MosaicFilter } from '../render/mosaic.ts';
import { forgetFilterInput } from '../render/filter_slots.ts';
import { Shop } from '../ui/shop.ts';
import type { MenuItem, MenuPlace } from '../ui/widgets.ts';
import type { Actor } from '../world/actor.ts';
import { WALK, World } from '../world/world.ts';
import { isIsoScene } from '../world/iso_scenes.ts';
import { PATROL_FIGHT_GRACE } from '../world/patrol.ts';
import type { BattleOutcome, LogEntry, DevFlags, GameContext } from './context.ts';
import { loadSettings, TEXT_SIZES, type Settings } from './settings.ts';
import { TitleMap, type TitleLanding } from '../ui/titleMap.ts';
import { DIVE_S } from '../audio/diveTiming.ts';
import { GAME_OVER_S } from '../audio/gameOverTiming.ts';
import { checkState, hasSave, keepUnreadableSave, loadGame, newGame, powerPellets, requirementsMet, saveExists, saveGame, type GameState } from './state.ts';
import { density } from '../render/density.ts';
import { EASE, motion, MS } from '../render/motion.ts';
import { anim } from '../ui/anim.ts';
import { SidewaysCard } from '../ui/sideways.ts';
import { hideLoader, loaderArtProgress, loaderShowing, showLoader } from '../ui/loader.ts';
import { saveSummary } from './saveSummary.ts';
import { LOG_SIZE, LogScreen } from '../ui/log.ts';
import { showStopped } from '../ui/stopped.ts';

/**
 * The pace of the view's narrowing back to the arcade's at the ending, from when the ending music comes in: the seconds
 * its S-curve would take (the owner kept 8, 2026-10-20). Past the middle it closes in ever more slowly, and the map's
 * breaking up for the credits brings it in.
 */
export const ENDING_NARROW_SECONDS = 8;
/**
 * The least the rest of the ending's narrowing takes once the map breaks up for the credits, so the view arrives after
 * the first page has spun in (about 0.85 s on) and not before (the owner, 2026-11-13).
 */
const ENDING_LAND_MIN_S = 1.5;

/** The flashback mosaic's timing: steps out and back, each step's length, and the largest block in CSS pixels (the owner's values from the slider page, 2026-10-19). */
export const MOSAIC = { out: 9, back: 18, stepMs: 50, largest: 96 };

/** The longest leaving the map title waits for its music (`playUnderTitle`): with no sound, or a render that never comes. */
const TITLE_MUSIC_WAIT_S = 3;
/** The breath between the game-over sound's end and the defeat page sliding in. */
const PAPER_AFTER_SOUND_S = 0.12;

/**
 * The REDUCED MOTION marker blinks as it comes on (the owner, 2026-10-27): MARK_BLINKS blinks of MARK_BLINK_S each, then it
 * holds steady and blinks again MARK_REST_S later. The owner asked for that rest to be X + 10 s, X being the pause after
 * which blinking counts as new rather than going on; no rule Claude knows defines X, so 5 s (WCAG's window) stands in.
 * It blinks from its red to a slightly brighter red rather than off and on, eased (the owner, 2026-10-28), so it always
 * says what it says; at the quarter of its first speed the owner chose ("quarter speed actually is a good speed to have it
 * at normally"), the three blinks take 18 s, longer than the five seconds WCAG 2.2.2 allows blinking without a way to pause it.
 */
const MARK_BLINK_S = 6, MARK_BLINKS = 3, MARK_REST_S = 5 + 10;
/** The bright red is about 40% of the way from the red to the first bright red (0xff5c6a at 0.95): "the blink is there but subtle". */
const MARK_RED = 0xff2b3d, MARK_RED_ALPHA = 0.6, MARK_BRIGHT = 0xff3f4f, MARK_BRIGHT_ALPHA = 0.74;
/** Each change between the reds eases over this long (the owner, 2026-10-28: "not a gradual ease, but something less jarring than the immediate flip", then a quarter of the speed). */
const MARK_EASE_S = 0.6;
/**
 * A white outline round the letters, under their fill, at the titles' outline weight (the owner, 2026-10-28, from a
 * comparison with no outline and a black one: "white outline looks best"). A tint would turn the outline red too, so the
 * fill takes the red itself, in this many steps between the two reds, and the letters are drawn again only on a step.
 */
const MARK_OUTLINE = 0xffffff, MARK_COLOUR_STEPS = 8;
const markOutline = (size: number) => Math.max(2, Math.round(size * 0.13));
/** A colour `k` of the way from `a` to `b`, channel by channel. */
const mixColour = (a: number, b: number, k: number) => [16, 8, 0].reduce((c, sh) => c | Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k) << sh, 0);
/**
 * The marker is always the Large text size's, whatever the player's text size (the owner, 2026-10-28); on a screen up to
 * the widest phone's upright width it is made as large as fills the width instead. Phones lay out upright even when
 * turned (uprightSize), so a sideways phone gets the same size as upright.
 */
const MARK_PHONE_W = 440;
/**
 * Larger than a phone, the marker keeps the proportion it has on a 1440x900 desktop, growing with the screen by whichever
 * of width or height grows less (the owner, 2026-10-28: on 2560x1440 it looked far smaller than on the desktop), and
 * never below the Large text size's, so a window between a phone's and the desktop's keeps the size it had.
 */
const MARK_DESKTOP_W = 1440, MARK_DESKTOP_H = 900;
const MARK_DESKTOP_FONT = Math.round(computeLayout(MARK_DESKTOP_W, MARK_DESKTOP_H, undefined, TEXT_SIZES.at(-1)).unit * 1.98);

/** Block sizes for the mosaic, growing by an even factor each step (as the old games doubled): out ends at the largest, back ends sharp. */
export function mosaicSteps(way: 'out' | 'in'): number[] {
  const n = way === 'out' ? MOSAIC.out : MOSAIC.back;
  const size = (k: number) => Math.max(1, Math.round(MOSAIC.largest ** k));
  return way === 'out' ? Array.from({ length: n }, (_, i) => size((i + 1) / n)) : Array.from({ length: n }, (_, i) => size((n - 1 - i) / n));
}

/**
 * The game as a whole: the stage, the loop, the current map, scripts, fights,
 * menus, and front pages.
 */
export class Game implements GameContext {
  readonly app: Application;
  content: Content;
  state: GameState;
  readonly input = new Input();
  readonly settings: Settings = loadSettings();
  readonly audio: AudioSystem;
  layout: Layout = computeLayout(1, 1);
  time = 0;
  world: World | null = null;
  readonly dev: DevFlags = { enabled: false, overlay: false, noclip: false, god: false, peace: false, fastText: false };
  readonly dialogue: Dialogue;
  readonly story: Story;
  readonly loop: FixedLoop;
  /** How far the view has opened out of the arcade's centred view toward the whole screen (the printed world). */
  readonly viewLift = new ViewLift();
  readonly halftone: HalftoneFilter;
  battle: Battle | null = null;

  /** Everything drawn: turned as a whole on a phone held sideways or upside down, so the game stays upright against the phone. */
  readonly root = new Container();
  /** The turn undone now, and when the phone last turned (a reading just after may be stale). */
  turn: Turn = 0;
  private turnedAt = -Infinity;
  /** The page's size when the phone last turned, to tell when the page has caught up with the turn. */
  private sizeAtTurn: [number, number] | null = null;
  /** Whether the last layout was turned on a guess, because the screen's angle did not fit the page's shape. */
  turnUnsure = false;
  /** While a phone is held sideways, the game is paused under this card, which asks for it to be turned upright. */
  sidewaysCard: SidewaysCard | null = null;
  readonly panel = new Container();
  /** Presentation-only scale: maps, menus and their masks keep the same logical panel coordinates. */
  private readonly viewport = new Container();
  private readonly viewportMatte = new Graphics();
  get renderResolution(): number { return this.app.renderer.resolution; }
  get viewportScale(): number { return this.viewport.scale.x; }
  private safeInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly panelMask = new Graphics();
  private readonly backdrop = new Graphics();
  readonly worldLayer = new Container();
  readonly uiLayer = new Container();
  /** Aligned with the panel, but outside its mask so battle controls can use the black letterbox. */
  readonly battleHeaderLayer = new Container();
  /** Aligned with the panel like the battle header and outside its mask: the Stats/Item button and its key cap, which on an
   * upright phone sit in the screen's corner, below the panel where there is room (the owner, 2026-10-27). Shown with the interface. */
  readonly hudEdgeLayer = new Container();
  readonly titleLayer = new Container();
  private readonly tapCatcher = new Graphics();
  readonly screenLayer = new Container();
  /** Full-screen modal pages cover world dialogue; a paused fight keeps that exact line ready for Resume.
   * Their printed scale is fixed, independent of the map's letterbox and lift. */
  readonly pageLayer = new Container();
  private readonly pageMask = new Graphics();
  private pageLayout: Layout = this.layout;
  /** Newspapers reach the safe screen edges; other modal pages retain their printed margin. */
  readonly newspaperLayer = new Container();
  private readonly newspaperMask = new Graphics();
  private newspaperLayout: Layout = this.layout;
  private readonly pageGame: GameContext = new Proxy(this, {
    get: (game, key) => {
      if (key === 'layout') return this.pageLayout;
      if (key === 'panelToPage') return (x: number, y: number) => this.pagePoint(x, y);
      if (key === 'panelRectToPage') return (x: number, y: number, w: number, h: number) => {
        const [ax, ay] = this.pagePoint(x, y), [bx, by] = this.pagePoint(x + w, y + h);
        return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
      };
      const value = Reflect.get(game, key, game);
      // Bind the current method: developer checks may replace a method while a page stays open.
      return typeof value === 'function' ? value.bind(game) : value;
    },
  });
  private readonly newspaperGame: GameContext = new Proxy(this.pageGame, {
    get: (game, key) => key === 'layout' ? this.newspaperLayout : Reflect.get(game, key),
  });
  readonly dialogueLayer = new Container();
  /** Achievements' notifications, over everything in the panel. */
  readonly toastLayer = new Container();
  readonly devLayer = new Container();
  /** "REDUCED MOTION" in the screen's bottom left while that setting is on (the owner, 2026-10-26: "some red translucent
   * text in the bottom left ... that overlaps a little if necessary"), over everything, so a still title is not taken for a hang. */
  /** When the marker last came on, on the game clock, or -1 while it is off. */
  private reducedMarkOn = -1;
  /** The marker's baseline at the screen's foot, and its margin, from the last layout. */
  private reducedMarkFoot = 0;
  private reducedMarkEdge = 0;
  private readonly reducedMark = new Text({ text: '', style: { fontFamily: FONT.letter, fill: MARK_RED, letterSpacing: 1 } });
  private reducedMarkColour = MARK_RED;
  readonly hud: Hud;
  /** Recent lines and fight results, for the log page: this visit only, never saved. */
  readonly log: LogEntry[] = [];
  /** Where lists were left this visit, by name (`menuPlace`). */
  private readonly menuPlaces = new Map<string, MenuPlace>();
  /** Every line of the latest fight, uncut, for fightLog() in the browser's console (the log keeps only the last few). */
  fightTranscript: string[] = [];
  /** How many times everything has been laid out, for the browser checks. */
  relayouts = 0;
  /** Set once a game step has thrown (see halt): nothing more is stepped, drawn or saved this visit. */
  halted = false;
  private screens: Screen[] = [];
  private delays: Array<{ t: number; resolve: () => void }> = [];
  private transitioning = false;
  private holding = false;
  private holdTimer = 0;
  private holdPos: [number, number] = [0, 0];
  private holdSteered = false;
  private picture: TallPage | null = null;
  /** Lands the ending page still sliding in, so the one under it goes now. */
  private pictureLanding: (() => void) | null = null;
  /** Set while play waits on the loading page for the rest of the art (`playUnderTitle`). */
  private waitingForArt = false;
  /** Set while leaving the map title waits for its music to be ready (`playUnderTitle`). */
  private waitingForTitleMusic = false;
  private title: TitleMap | null = null;
  /** While a map is entered under the leaving map title: how its music takes over from the title's song. */
  private titleMusic: { fadeOut: number; startAfter: number; close?: boolean } | { mosaic: true; music?: string } | null = null;
  /** The arcade's view holds while the title leaves; the room and dialogue stay at their final size. */
  private arcadeIntro = false;
  /** Border motion continues alongside dialogue after the central title page has left. */
  private titleFrameExit: { age: number; seconds: number } | null = null;
  private arcadeIntroSeconds = 0.4;
  /** The view narrowing back to the arcade's at the ending; it stays through the pictures, credits and FIN. */
  private arcadeBack = false;
  /** How long the view takes to narrow back to the arcade's at the ending: slowly, from when the ending music comes in. */
  private arcadeBackSeconds = 2;
  /** Seconds until the ending's slow narrowing starts, once the ending music is on its way. */
  private endingNarrow: number | null = null;
  /** `returnToArcade`'s wait for the arcade's view to be back. */
  private arcadeReturn: Promise<void> | null = null;
  private arcadeLanded: (() => void) | null = null;
  private playing = false;
  /** Fights in progress, counting the defeat page and the scene after a win. */
  private fights = 0;
  /** Before an outer scene moves the party or sets encounter flags. Used if its fight is lost. */
  private sceneReturn: { world: World; state: GameState } | null = null;
  /** Promises waiting on a screen (a shop, a front page), settled whenever that screen goes. */
  private screenWaits = new Map<Screen, () => void>();
  private storyWasBusy = false;
  /** Hooks for the dev tools. */
  onUpdate: Array<(dt: number) => void> = [];
  onRender: Array<() => void> = [];

  /**
   * The run's seed, from which every random number that changes play is drawn (each fight's, each map's):
   * the address's `?seed=` for a run that must play out the same again, otherwise random.
   */
  readonly runSeed: number;
  /** Fights started and maps built in this run, numbering each one's stream of random numbers. */
  private battlesStarted = 0;
  private worldsBuilt = 0;

  /**
   * With `lockstep`, the game's loop starts paused and only a test driver steps it (tools/pilot.ts), so a
   * run counts its steps from a fixed start rather than from the clock.
   */
  constructor(app: Application, content: Content, opts: { seed?: number; lockstep?: boolean } = {}) {
    this.app = app;
    this.content = content;
    this.runSeed = opts.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!;
    this.state = newGame(content);
    // Every reader of reduced motion sees the setting as it is now, even mid-step.
    motion.bind(() => this.settings.reduceMotion);
    density.bind(() => this.settings.batterySaver);
    // Nothing pressed while the loading page is up reaches the game, the title behind it included.
    this.input.gate = () => loaderShowing();
    // Every speaker's typing pitch, and the one a speaker with no voice types at (Dialogue), rendered up front.
    this.audio = new AudioSystem(this.settings, [...new Set([...Object.values(content.characters).map((c) => c.voice), 400])]);
    this.audio.introProgress = (name) => this.musicProgress(name);
    // The sound failed for good: its mark shows, top left, until a reload (or a browser that refused sound lets it start).
    // A browser that refused sound did so as the sound was made, before this was listening.
    this.audio.onProblem = (p) => {
      this.soundMark.shown = p !== null;
      // The synthesizer's file may be one a newer release took off the site (src/release_check.ts); its worker is built into it.
      if (p === 'load') void releaseWatch.missing();
    };
    this.soundMark.shown = this.audio.problem !== null;
    // From now on a newer release found reloads on the loading page (`newerRelease`); before, main.ts reloaded.
    releaseWatch.listen((sha) => this.newerRelease(sha));
    // A picture that did not arrive, even tried again, leaves its hot pink box: the player is told why once the loading page
    // has gone (`askLoadingProblem`).
    onArtFailed(() => { this.loadingProblem ??= 'pending'; });
    if (this.settings.keys) this.input.setBindings(this.settings.keys);
    this.dialogue = new Dialogue(this);
    this.story = new Story(this);
    this.halftone = new HalftoneFilter({ dot: 3.6, resolution: app.renderer.resolution, paper: PAPER, strength: PRINT.strength });
    this.hud = new Hud(this);
    this.hud.onMenu = () => this.openPartyMenu();
    // Key caps follow the last device used; only the caps change, nothing is laid out again.
    this.input.onDeviceChange = () => this.refreshCaps();

    this.bindPanelPointer();

    this.uiLayer.addChild(this.hud.container);
    this.hudEdgeLayer.addChild(this.hud.edge);
    this.dialogueLayer.addChild(this.dialogue.container);
    this.panel.addChild(this.backdrop, this.worldLayer, this.tapCatcher, this.uiLayer, this.screenLayer, this.dialogueLayer, this.toastLayer, this.devLayer);
    this.panel.mask = this.panelMask;
    app.stage.addChild(this.root);
    this.viewport.addChild(this.panel, this.panelMask);
    // No cabinet round the screen any more: in play the view sits over black (the owner, 2026-10-19).
    this.root.addChild(this.viewportMatte, this.titleLayer, this.viewport, this.battleHeaderLayer, this.hudEdgeLayer,
      this.newspaperLayer, this.newspaperMask, this.pageLayer, this.pageMask, this.reducedMark, this.soundLayer);
    this.soundLayer.addChild(this.soundMark.container);
    this.reducedMark.text = this.msg('system', 'reduced_motion').toUpperCase();
    this.reducedMark.alpha = MARK_RED_ALPHA;
    this.reducedMark.eventMode = 'none';
    this.pageLayer.mask = this.pageMask;
    this.newspaperLayer.mask = this.newspaperMask;

    this.loop = new FixedLoop(
      (dt) => this.update(dt),
      () => this.render(),
    );
    this.lockstepBattleClock = Boolean(opts.lockstep);
    app.ticker.add((t) => {
      if (this.halted) return;
      try {
        // Full wall time, before input and independent of capped fixed-step catch-up.
        if (!this.lockstepBattleClock) this.battle?.updateAbsolute(performance.now() / 1000);
        this.loop.tick(t.deltaMS / 1000);
      } catch (err) {
        this.halt(err);
      }
    });
    if (opts.lockstep) {
      this.loop.paused = true;
      this.input.gamepads = false;
    }
  }

  private bindPanelPointer(): void {
    const onDeviceChange = this.input.onDeviceChange;
    this.input.onDeviceChange = device => {
      onDeviceChange?.(device);
      this.world?.clearHover();
    };
    // Taps anywhere on the panel that nothing above claims: dialogue, targets, and walking.
    // It sits outside the interface layer, which hides under full-page pictures, so
    // captions over the epilogue pictures can still be tapped on.
    this.tapCatcher.eventMode = 'static';
    this.tapCatcher.on('pointerdown', (e) => {
      this.world?.clearHover();
      const p = e.getLocalPosition(this.panel);
      // Holding a finger down keeps walking, but only when the tap itself was a walk.
      this.holding = this.onPanelTap(p.x, p.y) === 'world';
      this.holdTimer = 0.25;
      this.holdPos = [p.x, p.y];
      this.holdSteered = false;
    });
    this.tapCatcher.on('globalpointermove', (e) => {
      const worldHover = e.pointerType === 'mouse' && !this.holding && !this.battle && !this.screens.length &&
        !this.dialogue.open && (!e.target || e.target === this.tapCatcher);
      if (worldHover) {
        const p = e.getLocalPosition(this.panel);
        this.world?.hover(p.x, p.y);
      } else this.world?.clearHover();
      // In a fight the mouse can point at a target before clicking it.
      if (e.pointerType === 'mouse' && this.battle && !this.screens.length) {
        const p = e.getLocalPosition(this.panel);
        this.battle.ui.hover(p.x, p.y);
      }
      if (!this.holding) return;
      const p = e.getLocalPosition(this.panel);
      if (p.x !== this.holdPos[0] || p.y !== this.holdPos[1]) this.holdSteered = true;
      this.holdPos = [p.x, p.y];
    });
    const cancel = () => (this.holding = false);
    const release = (e: FederatedPointerEvent) => {
      if (!this.holding) return;
      const p = e.getLocalPosition(this.panel);
      // The owner, 2026-10-15: the last motion before letting go counts, even between path calculations.
      const steered = this.holdSteered || p.x !== this.holdPos[0] || p.y !== this.holdPos[1];
      this.holdPos = [p.x, p.y];
      cancel();
      if (steered && !this.dialogue.open && !this.battle) this.world?.tap(p.x, p.y, { repeat: true });
    };
    this.tapCatcher.on('pointerup', release);
    this.tapCatcher.on('pointerupoutside', release);
    // The system can take a touch away (app switcher, Control Center, rotation); Pixi does not report that.
    this.app.canvas.addEventListener('pointercancel', cancel);
    const clearBattleHover = () => { this.battle?.ui.clearHover(); this.world?.clearHover(); };
    this.app.canvas.addEventListener('pointerleave', clearBattleHover);
    window.addEventListener('blur', clearBattleHover);
    window.addEventListener('keydown', clearBattleHover);
    window.addEventListener('pointerdown', (e) => {
      this.world?.clearHover();
      if (e.pointerType !== 'mouse') clearBattleHover();
    }, { capture: true });
    window.addEventListener('blur', cancel);

    // Phones can discard a hidden tab, so save on the way out, if the game is at a safe point.
    document.addEventListener('visibilitychange', () => {
      // Charge the hidden interval in full, including the first event on return.
      if (!this.lockstepBattleClock) this.battle?.updateAbsolute(performance.now() / 1000);
      if (document.visibilityState !== 'hidden') return;
      cancel();
      this.autosave();
      // A fight waits for the player: a call or a locked phone should not cost them it. (The Warsaw finale's fuse
      // burns on regardless; there is no stopping it, the owner, 2026-11-11.)
      if (this.battle && !this.screens.length) this.openPause();
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Layout

  relayout(): void {
    this.relayouts++;
    // Whatever is moving is put at rest first, so nothing is laid out half way through a motion.
    anim.finishAll();
    const { w, h } = viewportSize();
    this.app.renderer.resize(w, h);
    // On a phone the layout is always upright: turned sideways or upside down, the canvas keeps its
    // size and the whole stage is turned back, and the layout is made for the upright size.
    const s = readScreen();
    const fresh = readingIsFresh({ now: performance.now(), turnedAt: this.turnedAt, size: [w, h], sizeAtTurn: this.sizeAtTurn });
    this.turn = chooseTurn({ phone: s.phone, vw: w, vh: h, angle: s.angle, last: this.turn, fresh });
    const fits = w > h ? s.angle === 90 || s.angle === 270 : s.angle === 0 || s.angle === 180;
    this.turnUnsure = s.phone && !fits;
    const r = rootPlacement(this.turn, w, h);
    this.root.rotation = r.rotation;
    this.root.position.set(r.x, r.y);
    Object.assign(screenTurn, { turn: this.turn, cw: w, ch: h });
    const [lw, lh] = uprightSize(this.turn, w, h);
    this.safeInsets = turnInsets(readSafeInsets(), this.turn);
    this.layout = computeLayout(lw, lh, this.safeInsets, this.settings.textSize);
    const p = this.layout.panel;
    const overlay = overlayLayout(this.layout, this.safeInsets);
    this.pageLayout = overlay.layout;
    const page = this.pageLayout.panel;
    this.pageLayer.scale.set(overlay.scale);
    this.pageLayer.position.set(page.x * overlay.scale, page.y * overlay.scale);
    this.pageMask.clear().rect(page.x * overlay.scale, page.y * overlay.scale,
      page.w * overlay.scale, page.h * overlay.scale).fill(0xffffff);
    const safe = this.safeInsets;
    const newspaper = { x: safe.left / overlay.scale, y: safe.top / overlay.scale,
      w: (lw - safe.left - safe.right) / overlay.scale, h: (lh - safe.top - safe.bottom) / overlay.scale };
    this.newspaperLayout = { ...overlay.layout, panel: newspaper };
    this.newspaperLayer.scale.set(overlay.scale);
    this.newspaperLayer.position.set(safe.left, safe.top);
    this.newspaperMask.clear().rect(safe.left, safe.top,
      lw - safe.left - safe.right, lh - safe.top - safe.bottom).fill(0xffffff);
    this.panel.position.set(p.x, p.y);
    this.panelMask.clear().rect(p.x, p.y, p.w, p.h).fill(0xffffff);
    this.viewportMatte.clear().rect(0, 0, lw, lh).fill(0x000000);
    const large = computeLayout(lw, lh, this.safeInsets, TEXT_SIZES.at(-1)).unit;
    const mark = this.reducedMark, largeFont = Math.round(large * 1.98);
    let edge = Math.round(large * 0.4);
    // Twice the first size and a tenth more (the owner, 2026-10-27), at the Large text size; on a phone, the width's size;
    // larger, the 1440x900 desktop's proportion.
    // The outline goes with the size, so the phone's fit to its width counts it.
    const size = (font: number) => {
      const w = markOutline(font);
      mark.style.fontSize = font;
      mark.style.stroke = { color: MARK_OUTLINE, width: w, join: 'round' };
      mark.style.padding = w * 2;
    };
    size(largeFont);
    if (lw <= MARK_PHONE_W) {
      const room = lw - safe.left - safe.right - edge * 2;
      size(Math.floor(largeFont * room / mark.width));
      while (mark.width > room && Number(mark.style.fontSize) > 8) size(Number(mark.style.fontSize) - 1);
    } else {
      const font = Math.max(largeFont, Math.round(MARK_DESKTOP_FONT * Math.min(lw / MARK_DESKTOP_W, lh / MARK_DESKTOP_H)));
      edge = Math.round(edge * font / largeFont);
      size(font);
    }
    this.reducedMarkFoot = lh - safe.bottom - edge;
    this.reducedMarkEdge = edge;
    mark.position.set(safe.left + edge, this.reducedMarkFoot - mark.height);
    // The sound's mark in the play area's top left corner, as Stats/Item is in its top right on a wide screen, and moved
    // with the view as it is (`placeViewport`).
    const soundEdge = Math.round(this.layout.unit * 0.5);
    this.soundMark.layout(this.layout.unit, soundEdge, soundEdge);
    this.placeViewport();
    this.tapCatcher.clear().rect(0, 0, p.w, p.h).fill({ color: 0xffffff, alpha: 0.001 });
    this.drawBackdrop();
    if (this.creditsBackdrop) this.setCreditsBackdrop(true);
    this.world?.layout(p.w, p.h, p.x, p.y);
    this.hud.layout();
    for (const s of this.screens) s.layout();
    this.toast_?.layout();
    this.battle?.ui.relayout();
    this.dialogue.relayout();
    // Not on a guess: with no reading of the phone's angle to go by, a wide window is laid out turned but not paused.
    this.holdSideways((this.turn === 90 || this.turn === 270) && !this.turnUnsure, w, h, r.rotation);
  }

  /**
   * A phone held sideways pauses the game under a card asking for it to be turned upright (the owner,
   * 2026-09-30); upside down it carries on, turned. The card is square to the screen, over everything,
   * and takes every tap. A fight also gets its own pause page, so turning back does not drop the player
   * into a running clock. The save code's text field, which lies over the canvas, is hidden meanwhile.
   */
  private holdSideways(sideways: boolean, w: number, h: number, turned: number): void {
    if (sideways && !this.sidewaysCard) {
      this.sidewaysCard = new SidewaysCard(this.msg('system', 'paused'), this.msg('system', 'rotate_to_unpause'));
      this.app.stage.addChild(this.sidewaysCard.container);
      this.holding = false;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (this.battle && !this.screens.length) this.openPause();
    } else if (!sideways && this.sidewaysCard) {
      this.sidewaysCard.container.destroy({ children: true });
      this.sidewaysCard = null;
    }
    document.documentElement.classList.toggle('game-sideways', sideways);
    this.sidewaysCard?.layout(w, h, this.layout.unit, turned);
  }

  private drawBackdrop(): void {
    const p = this.layout.panel;
    // The map title shows through the panel.
    if (!this.world && this.title instanceof TitleMap) {
      this.backdrop.clear();
      return;
    }
    this.backdrop.clear().rect(0, 0, p.w, p.h).fill(this.world?.backdrop ?? PAPER);
  }

  /** Safe browser edges expressed in the battle header's panel-aligned coordinates. */
  battleHeaderBounds(): Rect {
    const scale = this.viewport.scale.x, ins = this.safeInsets;
    const inset = 6;
    return { x: (ins.left + inset - this.battleHeaderLayer.x) / scale,
      y: (ins.top + inset - this.battleHeaderLayer.y) / scale,
      w: (this.layout.vw - ins.left - ins.right - inset * 2) / scale,
      h: (this.layout.vh - ins.top - ins.bottom - inset * 2) / scale };
  }

  /** The safe screen edges in the panel-aligned layers' coordinates (the battle header's, the HUD's edge), with no margin. */
  screenEdges(): Rect {
    const scale = this.viewport.scale.x, ins = this.safeInsets;
    return { x: (ins.left - this.hudEdgeLayer.x) / scale, y: (ins.top - this.hudEdgeLayer.y) / scale,
      w: (this.layout.vw - ins.left - ins.right) / scale, h: (this.layout.vh - ins.top - ins.bottom) / scale };
  }

  /**
   * The arcade's view in the arcade, the whole screen in the printed world and on the title page; across the border it
   * follows the leader, and after a jump (a map change, the title) it eases there. It holds where it is through a fight,
   * whose dashes carry the leader to and fro across the border's columns. At the ending it narrows back.
   */
  private moveView(dt: number, w: World | null, diving: boolean): void {
    if (this.endingNarrow !== null) {
      this.endingNarrow -= dt;
      if (this.endingNarrow <= 0) this.startNarrowing();
    }
    if (this.arcadeBack) this.viewLift.setLift(0, this.arcadeBackSeconds);
    else if (!this.battle) this.viewLift.setLift(
      this.playing && (!this.title || this.arcadeIntro || diving) && w ? w.printShare() : 1,
      this.arcadeIntro ? this.arcadeIntroSeconds : undefined,
    );
    this.viewLift.update(dt);
    if (this.arcadeIntro && this.viewLift.lift === 0) this.arcadeIntro = false;
    if (this.arcadeBack && this.viewLift.lift === 0) this.landArcade();
  }

  /** Follow the view's lift with a proportional zoom, exposing only black beyond the play area. */
  private placeViewport(): void {
    const p = this.layout.panel, fit = expandedPanel(this.layout, this.safeInsets);
    const lift = this.playing && !this.arcadeIntro ? this.viewLift.lift : 0;
    const amount = motion.reduced ? (lift >= 0.5 ? 1 : 0) : lift * lift * (3 - 2 * lift);
    const exit = this.titleFrameExit;
    // In play the arcade's view sits in the middle of the screen, the masthead's space shared out as black above and
    // below it, and the paper gone (the owner, 2026-10-19). It moves there as the title page leaves.
    const ins = this.safeInsets;
    const middle = ins.top + (this.layout.vh - ins.top - ins.bottom - p.h) / 2;
    // With Reduce motion it is there at once, as the zoom jumps rather than swells.
    const centred = !this.playing ? 0 : exit && !motion.reduced ? EASE.smooth(exit.age / exit.seconds) : 1;
    const home = { x: p.x, y: p.y + (middle - p.y) * centred };
    const scale = 1 + (fit.w / p.w - 1) * amount;
    const x = home.x + (fit.x - home.x) * amount - p.x * scale;
    const y = home.y + (fit.y - home.y) * amount - p.y * scale;
    for (const layer of [this.battleHeaderLayer, this.hudEdgeLayer, this.soundLayer]) {
      layer.scale.set(scale);
      layer.position.set(x + p.x * scale, y + p.y * scale);
    }
    if (this.viewport.scale.x === scale && this.viewport.x === x && this.viewport.y === y) return;
    // A stationary held finger stays over the same physical point as the panel expands underneath it.
    const held = this.holding ? this.panel.toGlobal({ x: this.holdPos[0], y: this.holdPos[1] }) : null;
    this.viewport.scale.set(scale);
    this.viewport.position.set(x, y);
    if (held) {
      const at = this.panel.toLocal(held);
      this.holdPos = [at.x, at.y];
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Text

  msg(group: string, key: string, vars: Record<string, string | number> = {}): string {
    const s = this.content.messages[group]?.[key] ?? `${group}.${key}`;
    return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  }

  toast(text: string, opts: { unique?: boolean } = {}): void {
    this.hud.toast(text, 0, undefined, opts.unique);
  }

  announce(text: string): void {
    this.hud.showBonus(text);
  }

  // ---------------------------------------------------------------------------------------------
  // Flow

  /** The title owns display upgrades until play has begun under its departing page. */
  get titleShowing(): boolean { return this.title !== null && !this.playing; }

  /** With `onAchievements`, the pointer starts on that row, if it is there. */
  showTitle(onAchievements = false): void {
    // A lost fight's interface waits for the defeat page's choice; a quit to the title in that moment left it drawing stars
    // on the destroyed world's layer, which threw in the step loop (Fable review P14).
    if (this.lostFight && !this.lostFight.container.destroyed) this.lostFight.destroy();
    this.lostFight = null;
    this.playing = false;
    this.arcadeIntro = false;
    this.arcadeBack = false;
    this.arcadeBackSeconds = 2;
    this.endingNarrow = null;
    this.landArcade();
    this.titleFrameExit = null;
    this.clearScreens();
    this.world?.destroy();
    this.world = null;
    this.setCreditsBackdrop(false);
    this.drawBackdrop();
    this.audio.music('title');
    const items: MenuItem[] = [];
    const saved = loadGame(this.content);
    // New Game's first map and Continue's, so either opens on its own music in the player's style.
    const firstMusic = (id: string) => this.content.maps.get(id)?.props.music;
    this.audio.prepare([saved && firstMusic(saved.map), firstMusic(this.content.party.start.map)].filter((m): m is string => typeof m === 'string'));
    // Continue says what it will load: how long it has been played, and where.
    if (saved) items.push({ label: this.msg('title', 'continue'), detail: this.msg('title', 'continue_detail', saveSummary(this.content, saved)), onChoose: () => this.continueGame() });
    // A save this version cannot read is shown, not hidden, and kept safe before a new game replaces it.
    else if (saveExists()) items.push({ label: this.msg('title', 'continue_unreadable'), enabled: false, onChoose: () => undefined });
    // With a save to lose, New Game asks first. (The test tools call startNewGame directly.)
    items.push({ label: this.msg('title', 'new_game'), onChoose: () => (saved ? this.confirmNewGame(saved) : void this.startNewGame()) });
    items.push({ label: this.msg('title', 'enter_code'), onChoose: () => this.openCodeEntry() });
    let start = 0;
    // Once one is earned, in any game in this browser.
    if (earned(loadProgress(), hundredList(this.content)).length) {
      if (onAchievements) start = items.length;
      items.push({ label: this.msg('title', 'achievements'), onChoose: () => this.openAchievements() });
    }
    items.push({ label: this.msg('title', 'settings'), onChoose: () => this.openSettings() });
    // No choice is taken by tap, key or pad while the loading page is still up (under the phone notice, which stops only
    // Enter and Space: Z or a second quick tap chose under it) or while a choice already made waits for its art or the
    // title's music (a tap reached the rows there: Continue, then New Game and Yes, entered the saved map with a new party
    // and the autosave replaced the save). Fable review P8 and P9, 2026-11-09.
    for (const item of items) {
      const choose = item.onChoose;
      item.onChoose = () => { if (!this.titleHeld()) choose(); };
    }
    // The title is the map of the world in the house's colours, its menu on a coupon in the panel's corner (a trial).
    this.title = new TitleMap(this, items, start);
    this.pushScreen(this.title);
    this.drawBackdrop();
  }

  /** The sound's mark (`soundMark`), shown while the sound has failed for good; tapped, it says why and offers a reload. */
  private readonly soundMark = new SoundMark(() => this.askSoundReload());
  /** Over everything, placed as the panel is drawn (`placeViewport`), so the mark sits in the play area's corner. */
  readonly soundLayer = new Container();
  private soundAsk: ConfirmScreen | null = null;

  /**
   * The sound's mark tapped: the sound is unavailable, and a reload tries again (the safe answer, Not now, first). The game is
   * saved first where it is at rest, as before a reload for lost graphics, so the progress up to then is kept.
   */
  private askSoundReload(): void {
    const p = this.audio.problem;
    if (!p || this.soundAsk || this.halted) return;
    const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
      message: this.msg('system', 'sound_failed'),
      yes: this.msg('system', 'sound_reload'),
      no: this.msg('system', 'sound_not_now'),
      onNo: () => {
        this.soundAsk = null;
        this.popScreen(c);
      },
      onYes: () => {
        // Closed first, so the game is at rest and the save is made (it was not while the question was open).
        this.soundAsk = null;
        this.popScreen(c);
        this.autosave();
        location.reload();
      },
    });
    this.soundAsk = c;
    this.pushScreen(c);
  }

  /**
   * The site holds a newer release than this page (src/release_check.ts), found when a file it fetches late did not arrive.
   * On the loading page the game reloads by itself, saved first where it is at rest: nothing is under way there. A tab
   * already reloaded for that release that still came back old (the site not yet new everywhere) does not again. Elsewhere
   * the question about loading problems (`askLoadingProblem`) offers the reload, whatever kept the file away.
   */
  private newerRelease(sha: string): void {
    if (this.halted || !loaderShowing() || releaseWatch.reloadedFor(sha)) return;
    this.autosave();
    releaseWatch.reload(sha);
  }

  /** A picture failed for good: the question waits for the loading page to go, and is asked once a visit. */
  private loadingProblem: 'pending' | 'asked' | null = null;

  /**
   * Pictures did not arrive, even tried again, so hot pink boxes stand in for them: a dropped connection, or a newer release
   * that took them off the site. The player is told, Reload picked to start; it saves first where the game is at rest (the
   * owner, 15 Nov: "We should have reload as the default, instead of ignore. Hmm... it seems that we should explain if
   * loading went wrong instead of them thinking that the game has pink boxes in it").
   */
  private askLoadingProblem(): void {
    this.loadingProblem = 'asked';
    if (this.halted) return;
    const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
      message: this.msg('system', 'loading_problems'),
      yes: this.msg('system', 'loading_problems_reload'),
      no: this.msg('system', 'loading_problems_ignore'),
      yesPicked: true,
      onNo: () => this.popScreen(c),
      onYes: () => {
        // Closed first: the game is at rest only under pages safe to save under, and a question is not one.
        this.popScreen(c);
        this.autosave();
        location.reload();
      },
    });
    this.pushScreen(c);
  }

  /** Before a new game replaces a save: start over, or go back (the safe answer, first). */
  private confirmNewGame(saved: GameState): void {
    const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
      message: this.msg('title', 'confirm_new', saveSummary(this.content, saved)),
      yes: this.msg('title', 'confirm_yes'),
      no: this.msg('title', 'confirm_no'),
      onNo: () => {
        this.audio.play('cancel');
        this.popScreen(c);
      },
      onYes: () => void this.startNewGame(),
    });
    this.pushScreen(c);
  }

  toTitle(onAchievements = false): void {
    this.story.skip();
    this.dialogue.clear();
    this.showTitle(onAchievements);
  }

  /** A title choice is waiting, or the loading page is still up: no other choice is taken meanwhile (see showTitle). */
  private titleHeld(): boolean {
    return loaderShowing() || this.waitingForArt || this.waitingForTitleMusic;
  }

  async startNewGame(): Promise<void> {
    // Not over a choice that is waiting: its state would be replaced under it.
    if (this.waitingForArt || this.waitingForTitleMusic) return;
    keepUnreadableSave(this.content);
    this.state = newGame(this.content);
    // Recent lines start with this game: the last one's ending is not news in it (the owner, 2026-11-11).
    this.log.splice(0);
    const start = this.content.party.start;
    let opening: Promise<void> | undefined;
    let reveal!: () => void;
    const beforeDialogue = new Promise<void>(resolve => { reveal = resolve; });
    try {
      await this.playUnderTitle(() => {
        this.enterMap(start.map, start.spawn);
        // Place the cast under the title, but begin speaking only once it has left.
        if (start.scene) opening = this.runScene(start.scene, { beforeDialogue });
      }, { dive: true });
    } finally {
      reveal();
    }
    await opening;
    await this.afterEnter();
  }

  continueGame(): void {
    const s = loadGame(this.content);
    if (s) void this.resume(s);
  }

  /**
   * Plays on from a saved state; with `save`, writes it to the browser once its map has been entered.
   * Resolves once the title has gone, and rejects (or throws, when play starts at once) if the map
   * cannot be entered.
   */
  private resume(s: GameState, save = false): Promise<void> {
    // A second choice while one waits is dropped, as playUnderTitle drops it: never settled, and nothing touched.
    if (this.waitingForArt || this.waitingForTitleMusic) return new Promise(() => undefined);
    // The old world still writes its leader's position into state while destination art loads.
    // Capture the saved destination before exposing that state to those updates.
    const map = s.map;
    const at = { x: s.x, y: s.y, facing: s.facing };
    this.state = s;
    const started = this.playUnderTitle(() => {
      this.enterMap(map, at);
      this.world!.protectUntilMovement();
      if (save) saveGame(s);
    });
    // Then this map's chapter page and arrival scene, if the save was made before they ran.
    void started.then(
      () => this.afterEnter(),
      () => undefined,
    );
    return started;
  }

  /**
   * Starts play: every page but the title closes, the map is entered under the title page, and the
   * title turns away onto it as a chapter's page does. The map is entered before this returns, so an
   * error entering it is thrown to the caller. Resolves once the title has gone (at once without it).
   */
  private playUnderTitle(enter: () => void, opts: { dive?: boolean; heard?: boolean } = {}): Promise<void> {
    // This destination chapter loads behind the title. Play waits for its art, with the title held
    // still meanwhile, so no map is drawn half with art and half without.
    const needed = artForMap(this.state.map);
    if (!artReady(needed)) {
      // A second choice while waiting (the save code field's Enter, pressed again) is dropped: its
      // promise never settles, and the first goes on.
      if (this.waitingForArt) return new Promise(() => undefined);
      this.waitingForArt = true;
      // The save code field gives up the keyboard, whose Enter the held title would not stop.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const hold: Screen = { container: new Container(), opaque: false, blocking: true, update: () => undefined, layout: () => undefined, destroy: () => hold.container.destroy() };
      this.pushScreen(hold);
      showLoader(artProgress(needed));
      return whenArtReady({ slots: needed, onProgress: (p) => loaderArtProgress(p) }).then(() => {
        this.waitingForArt = false;
        hideLoader();
        return this.playUnderTitle(enter, opts);
      });
    }
    const page = this.title && this.screens.includes(this.title) ? this.title : null;
    // The map title's menu shows and takes choices at once; leaving it waits for its music to be ready to play (the owner,
    // 2026-10-26: the check belongs "when the player actually does 'New Game' or 'Continue'"), so the dive and the mosaic
    // always fade out of it. Pressed early, the choice waits that moment while the map plays on, the menu taking no more
    // presses, as the art's wait does.
    if (page instanceof TitleMap && !motion.reduced && !opts.heard && this.audio.titleMusicWaiting) {
      if (this.waitingForTitleMusic) return new Promise(() => undefined);
      this.waitingForTitleMusic = true;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      let held = 0;
      return new Promise<void>((resolve) => {
        const hold: Screen = {
          container: new Container(), opaque: false, blocking: true,
          update: (dt) => {
            held += dt;
            if (this.audio.titleMusicWaiting && held < TITLE_MUSIC_WAIT_S) return;
            this.popScreen(hold);
            resolve();
          },
          layout: () => undefined, destroy: () => hold.container.destroy(),
        };
        this.pushScreen(hold);
      }).then(() => {
        this.waitingForTitleMusic = false;
        return this.playUnderTitle(enter, { ...opts, heard: true });
      });
    }
    for (const s of [...this.screens]) if (s !== page) this.popScreen(s);
    this.picture = null;
    this.pictureLanding = null;
    // Leaving the map title, the song does not stop at the press (the owner, 2026-10-22, from the title concepts' sound
    // plan): under New Game's dive it falls away, darkening, and the house's tune starts on its first beat as the house
    // lands; under Continue's wipe it fades, and the saved map's music starts once the title has gone, at full level.
    const titleMusic: Game['titleMusic'] = page instanceof TitleMap && !motion.reduced
      ? opts.dive ? { fadeOut: DIVE_S, startAfter: DIVE_S, close: true }
        : this.audio.currentMusic === 'title' ? { mosaic: true } : null
      : null;
    this.titleMusic = titleMusic;
    try {
      enter();
    } finally {
      this.titleMusic = null;
    }
    // Use the actual bridge's distance and the ordinary walk, without a later speed-pellet bonus.
    const columns = String(this.content.maps.get('border')?.props.tilt_ease_x ?? '').split(',').map(Number);
    const span = (columns[1] ?? 0) - (columns[0] ?? 0);
    this.arcadeIntroSeconds = Number.isFinite(span) && span > 0 ? span * TILE / WALK : MS.pageOut / 1000;
    this.titleFrameExit = page ? { age: 0, seconds: this.arcadeIntroSeconds } : null;
    this.arcadeIntro = Boolean(page && this.world?.printShare() === 0);
    this.playing = true;
    if (!page) {
      this.title = null;
      return Promise.resolve();
    }
    page.leave();
    const gone = () => {
      if (this.screens.includes(page)) this.popScreen(page);
      if (this.title === page) this.title = null;
    };
    // New Game from the map title dives into the map and lands on the house's view, which is in its place from the start
    // (with Reduce motion it is simply there).
    if (opts.dive && page instanceof TitleMap) {
      this.titleFrameExit = null;
      return (motion.reduced ? Promise.resolve() : page.dive(() => this.diveLanding())).then(() => {
        this.resetWorldReveal();
        gone();
      });
    }
    // Continue and a save code (the owner, 2026-10-23: "We have the mosaic effect that we could use for the transition
    // instead of the slide left"): the whole screen breaks into the flashback's blocks, the saved map takes the title's
    // place at the biggest, and it comes back sharp.
    if (page instanceof TitleMap) {
      const music = titleMusic && 'mosaic' in titleMusic ? titleMusic.music : undefined;
      const fade = music !== undefined ? (progress: number) => this.audio.fadeTitle(progress) : undefined;
      return this.mosaicFromTitle(gone, fade).then(() => {
        // Selecting only now keeps the first notes after the actual, frame-quantised waits and any sideways pause.
        // Detach the now-silent title source before music() resets the incoming bus to full level.
        if (music !== undefined) this.audio.music(music, { fadeOut: 0.01 });
      }, err => { fade?.(0); throw err; });
    }
    return this.turnPage(page, 'out').then(gone);
  }

  /** Where the map title's dive lands: the house's view as play will show it, centred where the panel will be. */
  private diveLanding(): TitleLanding | null {
    const w = this.world;
    if (!w) return null;
    const p = this.layout.panel, ins = this.safeInsets;
    const middle = ins.top + (this.layout.vh - ins.top - ins.bottom - p.h) / 2;
    const [cx, cy] = w.worldToPanel(w.camX, w.camY);
    return {
      x: p.x + cx,
      y: middle + cy,
      tile: w.zoom * TILE,
      ox: -w.camX / TILE,
      oy: -w.camY / TILE,
      house: { x0: -w.camX / TILE, y0: -w.camY / TILE, x1: (w.map.width * TILE - w.camX) / TILE, y1: (w.map.height * TILE - w.camY) / TILE },
      reveal: (f, alpha) => {
        this.worldLayer.scale.set(f);
        this.worldLayer.position.set(cx * (1 - f), cy * (1 - f));
        this.worldLayer.alpha = alpha;
      },
    };
  }

  private resetWorldReveal(): void {
    this.worldLayer.scale.set(1);
    this.worldLayer.position.set(0, 0);
    this.worldLayer.alpha = 1;
  }

  /** The title page's save code entry. A code that checks out is saved in this browser and played. */
  openCodeEntry(): void {
    const screen: SaveCodeIn = new SaveCodeIn(
      this.pageGame,
      () => this.popScreen(screen),
      (s) => {
        // Written to the browser only once the game has started from it (`resume` saves it then).
        const failed = (err: unknown) => {
          console.error('Could not start from the save code:', err);
          this.toTitle();
        };
        try {
          this.resume(s, true).catch(failed);
        } catch (err) {
          failed(err);
        }
      },
    );
    this.pushScreen(screen);
  }

  /** The party menu's save code page. */
  openSaveCode(): void {
    const screen: SaveCodeOut = new SaveCodeOut(this.pageGame, () => this.popScreen(screen));
    this.pushScreen(screen);
  }

  /** The phone has just turned: until the page takes its new size (or a second passes), a reading that does not fit the page's shape is not trusted. */
  phoneTurned(): void {
    this.turnedAt = performance.now();
    const { w, h } = viewportSize();
    this.sizeAtTurn = [w, h];
  }

  /** Page pixels for a point on the panel, for placing the few HTML elements over the canvas. The stage may be turned. */
  panelToPage(x: number, y: number): [number, number] {
    const r = this.app.canvas.getBoundingClientRect();
    const at = this.panel.toGlobal({ x, y });
    return [r.left + at.x, r.top + at.y];
  }

  /** The page's box over a box on the panel: a quarter turn swaps its sides. */
  panelRectToPage(x: number, y: number, w: number, h: number): Rect {
    const [ax, ay] = this.panelToPage(x, y);
    const [bx, by] = this.panelToPage(x + w, y + h);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  }

  /** The panel point under a point on the page. */
  pageToPanel(px: number, py: number): [number, number] {
    const r = this.app.canvas.getBoundingClientRect();
    const at = this.panel.toLocal({ x: px - r.left, y: py - r.top });
    return [at.x, at.y];
  }

  /** Builds a map and puts the party at a spawn point or position. */
  enterMap(id: string, at: string | { x: number; y: number; facing: Dir }, opts: { preserveVisit?: boolean; resumeMusic?: boolean } = {}): void {
    const map = this.content.maps.get(id);
    if (!map) {
      console.error(`No map "${id}"`);
      return;
    }
    this.world?.destroy();
    const resets = map.props.resets;
    if (!opts.preserveVisit && typeof resets === 'string') for (const r of resets.split(',')) delete this.state.temp[r.trim()];
    this.state.map = id;
    const w = new World(this, map, this.halftone);
    this.world = w;
    this.worldLayer.addChild(w.view);
    const p = this.layout.panel;
    w.layout(p.w, p.h, p.x, p.y);
    if (typeof at === 'string') {
      const sp = w.spawnPoint(at);
      w.placeParty(sp?.x ?? map.width * 16, sp?.y ?? map.height * 16, (sp?.props.facing as Dir) ?? 'down');
      if (sp?.props.lined_up === true) w.lineUpParty();
    } else {
      // A saved position can fall inside a wall if the map has changed since; move to open ground. If it changed so
      // much that the spot is cut off from every way in (a street of the old Beijing is the pagoda's island in the new
      // one), start at the first way in.
      let [x, y] = w.collision.blocked(at.x, at.y) ? freeSpot(w, at.x, at.y) : [at.x, at.y];
      const spawns = map.objects.filter((o) => o.type === 'spawn');
      const cutOff = spawns.length > 0 && !spawns.some((s) => w.collision.findPathNear(s.x, s.y, x, y, false).reached);
      if (w.collision.blocked(x, y) || cutOff) {
        const sp = spawns[0];
        [x, y] = sp ? [sp.x, sp.y] : [x, y];
      }
      w.placeParty(x, y, at.facing);
      w.enteredAtSavedPlace();
    }
    this.drawBackdrop();
    this.audio.setMusicShare(w.musicShare());
    const music = map.props.music;
    if (typeof music === 'string') {
      if (opts.resumeMusic) this.audio.music(music, { resume: true });
      else if (this.titleMusic && 'mosaic' in this.titleMusic) this.titleMusic.music = music;
      else if (this.titleMusic) this.audio.music(music, this.titleMusic);
      else this.audio.music(music);
    }
    this.audio.prepare(this.musicAhead(id));
    prefetchArt(id);
  }

  /** Hold interaction until the next map or picture has its assets, without waiting for distant chapters. */
  async prepareArt(slots: readonly string[]): Promise<void> {
    if (artReady(slots)) return;
    const hold: Screen = { container: new Container(), opaque: false, blocking: true, update: () => undefined,
      layout: () => undefined, destroy: () => hold.container.destroy() };
    this.pushScreen(hold);
    showLoader(artProgress(slots));
    try { await whenArtReady({ slots, onProgress: p => loaderArtProgress(p) }); }
    finally { hideLoader(); if (this.screens.includes(hold)) this.popScreen(hold); }
  }

  /**
   * How far through the map playing `name` the player is, for the piece its music plays after a fight
   * (audio/intros.ts): the map's power pellets taken, with the one a won fight was for, which is taken only once the
   * fight is over and its music has come back. Null where the map has none.
   */
  private musicProgress(name: string): { done: number; total: number } | null {
    const w = this.world;
    if (!w || w.map.props.music !== name) return null;
    const pellets = powerPellets(this.content, w.map.id);
    if (!pellets.length) return null;
    return { done: pellets.filter((k) => this.state.taken.includes(k) || k === w.prizeAtStake).length, total: pellets.length };
  }

  /**
   * The music a map can lead to next, most likely first: its fights' (and what their scenes play), music its scenes
   * change to (the ending after the boss), its own, and the maps its exits reach. The game renders these in the
   * player's style ahead of time, so a change of music starts at once in that style.
   */
  private musicAhead(id: string): string[] {
    const map = this.content.maps.get(id);
    if (!map) return [];
    const fights: string[] = [], scripted: string[] = [], exits: string[] = [];
    const seen = new Set<string>();
    const mapMusic = (to: unknown) => {
      const music = typeof to === 'string' ? this.content.maps.get(to)?.props.music : undefined;
      if (typeof music === 'string') exits.push(music);
    };
    const fight = (encounter: unknown) => {
      if (typeof encounter !== 'string') return;
      const enc = this.content.encounters[encounter];
      fights.push(battleMusic(enc));
      scene(enc?.cry);
      scene(enc?.after);
    };
    const scene = (name: unknown): void => {
      if (typeof name !== 'string' || seen.has(name)) return;
      seen.add(name);
      for (const step of this.content.scenes.get(name)?.steps ?? []) {
        if (step.kind !== 'command') continue;
        const target = step.args[0];
        if (step.name === 'music' && target && target !== 'stop') scripted.push(target);
        else if (step.name === 'run') scene(target);
        else if (step.name === 'battle') fight(target);
        else if (step.name === 'warp') mapMusic(target);
      }
    };
    scene(map.props.on_enter);
    for (const o of map.objects) {
      if (o.type === 'enemy') fight(o.props.encounter);
      else if (o.type === 'exit') mapMusic(o.props.to);
      scene(o.props.scene);
    }
    const own = typeof map.props.music === 'string' ? [map.props.music] : [];
    return [...new Set([...fights, ...scripted, ...own, ...exits])];
  }

  /** The chapter a map opens, if the party has not had its front page yet. */
  private chapterFor(map: string): string | null {
    return this.content.frame.chapters.find((c) => c.map === map && c.on === 'enter' && !this.state.chapters.includes(c.id) && requirementsMet(this.state, c.requires))?.id ?? null;
  }

  /**
   * Chapter front page and arrival scene, the first time the party enters a map. A walk into a
   * chapter's map has already shown its page (see `changeMap`); a new game or a save made before
   * the page ran shows it here, over the map.
   */
  private async afterEnter(): Promise<void> {
    const id = this.state.map;
    const chapter = this.chapterFor(id);
    if (chapter) {
      this.state.chapters.push(chapter);
      await this.showFrontPage(chapter);
    }
    const onEnter = this.world?.map.props.on_enter;
    const flag = `entered:${id}`;
    const first = !this.state.flags[flag];
    this.state.flags[flag] = true;
    if (typeof onEnter === 'string' && first) {
      await this.runScene(onEnter);
    }
    this.autosave();
  }

  /**
   * Moves to another map. Unless it is instant or motion is reduced, the old map
   * slides away like one comic panel making way for the next, in the direction the
   * party was going. A map that opens a chapter turns its front page in over the map
   * being left instead; the party moves under the page, and it turns away onto the new map.
   * An instant change (the developer jumps) enters at once, and the page shows over the new map.
   */
  async changeMap(map: string, spawn: string, opts: { instant?: boolean; dir?: Dir } = {}): Promise<void> {
    if (this.transitioning) return;
    // Stay on this map rather than leave it for one that does not exist.
    if (!this.content.maps.has(map)) {
      console.error(`No map "${map}"`);
      return;
    }
    // Leaving a map saves first, at rest as every autosave (the owner, 15 Nov: "exiting a map to the next map should be an
    // autosave point right before entering the map transition"): a reload while the next map's pictures are awaited, as for
    // a newer release (`newerRelease`), comes back to what was done on the map left.
    this.autosave();
    this.transitioning = true;
    if (!artReady(artForMap(map))) await this.prepareArt(artForMap(map));
    const chapter = opts.instant ? null : this.chapterFor(map);
    // The page's own sound stands for a change it covers.
    if (!chapter) this.audio.play('door');
    if (chapter) {
      this.state.chapters.push(chapter);
      await this.showFrontPage(chapter, () => this.enterMap(map, spawn));
    } else {
      const animate = !opts.instant && !motion.reduced && this.world !== null;
      const old = animate ? this.detachWorld() : null;
      this.enterMap(map, spawn);
      if (old) await this.slidePanels(old, opts.dir ?? 'right');
    }
    this.transitioning = false;
    // The place's name, on arrivals that no front page or arrival scene already introduces.
    const onEnter = this.world?.map.props.on_enter;
    const scene = typeof onEnter === 'string' && !this.state.flags[`entered:${map}`];
    const title = this.world?.map.props.title;
    if (!chapter && !scene && typeof title === 'string' && title) this.hud.showPlace(title);
    await this.afterEnter();
  }

  /**
   * Takes the current map out of the panel, still drawn but no longer running, in a
   * clipped window of its own over the panel, so it can slide away as a new map comes in.
   */
  private detachWorld(): { layer: Container; mask: Graphics; world: World } {
    const w = this.world!;
    const p = this.layout.panel;
    const layer = new Container();
    const mask = new Graphics().rect(p.x, p.y, p.w, p.h).fill(0xffffff);
    // The old view is also clipped to its own panel, so the map beyond its edges never slides into sight.
    const own = new Graphics().rect(0, 0, p.w, p.h).fill(0xffffff);
    w.view.mask = own;
    layer.addChild(new Graphics().rect(0, 0, p.w, p.h).fill(w.backdrop), w.view, own);
    layer.mask = mask;
    layer.position.set(p.x, p.y);
    this.viewport.addChild(layer, mask);
    this.world = null;
    return { layer, mask, world: w };
  }

  /**
   * Slides the old map out and the new panel in behind it, with the paper gutter
   * between comic panels showing as they pass.
   */
  private async slidePanels(old: { layer: Container; mask: Graphics; world: World }, dir: Dir): Promise<void> {
    const [dx, dy] = dirVector(dir);
    const g = new Graphics();
    const gMask = new Graphics();
    g.mask = gMask;
    this.viewport.addChild(g, gMask);
    await anim.run(this, MS.mapSlide, EASE.smooth, (k) => {
      // The panel is read afresh each step: the phone may be turned in the middle of a slide.
      const p = this.layout.panel;
      const gutter = Math.round(this.layout.unit * 1.4);
      const span = (dx ? p.w : p.h) + gutter;
      old.mask.clear().rect(p.x, p.y, p.w, p.h).fill(0xffffff);
      gMask.clear().rect(p.x, p.y, p.w, p.h).fill(0xffffff);
      const travel = span * k;
      old.layer.position.set(p.x - dx * travel, p.y - dy * travel);
      this.panel.position.set(p.x + dx * (span - travel), p.y + dy * (span - travel));
      // The gutter: paper between the two panels, with each panel's ruled edge.
      g.clear();
      const gx = dx > 0 ? old.layer.x + p.w : dx < 0 ? this.panel.x + p.w : p.x;
      const gy = dy > 0 ? old.layer.y + p.h : dy < 0 ? this.panel.y + p.h : p.y;
      const [w, h] = dx ? [gutter, p.h] : [p.w, gutter];
      g.rect(gx, gy, w, h).fill(PAPER);
      const edge = Math.max(2, Math.round(this.layout.unit * 0.16));
      if (dx) g.rect(gx, gy, edge, h).rect(gx + w - edge, gy, edge, h).fill(INK);
      else g.rect(gx, gy, w, edge).rect(gx, gy + h - edge, w, edge).fill(INK);
    });
    this.panel.position.set(this.layout.panel.x, this.layout.panel.y);
    old.world.destroy();
    old.layer.destroy({ children: true });
    old.mask.destroy();
    g.destroy();
    gMask.destroy();
  }

  /** The interface's motion stepper, for the dev tools and the checks. */
  get anim(): typeof anim {
    return anim;
  }

  async runScene(id: string, opts: SceneOptions = {}): Promise<void> {
    const capture = this.world && !this.story.busy && !this.fightInProgress();
    if (capture) this.sceneReturn = { world: this.world!, state: { ...structuredClone(this.state), ...this.world!.retryPoint() } };
    try {
      await this.story.run(id, opts);
    } finally {
      if (capture) this.sceneReturn = null;
    }
  }

  storyBusy(): boolean {
    return this.story.busy || this.transitioning || Boolean(this.flashback) || Boolean(this.titleMosaic);
  }

  screensOpen(): boolean {
    return this.screens.some((s) => s.blocking);
  }

  battleActive(): boolean {
    return this.battle !== null;
  }

  /** A fight is under way, including its defeat page and the scene after a win. */
  fightInProgress(): boolean {
    return this.fights > 0 || this.battle !== null;
  }

  /**
   * Whether the game is at a point that is safe to save and to rebuild: on a map,
   * with no scene, fight, map change, or page in progress. The party menu is fine.
   */
  atRest(): boolean {
    return (
      this.playing &&
      this.world !== null &&
      !this.fightInProgress() &&
      !this.storyBusy() &&
      !this.dialogue.open &&
      this.screens.every((s) => s.saveSafe === true)
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Screens

  private pagePoint(x: number, y: number): [number, number] {
    const canvas = this.app.canvas.getBoundingClientRect();
    const at = this.pageLayer.toGlobal({ x, y });
    return [canvas.left + at.x, canvas.top + at.y];
  }

  private fullScreenPage(s: Screen): boolean {
    return s instanceof PartyMenu || s instanceof SettingsScreen || s instanceof LogScreen ||
      s instanceof ControlsScreen || s instanceof SaveCodeIn || s instanceof SaveCodeOut ||
      s instanceof ConfirmScreen || s instanceof PauseScreen || s instanceof Shop || s instanceof TallPage ||
      s instanceof AchievementsScreen || s instanceof AchievementDetails;
  }

  private parentForScreen(s: Screen): Container {
    // An ending's page stays in the game's view, as its pictures did, under the narration's captions.
    if (s instanceof TallPage) return s.narrated ? this.screenLayer : this.newspaperLayer;
    return this.fullScreenPage(s) ? this.pageLayer : this.screenLayer;
  }

  pushScreen(s: Screen): void {
    this.battle?.ui.clearHover();
    this.screens.push(s);
    this.parentForScreen(s).addChild(s.container);
    // Its opening motion, if it has one: the page is built and takes input already.
    s.enter?.();
  }

  popScreen(s: Screen): void {
    const i = this.screens.indexOf(s);
    if (i >= 0) this.screens.splice(i, 1);
    // Closing is instant: anything the page had moving stops first, an ending page's landing abandoned.
    if (s instanceof TallPage) s.cancelEntry();
    anim.finish(s);
    s.destroy();
    const wait = this.screenWaits.get(s);
    this.screenWaits.delete(s);
    wait?.();
  }

  /** Closes every page and menu. Anything waiting on a shop or front page carries on. */
  clearScreens(): void {
    for (const s of [...this.screens]) this.popScreen(s);
    this.picture = null;
    this.pictureLanding = null;
    this.title = null;
  }

  /** For dev tools: marks the game as being played, so it saves and shows the party button. */
  beginPlay(): void {
    this.playing = true;
  }

  /** For dev tools: stops the scene that is running and waits briefly for it to wind down. */
  async settle(): Promise<void> {
    if (this.story.busy) {
      this.story.skip();
      for (let i = 0; i < 40 && this.story.busy; i++) await this.delay(0.05);
    }
    this.dialogue.clear();
  }

  topScreen(): Screen | undefined {
    return this.screens[this.screens.length - 1];
  }

  openPartyMenu(): void {
    // Not while the party is out of the player's hands, as while the camera is away showing something that has just
    // appeared (World.showAppearing): it would appear unseen under the menu.
    if (this.screens.length || this.storyBusy() || this.fightInProgress() || !this.world?.control) return;
    const m: PartyMenu = new PartyMenu(this.pageGame, () => this.popScreen(m));
    this.pushScreen(m);
  }

  /**
   * Settings, from the title or a fight's Pause. On touch its band rests on Back, and back from More settings or Controls on that
   * row, until the page closes; opened again, on Back (the owner, 2026-11-12).
   */
  openSettings(): void {
    const s: SettingsScreen = new SettingsScreen(this.pageGame, () => this.popScreen(s), 'main', { key: null });
    this.pushScreen(s);
  }

  menuPlace(list: string): MenuPlace {
    let place = this.menuPlaces.get(list);
    if (!place) this.menuPlaces.set(list, (place = { key: null }));
    return place;
  }

  openAchievements(): void {
    const s: AchievementsScreen = new AchievementsScreen(this.pageGame, () => this.popScreen(s), () => void this.openAchievementDetails(s));
    this.pushScreen(s);
  }

  /** The details take the page's place, and back returns to it. They show every maze ghost, whose pictures a player at the title may not have yet. */
  private async openAchievementDetails(page: AchievementsScreen): Promise<void> {
    await this.prepareArt(artForGroup('arcade'));
    this.popScreen(page);
    const s: AchievementDetails = new AchievementDetails(this.pageGame, () => { this.popScreen(s); this.openAchievements(); });
    this.pushScreen(s);
  }

  forgetFilterInput(texture: Texture): boolean {
    return forgetFilterInput(this.app.renderer.filter, texture);
  }

  /** Changes what the player has done across games, and pops up a notification for each achievement that earns. */
  noteProgress(change: (p: Progress) => void): void {
    const list = hundredList(this.content);
    const p = loadProgress();
    const before = earned(p, list);
    change(p);
    saveProgress(p);
    for (const id of earned(p, list)) if (!before.includes(id)) this.toastsWaiting.push(id);
  }

  /** The notification showing, and those waiting their turn. */
  private toast_: AchievementToast | null = null;
  private readonly toastsWaiting: AchievementId[] = [];

  private updateToasts(dt: number): void {
    if (this.toast_?.done) this.toast_ = null;
    if (!this.toast_ && this.toastsWaiting.length) {
      this.toast_ = new AchievementToast(this, this.toastsWaiting.shift()!);
      this.toastLayer.addChild(this.toast_.container);
      this.audio.play('achievement');
    }
    this.toast_?.update(dt);
  }

  openMoreSettings(): void {
    // On touch its band rests on the row chosen last, from wherever it is opened (the owner, 2026-11-12).
    const s: SettingsScreen = new SettingsScreen(this.pageGame, () => this.popScreen(s), 'more', this.menuPlace('more_settings'));
    this.pushScreen(s);
  }

  refreshCaps(): void {
    this.hud.refreshCaps();
    this.battle?.ui.refreshCaps();
  }

  /** Keeps a line or a fight result for the log page, dropping the oldest past its size. */
  record(entry: LogEntry): void {
    this.log.push(entry);
    if (entry.kind === 'fight') this.fightTranscript.push(entry.text);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }

  /** The page to reread recent lines and fight results. */
  openLog(): void {
    const l: LogScreen = new LogScreen(this.pageGame, () => this.popScreen(l));
    this.pushScreen(l);
  }

  /** The Controls page, for putting actions on other keys. */
  openControls(): void {
    const c: ControlsScreen = new ControlsScreen(this.pageGame, () => this.popScreen(c));
    this.pushScreen(c);
  }

  interruptBattle(): void {
    this.clearScreens();
    this.input.consume();
  }

  /** Decisions pause here. The Warsaw Pac's absolute fuse continues. */
  openPause(): void {
    // Only while the fight is going: not over the victory box or the defeat page.
    const phase = this.battle?.phase;
    if (this.battle?.bossInterrupting) return;
    if ((phase !== 'intro' && phase !== 'active') || this.screens.some((s) => s instanceof PauseScreen)) return;
    const pause: PauseScreen = new PauseScreen(this.pageGame, {
      resume: () => {
        this.audio.play('cancel');
        this.popScreen(pause);
      },
      settings: () => this.openSettings(),
      log: () => this.openLog(),
      quit: () => this.confirmQuit(false),
    });
    this.pushScreen(pause);
  }

  /**
   * Asks before going to the title page. From the party menu the game is saved
   * first; from a fight it cannot be, so the next Continue starts from the last save.
   */
  /**
   * Before Reduce motion goes on from Settings (the owner, 2026-10-26: ask for confirmation when a player switches it
   * on), or the Print filter goes off; the question explains the setting, which has no caption (the owner, 2026-11-11);
   * or Battery saver goes on (the owner, 2026-11-14).
   * Going back, and the device's own Reduce Motion at the first start, don't ask.
   */
  confirmSetting(setting: 'motion' | 'halftone' | 'battery', onYes: () => void): void {
    const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
      message: this.msg('settings', `${setting}_confirm`),
      yes: this.msg('settings', `${setting}_yes`),
      no: this.msg('settings', `${setting}_no`),
      // On touch the glove points at the answer that changes nothing (the owner, 2026-11-12).
      glove: true,
      onNo: () => {
        this.audio.play('cancel');
        this.popScreen(c);
      },
      onYes: () => {
        this.popScreen(c);
        onYes();
      },
    });
    this.pushScreen(c);
  }

  ask(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
        message: question,
        yes: this.msg('story', 'yes'),
        no: this.msg('story', 'no'),
        yesFirst: true,
        onNo: () => {
          this.audio.play('cancel');
          this.popScreen(c);
          resolve(false);
        },
        onYes: () => {
          this.popScreen(c);
          resolve(true);
        },
      });
      this.pushScreen(c);
    });
  }

  confirmQuit(save: boolean): void {
    const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
      message: this.msg('quit', 'confirm'),
      yes: this.msg('quit', 'yes'),
      no: this.msg('quit', 'no'),
      // Asked from a fight's Pause, on touch the glove points at Stay too (the owner, 2026-11-12).
      glove: !save,
      onNo: () => {
        this.audio.play('cancel');
        this.popScreen(c);
      },
      onYes: () => {
        // Keep progress before leaving. If the browser refuses, stay, say so, and ask again.
        if (save && this.playing && this.world && !this.fightInProgress() && !this.write()) {
          this.autosaveWarned = true;
          this.popScreen(c);
          this.toast(this.msg('system', 'save_failed'));
          this.confirmUnsaved();
          return;
        }
        this.quitToTitle(false);
      },
    });
    this.pushScreen(c);
  }

  /** After a save the browser refused: quit anyway, and lose what was not saved, or stay. */
  private confirmUnsaved(): void {
    const c: ConfirmScreen = new ConfirmScreen(this.pageGame, {
      message: this.msg('quit', 'unsaved'),
      yes: this.msg('quit', 'yes_anyway'),
      no: this.msg('quit', 'no'),
      onNo: () => {
        this.audio.play('cancel');
        this.popScreen(c);
      },
      onYes: () => this.quitToTitle(false),
    });
    this.pushScreen(c);
  }

  private abandoning = false;

  /** Leaves play for the title page, saving first if asked; a fight in progress is given up. */
  quitToTitle(save: boolean): void {
    if (save && this.playing && this.world && !this.fightInProgress()) this.write();
    if (this.battle) {
      this.abandoning = true;
      this.battle.forceEnd('lost');
    }
    this.toTitle();
  }

  openShop(priceList?: string): Promise<void> {
    return new Promise((resolve) => {
      const s: Shop = new Shop(this.pageGame, () => this.popScreen(s), priceList ? this.content.shops[priceList]!.prices : {});
      this.screenWaits.set(s, resolve);
      this.pushScreen(s);
    });
  }

  /**
   * A chapter's front page. It turns in like a newspaper page, and turns away when the player goes on.
   * `covered` runs under the old-map snapshot before the slide starts. The opaque newspaper edge
   * wipes that snapshot away to reveal the new map; the page cannot turn away before its arrival finishes.
   */
  async showFrontPage(chapter: string, covered?: () => void): Promise<void> {
    const ch = this.content.frame.chapters.find((c) => c.id === chapter);
    if (!ch) {
      covered?.();
      return Promise.resolve();
    }
    // Scripted pages count as chapters too, just like pages shown during a map change.
    if (!this.state.chapters.includes(chapter)) this.state.chapters.push(chapter);
    // The tall newsprint page slides in like a wipe: the map being left stays to its left as a picture, and the new map
    // is uncovered behind its right edge (the owner, 2026-10-19).
    const snapshot = this.snapshotWorld();
    return new Promise((resolve) => {
      let under: Promise<void> = Promise.resolve();
      const fp: TallPage = new TallPage(this.newspaperGame, {
        headline: ch.headline,
        // Drawn when the page is made; a chapter with no picture of its own shows hot pink under its own name.
        picture: CHAPTER_PICTURE[ch.id] ?? ch.id,
        issue: Math.max(1, this.state.chapters.length),
        snapshot,
        // The page owns the picture of the old map and lets go of it when it closes, however it closes.
        onDone: () => void under.then(() => fp.turnOut()).then(() => this.popScreen(fp)),
      });
      this.screenWaits.set(fp, resolve);
      this.pushScreen(fp);
      // The new map goes in at once, under the picture of the old one, so the sliding page uncovers it as it comes.
      covered?.();
      under = fp.turnIn();
    });
  }

  /**
   * What each page's picture of the map is put together in. One for the session: Pixi keeps a batcher for every container it has
   * drawn off screen, for good (BatcherPipe, Pixi 8.20.1), so a new one for each page left one behind each page.
   */
  private readonly snapshotComposer = new Container();

  /** The map as it is drawn now, for a page to keep beside it after the map has changed: the picture and its backdrop colour. */
  private snapshotWorld(): { texture: Texture; backdrop: number } | null {
    const w = this.world;
    if (!w) return null;
    const p = this.layout.panel;
    try {
      // In the owner's Firefox the first picture drawn off screen in a session left out every sprite: the first newspaper page
      // after a ?dev&map= start, which skips the title, showed the map being left as bare ground (5 Nov 2026). A picture
      // thrown away first fixed it there; headless browsers never did it. See docs/pixi_dependencies.md, section 4.
      this.app.renderer.generateTexture({ target: this.worldLayer, frame: new Rectangle(0, 0, p.w, p.h), resolution: this.app.renderer.resolution }).destroy(true);
      const map = this.app.renderer.generateTexture({ target: this.worldLayer, frame: new Rectangle(0, 0, p.w, p.h), resolution: this.app.renderer.resolution });
      const page = this.newspaperLayout.panel;
      const composed = this.snapshotComposer, view = new Container();
      composed.addChild(new Graphics().rect(0, 0, page.w, page.h).fill(0x000000));
      view.addChild(new Graphics().rect(0, 0, p.w, p.h).fill(w.backdrop), new Sprite(map));
      // Preserve the map and its black bands inside the larger chapter-page wipe.
      const pageScale = this.newspaperLayer.scale.x;
      const scale = this.viewport.scale.x / pageScale;
      view.scale.set(scale);
      view.position.set(this.viewport.x / pageScale + p.x * scale - page.x,
        this.viewport.y / pageScale + p.y * scale - page.y);
      composed.addChild(view);
      try {
        const texture = this.app.renderer.generateTexture({ target: composed, frame: new Rectangle(0, 0, page.w, page.h), resolution: this.app.renderer.resolution * pageScale });
        return { texture, backdrop: 0x000000 };
      } finally {
        // With `context`, the two backdrops let go of what Pixi made of them now, not a minute and a half later.
        for (const c of composed.removeChildren()) c.destroy({ children: true, context: true });
        map.destroy(true);
      }
    } catch (e) {
      console.error('Could not keep a picture of the map', e);
      return null;
    }
  }

  /**
   * Turns a full page in from the right, or away to the left, with a hard shadow strip along
   * its edge. Without motion, it simply appears and goes.
   */
  private turning = new Set<Screen>();

  private async turnPage(page: Screen, way: 'in' | 'out'): Promise<void> {
    if (motion.reduced) return;
    this.turning.add(page);
    const p = (this.fullScreenPage(page) ? this.pageLayout : this.layout).panel;
    const shade = new Graphics();
    this.parentForScreen(page).addChild(shade);
    const u = this.layout.unit;
    const stripW = Math.round(u * 0.8);
    const rule = Math.max(2, Math.round(u * 0.16));
    await anim.run(page, way === 'in' ? MS.pageIn : MS.pageOut, EASE.smooth, (k) => {
      if (page.container.destroyed) return;
      const x = way === 'in' ? p.w * (1 - k) : -p.w * k;
      page.container.x = x;
      // The page casts a hard shadow strip on what it is turning over, as printed, with an ink rule along its own edge.
      // Turning in, the strip falls to the left of the page's leading edge; turning out, to the right of its trailing edge.
      shade.clear();
      const edge = way === 'in' ? x : x + p.w;
      if (edge <= 0 || edge >= p.w) return;
      shade.rect(way === 'in' ? edge - stripW : edge, 0, stripW, p.h).fill({ color: INK, alpha: 0.3 });
      shade.moveTo(edge, 0).lineTo(edge, p.h).stroke({ width: rule, color: INK });
    });
    shade.destroy();
    this.turning.delete(page);
    if (!page.container.destroyed && way === 'in') page.container.x = 0;
  }

  async showPicture(name: string, covered?: () => void): Promise<void> {
    // The view still closing in on the arcade's carries on under the page.
    this.landNarrowing();
    // An isometric picture waits for the ending's art, which its figures and props are in; any other, for its own file.
    const need = isIsoScene(name) ? artForGroup('ending') : [`pictures/${name}`];
    if (!artReady(need)) await this.prepareArt(need);
    // Rapidly advancing a caption lands the page still sliding in, and the one under it goes, before another comes.
    this.pictureLanding?.();
    const old = this.picture;
    const words = this.content.endingPages[name]!;
    // An ending's page is printed as the chapters' and the lost fights' are (the owner, 2026-11-13: "the same format for all"),
    // and spins in as the ending pictures always have, over the one before it, which goes once this one has landed.
    const page: TallPage = new TallPage(this, { headline: words.headline, picture: name, issue: words.issue,
      stamp: words.stamp, snapshot: null, narrated: true });
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      if (this.pictureLanding === landNow) this.pictureLanding = null;
      // Cleared screens abandon it.
      if (!this.screens.includes(page)) return;
      if (old && this.screens.includes(old)) this.popScreen(old);
      covered?.();
    };
    const landNow = () => { page.finishEntry(); land(); };
    this.pictureLanding = landNow;
    this.picture = page;
    this.pushScreen(page);
    void page.spinIn().then(land);
  }

  pictureCaption(full: string) {
    // On an ending's page, the caption lies over the foot of the story, as a lost fight's coupon does.
    return this.picture && this.screens.includes(this.picture) ? endingCaptionSlot(full, this.layout.panel, this.layout.unit) : undefined;
  }

  finishPictureEntry(): void { this.pictureLanding?.(); }

  /**
   * The ending's slow narrowing back to the arcade's view, `after` seconds from now, when the ending music comes in
   * (the owner, 2026-10-19: "At the ending when the ending music starts, slowly narrow the top and bottom back").
   */
  narrowForEnding(after: number): void {
    if (this.arcadeBack) return;
    this.endingNarrow = Math.max(0, after);
  }

  private startNarrowing(): void {
    this.endingNarrow = null;
    this.arcadeBackSeconds = ENDING_NARROW_SECONDS;
    this.arcadeBack = true;
    // It closes in more and more slowly and never arrives by itself (the owner, 2026-11-13: "the camera should continue
    // to move slow towards a letterbox (but not actually arriving at it before the pixelate and newspaper spins in)").
    this.viewLift.setLift(0, ENDING_NARROW_SECONDS, true);
  }

  /** The ending's narrowing, still closing in, goes the rest of the way at about its own pace, ENDING_LAND_MIN_S at least. */
  private landNarrowing(): void {
    if (this.viewLift.open) this.viewLift.land(Math.max(ENDING_LAND_MIN_S, this.viewLift.lift * ENDING_NARROW_SECONDS / 1.5));
  }

  async returnToArcade(opts: { wait?: boolean } = {}): Promise<void> {
    // Prepare before starting, so [arcade back] and the following first box begin together, even on a cold load.
    if (!artReady(artForGroup('ending'))) await this.prepareArt(artForGroup('ending'));
    // Already narrowing slowly from the ending music, or about to: carry on at that pace.
    if (this.endingNarrow !== null) this.startNarrowing();
    this.arcadeBack = true;
    if (this.viewLift.lift === 0) return;
    this.arcadeReturn ??= new Promise((resolve) => { this.arcadeLanded = resolve; });
    if (opts.wait === false) return;
    this.landNarrowing();
    await this.arcadeReturn;
  }

  private landArcade(): void {
    const landed = this.arcadeLanded;
    this.arcadeLanded = null;
    this.arcadeReturn = null;
    landed?.();
  }

  async fin(): Promise<void> {
    if (!artReady(artForGroup('ending'))) await this.prepareArt(artForGroup('ending'));
    // The game is finished once the credits roll (the owner, 2026-10-23: "the save shouldn't clear until after the
    // credits start rolling"): the browser save goes, and saveGame keeps it gone, so the title offers no Continue until a
    // new game saves. Quit before this and Continue still goes back to the last save before the boss.
    this.state.flags.finished = true;
    this.saveNow();
    this.noteProgress((p) => { p.finished = true; });
    await new Promise<void>((resolve) => {
      const credits = new CreditsScreen(this, () => { void this.creditsToTitle(); });
      this.screenWaits.set(credits, resolve);
      this.pushScreen(credits);
    });
  }

  /** The whole reel breaks up, swaps to the title at the biggest blocks, then sharpens there. */
  private async creditsToTitle(): Promise<void> {
    this.transitioning = true;
    try {
      await this.mosaic('out', false, true);
      // Back from the credits, the pointer waits on what finishing the game just earned (the owner, 2026-11-02).
      this.toTitle(true);
      await this.mosaic('in', false, true);
    } finally {
      this.endMosaic();
      this.transitioning = false;
    }
  }

  worldSeed(map: string): number {
    return hashSeed(this.runSeed, 'world', map, this.worldsBuilt++);
  }

  // ---------------------------------------------------------------------------------------------
  // Fights

  async startBattle(encounter: string, enemies: Actor[]): Promise<BattleOutcome> {
    const w = this.world;
    if (!w || this.fightInProgress() || !enemies.length) return 'lost';
    // A fight ends a tapped walk, whichever way it started (a scene's fight passed it by: Fable review P11).
    w.endTappedWalk?.();
    const patrolFight = enemies.some(e => w.patrols.has(e) && e.obj?.props.relentless !== true && e.obj?.props.confined !== true);
    this.fights++;
    this.fightTranscript = [`Fight: ${encounter}`];
    try {
      const sceneState = this.sceneReturn?.world === w ? this.sceneReturn.state : null;
      const snapshot = sceneState ? structuredClone(sceneState) : { ...structuredClone(this.state), ...w.retryPoint() };
      // Formation moves actors. Keep wandering enemies on their pre-fight side of the
      // party when rebuilding; pursuing guards intentionally return to their patrols.
      const enemyPositions = sceneState ? [] : w.enemies.filter(e => e.obj?.props.behavior !== 'pursue').map(e => ({
        id: e.id, x: e.x, y: e.y, facing: e.facing, aiTimer: e.aiTimer,
      }));
      this.battle = new Battle(this, w, encounter, enemies, mulberry32(hashSeed(this.runSeed, 'battle', this.battlesStarted++)));
      this.uiLayer.addChild(this.battle.ui.container);
      const data = this.content.encounters[encounter];
      const keepVictoryStage = Boolean((data?.boss || data?.keep_framing) && data.after);
      const outcome = await this.battle.run(keepVictoryStage);
      const retryLine = this.battle.retryLine;
      const getaway = this.battle.getaway;
      // A lost fight leaves its cards up over the fallen party (src/battle/battle.ts), still moving (the dizzy stars turn; the
      // owner, 2026-11-04): they go once the defeat page has its choice, or at once when the player quit.
      const fightUi = this.battle.ui;
      if (outcome === 'lost') this.lostFight = fightUi;
      const dropFightUi = () => {
        if (this.lostFight === fightUi) this.lostFight = null;
        if (!fightUi.container.destroyed) fightUi.destroy();
      };
      this.battle = null;
      // The player quit the fight from the pause page: no defeat page, the title comes next.
      if (this.abandoning) {
        this.abandoning = false;
        dropFightUi();
        return 'lost';
      }
      if (outcome === 'won') {
        // Preserve this accomplishment for the future ending easter egg.
        if (encounter === 'boss') this.state.flags.warsaw_without_speed_pellet = !snapshot.taken.includes('field:speed_pellet');
        if (data?.flag) this.state.flags[data.flag] = true;
        // Recorded before anything can save, so a save never has the reward without the win.
        if (this.world === w) w.recordDefeat(encounter);
        try {
          if (data?.after) await this.runScene(data.after);
        } finally {
          // The scene normally releases its framing with [camera party]. Also clean up
          // when it is skipped, without touching a new world entered by the ending, and
          // fall back in behind the leader, as an unstaged win does at once.
          if (keepVictoryStage && this.world === w) {
            w.releaseFightCamera();
            w.control = true;
            w.lineUp();
          }
        }
        return 'won';
      }
      const rescued = encounter === 'boss' && !snapshot.taken.includes('field:speed_pellet');
      // Ronnienomics!: the party slipped away under the flashback's blocks (Battle.escape), and the fight starts again as
      // Retry does after a wipe, without the defeat page or its retry line (the owner, 2026-11-07: "a quick retry instead
      // of having to wait for a wipe").
      const quick = outcome === 'fled';
      const choice = quick ? 'retry' : await this.defeatScreen(rescued, encounter === 'boss');
      // The page stays up while what comes next is set up under it (the map again, the save, the title), then turns
      // away over it to the left, as a chapter's page does. The owner, 2026-10-16: "After the nuke ending, the paper
      // doesn't run away to the left, it just disappears."
      const page = quick ? null : this.detachDefeatPage();
      dropFightUi();
      try {
        // Leaving a lost fight also abandons the scene that started it, including any later rewards.
        this.story.skip();
        this.dialogue.clear();
        if (choice === 'retry' && this.world === w) {
          // Items used in a fight got away from come back with the retry, and the one who got the party away may say so.
          const itemsBack = Object.entries(snapshot.items).some(([id, n]) => (this.state.items[id] ?? 0) < n);
          // Ronnienomics! failures count for the whole game, one in the fight given up as well (the debt keeps rising), and so
          // do its getaways, this one included.
          const { escapesFailed: failed, escapesMade: made } = this.state;
          this.state = snapshot;
          if (failed) this.state.escapesFailed = Math.max(failed, snapshot.escapesFailed ?? 0);
          if (made) this.state.escapesMade = Math.max(made, snapshot.escapesMade ?? 0);
          // Back from a lost boss fight, by either way: the trio and Berlin's townspeople speak of it (`warsaw_lost`).
          if (encounter === 'boss') this.state.flags.warsaw_lost = true;
          this.input.consume();
          // An unprepared defeat sends the party back to the city where they can find
          // the speed pellet, with the same resources and progress as before the fight.
          if (encounter === 'boss' && !snapshot.taken.includes('field:speed_pellet')) {
            this.state.flags.warsaw_speed_hint = true;
            if (!artReady(artForMap('field'))) await this.prepareArt(artForMap('field'));
            // The page slides away as soon as the choice is made, while the scene behind it goes through the flashback.
            const away = this.turnAway(page);
            await this.mosaic('out');
            this.enterMap('field', 'from_border', { preserveVisit: true });
            this.world!.protectUntilMovement();
            await this.mosaic('in');
            // The page has gone before the trio speaks.
            await away;
            await this.runScene('warsaw_retry');
            return 'lost';
          }
          // Rebuild enemies and scene props from before the encounter. Preserve this visit's
          // collected pellets and defeated enemies, even on maps with entry-reset rules.
          // A map may return a lost encounter to a named approach, outside its patrol territory.
          const retrySpawn = w.map.props[`retry_${encounter}`];
          const at = typeof retrySpawn === 'string' && w.spawnPoint(retrySpawn)
            ? retrySpawn : { x: snapshot.x, y: snapshot.y, facing: snapshot.facing };
          // The page slides away as soon as the choice is made, while the scene behind it goes through the flashback.
          void this.turnAway(page);
          // An escape has the blocks at their biggest already.
          if (!quick) await this.mosaic('out');
          this.enterMap(snapshot.map, at, { preserveVisit: true, resumeMusic: true });
          for (const { id, ...position } of enemyPositions) {
            const enemy = this.world!.actor(id);
            if (enemy) Object.assign(enemy, position);
          }
          this.world!.protectUntilMovement();
          // Ronnienomics!: back on the map, the one who got them away has a word for it, on top of the party's stack, each
          // line once in a game (the scene's own id is its flag); after both, they stand as ever, quiet (the owner,
          // 2026-11-07).
          const quips = getaway?.quips ?? {};
          const quip = [itemsBack ? quips.items_back : undefined, quips.got_away].find((s) => s && !this.state.flags[s]);
          const speaker = quip && getaway ? this.world!.actor(getaway.by) : undefined;
          if (speaker) this.world!.onTopUntilMovement(speaker);
          await this.mosaic('in');
          if (quick) {
            if (quip) {
              this.state.flags[quip] = true;
              await this.runScene(quip);
            }
            return 'fled';
          }
          if (retryLine) await this.runScene(retryLine);
          return 'lost';
        }
        const saved = choice === 'load' ? loadGame(this.content) : null;
        // The page goes at once; the lost fight holds in the flashback's blocks until a cold saved chapter is in place.
        if (saved) {
          void this.turnAway(page);
          await this.mosaic('out');
          await this.resume(saved);
          await this.mosaic('in');
        } else this.toTitle();
        return 'lost';
      } finally {
        this.endMosaic();
        void this.turnAway(page);
      }
    } finally {
      this.fights--;
      if (patrolFight && this.world?.map.id === w.map.id) this.world.protectUntilMovement(PATROL_FIGHT_GRACE);
      this.autosave();
    }
  }

  /** `atOnce`: the paper comes in with the game-over sound rather than after it (the Warsaw Pac's fight). */
  private async defeatScreen(rescued = false, atOnce = false): Promise<'retry' | 'load' | 'title'> {
    this.audio.music(null);
    this.audio.play('game_over');
    // The sound plays out over the lost fight, then a breath, then the paper (the owner, 2026-11-04: "the game over sound
    // should fully play, then have a tiny tiny tiny pause before the newspaper slides in"). After the Warsaw Pac's fight the
    // party is already gone, so the paper comes with the sound (the owner, 2026-11-05: "the pause just seems makes it seem like
    // something should be happening. I think that the newspaper should slide in right when the game over sound effect plays,
    // as an exception to the rule").
    if (!atOnce) await this.delay(GAME_OVER_S + PAPER_AFTER_SOUND_S);
    // The page's isometric picture draws from art files (the rescue's Wall is Berlin's own panels), usually in already.
    const need = artForGroup(rescued ? 'rescue' : 'defeat');
    if (!artReady(need)) await this.prepareArt(need);
    return new Promise((resolve) => {
      // The page stays: the caller turns it away once what comes next is set up under it.
      const done = (c: 'retry' | 'load' | 'title') => resolve(c);
      const items: MenuItem[] = [{ label: this.msg('system', rescued ? 'rescued_retry' : 'retry'), onChoose: () => done('retry') }];
      if (!rescued) {
        if (hasSave(this.content)) items.push({ label: this.msg('system', 'load'), onChoose: () => done('load') });
        items.push({ label: this.msg('system', 'to_title'), onChoose: () => done('title') });
      }
      // The tall newsprint page slides in over the lost fight, which stays in view beside it (the owner, 2026-10-19).
      const fp: TallPage = new TallPage(this.newspaperGame, {
        headline: this.msg('system', rescued ? 'rescued_headline' : 'annihilated_headline'),
        stamp: rescued ? undefined : this.msg('system', 'game_over'),
        lead: rescued ? undefined : this.msg('system', 'annihilated_lead'),
        picture: rescued ? 'warsaw_rescue' : 'inferno',
        issue: Math.max(1, this.state.chapters.length),
        snapshot: null,
        menu: items,
      });
      this.defeatPage = fp;
      this.pushScreen(fp);
      // It slides in over the lost fight; its choices wait until it has landed.
      void fp.turnIn();
    });
  }

  /**
   * The old games' flashback: what is behind the page breaks into ever bigger blocks, in jumps (out), and after the
   * scene has changed under it, comes back sharp at the new spot (in). The owner, 2026-10-19: "have the map do a jumpy
   * pixelate out and back in to the spot, kind of like how old games would signal flashbacks".
   */
  private mosaicFilter: MosaicFilter | null = null;
  private mosaicLayers: Container[] = [];
  /**
   * While the flashback runs, the map it started on: the party is out of the player's hands (`storyBusy`) from its first
   * block until it is sharp again at the new spot, and that map's guards hold still while it breaks up.
   */
  private flashback: World | null = null;

  /** Ronnienomics!'s blocks over a fight, which already has the party out of the player's hands. */
  async flashbackBlocks(way: 'out' | 'in'): Promise<void> {
    await this.mosaic(way, false);
  }

  /** With `hold` (a flashback), the party is out of the player's hands until it is sharp again; the ending's way into
   * the credits only breaks up the picture. */
  private async mosaic(way: 'out' | 'in', hold = true, whole = false): Promise<void> {
    if (motion.reduced) return;
    const layers = whole ? [this.root] : [this.backdrop, this.worldLayer, this.uiLayer];
    if (!this.mosaicFilter) {
      this.mosaicFilter = new MosaicFilter(this.app.renderer.resolution);
      this.mosaicLayers = layers;
      for (const l of layers) l.filters = [...(l.filters ? [l.filters].flat() : []), this.mosaicFilter];
    }
    const f = this.mosaicFilter;
    if (hold && way === 'out' && !this.flashback && this.world) {
      this.flashback = this.world;
      this.world.control = false;
    }
    // On the game's clock, so it pauses with the game and a seeded run plays it the same every time.
    for (const b of mosaicSteps(way)) {
      f.block = b;
      await this.delay(MOSAIC.stepMs / 1000);
    }
    if (way === 'in') this.endMosaic();
  }

  /** While the title breaks up, the saved map behind it stays hidden: the panel draws over the title's own layer. */
  private titleCover = false;
  /** Unlike the cover, this hold survives the title/map swap until the map is sharp. */
  private titleMosaic = false;

  /**
   * Continue's and an accepted code's way from the map title into the saved map: the flashback's blocks over the whole
   * screen (title, menu and map on one grid), the swap at the biggest, then sharp at the saved spot. With Reduce motion
   * the map is simply there.
   */
  private async mosaicFromTitle(gone: () => void, progress?: (fraction: number) => void): Promise<void> {
    if (motion.reduced) { gone(); return; }
    const f = new MosaicFilter(this.app.renderer.resolution);
    this.root.filters = [...(this.root.filters ? [this.root.filters].flat() : []), f];
    const cover = (on: boolean) => {
      this.titleCover = on;
      this.worldLayer.visible = this.uiLayer.visible = this.backdrop.visible = !on;
    };
    this.titleMosaic = true;
    let completed = 0;
    try {
      progress?.(0);
      cover(true);
      for (const b of mosaicSteps('out')) {
        f.block = b;
        await this.delay(MOSAIC.stepMs / 1000);
        progress?.(++completed / (MOSAIC.out + MOSAIC.back));
      }
      cover(false);
      gone();
      for (const b of mosaicSteps('in')) {
        f.block = b;
        await this.delay(MOSAIC.stepMs / 1000);
        progress?.(++completed / (MOSAIC.out + MOSAIC.back));
      }
    } finally {
      this.titleMosaic = false;
      cover(false);
      this.root.filters = (this.root.filters ? [this.root.filters].flat() : []).filter((x) => x !== f);
      f.destroy();
    }
  }

  /** The credits' blue ground over the map, from the ending's way into the credits until the title. */
  private creditsBackdrop: Container | null = null;

  /**
   * The ending's way into the credits (the owner's idea, 2026-10-20: "use that pixelate out and in effect to bring the
   * background into the blue credits background while the newspapers are flying at the screen"). The map behind the party
   * breaks into the flashback's blocks as soon as the narration is done, the view still closing in on the arcade's: it goes
   * the rest of the way under the blocks and the first paper, arriving once that has spun in (the owner, 2026-11-13: they
   * "jump up and down for several seconds before the first newspaper appears"). At the blocks' biggest the credits' ground
   * takes their place, and it sharpens as the first paper flies in over it. The credits then run on the same ground.
   * Reduce motion swaps the ground at once.
   */
  async creditsGround(): Promise<void> {
    this.landNarrowing();
    if (this.creditsBackdrop) return;
    await this.mosaic('out', false);
    this.setCreditsBackdrop(true);
    void this.mosaic('in', false);
  }

  /**
   * Lays the credits' ground over the map and the party (under the pages), or takes it away. Its ink runs a block's
   * width past the panel's edges, so the biggest blocks along an edge come from the ground and not the map beyond it.
   */
  private setCreditsBackdrop(on: boolean): void {
    this.creditsBackdrop?.destroy({ children: true });
    this.creditsBackdrop = null;
    if (!on) return;
    const p = this.layout.panel, pad = MOSAIC.largest;
    const ground = new Container();
    ground.addChild(new Graphics().rect(-pad, -pad, p.w + pad * 2, p.h + pad * 2).fill(INK), finGround(this));
    this.creditsBackdrop = ground;
    this.uiLayer.addChildAt(ground, 0);
  }

  /** Takes the flashback's blocks off, also when what it covered failed part way. */
  private endMosaic(): void {
    // Still on the map it started on (what came next failed): that map is the player's again.
    const was = this.flashback;
    this.flashback = null;
    if (was && was === this.world) was.control = true;
    const f = this.mosaicFilter;
    if (!f) return;
    for (const l of this.mosaicLayers) l.filters = (l.filters ? [l.filters].flat() : []).filter((x) => x !== f);
    this.mosaicLayers = [];
    this.mosaicFilter = null;
  }

  /** A lost fight's cards, kept up and moving until the defeat page has its choice. */
  private lostFight: Battle['ui'] | null = null;
  /** The defeat page while its choice is acted on. */
  private defeatPage: TallPage | null = null;
  private turnedAway = new WeakSet<Screen>();

  /**
   * Takes the defeat page out of the screen stack, still drawn and taking no more choices, so what comes next can
   * clear the stack and build under it; `turnAway` then closes it.
   */
  private detachDefeatPage(): TallPage | null {
    const page = this.defeatPage;
    this.defeatPage = null;
    if (!page) return null;
    page.leave();
    const i = this.screens.indexOf(page);
    if (i >= 0) this.screens.splice(i, 1);
    return page;
  }

  /**
   * Turns a page that has left the screen stack away to the left over what is beneath it now, then closes it; once
   * only. Without motion it simply goes.
   */
  private async turnAway(page: Screen | null): Promise<void> {
    if (!page || this.turnedAway.has(page) || page.container.destroyed) return;
    this.turnedAway.add(page);
    // Above whatever the next scene has put up meanwhile.
    this.parentForScreen(page).addChild(page.container);
    if (page instanceof TallPage) await page.turnOut();
    else await this.turnPage(page, 'out');
    anim.finish(page);
    page.destroy();
  }

  // ---------------------------------------------------------------------------------------------
  // Saving and resting

  async rest(opts: { show?: boolean; quiet?: boolean } = {}): Promise<void> {
    for (const id of this.state.order) {
      const m = this.state.members[id]!;
      m.hp = m.maxHp;
      m.mp = m.maxMp;
    }
    const w = this.world;
    w?.party.forEach((a) => (a.ko = false));
    if (!opts.quiet) this.toast(this.msg('system', 'rested'));
    if (!opts.show || !w) {
      if (!opts.quiet) this.audio.play('heal');
      return;
    }
    this.audio.play('rest');
    await w.restGlow(() => this.story.skipping);
  }

  /** Writes a checkpoint quietly; a storage failure still needs a visible warning. */
  saveNow(): boolean {
    const ok = this.write();
    if (!ok) {
      this.toast(this.msg('system', 'save_failed'), { unique: true });
      // Having been told, the player is not told again by routine autosaves.
      this.autosaveWarned = true;
    }
    return ok;
  }

  /** Whether the player has been told this visit that the game could not save itself. */
  private autosaveWarned = false;

  /**
   * Saves quietly, but only at a safe point, so a save can never land in the middle of a scene or
   * fight. If the browser refuses (private browsing, no room), the player is told once a visit.
   */
  autosave(): void {
    // Stopped on an error: nothing is saved, and that is not the browser's storage failing.
    if (this.halted || !this.atRest() || this.write() || this.autosaveWarned) return;
    this.autosaveWarned = true;
    this.toast(this.msg('system', 'autosave_failed'));
  }

  /**
   * A game step threw. Before this the picture stood still for good, the music played on, input did nothing and a save
   * could still be written from the half-stepped state (Fable review F1, 2026-11-09). Now nothing more is stepped, drawn or
   * saved this visit, the error is logged (the check tools fail on it), the music stops, and a page says the progress up
   * to the last autosave is kept, with a Reload button. Other window errors stay logged only: the code voids promises on
   * purpose, and a harmless one must not stop a working game.
   */
  halt(err: unknown): void {
    if (this.halted) return;
    this.halted = true;
    this.loop.paused = true;
    console.error('The game stopped on an error in a game step; nothing more is saved this visit.', err);
    try { this.audio.stopForGood(); } catch { /* the sound may be what failed */ }
    showStopped({ title: this.msg('system', 'stopped_title'), text: this.msg('system', 'stopped_text'), reload: this.msg('system', 'stopped_reload') });
  }

  /** Writes the save. In development, first checks it would load again, so a mismatch shows the moment it happens. */
  private write(): boolean {
    if (this.halted) return false;
    // Between the boss falling and the game finishing, the save before the boss stays: an ending that failed before its first
    // picture left a save with the boss beaten and the game unfinished, from which nothing could start the ending again
    // (Fable review F4, 2026-11-09). Reported as written, so no "could not store" warning follows.
    if (this.state.flags?.boss_defeated && !this.state.flags.finished) return true;
    if (this.dev.enabled) {
      const r = checkState(structuredClone(this.state), this.content);
      if ('error' in r) console.error(`This save would not load again (${r.error}). Something wrote a value the save check refuses.`, this.state);
    }
    return saveGame(this.state);
  }

  delay(seconds: number): Promise<void> {
    return new Promise((resolve) => this.delays.push({ t: seconds, resolve }));
  }

  // ---------------------------------------------------------------------------------------------
  // Input routing

  /** Where a tap on the panel went: the dialogue, the fight, or the map. */
  private onPanelTap(x: number, y: number): 'dialogue' | 'battle' | 'world' | 'none' {
    if (this.dialogue.open) {
      this.dialogue.advance();
      return 'dialogue';
    }
    if (this.battle) {
      this.battle.ui.tap(x, y);
      return 'battle';
    }
    if (!this.world) return 'none';
    return this.world.tap(x, y) ? 'world' : 'none';
  }

  // ---------------------------------------------------------------------------------------------
  // Loop

  private bossTestTime = 0;
  private lockstepBattleClock = false;

  private update(dt: number): void {
    // While the loading page is up, the pointer moving over it is not over what lies under it: the title's rows lit
    // through it, and the cursor went with them (14 Nov).
    const events = this.app?.renderer?.events;
    if (events) {
      const loading = loaderShowing();
      if (events.features.move === loading) events.features.move = events.features.globalMove = !loading;
    }
    if (this.lockstepBattleClock) {
      this.bossTestTime += dt;
      this.battle?.updateAbsolute(this.bossTestTime);
    }
    // Held sideways, everything stands still under the card; presses made meanwhile are let go.
    if (this.sidewaysCard) {
      this.input.update(dt);
      if (this.input.gamepadActive) this.battle?.ui.clearHover();
      this.sidewaysCard.update(dt);
      return;
    }
    this.time += dt;
    if (this.loadingProblem === 'pending' && !loaderShowing() && !this.transitioning) this.askLoadingProblem();
    // Interface motion steps first, even under a paused fight, so a page over it finishes opening.
    anim.step(dt);
    this.input.update(dt);
    if (this.input.gamepadActive) this.battle?.ui.clearHover();
    // A fight with a page over it (the pause page, settings) stands completely still: its clock,
    // any attack in flight, its waits, and the map around it. Only the page itself runs, and the Warsaw
    // finale's placard: its fuse burns on the wall clock under a page too, so the placard keeps counting.
    const frozen = this.battle !== null && this.screens.length > 0;
    if (frozen) {
      this.screens[this.screens.length - 1]!.update(dt);
      if (this.battle!.finale) this.battle!.ui.drawFinaleClock();
      for (const fn of this.onUpdate) fn(dt);
      this.finishStep(dt, this.world);
      return;
    }
    if (this.playing) this.state.playTime += dt;
    for (const d of [...this.delays]) {
      d.t -= dt;
      if (d.t <= 0) {
        this.delays.splice(this.delays.indexOf(d), 1);
        d.resolve();
      }
    }
    for (const fn of this.onUpdate) fn(dt);

    // A key that closes a screen must not also reopen the menu on the same step.
    const hadScreen = this.screens.some((s) => s.blocking);
    const top = this.screens[this.screens.length - 1];
    top?.update(dt);

    this.dialogue.update(dt);
    this.battle?.update(dt);
    this.lostFight?.update(dt);
    const w = this.world;
    if (w) {
      if (this.holding && !this.dialogue.open && !this.battle) {
        this.holdTimer -= dt;
        if (this.holdTimer <= 0) {
          this.holdTimer = 0.2;
          this.holdSteered = true;
          w.tap(this.holdPos[0], this.holdPos[1], { repeat: true });
        }
      }
      w.runTasks(dt);
      w.update(dt);
      const free = !hadScreen && !this.fightInProgress() && !this.storyBusy() && !this.screens.length;
      // Cancel also reads text, so a press mashed through the end of a talk does not open the menu.
      const mashed = this.time - this.dialogue.closedAt < 0.6;
      if (free && (this.input.pressed('menu') || (this.input.pressed('cancel') && !mashed))) this.openPartyMenu();
      // In a fight, the menu key pauses; cancel stays with the fight's own menus.
      if (!hadScreen && this.battle && !this.screens.length && this.input.pressed('menu')) this.openPause();
    }
    this.finishStep(dt, w);
  }

  /** The end of every step, paused or not: saving, the paper's news, what is visible. */
  private finishStep(dt: number, w: World | null): void {
    // Save whenever a scene has just finished and the game is back at rest.
    const storyBusy = this.story.busy;
    if (this.storyWasBusy && !storyBusy) this.autosave();
    this.storyWasBusy = storyBusy;
    if (this.titleFrameExit) {
      this.titleFrameExit.age += dt;
      if (this.titleFrameExit.age >= this.titleFrameExit.seconds) this.titleFrameExit = null;
    }
    if (w && !this.battle) this.audio.setMusicShare(w.musicShare());
    // A map title diving into the house counts as gone: the view stays as play will show it, rather than swelling.
    const diving = this.title instanceof TitleMap && this.title.diving;
    this.moveView(dt, w, diving);
    this.placeViewport();
    // A page still turning in or out does not hide the map beneath it yet.
    const opaque = this.screens.some((s) => s.opaque && !this.turning.has(s));
    // While the map title dives the house's view shows as it grows, without the panel's black ground or the HUD.
    this.worldLayer.visible = !opaque && !this.titleCover;
    this.uiLayer.visible = (!opaque || this.battle !== null) && !diving && !this.titleCover;
    this.battleHeaderLayer.visible = this.uiLayer.visible && !!this.battle?.ui.container.visible;
    this.hudEdgeLayer.visible = this.uiLayer.visible;
    this.backdrop.visible = !diving && !this.titleCover;
    this.hud.update(dt, Boolean(w?.control) && this.playing && !this.storyBusy() && !this.fightInProgress() && !this.screens.length);
    this.updateToasts(dt);
  }

  private render(): void {
    const held = this.holding && !this.dialogue.open && !this.battle ? this.holdPos : null;
    this.world?.render(this.time, held);
    for (const fn of this.onRender) fn();
    const on = this.settings.reduceMotion, burst = MARK_BLINKS * MARK_BLINK_S;
    if (!on) this.reducedMarkOn = -1;
    else if (this.reducedMarkOn < 0) this.reducedMarkOn = this.time;
    const since = on ? (this.time - this.reducedMarkOn) % (burst + MARK_REST_S) : 0;
    this.reducedMark.visible = on;
    // Brighter for the first half of each blink, easing up and down at its ends. The see-through amount eases smoothly;
    // the red moves in MARK_COLOUR_STEPS steps, each drawing the letters again.
    const phase = since % MARK_BLINK_S, half = MARK_BLINK_S / 2;
    const k = on && since < burst && phase < half ? EASE.smooth(Math.min(1, phase / MARK_EASE_S, (half - phase) / MARK_EASE_S)) : 0;
    const colour = mixColour(MARK_RED, MARK_BRIGHT, Math.round(k * MARK_COLOUR_STEPS) / MARK_COLOUR_STEPS);
    if (colour !== this.reducedMarkColour) { this.reducedMarkColour = colour; this.reducedMark.style.fill = colour; }
    this.reducedMark.alpha = MARK_RED_ALPHA + (MARK_BRIGHT_ALPHA - MARK_RED_ALPHA) * k;
    // On a narrow upright phone the marker would run under the Stats/Item button in the same corner; then it sits just
    // above the button, still at the left. The fight's menu may still be overlapped a little, as the owner allowed.
    if (on) {
      const mark = this.reducedMark, button = this.hudEdgeLayer.visible ? this.hud.menuBounds() : null;
      let foot = this.reducedMarkFoot;
      if (button) {
        // Both corners, then the nearer edges: on a turned phone the box's first corner is not its top left in the page's
        // own space (Fable review MU, 2026-11-09).
        const a = this.root.toLocal({ x: button.x, y: button.y }), b = this.root.toLocal({ x: button.x + button.w, y: button.y + button.h });
        const at = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
        if (mark.x + mark.width > at.x && foot > at.y) foot = at.y - this.reducedMarkEdge;
      }
      mark.y = foot - mark.height;
    }
  }
}
