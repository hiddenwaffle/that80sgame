import { LineCounter, parseDocument } from 'yaml';
import type { z } from 'zod';
import { LOOKS } from '../art/characters.ts';
import { PROPS } from '../art/props.ts';
import { TRACKS } from '../audio/music.ts';
import {
  dataFiles,
  type BattleData,
  type CharacterData,
  type DataFileName,
  type EncounterData,
  type EndingPageData,
  type EnemyData,
  type FrameData,
  type ItemData,
  type ShopData,
  type Messages,
  type PartyData,
  type PickupData,
  type SpecialData,
} from './schemas.ts';
import { parseScreenplay, type ContentError, type Scene } from './screenplay.ts';
import { parseTiledMap, type GameMap } from './tiled.ts';
import { TILE } from './terrain.ts';

/** Everything the game reads from content/, checked and cross-referenced. */
export interface Content {
  scenes: Map<string, Scene>;
  maps: Map<string, GameMap>;
  party: PartyData;
  specials: Record<string, SpecialData>;
  enemies: Record<string, EnemyData>;
  encounters: Record<string, EncounterData>;
  items: Record<string, ItemData>;
  shops: Record<string, ShopData>;
  pickups: Record<string, PickupData>;
  characters: Record<string, CharacterData>;
  battle: BattleData;
  frame: FrameData;
  endingPages: Record<string, EndingPageData>;
  messages: Messages;
}

const DIRS = ['up', 'down', 'left', 'right'];

function isNumber(s: string): boolean {
  return s.trim() !== '' && Number.isFinite(Number(s));
}

/** Script commands, with how many arguments each takes. */
export const COMMANDS: Record<string, { min: number; max: number; usage: string }> = {
  wait: { min: 1, max: 1, usage: '[wait seconds]' },
  walk: { min: 3, max: 5, usage: '[walk who to point] or [walk who by dx dy]' },
  walk_together: { min: 2, max: 10, usage: '[walk_together who point who point]' },
  walk_on: { min: 3, max: 3, usage: '[walk_on who to point]' },
  place: { min: 2, max: 2, usage: '[place who point]' },
  face: { min: 2, max: 3, usage: '[face who up|down|left|right|someone] or [face who someone sideways]' },
  gather: { min: 0, max: 0, usage: '[gather]' },
  line_up: { min: 0, max: 1, usage: '[line_up] or [line_up wait]' },
  step_clear: { min: 2, max: 2, usage: '[step_clear area left|right|up|down]' },
  formation: { min: 0, max: 3, usage: '[formation left|right|up|down] or [formation left|right|up|down at point]' },
  camera: { min: 1, max: 1, usage: '[camera point|someone|party|everyone]' },
  shake: { min: 0, max: 1, usage: '[shake seconds]' },
  shake_head: { min: 1, max: 3, usage: '[shake_head who] or [shake_head who who]' },
  blink: { min: 1, max: 1, usage: '[blink who]' },
  celebrate: { min: 1, max: 3, usage: '[celebrate party] or [celebrate who who] or [celebrate stop]' },
  flag: { min: 1, max: 2, usage: '[flag name] or [flag name off]' },
  give: { min: 1, max: 2, usage: '[give item count]' },
  dots: { min: 1, max: 1, usage: '[dots amount]' },
  heal: { min: 0, max: 0, usage: '[heal]' },
  battle: { min: 1, max: 1, usage: '[battle encounter]' },
  warp: { min: 2, max: 2, usage: '[warp map spawn]' },
  reveal: { min: 1, max: 1, usage: '[reveal object]' },
  drop: { min: 2, max: 3, usage: '[drop object who] or [drop object who first_handoff_scene]' },
  hide: { min: 1, max: 1, usage: '[hide object]' },
  explode: { min: 1, max: 2, usage: '[explode actor] or [explode actor remains_prop]' },
  achieve: { min: 1, max: 1, usage: '[achieve unnuked]' },
  warning_shot: { min: 1, max: 1, usage: '[warning_shot actor]' },
  sound: { min: 1, max: 1, usage: '[sound name]' },
  music: { min: 1, max: 1, usage: '[music name] or [music stop]' },
  frontpage: { min: 1, max: 1, usage: '[frontpage chapter]' },
  save: { min: 0, max: 0, usage: '[save]' },
  rest: { min: 0, max: 0, usage: '[rest]' },
  shop: { min: 0, max: 1, usage: '[shop] or [shop price_list]' },
  run: { min: 1, max: 2, usage: '[run scene] or [run scene requires]' },
  ask: { min: 2, max: 3, usage: '[ask "Question?" yes_scene] or [ask "Question?" yes_scene no_scene]' },
  kuji_kiri: { min: 4, max: 5, usage: '[kuji_kiri pupil teacher teacher pile_point] or [kuji_kiri pupil teacher teacher pile_point after_scene]' },
  picture: { min: 1, max: 1, usage: '[picture name]' },
  fin: { min: 0, max: 0, usage: '[fin]' },
  arcade: { min: 1, max: 1, usage: '[arcade back]' },
  sunlight: { min: 0, max: 0, usage: '[sunlight]' },
  credits: { min: 1, max: 1, usage: '[credits ground]' },
  title: { min: 0, max: 0, usage: '[title]' },
};

