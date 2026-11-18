export interface BuildStamp { sha: string; changed: boolean; time: string }

/**
 * The commit this copy of the game was built from, whether it had uncommitted changes, and when it was built, as Vite writes them
 * into index.html (`stampPage` in vite.config.ts), never into a script. Null where the source runs without that page, as some
 * tools run it.
 */
export const BUILD: BuildStamp | null = readStamp(typeof document === 'undefined' ? null : document);

/** The stamp in a page's `build-stamp` block, or null when it has none or it is not a stamp. */
export function readStamp(page: Pick<Document, 'getElementById'> | null): BuildStamp | null {
  try {
    const s = JSON.parse(page?.getElementById('build-stamp')?.textContent ?? 'null') as Partial<BuildStamp> | null;
    return s && typeof s.sha === 'string' && typeof s.changed === 'boolean' && typeof s.time === 'string' ? { sha: s.sha, changed: s.changed, time: s.time } : null;
  } catch {
    return null;
  }
}

/** The build time as the page prints it: to the minute, in UTC. */
export const buildTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
