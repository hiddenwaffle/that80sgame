import { BUILD } from './build_stamp.ts';

/**
 * Noticing that the site holds a newer release than this page (the owner, 15 Nov: "Noticing a newer release would be
 * better"). Each release replaces the whole site (tools/publish/root/.github/workflows/pages.yml), so a file whose content
 * changed, being named by it, is gone, and a page left open across a release fails when it next fetches one. Once every
 * picture is in (about 20 s on a slow connection, behind the title: src/art/images.ts), nothing more is fetched: the workers,
 * the synthesizer's (src/audio/styled.ts) and the title globe's (src/ui/title_globe_load.ts), are built into the code that
 * starts them and made from memory. When a picture or the synthesizer's code does not arrive, or startup stops on a part
 * that did not, the page reads the site's version.json
 * (vite.config.ts) and, if it names another build, tells whoever listens: before the game is shown, the page reloads by
 * itself. In play it does not: pictures that fail for good are explained by the game's question about loading problems
 * (Game.askLoadingProblem), which offers the reload whatever kept them away. Coming back to the tab does not ask, since a
 * page with everything in breaks only where a file it fetches again is gone (the owner, 15 Nov: "Yes drop the return
 * check, then").
 */

/** How soon after asking the site, with nothing newer there, another missing file asks again. */
export const RECHECK_MS = 60_000;
/** The build the page was last reloaded for, this tab only (sessionStorage). */
const RELOADED_KEY = 'that80sgame.reloadedFor';

export interface ReleaseWatch {
  /** A file fetched late did not arrive: asks the site whether a newer release took it away. */
  missing(): Promise<void>;
  /** Told the newer release's build each time a missing file finds it; one listener, the latest. */
  listen(fn: ((sha: string) => void) | null): void;
  /** Whether this tab was reloaded for that build already and is still the old page (the site not yet the new one everywhere). */
  reloadedFor(sha: string): boolean;
  /** Reloads the page for that build, noting it, so a page that comes back old does not reload for it again by itself. */
  reload(sha: string): void;
}

export interface ReleaseWatchDeps {
  /** This page's build, or null where the source runs without Vite. */
  current: string | null;
  /** The site's version.json, read past every cache; rejects or gives null when it cannot be read. */
  version: () => Promise<unknown>;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
}

export function createReleaseWatch(deps: ReleaseWatchDeps): ReleaseWatch {
  let newer: string | null = null;
  let askedAt = -Infinity;
  let asking: Promise<string | null> | null = null;
  let listener: ((sha: string) => void) | null = null;
  // Once found, a newer release stays found; otherwise the site is asked at most once a `RECHECK_MS`.
  const ask = (): Promise<string | null> => {
    if (newer) return Promise.resolve(newer);
    if (deps.current === null) return Promise.resolve(null);
    if (asking) return asking;
    if (deps.now() - askedAt < RECHECK_MS) return Promise.resolve(null);
    askedAt = deps.now();
    asking = deps.version().then(
      (v) => {
        const sha = (v as { sha?: unknown } | null)?.sha;
        if (typeof sha === 'string' && sha && sha !== deps.current) newer = sha;
        return newer;
      },
      () => null,
    ).finally(() => { asking = null; });
    return asking;
  };
  const tell = async (): Promise<void> => {
    const sha = await ask();
    if (sha) listener?.(sha);
  };
  return {
    missing: () => tell(),
    listen: (fn) => { listener = fn; },
    reloadedFor: (sha) => {
      try { return deps.storage?.getItem(RELOADED_KEY) === sha; } catch { return false; }
    },
    reload: (sha) => {
      try { deps.storage?.setItem(RELOADED_KEY, sha); } catch { /* reloaded all the same */ }
      deps.reload();
    },
  };
}

function session(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}

/** The page's own watch, on its build and the site it came from. */
export const releaseWatch = createReleaseWatch({
  current: BUILD?.sha ?? null,
  // A query of its own, past the site's caches as well as the browser's.
  version: () => fetch(new URL(`version.json?t=${Date.now()}`, document.baseURI), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
  now: () => performance.now(),
  storage: typeof sessionStorage === 'undefined' ? null : session(),
  reload: () => location.reload(),
});