export const PICTURES = ['separate_ways', 'fireside', 'ceo'];
export const OBJECT_TYPES = ['spawn', 'npc', 'enemy', 'trigger', 'exit', 'pickup', 'prop', 'point', 'area', 'placeholder'];

export interface LoadResult {
  content: Content | null;
  errors: ContentError[];
}

/**
 * Builds the content from a map of file paths (relative to the project, such as
 * "content/script/01_opening.txt") to file text.
 */
export function loadContent(files: Map<string, string>): LoadResult {
  const errors: ContentError[] = [];
  const data: Partial<Record<DataFileName, unknown>> = {};

  for (const [name, schema] of Object.entries(dataFiles) as Array<[DataFileName, z.ZodType]>) {
    const file = `content/data/${name}`;
    const text = files.get(file);
    if (text === undefined) {
      errors.push({ file, line: 0, message: 'File is missing.' });
      continue;
    }
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc });
    for (const e of doc.errors) errors.push({ file, line: e.linePos?.[0]?.line ?? 0, message: e.message.split('\n')[0]! });
    // An unquoted value starting with ! is a YAML tag and would quietly read as empty, such as `requires: !flag`.
    for (const w of doc.warnings) {
      if (w.code === 'TAG_RESOLVE_FAILED') errors.push({ file, line: w.linePos?.[0]?.line ?? 0, message: 'A value starting with ! must be in quotes, such as requires: "!flag".' });
    }
    if (doc.errors.length || doc.warnings.some((w) => w.code === 'TAG_RESOLVE_FAILED')) continue;
    const parsed = schema.safeParse(doc.toJS());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const pathKeys = issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p));
        let line = 0;
        for (let n = pathKeys.length; n >= 0 && line === 0; n--) {
          const node = doc.getIn(pathKeys.slice(0, n), true) as { range?: [number, number, number] } | undefined;
          if (node?.range) line = lc.linePos(node.range[0]).line;
        }
        errors.push({ file, line, message: `${pathKeys.join('.') || '(top)'}: ${issue.message}` });
      }
      continue;
    }
    data[name] = parsed.data;
  }

  const script = { scenes: new Map<string, Scene>(), errors: [] as ContentError[] };
  for (const [file, text] of [...files].filter(([f]) => f.startsWith('content/script/') && f.endsWith('.txt')).sort()) {
    parseScreenplay(file, text, script);
  }
  errors.push(...script.errors);

  const maps = new Map<string, GameMap>();
  for (const [file, text] of files) {
    if (!file.startsWith('content/maps/') || !file.endsWith('.tmj')) continue;
    const { map, errors: mapErrors } = parseTiledMap(file, text, (p) => files.get(p));
    errors.push(...mapErrors);
    if (map) maps.set(map.id, map);
  }

  if (Object.keys(dataFiles).some((k) => data[k as DataFileName] === undefined)) {
    return { content: null, errors };
  }

  const content: Content = {
    scenes: script.scenes,
    maps,
    party: data['party.yaml'] as PartyData,
    specials: data['specials.yaml'] as Record<string, SpecialData>,
    enemies: data['enemies.yaml'] as Record<string, EnemyData>,
    encounters: data['encounters.yaml'] as Record<string, EncounterData>,
    items: data['items.yaml'] as Record<string, ItemData>,
    shops: data['shops.yaml'] as Record<string, ShopData>,
    pickups: data['pickups.yaml'] as Record<string, PickupData>,
    characters: data['characters.yaml'] as Record<string, CharacterData>,
    battle: data['battle.yaml'] as BattleData,
    frame: data['frame.yaml'] as FrameData,
    endingPages: data['ending_pages.yaml'] as Record<string, EndingPageData>,
    messages: data['messages.yaml'] as Messages,
  };
  errors.push(...crossCheck(content));
  return { content, errors };
}

