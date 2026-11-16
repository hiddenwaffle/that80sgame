/**
 * Where the browser refuses the site any storage (turned off, or the site's data blocked), the game keeps its save, and the
 * note the release check leaves as it reloads (src/release_check.ts), in the page's own address, after the # (the owner,
 * 16 Nov: "Something like a hash fragment that gets updated that the player can bookmark?", then "Yeah let's do that"). The
 * address changes in place, with no reload and no new step for Back, so a reload, a reopened tab, a restored session or a
 * bookmark brings the save back. Only then: where storage works, nothing is written there and nothing there is read, so other
 * players keep a clean address, and a link someone made up changes nobody's game.
 */

/** Whether the browser refuses this site storage altogether, as opposed to storage that works but may be out of room. */
export function storageRefused(): boolean {
  // Refused, the getter throws (a SecurityError, which `typeof` does not guard against) or, in some browsers, gives null.
  try {
    return !globalThis.localStorage;
  } catch {
    return true;
  }
}

function read(): URLSearchParams {
  return new URLSearchParams(location.hash.slice(1));
}

function write(p: URLSearchParams): void {
  const text = p.toString();
  if (text === location.hash.slice(1)) return;
  // Replaced, not pushed, so Back still leaves the game; with nothing left, the # goes too.
  history.replaceState(history.state, '', text ? `#${text}` : `${location.pathname}${location.search}`);
}

/** The address as a store of short texts. Every call throws where there is no page, as in the unit tests' Node. */
export const addressStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: (key) => read().get(key),
  setItem: (key, value) => {
    const p = read();
    p.set(key, value);
    write(p);
  },
  removeItem: (key) => {
    const p = read();
    p.delete(key);
    write(p);
  },
};
