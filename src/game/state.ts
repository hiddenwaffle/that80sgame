import { z } from 'zod';
import { addressStore, storageRefused } from '../address_store.ts';
import type { Dir } from '../art/geom.ts';
import type { Content } from '../content/content.ts';

/** Everything that changes during play and goes into a save. Plain data only. */

export interface MemberState {
  id: string;
  level: number;
  /** XP gained toward the next level. */
  xp: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  strength: number;
  accuracy: number;
  speed: number;
}

export interface PropPlacement {
  x: number;
  y: number;
  mirror: boolean;
  width: number;
}

export interface MapTemp {
  /** Encounters beaten since the map last reset. */
  defeated: string[];
  /** Pellet cells eaten since the map last reset. */
  pellets: number[];
  /** Enemies, by map object name, who left their group for another fight and were beaten there, since the map last reset. */
  left?: string[];
  /** Scenery left where a figure fell, retained across saves and map visits. */
  props?: Record<string, PropPlacement>;
}

export interface GameState {
  version: 1;
  order: string[];
  members: Record<string, MemberState>;
  dots: number;
  items: Record<string, number>;
  flags: Record<string, boolean>;
  map: string;
  x: number;
  y: number;
  facing: Dir;
  /** Permanent pickups taken and encounters beaten, as "map:name". */
  taken: string[];
  beaten: string[];
  revealed: string[];
  temp: Record<string, MapTemp>;
  chapters: string[];
  playTime: number;
  /** Ronnienomics! failures this game, for the national debt its panel reports (Battle.escape); none before the first. */
  escapesFailed?: number;
  /** Ronnienomics! getaways this game: none yet, and it cannot fail (but against the Warsaw Pac), so a first use shows what it does. */
  escapesMade?: number;
}

export function newGame(c: Content): GameState {
  const members: Record<string, MemberState> = {};
  for (const id of c.party.order) {
    const m = c.party.members[id]!;
    members[id] = {
      id,
      level: 1,
      xp: 0,
      hp: m.hp,
      mp: m.mp,
      maxHp: m.hp,
      maxMp: m.mp,
      strength: m.strength,
      accuracy: m.accuracy,
      speed: m.speed,
    };
  }
  return {
    version: 1,
    order: [...c.party.order],
    members,
    dots: c.party.start.dots,
    items: { ...c.party.start.items },
    flags: {},
    map: c.party.start.map,
    x: 0,
    y: 0,
    facing: 'down',
    taken: [],
    beaten: [],
    revealed: [],
    temp: {},
    chapters: [],
    playTime: 0,
  };
}

export function xpToNext(c: Content, level: number): number {
  const table = c.party.xp_to_next;
  if (level - 1 < table.length) return table[level - 1]!;
  let v = table[table.length - 1]!;
  for (let l = table.length; l < level; l++) v = Math.round(v * 1.5);
  return v;
}

/** Adds XP to a member. Returns how many levels they gained. Spare XP carries over. */
export function gainXp(c: Content, m: MemberState, xp: number): number {
  m.xp += xp;
  let levels = 0;
  while (m.xp >= xpToNext(c, m.level)) {
    m.xp -= xpToNext(c, m.level);
    m.level++;
    levels++;
    const up = c.party.level_up;
    m.maxHp += up.hp;
    m.maxMp += up.mp;
    m.strength += up.strength;
    m.accuracy = Math.min(100, m.accuracy + up.accuracy);
    m.speed += up.speed;
    if (m.hp > 0) m.hp += up.hp;
    m.mp += up.mp;
  }
  return levels;
}

export function tempFor(s: GameState, map: string): MapTemp {
  return (s.temp[map] ??= { defeated: [], pellets: [] });
}

/**
 * The maze rest stop (its star and merchant) opens once every power pellet in the maze is taken: the owner,
 * 2026-10-13, "removing the requirement to defeat all the ghosts, and making it so that you have to get all the power
 * pellets". The power pellets are the maze's guarded bonus dots. Each is taken for good, so a trip to town, which
 * brings the ghosts back and forgets their defeats, no longer undoes the progress, as it did when every ghost group
 * had to be beaten since the last trip.
 */
