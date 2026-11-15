import { z } from 'zod';

/** Schemas for the YAML files in content/data/. Each file is checked when the game loads and by `npm run check`. */

const statBlock = z.strictObject({
  name: z.string(),
  look: z.string(),
  hp: z.number().int().positive(),
  mp: z.number().int().nonnegative(),
  speed: z.number().nonnegative(),
  strength: z.number().int().positive(),
  accuracy: z.number().min(0).max(100),
});

export const partySchema = z.strictObject({
  order: z.array(z.string()).min(1),
  members: z.record(z.string(), statBlock),
  level_up: z.strictObject({
    hp: z.number().int(),
    mp: z.number().int(),
    strength: z.number().int(),
    accuracy: z.number(),
    speed: z.number().default(0),
  }),
  xp_to_next: z.array(z.number().int().positive()).min(1),
  start: z.strictObject({
    dots: z.number().int().nonnegative(),
    items: z.record(z.string(), z.number().int().nonnegative()),
    map: z.string(),
    spawn: z.string(),
    scene: z.string().optional(),
  }),
});

export const specialSchema = z.strictObject({
  name: z.string(),
  /** What the member yells on the move's cut-in, in place of its name. */
  shout: z.string().optional(),
  mp: z.number().int().nonnegative(),
  /** How far the user's time bar drops after using it, in bar units. */
  cost: z.number().positive(),
  target: z.enum(['all_enemies', 'one_enemy', 'party', 'one_member']),
  /** Damage as a multiple of Strength. */
  power: z.number().optional(),
  /** Healing: "full", or an amount of HP. */
  heal: z.union([z.literal('full'), z.number()]).optional(),
  revive: z.boolean().default(false),
  message: z.string(),
  /** Learned in a scene: only `member` knows it, once `flag` is set, in the place of the move it `replaces`. */
  member: z.string().optional(),
  flag: z.string().optional(),
  replaces: z.string().optional(),
  /**
   * The party slips out of the fight in smoke and it starts again from its beginning, as Retry does after a wipe, with
   * no defeat page. It fails this share of the time (0 to 1), and always in an encounter with `no_escape`; then the
   * member says one of `excuses` (scenes, in turn). Back on the map after getting
   * away, the member has a word for it, each of `quips` once in a game: `items_back` when the fight's items came back
   * with it, else `got_away`; after both, nothing. `debt` is the failure panel's national debt: up `first` dots the first
   * time in a game, then `rise` times more on top each time after (1.86 is 186% more).
   */
  escape: z.strictObject({
    fails: z.number().min(0).max(1),
    excuses: z.array(z.string()).default([]),
    quips: z.strictObject({ items_back: z.string(), got_away: z.string() }).partial().default({}),
    debt: z.strictObject({ first: z.number().positive(), rise: z.number().min(0) }).default({ first: 1.9e12, rise: 1.86 }),
  }).optional(),
});

export const enemySchema = z.strictObject({
  name: z.string(),
  look: z.string(),
  hp: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  /** Defense against party damage; offensive specials scale it by their power. */
  armor: z.number().int().nonnegative().default(0),
  /** Ordinary Attack multiplier after armor, earned with the Beijing speed pellet. */
  speed_pellet_power: z.number().min(1).default(1),
  /** A stationary challenge target: ordinary hits use Strength, with no miss/variance rolls. */
  steady_hits: z.boolean().default(false),
  /** The finale is an entry-qualified hit challenge, separate from the turn queue. */
  finale: z.strictObject({
    grind_strength: z.record(z.string(), z.number().int().positive()),
    grind_hits: z.number().int().positive(),
    pellet_hits: z.number().int().positive(),
    pellet_countdown: z.number().positive().optional(),
  }).optional(),
  xp: z.number().int().nonnegative(),
  dots: z.number().int().nonnegative(),
  /** Seconds of battle clock between attacks, as a range. */
  timer: z.tuple([z.number().positive(), z.number().positive()]),
  accuracy: z.number().min(0).max(100).default(100),
  /** The Warsaw finale's fuse, in seconds, burning on the wall clock through animations and pages (`pellet_countdown` takes its place on the pellet route). */
  countdown: z.number().positive().optional(),
  /** Lands on the whole party right before each of that member's turns, from their second on (the giant ghost). */
  blast: z.strictObject({
    name: z.string(),
    damage: z.number().int().positive(),
    before: z.string(),
  }).optional(),
});

export const encounterSchema = z.strictObject({
  /** Real seconds for each party decision; omitted encounters use battle.yaml's default. */
  decision_seconds: z.number().positive().optional(),
  /** Scene with the enemies' battle cry, shown before the fight. */
  cry: z.string().optional(),
  /** Scene spoken by arriving reinforcements while they run into place. */
  reinforcement_cry: z.string().optional(),
  /** At this share of its first enemy's Health, one enemy from each of these encounters comes, while any stand on the map. */
  calls_for_help: z.strictObject({
    at: z.number().positive().max(1),
    groups: z.array(z.string()).min(1),
    words: z.string(),
    cry: z.string(),
    nobody: z.string(),
  }).optional(),
  /** Scenes after Try Again from a lost fight: when no special was used, or else when others came to help. */
  retry_no_specials: z.string().optional(),
  retry_helpers: z.string().optional(),
  /** Scene to play after winning. */
  after: z.string().optional(),
  /** Flag to set after winning. */
  flag: z.string().optional(),
  /** Started by a script, not by touching an enemy. */
  scripted: z.boolean().default(false),
  /** Ronnienomics! always fails here: losing this fight is a step in the story, which a quick retry would skip. */
  no_escape: z.boolean().default(false),
  boss: z.boolean().default(false),
  /**
   * After a win, the fight's framing and places stay while its `after` scene plays, as a boss fight's do, so the
   * scene starts where the fight left the camera instead of easing back to the party first.
   */
  keep_framing: z.boolean().default(false),
  /** Laid out side to side on every screen, the party in a column facing the enemies on its right (`columnLayout`). */
  column: z.boolean().default(false),
  music: z.string().optional(),
  /** Whether defeated enemies come back when the map resets. */
  respawn: z.boolean().default(false),
});

