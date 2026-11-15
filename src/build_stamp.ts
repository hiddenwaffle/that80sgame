declare const __BUILD__: { sha: string; changed: boolean; time: string } | undefined;

/**
 * The commit this copy of the game was built from, whether it had uncommitted changes, and when it was built, as Vite writes them
 * in (`buildStamp` in vite.config.ts). Null where the source runs without Vite, as some tools run it.
 */
export const BUILD = typeof __BUILD__ === 'undefined' ? null : __BUILD__;

/** The build time as the page prints it: to the minute, in UTC. */
export const buildTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
