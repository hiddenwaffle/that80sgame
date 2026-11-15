import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Whether the module whose import.meta.url is given is the script node was started with. Compares real paths, so a
 * checkout whose path has a space, or one reached through a symlink, still runs the tool (a plain `file://` + argv[1]
 * comparison printed nothing and exited 0 there; Fable review T1, 2026-11-09). */
export function isMain(url: string): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const real = (file: string) => { try { return realpathSync(file); } catch { return path.resolve(file); } };
  return real(fileURLToPath(url)) === real(script);
}
