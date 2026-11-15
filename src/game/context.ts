import type { Container } from 'pixi.js';
import type { Content } from '../content/content.ts';
import type { AudioSystem } from '../audio/audio.ts';
import type { Input } from '../engine/input.ts';
import type { Layout } from '../engine/layout.ts';
import type { Actor } from '../world/actor.ts';
import type { World } from '../world/world.ts';
import type { Settings } from './settings.ts';
import type { GameState } from './state.ts';
import type { SceneOptions } from '../story/story.ts';

/** `fled`: the party slipped out (Ronnienomics!), and the fight starts again from its beginning, as Retry does after a wipe. */
export type BattleOutcome = 'won' | 'lost' | 'fled';

/** One entry in the log of recent lines: who said it (empty for narration and fights), the words, and what kind. */
export interface LogEntry {
  speaker: string;
  text: string;
  kind: 'line' | 'caption' | 'fight';
}

/** What the game's parts need from the game as a whole. */
export interface GameContext {
  /** Live presentation density; renderer-free contexts use one pixel per CSS pixel. */
  readonly renderResolution?: number;
  /** Live play-time expansion outside the logical panel; renderer-free contexts use unit scale. */
  readonly viewportScale?: number;
  /** Upright canvas content, including the frame; full-screen scene effects sit here. */
  readonly root: import('pixi.js').Container;
  /** Behind the panel across the whole window, for a title drawn round it (the map title). */
  readonly titleLayer: import('pixi.js').Container;
  /** Over the map and under the pages and the dialogue: the fight's lists, the HUD, a story's own effects. */
  readonly uiLayer?: import('pixi.js').Container;
  /** Battle controls may use the safe letterbox around the map, in panel coordinates. */
  readonly battleHeaderLayer?: import('pixi.js').Container;
  battleHeaderBounds?(): import('../engine/layout.ts').Rect;
  /** The safe screen edges in the panel-aligned layers' coordinates, with no margin. */
  screenEdges?(): import('../engine/layout.ts').Rect;
  /** Makes the filter system forget a pooled texture before it is destroyed; false while a filter draws into it (src/render/filter_slots.ts).
   * Renderer-free contexts have no filter system. */
  forgetFilterInput?(texture: import('pixi.js').Texture): boolean;
  /** Changes what the player has done across games; renderer-free contexts have no achievements. */
  noteProgress?(change: (p: import('./achievements.ts').Progress) => void): void;
  readonly content: Content;
  state: GameState;
  readonly input: Input;
  readonly audio: AudioSystem;
  readonly settings: Settings;
  layout: Layout;
  /** Simulated seconds since the game started. */
  time: number;
  /**
   * The seed for a map's own random numbers (where enemies wander, and when), new each time a map is
   * built: drawn from the run's seed, so a run with a fixed seed (`?seed=`) plays the same every time.
   */
  worldSeed(map: string): number;
  world: World | null;
  readonly dev: DevFlags;
  msg(group: string, key: string, vars?: Record<string, string | number>): string;
  toast(text: string, opts?: { unique?: boolean }): void;
  /** The notifications over everything (an achievement earned, a toast): a screen can keep a control clear of them. */
  readonly toastLayer: Container;
  /** Shows a gain large, low in the middle of the panel, as the place's name is shown. */
  announce(text: string): void;
  runScene(id: string, opts?: SceneOptions): Promise<void>;
  storyBusy(): boolean;
  /** A menu, shop, front page, or battle is up, so the party cannot walk. */
  screensOpen(): boolean;
  battleActive(): boolean;
  startBattle(encounter: string, enemies: Actor[]): Promise<BattleOutcome>;
  changeMap(map: string, spawn: string, opts?: { instant?: boolean; dir?: import('../art/geom.ts').Dir }): Promise<void>;
  openShop(priceList?: string): Promise<void>;
  showFrontPage(chapter: string): Promise<void>;
  /** Starts a picture without holding its caption; `covered` runs once its sheet covers the panel. */
  showPicture(name: string, covered?: () => void): Promise<void>;
  /** Optional page-owned caption space; ordinary narration continues to follow its speaker. */
  pictureCaption?(full: string): import('../engine/layout.ts').Rect | undefined;
  /** A dialogue tap lands an entering picture without consuming the dialogue action. */
  finishPictureEntry?(): void;
  fin(): Promise<void>;
  /** Narrows the view back to the arcade's for the ending's pictures, the credits and FIN; settles once it is all the
   * way back, or once it starts with `wait: false`. Pictures always wait for it to be back. */
  returnToArcade(opts?: { wait?: boolean }): Promise<void>;
  narrowForEnding(after: number): void;
  /** Once the view is back, the map breaks into the flashback's blocks and comes back as the credits' ground; settles
   * when the blocks are at their biggest, so the next picture flies in as the ground sharpens. */
  creditsGround(): Promise<void>;
  toTitle(): void;
  autosave(): void;
  /** Resolves after this many seconds of game time. */
  delay(seconds: number): Promise<void>;
  /** The flashback's blocks over the map and the fight, growing (`out`) or sharpening again (`in`); for Ronnienomics!. */
  flashbackBlocks(way: 'out' | 'in'): Promise<void>;
  /** Restores the party's HP and MP; `show` plays it big, as at the save star, and resolves when that is over. */
  rest(opts?: { show?: boolean; quiet?: boolean }): Promise<void>;
  /** Writes a checkpoint quietly and warns if the browser refuses. */
  saveNow(): boolean;
  /** Page pixels for a point on the panel, for the few HTML elements laid over the canvas. */
  panelToPage(x: number, y: number): [number, number];
  panelRectToPage(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number };
  /** The party menu's save code page. */
  openSaveCode(): void;
  /** The pause page, during a fight. */
  openPause(): void;
  /** The boss fuse closes any pause/settings page when its blast interrupts. */
  interruptBattle(): void;
  /** The secondary Settings page for text and presentation preferences. */
  openMoreSettings(): void;
  /** The Controls page, for putting actions on other keys. */
  openControls(): void;
  /** Asks, then goes to the title page; `save` saves first (not possible mid-fight). */
  confirmQuit(save: boolean): void;
  /** A question put to the player in a story, on the yes/no card; true for Yes. */
  ask(question: string): Promise<boolean>;
  /** Asks before Reduce motion goes on or the Print filter goes off, the answer that changes nothing first; `onYes` makes the change. */
  confirmSetting(setting: 'motion' | 'halftone' | 'battery', onYes: () => void): void;
  /** Lays everything out again, such as after the text size changes. */
  relayout(): void;
  readonly dialogue: import('../story/dialogue.ts').Dialogue;
  /** Recent lines and fight results, oldest first, for this visit only. */
  readonly log: LogEntry[];
  record(entry: LogEntry): void;
  /** The page to reread them. */
  openLog(): void;
  /** Draws the key caps again, after the device in use or the keys change. */
  refreshCaps(): void;
  /**
   * Where a list was left, kept for this visit to the game, by the list's name: on touch its band rests there the next time
   * (the owner, 2026-11-12). Renderer-free contexts keep none.
   */
  menuPlace?(list: string): import('../ui/widgets.ts').MenuPlace;
}

export interface DevFlags {
  enabled: boolean;
  overlay: boolean;
  noclip: boolean;
  god: boolean;
  /** Skips battles when touching enemies. */
  peace: boolean;
  fastText: boolean;
}
