/**
 * The built game's licenses.txt: every library and font the build bundles, each with its license in full (card
 * fable_release_gaps, 2026-11-14). Vite's build.license lists the bundled packages and the license files they ship, as JSON;
 * a package that ships none gets its text from tools/licenses/, in a file named after the package (textFileFor). There,
 * pixi__colord.txt is LICENSE.md from github.com/omgovich/colord, read 2026-11-14: Pixi's fork of colord leaves it out of
 * its package. The build stops if a package is left without a text, or if a file there is no longer needed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** One package as Vite's build.license lists it. */
export type LicenseEntry = { name: string; version: string; identifier?: string; text?: string };
export type CompleteEntry = LicenseEntry & { text: string };

/** Where the built site carries the file, and where Vite writes the list it is made from (left out of the build). */
export const LICENSES_FILE = 'licenses.txt';
export const VITE_LICENSES = '.vite/licenses.json';

export const textsDir = (root: string) => path.join(root, 'tools', 'licenses');
/** @pixi/colord → pixi__colord.txt */
export const textFileFor = (name: string) => `${name.replace(/^@/, '').replace('/', '__')}.txt`;

/** The texts in tools/licenses/, by file name. */
export function readTexts(dir: string): Map<string, string> {
  return new Map(readdirSync(dir).filter(f => f.endsWith('.txt')).sort().map(f => [f, readFileSync(path.join(dir, f), 'utf8')]));
}

/** Every entry with its text, and the problems: a package with no text anywhere, a file for one that ships its own, a file for none. */
export function completeLicenses(entries: readonly LicenseEntry[], texts: ReadonlyMap<string, string>): { entries: CompleteEntry[]; problems: string[] } {
  const problems: string[] = [], used = new Set<string>();
  if (!entries.length) problems.push('Vite listed no bundled packages, though the game bundles Pixi: is build.license on?');
  const complete = entries.map(e => {
    const file = textFileFor(e.name), given = texts.get(file)?.trim();
    if (texts.has(file)) used.add(file);
    const own = e.text?.trim();
    if (own) {
      if (texts.has(file)) problems.push(`${e.name} ships its own license now, so tools/licenses/${file} is not needed`);
      return { ...e, text: own };
    }
    if (!given) problems.push(`${e.name} ${e.version} ships no license text: add it as tools/licenses/${file}`);
    return { ...e, text: given ?? '' };
  });
  for (const file of texts.keys()) if (!used.has(file)) problems.push(`tools/licenses/${file} is for no package the build bundles`);
  return { entries: complete, problems };
}

export function renderLicenses(entries: readonly CompleteEntry[]): string {
  const rule = '-'.repeat(72);
  return [
    'Licenses',
    '',
    "This build of That '80s Game bundles these libraries and fonts. Each is under its own license, given in full below.",
    ...entries.flatMap(e => ['', rule, `${e.name} ${e.version}${e.identifier ? `, ${e.identifier}` : ''}`, rule, '', e.text]),
  ].join('\n') + '\n';
}