/** Checks that everything one file names exists in another. */
export function crossCheck(c: Content): ContentError[] {
  const errors: ContentError[] = [];
  const at = (file: string, line: number, message: string) => errors.push({ file, line, message });

  const partyIds = new Set(c.party.order);
  const objectNames = new Set<string>();
  for (const m of c.maps.values()) for (const o of m.objects) if (o.name) objectNames.add(o.name);
  const actorOk = (a: string) => partyIds.has(a.toLowerCase()) || ['party', 'leader', 'encounter', 'none'].includes(a.toLowerCase()) || objectNames.has(a);
  const chapterIds = new Set(c.frame.chapters.map((ch) => ch.id));

  // Party
  for (const id of c.party.order) if (!c.party.members[id]) at('content/data/party.yaml', 0, `order lists "${id}", which is not under members.`);
  for (const [id, m] of Object.entries(c.party.members)) if (!(m.look in LOOKS)) at('content/data/party.yaml', 0, `${id}: unknown look "${m.look}".`);
  for (const item of Object.keys(c.party.start.items)) if (!c.items[item]) at('content/data/party.yaml', 0, `start.items: unknown item "${item}".`);
  const startMap = c.maps.get(c.party.start.map);
  if (!startMap) at('content/data/party.yaml', 0, `start.map: no map "${c.party.start.map}".`);
  else if (!startMap.objects.some((o) => o.type === 'spawn' && o.name === c.party.start.spawn)) at('content/data/party.yaml', 0, `start.spawn: map "${startMap.id}" has no spawn "${c.party.start.spawn}".`);
  if (c.party.start.scene && !c.scenes.has(c.party.start.scene)) at('content/data/party.yaml', 0, `start.scene: no scene "${c.party.start.scene}".`);

  for (const [id, sp] of Object.entries(c.specials)) {
    for (const s of sp.escape?.excuses ?? []) if (!c.scenes.has(s)) at('content/data/specials.yaml', 0, `${id}.escape.excuses: no scene "${s}".`);
    for (const [k, s] of Object.entries(sp.escape?.quips ?? {})) if (!c.scenes.has(s)) at('content/data/specials.yaml', 0, `${id}.escape.quips.${k}: no scene "${s}".`);
  }
  for (const [id, e] of Object.entries(c.enemies)) if (!(e.look in LOOKS)) at('content/data/enemies.yaml', 0, `${id}: unknown look "${e.look}".`);
  for (const [id, shop] of Object.entries(c.shops)) for (const item of Object.keys(shop.prices)) {
    if (!c.items[item]) at('content/data/shops.yaml', 0, `${id}.prices: unknown item "${item}".`);
  }
  for (const [id, pk] of Object.entries(c.pickups)) if (pk.stat === 'dots' && !Number.isInteger(pk.amount)) at('content/data/pickups.yaml', 0, `${id}: Dots must be a whole number, not ${pk.amount}.`);
  for (const [id, e] of Object.entries(c.encounters)) {
    for (const key of ['cry', 'reinforcement_cry', 'after', 'retry_no_specials', 'retry_helpers'] as const) {
      const s = e[key];
      if (s && !c.scenes.has(s)) at('content/data/encounters.yaml', 0, `${id}.${key}: no scene "${s}".`);
    }
    // A battle cry plays in the fight's intro, which a quit to the title cannot end while a [wait] or [blink] holds it, so
    // the next Continue would hang (Fable review C10, 2026-11-09). A wait belongs in the scenes around the fight.
    for (const key of ['cry', 'reinforcement_cry'] as const) {
      const scene = e[key] ? c.scenes.get(e[key]) : undefined;
      for (const step of scene?.steps ?? []) if (step.kind === 'command' && (step.name === 'wait' || step.name === 'blink'))
        at(step.file, step.line, `[${step.name}] in "${scene!.id}", ${id}'s ${key === 'cry' ? 'battle cry' : 'reinforcement cry'}: a quit during the fight's intro could not end it.`);
    }
    for (const s of [e.calls_for_help?.cry, e.calls_for_help?.nobody]) if (s && !c.scenes.has(s)) at('content/data/encounters.yaml', 0, `${id}.calls_for_help: no scene "${s}".`);
    for (const g of e.calls_for_help?.groups ?? []) if (!c.encounters[g]) at('content/data/encounters.yaml', 0, `${id}.calls_for_help: no encounter "${g}".`);
    if (e.music && !TRACKS[e.music]) at('content/data/encounters.yaml', 0, `${id}.music: no track "${e.music}".`);
  }
  for (const [name, ch] of Object.entries(c.characters)) {
    if (!actorOk(ch.actor)) at('content/data/characters.yaml', 0, `${name}: actor "${ch.actor}" is not a party member or a map object name.`);
  }
  for (const ch of c.frame.chapters) if (!c.maps.has(ch.map)) at('content/data/frame.yaml', 0, `chapter ${ch.id}: no map "${ch.map}".`);
  for (const picture of PICTURES) if (!c.endingPages[picture])
    at('content/data/ending_pages.yaml', 0, `Missing ending page for picture "${picture}".`);
  for (const picture of Object.keys(c.endingPages)) if (!PICTURES.includes(picture))
    at('content/data/ending_pages.yaml', 0, `No ending picture "${picture}". Pictures: ${PICTURES.join(', ')}.`);

  // Script
  for (const scene of c.scenes.values()) {
    for (const step of scene.steps) {
      if (step.kind === 'line') {
        if (step.speaker !== null && !c.characters[step.speaker]) {
          at(step.file, step.line, `Unknown speaker "${step.speaker}". Add them to content/data/characters.yaml.`);
        }
        // Olli never speaks (the owner's rule, 2026-11-01): his lines go to Ronnie or Gorbie.
        if (step.speaker !== null && step.speaker.toLowerCase() === 'olli') at(step.file, step.line, 'Olli never speaks; give the line to Ronnie or Gorbie.');
        // An instruction in braces that is not one of {pause}, {pause N}, {br} or {speed N} would be typed out, braces and all.
        for (const brace of step.text.match(/\{[^}]*\}?/g) ?? [])
          if (!/^\{(pause|br|speed)(\s+[0-9.]+)?\}$/.test(brace)) at(step.file, step.line, `Unknown instruction ${brace}: use {pause}, {pause 1.5}, {br} or {speed 30}.`);
        for (const tag of step.tags) if (!['shout', 'large', 'whisper', 'aside', 'haunted', 'offscreen_right'].includes(tag)) at(step.file, step.line, `Unknown tag [${tag}]. Use shout, large, whisper, aside, or offscreen_right.`);
        continue;
      }
      const spec = COMMANDS[step.name];
      if (!spec) {
        at(step.file, step.line, `Unknown command [${step.name}].`);
        continue;
      }
      if (step.args.length < spec.min || step.args.length > spec.max) {
        at(step.file, step.line, `[${step.name}] takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} arguments. Usage: ${spec.usage}`);
        continue;
      }
      const [a0, a1, a2] = step.args;
      switch (step.name) {
        case 'shop':
          if (a0 !== undefined && !c.shops[a0]) at(step.file, step.line, `No shop price list "${a0}" in shops.yaml.`);
          break;
        case 'run':
          if (!c.scenes.has(a0!)) at(step.file, step.line, `No scene "${a0}".`);
          break;
        case 'ask':
          for (const scene of step.args.slice(1)) if (!c.scenes.has(scene)) at(step.file, step.line, `No scene "${scene}".`);
          break;
        case 'kuji_kiri':
          for (const who of step.args.slice(0, 3)) if (!actorOk(who)) at(step.file, step.line, `Unknown actor "${who}".`);
          if (!objectNames.has(step.args[3]!)) at(step.file, step.line, `No map object named "${step.args[3]}".`);
          if (step.args[4] !== undefined && !c.scenes.has(step.args[4])) at(step.file, step.line, `No scene "${step.args[4]}".`);
          break;
        case 'battle':
          if (!c.encounters[a0!]) at(step.file, step.line, `No encounter "${a0}" in encounters.yaml.`);
          break;
        case 'frontpage':
          if (!chapterIds.has(a0!)) at(step.file, step.line, `No chapter "${a0}" in frame.yaml.`);
          break;
        case 'give':
          if (!c.items[a0!]) at(step.file, step.line, `No item "${a0}".`);
          if (a1 !== undefined && !/^[1-9]\d*$/.test(a1)) at(step.file, step.line, `The count must be a whole number above zero, not "${a1}".`);
          break;
        case 'formation':
          if (a0 !== undefined && !DIRS.includes(a0)) at(step.file, step.line, `Formation faces up, down, left, or right, not "${a0}".`);
          if (step.args.length > 1 && (step.args.length !== 3 || a1 !== 'at')) at(step.file, step.line, 'Use [formation direction] or [formation direction at point].');
          else if (a1 === 'at' && !objectNames.has(a2!)) at(step.file, step.line, `No map object named "${a2}".`);
          break;
        case 'picture':
          if (!PICTURES.includes(a0!)) at(step.file, step.line, `No picture "${a0}". Pictures: ${PICTURES.join(', ')}.`);
          break;
        case 'warp': {
          const m = c.maps.get(a0!);
          if (!m) at(step.file, step.line, `No map "${a0}".`);
          else if (!m.objects.some((o) => o.type === 'spawn' && o.name === a1)) at(step.file, step.line, `Map "${a0}" has no spawn "${a1}".`);
          break;
        }
        case 'walk_together':
          for (let i = 0; i < step.args.length; i += 2) {
            if (!actorOk(step.args[i]!)) at(step.file, step.line, `Unknown actor "${step.args[i]}".`);
            if (!objectNames.has(step.args[i + 1] ?? '')) at(step.file, step.line, `No map object named "${step.args[i + 1]}".`);
          }
          break;
        case 'walk_on':
          if (!actorOk(a0!)) at(step.file, step.line, `Unknown actor "${a0}".`);
          if (a1 !== 'to') at(step.file, step.line, 'Use [walk_on who to point].');
          else if (!objectNames.has(a2!)) at(step.file, step.line, `No map object named "${a2}".`);
          break;
        case 'line_up':
          if (a0 !== undefined && a0 !== 'wait') at(step.file, step.line, `Use [line_up] or [line_up wait], not "${a0}".`);
          break;
        case 'blink':
          if (!actorOk(a0!)) at(step.file, step.line, `Unknown actor "${a0}".`);
          break;
        case 'walk': {
          if (!actorOk(a0!)) at(step.file, step.line, `Unknown actor "${a0}".`);
          const nums = (list: Array<string | undefined>) => list.every((v) => v !== undefined && isNumber(v));
          if (a1 === 'to') {
            if (!objectNames.has(a2!)) at(step.file, step.line, `No map object named "${a2}".`);
            if (step.args.length > 4) at(step.file, step.line, 'Use [walk who to point] or [walk who to point speed].');
            else if (step.args.length === 4 && !nums([step.args[3]])) at(step.file, step.line, `The speed must be a number, not "${step.args[3]}".`);
          } else if (a1 === 'by') {
            if (!nums([a2, step.args[3]])) at(step.file, step.line, 'Use [walk who by dx dy], with dx and dy in tiles.');
            else if (step.args.length === 5 && !nums([step.args[4]])) at(step.file, step.line, `The speed must be a number, not "${step.args[4]}".`);
          } else {
            at(step.file, step.line, 'Use [walk who to point] or [walk who by dx dy].');
          }
          break;
        }
        case 'place':
          if (!actorOk(a0!)) at(step.file, step.line, `Unknown actor "${a0}".`);
          if (!objectNames.has(a1!)) at(step.file, step.line, `No map object named "${a1}".`);
          break;
        case 'face':
          if (!actorOk(a0!)) at(step.file, step.line, `Unknown actor "${a0}".`);
          if (!['up', 'down', 'left', 'right'].includes(a1!) && !actorOk(a1!)) at(step.file, step.line, `Face a direction, someone or something on the map, not "${a1}".`);
          if (a2 !== undefined && (a2 !== 'sideways' || DIRS.includes(a1!))) at(step.file, step.line, 'Use [face who someone sideways] to face a person without rolling up or down.');
          break;
        case 'shake_head':
          for (const who of step.args) if (!actorOk(who)) at(step.file, step.line, `Unknown actor "${who}".`);
          break;
        case 'celebrate':
          if (a0 === 'stop') {
            if (step.args.length !== 1) at(step.file, step.line, 'Use [celebrate stop] without other arguments.');
          } else {
            for (const who of step.args) if (!actorOk(who)) at(step.file, step.line, `Unknown actor "${who}".`);
          }
          break;
        case 'reveal':
        case 'hide':
          if (!objectNames.has(a0!)) at(step.file, step.line, `No map object named "${a0}".`);
          break;
        case 'arcade':
          if (a0 !== 'back') at(step.file, step.line, 'Use [arcade back].');
          break;
        case 'achieve':
          if (a0 !== 'unnuked') at(step.file, step.line, 'Use [achieve unnuked].');
          break;
        case 'explode':
        case 'warning_shot':
          if (!partyIds.has(a0!.toLowerCase()) && a0 !== 'leader' && ![...c.maps.values()].some((m) => m.objects.some((o) => o.name === a0 && ['npc', 'enemy'].includes(o.type))))
            at(step.file, step.line, `[${step.name}] needs a figure, not "${a0}".`);
          if (step.name === 'explode' && a1 && ![...c.maps.values()].some(m => m.objects.some(o => o.name === a1 && o.type === 'prop' && !o.props.solid)))
            at(step.file, step.line, `[explode] remains must name a non-solid prop, not "${a1}".`);
          break;
        case 'drop':
          if (!objectNames.has(a0!)) at(step.file, step.line, `No map object named "${a0}".`);
          if (!actorOk(a1!)) at(step.file, step.line, `Unknown actor "${a1}".`);
          if (a2 && !c.scenes.has(a2)) at(step.file, step.line, `No scene "${a2}".`);
          break;
        case 'wait':
        case 'shake':
          if (a0 !== undefined && !isNumber(a0)) at(step.file, step.line, `"${a0}" is not a number.`);
          break;
        case 'dots':
          // Dots are counted in whole numbers; saves refuse anything else.
          if (!/^-?\d+$/.test(a0!)) at(step.file, step.line, `Dots must be a whole number, not "${a0}".`);
          break;
        // These used to pass whatever followed them (Fable review C6 and others, 2026-11-09): a track that does not exist
        // played nothing, [flag x false] set the flag, and a misspelt camera target or area did nothing.
        case 'music':
          if (a0 !== 'stop' && !TRACKS[a0!]) at(step.file, step.line, `No track "${a0}". Tracks: ${Object.keys(TRACKS).join(', ')}, or [music stop].`);
          break;
        case 'flag':
          if (a1 !== undefined && a1 !== 'off') at(step.file, step.line, `[flag ${a0} ${a1}] would set the flag; only "off" clears it: [flag ${a0} off].`);
          break;
        case 'camera':
          if (!actorOk(a0!) && a0 !== 'point' && a0 !== 'everyone') at(step.file, step.line, `[camera] needs the party, everyone, someone, or a map object, not "${a0}".`);
          break;
        case 'step_clear':
          if (![...c.maps.values()].some((m) => m.objects.some((o) => o.type === 'area' && o.name === a0))) at(step.file, step.line, `[step_clear] needs an area on a map, not "${a0}".`);
          if (!DIRS.includes(a1!)) at(step.file, step.line, `[step_clear] goes left, right, up or down, not "${a1}".`);
          break;
      }
    }
  }

  // Maps
  for (const m of c.maps.values()) {
    const where = (o: { name: string; id: number }) => `object "${o.name || '(unnamed)'}" (id ${o.id})`;
    const world = m.props.world;
    if (!['arcade', 'print', 'mixed'].includes(String(world))) at(m.file, 0, 'Map property "world" must be arcade, print, or mixed.');
    if (m.props.fight_camera !== undefined && m.props.fight_camera !== 'free')
      at(m.file, 0, 'Map property "fight_camera" must be "free", or omitted to keep fights inside the map.');
    // Tiled may store these as text or as numbers; both are fine if they read as numbers.
    const tilt = m.props.tilt;
    if (tilt !== undefined) {
      const t = Number(tilt);
      if (String(tilt).trim() === '' || !(t >= 0 && t <= 1)) at(m.file, 0, `Map property "tilt" must be a number from 0 (straight down) to 1 (full tilt), not "${tilt}".`);
    }
    const ease = m.props.tilt_ease_x;
    if (ease !== undefined) {
      const ok = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(String(ease));
      const [a, b] = String(ease).split(',').map(Number);
      if (!ok || a! >= b!) at(m.file, 0, `Map property "tilt_ease_x" must be two tile columns, left then right, such as "11,17", not "${ease}".`);
    }
    const onEnter = m.props.on_enter;
    if (typeof onEnter === 'string' && !c.scenes.has(onEnter)) at(m.file, 0, `on_enter: no scene "${onEnter}".`);
    // A map's music naming no track left it silent, with no error.
    if (m.props.music !== undefined && !TRACKS[String(m.props.music)]) at(m.file, 0, `Map property "music": no track "${m.props.music}". Tracks: ${Object.keys(TRACKS).join(', ')}.`);
    const seen = new Set<string>();
    for (const o of m.objects) {
      if (!OBJECT_TYPES.includes(o.type)) {
        at(m.file, 0, `${where(o)} has type "${o.type}". Use one of: ${OBJECT_TYPES.join(', ')}.`);
        continue;
      }
      // A pickup's or an enemy's saved state is kept by its name, so two unnamed ones would share one.
      if (!o.name && ['enemy', 'pickup'].includes(o.type)) at(m.file, 0, `${where(o)}: ${o.type === 'enemy' ? 'an enemy' : 'a pickup'} needs a name; the save keeps whether it is gone by name.`);
      if (o.name && ['npc', 'enemy', 'spawn', 'point', 'pickup'].includes(o.type)) {
        const k = `${o.type}:${o.name}`;
        if (seen.has(k)) at(m.file, 0, `Two ${o.type} objects are named "${o.name}".`);
        seen.add(k);
      }
      const p = o.props;
      if (p.flee_on_arrival !== undefined && (o.type !== 'npc' || (p.wander !== 0 && p.scenery_patrol === undefined) ||
        p.traffic !== undefined || typeof p.flee_on_arrival !== 'string' || !c.encounters[p.flee_on_arrival] ||
        !m.objects.some(point => point.type === 'point' && point.name === p.flee_to)))
        at(m.file, 0, `${where(o)}: "flee_on_arrival" needs a stationary or patrolling npc, an existing encounter, and a "flee_to" point on this map.`);
      if (p.flee_via !== undefined && (p.flee_on_arrival === undefined || typeof p.flee_via !== 'string' ||
        !p.flee_via.split(',').every(name => m.objects.some(point => point.type === 'point' && point.name === name.trim()))))
        at(m.file, 0, `${where(o)}: "flee_via" needs "flee_on_arrival" and a comma-separated list of points on this map.`);
      if (p.flee_hop !== undefined && (p.flee_hop !== true || p.flee_on_arrival === undefined || typeof p.flee_via !== 'string'))
        at(m.file, 0, `${where(o)}: "flee_hop" can only be true on a fleeing npc with an authored first waypoint.`);
      if (p.yield_up !== undefined && (o.type !== 'prop' || p.solid !== false || typeof p.yield_up !== 'number' || !Number.isFinite(p.yield_up) || p.yield_up <= 0))
        at(m.file, 0, `${where(o)}: "yield_up" needs a non-solid prop and a positive distance in world units.`);
      const scene = p.scene;
      if (typeof scene === 'string' && !c.scenes.has(scene)) at(m.file, 0, `${where(o)}: no scene "${scene}".`);
      if (p.facing !== undefined && !DIRS.includes(String(p.facing))) at(m.file, 0, `${where(o)}: "facing" must be up, down, left, or right, not "${p.facing}".`);
      if (p.wander !== undefined && typeof p.wander !== 'number') at(m.file, 0, `${where(o)}: "wander" must be a number of tiles.`);
      if (p.idle !== undefined && (o.type !== 'npc' || p.idle !== false || p.wander !== 0))
        at(m.file, 0, `${where(o)}: "idle" can only be false on a stationary townsperson (wander: 0).`);
      if (p.scenery_patrol !== undefined) {
        const distance = p.scenery_patrol;
        if (o.type !== 'npc' || typeof distance !== 'number' || !Number.isFinite(distance) || distance === 0 ||
          o.x + Number(distance) * TILE < TILE || o.x + Number(distance) * TILE > (m.width - 1) * TILE ||
          p.scene !== undefined || p.encounter !== undefined || p.traffic !== undefined || p.wander !== undefined ||
          typeof p.walk_speed !== 'number' || !Number.isFinite(p.walk_speed) || p.walk_speed <= 0)
          at(m.file, 0, `${where(o)}: "scenery_patrol" needs a non-speaking npc, a nonzero horizontal distance in tiles within the map, and a positive walk_speed; no wander, traffic, or encounter.`);
      }
      if (p.frame_encounter !== undefined && (o.type !== 'area' || !c.encounters[String(p.frame_encounter)]))
        at(m.file, 0, `${where(o)}: "frame_encounter" needs an area and an existing encounter.`);
      if (p.frame_party !== undefined && (o.type !== 'area' || p.frame_party !== true))
        at(m.file, 0, `${where(o)}: "frame_party" can only be true on an area.`);
      if (p.appears !== undefined && (typeof p.appears !== 'string' || !['prop', 'npc'].includes(o.type)))
        at(m.file, 0, `${where(o)}: "appears" takes flags, as "requires" does, and only props and townspeople (npc) appear; a trigger uses "requires".`);
      if (p.pop !== undefined && (p.pop !== false || p.appears === undefined)) at(m.file, 0, `${where(o)}: "pop" can only be false, on something that "appears", to be there without a burst.`);
      switch (o.type) {
        case 'npc':
          if (!(String(p.look) in LOOKS)) at(m.file, 0, `${where(o)}: unknown look "${p.look}".`);
          if (p.facing === 'up' || p.facing === 'down')
            at(m.file, 0, `${where(o)}: a townsperson stands facing left or right, not "${p.facing}"; they face up or down only for a moment after walking that way.`);
          break;
        case 'enemy':
          if (!c.enemies[String(p.kind)]) at(m.file, 0, `${where(o)}: unknown enemy kind "${p.kind}".`);
          if (!c.encounters[String(p.encounter)]) at(m.file, 0, `${where(o)}: unknown encounter "${p.encounter}".`);
          if (p.behavior !== undefined && !['still', 'shuffle', 'patrol', 'pursue'].includes(String(p.behavior))) at(m.file, 0, `${where(o)}: "behavior" must be still, shuffle, patrol, or pursue, not "${p.behavior}".`);
          if (p.chase !== undefined && (p.behavior !== 'pursue' || typeof p.chase !== 'number' || !Number.isFinite(p.chase) || p.chase <= 0))
            at(m.file, 0, `${where(o)}: "chase" needs a pursuing patrol and a positive speed multiplier.`);
          if (p.confined !== undefined && (p.behavior !== 'pursue' || typeof p.confined !== 'boolean'))
            at(m.file, 0, `${where(o)}: "confined" needs a pursuing patrol and a boolean.`);
          if (p.behavior === 'pursue') {
            // Several areas may share the name; together they are the territory.
            const zones = m.objects.filter((z) => z.type === 'area' && z.name === p.territory);
            if (!zones.length) at(m.file, 0, `${where(o)}: a pursuing patrol needs a "territory" naming an area on this map.`);
            else {
              const [dx, dy] = String(p.patrol ?? '0,-2').split(',').map((v) => Number(v) * 32);
              const inside = (x: number, y: number) => zones.some((zone) => x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h);
              if (!inside(o.x, o.y) || !inside(o.x + dx!, o.y + dy!)) at(m.file, 0, `${where(o)}: both patrol endpoints must lie inside its territory.`);
            }
          }
          if (p.patrol !== undefined && !/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(String(p.patrol))) at(m.file, 0, `${where(o)}: "patrol" must be "dx,dy" in tiles, such as "6,0", not "${p.patrol}".`);
          if (p.pellets !== undefined && p.pellets !== true) at(m.file, 0, `${where(o)}: "pellets" on an enemy can only be true (a boolean), to leave the pellets where it stands.`);
          break;
        case 'pickup':
          if (!c.pickups[String(p.kind)]) at(m.file, 0, `${where(o)}: unknown pickup kind "${p.kind}".`);
          if (p.guarded_by !== undefined && !m.objects.some((e) => e.type === 'enemy' && e.props.encounter === p.guarded_by))
            at(m.file, 0, `${where(o)}: "guarded_by" names encounter "${p.guarded_by}", but no enemy on this map is in it.`);
          break;
        case 'prop':
          if (!PROPS[String(p.kind)]) at(m.file, 0, `${where(o)}: unknown prop kind "${p.kind}". Kinds: ${Object.keys(PROPS).join(', ')}.`);
          break;
        case 'trigger':
          if (typeof scene !== 'string') at(m.file, 0, `${where(o)}: a trigger needs a "scene" property.`);
          if (p.on !== undefined && !['enter', 'use', 'seen'].includes(String(p.on))) at(m.file, 0, `${where(o)}: "on" must be enter, use, or seen.`);
          if (p.needs_rest !== undefined && (p.needs_rest !== true || (p.on ?? 'enter') !== 'enter'))
            at(m.file, 0, `${where(o)}: "needs_rest" can only be true, on a trigger walked into (on enter), so it plays only when someone is short of HP or MP.`);
          if (p.save_when_full !== undefined && (p.save_when_full !== true || (p.on ?? 'enter') !== 'enter'))
            at(m.file, 0, `${where(o)}: "save_when_full" can only be true, on a trigger walked into (on enter), to save without a scene when HP and MP are full.`);
          if (o.point) at(m.file, 0, `${where(o)}: a trigger must be a rectangle.`);
          break;
        case 'area':
          if (o.point) at(m.file, 0, `${where(o)}: an area must be a rectangle.`);
          if (p.pellets !== undefined && p.pellets !== false) at(m.file, 0, `${where(o)}: "pellets" can only be false (a boolean), to keep pellets out of the area.`);
          break;
        case 'exit': {
          const to = c.maps.get(String(p.to));
          if (!to) at(m.file, 0, `${where(o)}: no map "${p.to}".`);
          else if (!to.objects.some((t) => t.type === 'spawn' && t.name === p.spawn)) at(m.file, 0, `${where(o)}: map "${p.to}" has no spawn "${p.spawn}".`);
          if (o.point) at(m.file, 0, `${where(o)}: an exit must be a rectangle.`);
          break;
        }
      }
    }
  }
  return errors;
}
