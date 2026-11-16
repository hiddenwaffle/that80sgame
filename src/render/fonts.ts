import bangers from '@fontsource/bangers/files/bangers-latin-400-normal.woff2?url';
import comic400 from '@fontsource/comic-neue/files/comic-neue-latin-400-normal.woff2?url';
import comic400i from '@fontsource/comic-neue/files/comic-neue-latin-400-italic.woff2?url';
import comic700 from '@fontsource/comic-neue/files/comic-neue-latin-700-normal.woff2?url';
import oldStd400 from '@fontsource/old-standard-tt/files/old-standard-tt-latin-400-normal.woff2?url';
import oldStd400i from '@fontsource/old-standard-tt/files/old-standard-tt-latin-400-italic.woff2?url';
import oldStd700 from '@fontsource/old-standard-tt/files/old-standard-tt-latin-700-normal.woff2?url';
import oswald400 from '@fontsource/oswald/files/oswald-latin-400-normal.woff2?url';
import oswald700 from '@fontsource/oswald/files/oswald-latin-700-normal.woff2?url';
import fraktur from '@fontsource/unifrakturmaguntia/files/unifrakturmaguntia-latin-400-normal.woff2?url';

/** Font families, by role. All are open-licence fonts bundled with the game. */
export const FONT = {
  /** The masthead. */
  masthead: 'UnifrakturMaguntia',
  /** Headlines, menus, and numbers. */
  headline: 'Oswald',
  /** Narration captions and newspaper body text. */
  body: 'Old Standard TT',
  /** Speech balloons. */
  balloon: 'Comic Neue',
  /** Shouts, battle cries, and sound effects lettering. */
  shout: 'Bangers',
  /** Poster lettering: names, titles, and the fight's commands. */
  letter: 'Bangers',
} as const;

// The real italic faces for captions and whispers, so the browser does not slant the upright ones itself.
const faces: Array<[string, string, string, string?]> = [
  [FONT.masthead, fraktur, '400'],
  [FONT.headline, oswald400, '400'],
  [FONT.headline, oswald700, '700'],
  [FONT.body, oldStd400, '400'],
  [FONT.body, oldStd400i, '400', 'italic'],
  [FONT.body, oldStd700, '700'],
  [FONT.balloon, comic400, '400'],
  [FONT.balloon, comic400i, '400', 'italic'],
  [FONT.balloon, comic700, '700'],
  [FONT.shout, bangers, '400'],
];

/** Loads every face. Each is tried three times, a second apart, as art is (src/art/images.ts): one failed request used to
 * end startup on a developer's error page (Fable review F3, 2026-11-09). One that still fails stops startup with a message. */
export async function loadFonts(): Promise<void> {
  await Promise.all(
    faces.map(async ([family, url, weight, style]) => {
      for (let attempt = 1; ; attempt++) {
        // Tried again at an address of its own: WebKit keeps a font that dropped on its way as failed, through every Reload too,
        // when the phone notice had preloaded it (index.html), and answers the same address so without asking again. The first
        // try takes the plain address, the preload's, so nothing is fetched twice (tools/network_cut_checks.ts, 15 Nov).
        const src = attempt === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}again=${attempt}`;
        const face = new FontFace(family, `url(${src})`, { weight, style: style ?? 'normal' });
        try {
          await face.load();
          document.fonts.add(face);
          return;
        } catch (e) {
          if (attempt >= 3) throw new Error(`The ${family} font did not load (${e instanceof Error ? e.message : String(e)}).`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }),
  );
}