export const itemSchema = z.strictObject({
  name: z.string(),
  /** Counted name, including unchanged mass nouns such as Health. */
  plural: z.string().optional(),
  price: z.number().int().nonnegative(),
  hp: z.number().int().nonnegative().default(0),
  mp: z.number().int().nonnegative().default(0),
  revive: z.boolean().default(false),
  sold: z.boolean().default(true),
  message: z.string(),
});

/** A scene chooses a named shop; unlisted items retain their default prices. */
export const shopSchema = z.strictObject({
  prices: z.record(z.string(), z.number().int().nonnegative()),
});

export const pickupSchema = z.strictObject({
  stat: z.enum(['max_hp', 'max_mp', 'strength', 'accuracy', 'speed', 'dots']),
  amount: z.number(),
  /** Additional party bonuses granted by the same one-time pickup. */
  bonuses: z.array(z.strictObject({
    stat: z.enum(['max_hp', 'max_mp', 'strength', 'accuracy', 'speed']),
    amount: z.number(),
  })).optional(),
  message: z.string().optional(),
  sound: z.string().default('pickup'),
  /** Drawn to stand out where it lies (big, glowing, an arrow over it), and its taking celebrated, its message announced large. */
  celebrate: z.boolean().default(false),
  /** Once it is taken, the party walks this many times as fast. */
  walk: z.number().positive().optional(),
});

export const characterSchema = z.strictObject({
  /** Which figure speaks: a party member id, a map object name, "encounter", or "none". */
  actor: z.string().default('none'),
  /** Voice pitch for the typing sound, in hertz. */
  voice: z.number().positive().default(400),
  style: z.enum(['balloon', 'shout', 'boss', 'caption']).default('balloon'),
  /** Name shown on the balloon. Defaults to the speaker's name in the script. */
  label: z.string().optional(),
  color: z.string().optional(),
});

export const battleSchema = z.strictObject({
  decision_seconds: z.number().positive().default(5),
  bar: z.number().positive(),
  fill_per_speed: z.number().positive(),
  speed_offset: z.number(),
  costs: z.strictObject({ attack: z.number().positive(), item: z.number().positive() }),
  damage_variance: z.tuple([z.number(), z.number()]),
  /** Seconds the battle cry stays up after typing, and the tank's backups run in. */
  cry_time: z.number().nonnegative(),
  backup_run_time: z.number().positive(),
});

export const chapterSchema = z.strictObject({
  id: z.string(),
  /** Shown on entry by default; a script can introduce a landmark later. */
  map: z.string(),
  on: z.enum(['enter', 'script']).default('enter'),
  /** Flags the story must have reached (as on map objects); until then entering the map shows no page, and the first entry after does. */
  requires: z.string().default(''),
  headline: z.string(),
});

export const frameSchema = z.strictObject({
  title: z.string(),
  /** Left and right of the line under every newspaper page's masthead. `{issue}` is the page's issue number. */
  dateline: z.tuple([z.string(), z.string()]),
  chapters: z.array(chapterSchema),
});

/** Editable newspaper furniture around each ending picture; narration stays in the screenplay. */
export const endingPageSchema = z.strictObject({
  headline: z.string().trim().min(1),
  stamp: z.string().trim().min(1),
  issue: z.number().int().positive(),
});

/** Every piece of system text: battle messages, menus, shop lines. Values may use {placeholders}. */
export const messagesSchema = z.record(z.string(), z.record(z.string(), z.string()));

export type PartyData = z.infer<typeof partySchema>;
export type SpecialData = z.infer<typeof specialSchema>;
export type EnemyData = z.infer<typeof enemySchema>;
export type EncounterData = z.infer<typeof encounterSchema>;
export type ItemData = z.infer<typeof itemSchema>;
export type ShopData = z.infer<typeof shopSchema>;
export type PickupData = z.infer<typeof pickupSchema>;
export type CharacterData = z.infer<typeof characterSchema>;
export type BattleData = z.infer<typeof battleSchema>;
export type FrameData = z.infer<typeof frameSchema>;
export type EndingPageData = z.infer<typeof endingPageSchema>;
export type Messages = z.infer<typeof messagesSchema>;

export const dataFiles = {
  'party.yaml': partySchema,
  'specials.yaml': z.record(z.string(), specialSchema),
  'enemies.yaml': z.record(z.string(), enemySchema),
  'encounters.yaml': z.record(z.string(), encounterSchema),
  'items.yaml': z.record(z.string(), itemSchema),
  'shops.yaml': z.record(z.string(), shopSchema),
  'pickups.yaml': z.record(z.string(), pickupSchema),
  'characters.yaml': z.record(z.string(), characterSchema),
  'battle.yaml': battleSchema,
  'frame.yaml': frameSchema,
  'ending_pages.yaml': z.record(z.string(), endingPageSchema),
  'messages.yaml': messagesSchema,
} as const;

export type DataFileName = keyof typeof dataFiles;
