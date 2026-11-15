/**
 * The build plugin selects reachable maps before bundling; development retains every file. An edited file
 * reaches the game when the page is refreshed (nothing is pushed to an open page).
 */
import raw from 'virtual:content-files';

export function contentFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [path, text] of Object.entries(raw)) files.set(path.replace(/^\//, ''), text);
  return files;
}
