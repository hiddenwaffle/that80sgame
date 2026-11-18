import { Assets, Texture } from 'pixi.js';
import facts from 'virtual:art-files';
import files, { webpOnly } from 'virtual:art-sources';
import type { Content } from '../content/content.ts';
import { ArtQueue } from './artQueue.ts';
import { artChapter, artGroups, nearbyArt } from './artGroups.ts';
import { releaseWatch } from '../release_check.ts';

/**
 * Generated art, dropped into the slots the code drawings fill. Each PNG or JPEG under `src/art/images/` is a
 * slot named by its path without the extension, such as `pictures/trio` or `props/willow`, and the
 * spec for every slot is in `docs/art_spec.md`. The title page draws no pictures of its own, so it appears at once; the
 * saved chapter (or the opening without a save) loads behind it. Maps and pictures wait for their own slots; the other chapters
 * follow once that one is in, behind the title or in play. A slot with no
 * image keeps its code drawing, and with `?art=off` in the page's address every slot does, for comparing the two.
 * An image that fails to load, tried three times, leaves a hot pink box its size, plain enough that a player
 * says so (the owner, 2026-10-14).
 */

const textures = new Map<string, Texture>();
/** The file each loaded slot came from, for the checks. */
const sources = new Map<string, string>();
/** The slots whose image failed to load, with its size, and the hot pink box made for it once it is asked for. */
const failed = new Map<string, { width: number; height: number; box?: Texture }>();
let enabled = true;

/** One image to load: its slot, its address (none for a master with no current WebP copy, in development), and its size in bytes and pixels. */
interface Pic {
  slot: string;
  url: string | null;
  bytes: number;
  width: number;
  height: number;
}

/**
 * Each slot's file. The PNGs and JPEGs are the masters; beside each is a WebP copy about a fifth of the
 * size (tools/art_webp.ts), which production imports exclusively. Builds reject missing or stale copies.
 * The dev server serves the same copies, each only while it is current; a master whose copy is missing or stale comes
 * with no address and shows its hot pink box until the copy is made (vite.config.ts devArtFiles), never the master.
 */
function slotFiles(webp: boolean): Pic[] {
  const out = new Map<string, Pic>();
  const masters = new Set(Object.keys(files).filter(path => !path.endsWith('.webp')).map(slotOf));
  for (const [path, url] of Object.entries(files)) {
    const slot = slotOf(path);
    // A file the size list lacks (none should, so it says so) counts little toward the share and is a square should it fail.
    const f = facts[path] ?? { bytes: 1, width: 256, height: 256 };
    if (!facts[path]) console.warn(`No size for the art file ${path}; the loading page's share leaves it out.`);
    // Also accept a copy when its master is absent, so even a mistaken preference cannot empty a WebP-only catalog.
    if (path.endsWith('.webp') ? webp || !masters.has(slot) : !(webp && out.has(slot))) out.set(slot, { slot, url, ...f });
  }
  return [...out.values()];
}

const catalog = new Map<string, Pic>();
let groups = new Map<string, string[]>();
let prefetchVersion = 0;
const queue = new ArtQueue(async (key, priority) => loadOne(catalog.get(key)!, priority === 0));

/** Dependencies include hidden objects, alternate poses, plant replacements and chapter pictures. */
export function artForMap(map: string): string[] { return groups.get(artChapter(map)) ?? []; }
export function artForGroup(group: string): string[] { return groups.get(group) ?? []; }
const selected = (slots?: readonly string[]) => slots ? [...new Set(slots)].filter(s => catalog.has(s)) : [...catalog.keys()];