export function unlockMazeRest(s: GameState, c: Content): void {
  if (s.flags.maze_cleared) return;
  const pellets = powerPellets(c, 'maze');
  if (pellets.length && pellets.every(key => s.taken.includes(key))) s.flags.maze_cleared = true;
}

/** A map's power pellets, its guarded bonus dots, by the keys `taken` records them under. */
export function powerPellets(c: Content, map: string): string[] {
  return c.maps.get(map)?.objects.filter(o => o.type === 'pickup' && o.props.guarded_by).map(o => `${map}:${o.name}`) ?? [];
}

/** Evaluates flags and collected pickups, e.g. "warsaw_lost,taken:field:speed_pellet"; ! negates either. */
export function requirementsMet(s: GameState, requires: unknown): boolean {
  if (typeof requires !== 'string' || requires.trim() === '') return true;
  return requires.split(',').every((r) => {
    const t = r.trim();
    if (!t) return true;
    const key = t.startsWith('!') ? t.slice(1) : t;
    const met = key.startsWith('taken:') ? s.taken.includes(key.slice(6)) : Boolean(s.flags[key]);
    return t.startsWith('!') ? !met : met;
  });
}

const SAVE_KEY = 'that80sgame.save.v1';
/** Where the browser refuses storage, the save is a save code in the address instead (src/address_store.ts). */
const ADDRESS_SAVE = 'save';

export function saveGame(s: GameState): boolean {
  try {
    // A finished game (the credits have rolled: Game.fin) has no save, so no later checkpoint, cleanup autosave or
    // developer save brings Continue back before a new game saves.
    if (storageRefused()) {
      // Written, so nothing warns that progress could not be stored: a player who turned storage off knows save codes (the
      // owner, 16 Nov: "I think that the game should just silently continue").
      if (s.flags?.finished) addressStore.removeItem(ADDRESS_SAVE);
      else addressStore.setItem(ADDRESS_SAVE, exportSave(s));
    } else if (s.flags?.finished) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** The saved game, if there is one and it fits this version of the content. */
export function loadGame(c: Content): GameState | null {
  try {
    if (storageRefused()) {
      const code = addressStore.getItem(ADDRESS_SAVE);
      const r = code ? importSave(code, c) : null;
      return r && 'state' in r ? r.state : null;
    }
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const r = checkState(JSON.parse(raw), c);
    return 'state' in r ? r.state : null;
  } catch {
    return null;
  }
}

export function hasSave(c: Content): boolean {
  return loadGame(c) !== null;
}

/** Whether the browser holds a save at all, readable or not. */
export function saveExists(): boolean {
  try {
    return (storageRefused() ? addressStore.getItem(ADDRESS_SAVE) : localStorage.getItem(SAVE_KEY)) !== null;
  } catch {
    return false;
  }
}

/**
 * Copies a save that this version cannot read to a side key, so a new game does
 * not destroy it. A later version, or a developer, can still recover it.
 */
export function keepUnreadableSave(c: Content): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw !== null && !hasSave(c)) localStorage.setItem(`${SAVE_KEY}.unreadable`, raw);
  } catch {
    /* storage unavailable: nothing to keep */
  }
}

// -------------------------------------------------------------------------------------------------
// Checking a save

export type SaveError = 'incomplete' | 'unknown_map' | 'unknown_member' | 'empty' | 'not_a_code' | 'damaged' | 'unreadable';
export type SaveCheck = { state: GameState } | { error: SaveError };

