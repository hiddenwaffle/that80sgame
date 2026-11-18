/**
 * The content, read and checked when the game is built and handed over packed (src/content/packed.ts): the game itself never
 * reads a content file. The dev server does the same at each refresh after an edit, and passes on the problems it found, which
 * the page shows; nothing is pushed to an open page. A build keeps only the maps play can reach (tools/production_content.ts).
 */
import built from 'virtual:content';
import type { LoadResult } from './content.ts';
import { unpackContent, type PackedContent } from './packed.ts';
import type { ContentError } from './screenplay.ts';

export function builtContent(): LoadResult {
  const { content, errors } = built as { content: PackedContent | null; errors: ContentError[] };
  return { content: content && unpackContent(content), errors };
}