/** A file's path under images/ without the extension: the slot it fills. */
function slotOf(path: string): string {
  return path.replace(/^\.\/images\//, '').replace(/\.(png|jpg|webp)$/, '');
}

/**
 * Told each time a waited-on picture fails for good, its hot pink box standing in: the game says why (Game.askLoadingProblem).
 * The opening chapter loads before the game is made, so a failure then is kept and told as the game starts listening.
 */
let failedForGood: (() => void) | null = null;
let failedUnheard = false;
export function onArtFailed(fn: (() => void) | null): void {
  failedForGood = fn;
  if (fn && failedUnheard) {
    failedUnheard = false;
    fn();
  }
}

/**
 * Loads one image into its slot, trying twice more a second apart, and answers whether the slot is settled. One that still
 * fails leaves its hot pink box. Waited on (`final`: a map change, with the loading page up), that failure is final; in the
 * background it is not, so the next wait for the slot asks again: a short network drop used to leave whole maps pink for
 * good (Fable review P3, 2026-11-09). A later success clears the failure.
 */
async function loadOne(pic: Pic, final: boolean): Promise<boolean> {
  if (pic.url === null) {
    failed.set(pic.slot, { width: pic.width, height: pic.height });
    console.warn(`Art for ${pic.slot} has no current WebP copy yet (node tools/art_webp.ts; npm run dev makes it in the background); a hot pink box stands in for it.`);
    return true;
  }
  try {
    textures.set(pic.slot, await Assets.load<Texture>(pic.url, { strategy: 'retry', retryCount: 2, retryDelay: 1000 }));
    sources.set(pic.slot, pic.url);
    // Forgotten, not destroyed: a sprite drawn with the pink box meanwhile may still hold it until its map is built again.
    failed.delete(pic.slot);
    return true;
  } catch (e) {
    failed.set(pic.slot, failed.get(pic.slot) ?? { width: pic.width, height: pic.height });
    console.warn(`Art for ${pic.slot} did not load${final ? '' : ' in the background (it is tried again when it is needed)'}; a hot pink box stands in for it.`, e);
    if (final) {
      if (failedForGood) failedForGood();
      else failedUnheard = true;
    }
    // It may be one a newer release took off the site (src/release_check.ts).
    void releaseWatch.missing();
    // A failed request is not cached by Pixi's loader for a retry to reuse: unload it so the next try fetches afresh.
    void Assets.unload(pic.url).catch(() => undefined);
    return final;
  }
}

/**
 * The chosen initial chapter first; once it is in, the others behind it, nearest first, whether the player is still on the
 * title or playing (the owner, 15 Nov: "Any reason why the background loading couldn't happen right the initial loading is
 * done?"). Before, they waited for play to begin, so a player who stayed on the title had none of them. A map entered meanwhile
 * points the order from there (`prefetchArt`), and anything waited on goes ahead of them all (ArtQueue).
 */
export async function loadArt(on: boolean, content: Content, initialMap = content.party.start.map): Promise<void> {
  enabled = on;
  const all = on ? slotFiles(webpOnly) : [];
  all.forEach(p => catalog.set(p.slot,p));
  groups = artGroups(content,[...catalog.keys()]);
  // Waited on: startup holds the loading page until the opening chapter is in, so its three tries are final (the owner's three
  // tries, then pink, 2026-10-14), not background ones to be asked for again.
  void queue.ensure(artForMap(initialMap),0).then(() => prefetchArt(initialMap), () => undefined);
}

/** A chapter the player has just picked (a save code that checks out) comes in ahead of the background prefetch. */
export function warmArt(map: string): void {
  void queue.ensure(selected(artForMap(map)));
}

/** Cached art stays resident on revisits. A new destination redirects the remaining prefetch order. */
export function prefetchArt(map: string): void {
  const version=++prefetchVersion;
  void (async () => {
    for (const group of nearbyArt(map)) {
      if (version!==prefetchVersion) return;
      await queue.ensure(artForGroup(group),1);
    }
  })();
}

/** Whether the requested selected images have arrived or failed. Omitted slots means all selected art. */
export function artReady(slots?: readonly string[]): boolean { return queue.ready(selected(slots)); }

/**
 * How far the art has come: images in (arrived or failed) of how many, the share of their bytes in, and the seconds
 * left at the rate they have come so far (null until it can be told, 0 once all are in).
 */
export interface ArtProgress {
  loaded: number;
  total: number;
  share: number;
  secondsLeft: number | null;
}

export function artProgress(slots?: readonly string[]): ArtProgress {
  const wanted=selected(slots);
  const complete=wanted.filter(s=>queue.complete.has(s));
  const bytesAll=wanted.reduce((n,s)=>n+catalog.get(s)!.bytes,0);
  const bytesIn=complete.reduce((n,s)=>n+catalog.get(s)!.bytes,0);
  return {
    loaded: complete.length, total: wanted.length,
    share: bytesAll ? bytesIn / bytesAll : 1,
    secondsLeft: artReady(wanted) ? 0 : null,
  };
}

/**
 * Seconds until `left` bytes more arrive at the rate `arrived` bytes came in `ms`; null in the first second, or with
 * nothing in yet, when the rate means nothing.
 */
export function secondsLeft(left: number, arrived: number, ms: number): number | null {
  if (ms < 1000 || arrived <= 0) return null;
  return left / (arrived / (ms / 1000));
}

/**
 * Resolves when every image has arrived or failed, telling `onProgress` how far along it is as it goes. It waits as
 * long as that takes: the loading page shows how far along it is, and a player who would rather not wait can leave.
 */
export function whenArtReady(opts: { slots?: readonly string[]; onProgress?: (p: ArtProgress) => void } = {}): Promise<void> {
  const slots=selected(opts.slots);
  const began=performance.now();
  const arrived=()=>slots.filter(s=>queue.complete.has(s)).reduce((n,s)=>n+catalog.get(s)!.bytes,0);
  const before=arrived(), total=slots.reduce((n,s)=>n+catalog.get(s)!.bytes,0);
  // A slot whose background load failed, or that was already loading in the background when this asked, is asked for again,
  // waited on this time, so only a failure here is final.
  const done=queue.ensure(slots).then(()=>queue.ready(slots)?undefined:queue.ensure(slots.filter(s=>!queue.complete.has(s))));
  const tick=()=> {
    const p=artProgress(slots), bytes=arrived();
    p.secondsLeft=p.share===1?0:secondsLeft(total-bytes,bytes-before,performance.now()-began);
    opts.onProgress?.(p);
  };
  tick();
  if (!opts.onProgress) return done;
  const timer=window.setInterval(tick,200);
  return done.finally(()=>{window.clearInterval(timer);tick();});
}

/** The hot pink a failed image's box is filled with. */
export const MISSING_PINK = '#ff69b4';

/** A box of hot pink, as many pixels as the image it stands in for, so it is placed and sized as that image would be. */
function pinkBox(width: number, height: number): Texture {
  const c = document.createElement('canvas');
  c.width = Math.max(1, width);
  c.height = Math.max(1, height);
  const g = c.getContext('2d')!;
  g.fillStyle = MISSING_PINK;
  g.fillRect(0, 0, c.width, c.height);
  return Texture.from(c);
}

/**
 * The image for a slot: its hot pink box if it failed to load, or null when there is none (or art is off) and the
 * code drawing is used.
 */
export function art(slot: string): Texture | null {
  if (!enabled) return null;
  const tex = textures.get(slot);
  if (tex) return tex;
  const f = failed.get(slot);
  if (!f) return null;
  f.box ??= pinkBox(f.width, f.height);
  return f.box;
}

/** The slots whose image failed to load, for the checks. */
export function artFailed(): string[] {
  return enabled ? [...failed.keys()].sort() : [];
}

/** The file each loaded slot came from (a WebP copy or a master), for the checks. */
export function artSources(): Record<string, string> {
  return Object.fromEntries(sources);
}

/** The slots that have an image (not counting failed ones), for the checks and the dev tools. */
export function artSlots(): string[] {
  return enabled ? [...textures.keys()].sort() : [];
}