const dir = z.enum(['up', 'down', 'left', 'right']);
// Generous limits, but finite: a level in the billions would make the XP table loop for ever.
const BIG = 1e7;
const count = z.number().int().min(0).max(BIG);
const stat = z.number().min(-BIG).max(BIG);
const memberSchema = z.object({
  id: z.string(),
  level: z.number().int().min(1).max(99),
  xp: z.number().min(0).max(BIG),
  hp: z.number().min(0).max(BIG),
  mp: z.number().min(0).max(BIG),
  maxHp: z.number().positive().max(BIG),
  maxMp: z.number().min(0).max(BIG),
  strength: stat,
  accuracy: stat,
  speed: stat,
});
const stateSchema = z.object({
  version: z.literal(1),
  order: z.array(z.string()).min(1),
  members: z.record(z.string(), memberSchema),
  dots: count,
  items: z.record(z.string(), count),
  flags: z.record(z.string(), z.boolean()),
  map: z.string(),
  x: z.number(),
  y: z.number(),
  facing: dir,
  taken: z.array(z.string()),
  beaten: z.array(z.string()),
  revealed: z.array(z.string()),
  temp: z.record(z.string(), z.object({
    defeated: z.array(z.string()), pellets: z.array(count), left: z.array(z.string()).optional(),
    props: z.record(z.string(), z.object({ x: stat, y: stat, mirror: z.boolean(), width: z.number().positive().max(BIG) })).optional(),
  })),
  chapters: z.array(z.string()),
  playTime: z.number().min(0).max(1e9),
  escapesFailed: count.optional(),
  escapesMade: count.optional(),
});

/** Names a save may not use as keys, since they reach into every JavaScript object. */
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Checks that something read from storage or a pasted code is a whole save that
 * this version of the game can play: the right shape, sane numbers, the map and
 * every member still in the content. Items the content no longer has are dropped
 * rather than refusing the save. The error is a key in the `savecode` group of
 * messages.yaml, which says what went wrong in plain words.
 */
export function checkState(raw: unknown, c: Content): SaveCheck {
  // Checked on the raw data: rebuilding it would already have acted on a "__proto__" key.
  if (raw && typeof raw === 'object') {
    for (const field of ['members', 'items', 'flags', 'temp']) {
      const rec = (raw as Record<string, unknown>)[field];
      if (rec && typeof rec === 'object' && Object.keys(rec).some((k) => RESERVED.has(k))) return { error: 'incomplete' };
    }
  }
  const r = stateSchema.safeParse(raw);
  if (!r.success) return { error: 'incomplete' };
  const s = r.data as GameState;
  if (!c.maps.has(s.map)) return { error: 'unknown_map' };
  // Own keys only: an id such as "constructor" must not match what every object inherits.
  const own = (o: object, k: string) => Object.hasOwn(o, k);
  if (new Set(s.order).size !== s.order.length || s.order.length > c.party.order.length) return { error: 'unknown_member' };
  for (const id of s.order) {
    if (!own(s.members, id) || !own(c.party.members, id)) return { error: 'unknown_member' };
    const m = s.members[id]!;
    if (m.id !== id || m.hp > m.maxHp || m.mp > m.maxMp) return { error: 'incomplete' };
  }
  for (const id of Object.keys(s.items)) if (!own(c.items, id)) delete s.items[id];
  // Older saves saw the bridge's page and dialogue together. Preserve that discovery flag;
  // the current route plays the dialogue after the guards and the page on entering Beijing.
  if (s.chapters.includes('curtain')) s.flags.bridge_seen = true;
  // Open the maze stop for an older save that already holds every power pellet (never from the old exit-pair flag).
  unlockMazeRest(s, c);
  return { state: s };
}

// -------------------------------------------------------------------------------------------------
// Save codes: a save as text the player can copy out and paste back in, for
// browsers that clear a site's data. The code is a prefix, the save as
// base64url, and a checksum, so a code damaged in copying is caught.

const CODE_PREFIX = 'T80S1';

function checksum(text: string): string {
  // FNV-1a, 32 bits.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function exportSave(s: GameState): string {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(s)));
  return `${CODE_PREFIX}.${body}.${checksum(body)}`;
}

/** Reads a pasted code. Spaces and line breaks that copying adds are ignored. */
export function importSave(code: string, c: Content): SaveCheck {
  const text = code.replace(/[\s​-‍﻿]+/g, '');
  if (!text) return { error: 'empty' };
  const [prefix, body, sum, ...rest] = text.split('.');
  if (prefix !== CODE_PREFIX) return { error: 'not_a_code' };
  // It starts like one of ours, so anything missing was lost in copying.
  if (!body || !sum || rest.length || checksum(body) !== sum) return { error: 'damaged' };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return { error: 'unreadable' };
  }
  return checkState(raw, c);
}
