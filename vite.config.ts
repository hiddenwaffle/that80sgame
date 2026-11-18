import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { masters, stale, orphans, currentCopyOf } from './tools/webp_record.ts';
import { imageFactsUnder, imageSize } from './tools/image_size.ts';
import { loadContent } from './src/content/content.ts';
import { contentForGame, INCLUDE_DEV_MAPS, keepScenery, readBuildFiles, selectBuildContent, type BuildContent } from './tools/production_content.ts';
import { completeLicenses, LICENSES_FILE, readTexts, renderLicenses, textsDir, VITE_LICENSES, type LicenseEntry } from './tools/third_party_licenses.ts';

/** The module listing each art image's size in bytes and pixels (`artFiles` below). */
const ART_FILES = 'virtual:art-files';
/** The content, read and checked here, as the game gets it (src/content/bundle.ts). */
const CONTENT = 'virtual:content';
/** URL imports are selected before bundling, so production never emits source masters. */
const ART_SOURCES = 'virtual:art-sources';
const here = fileURLToPath(new URL('.', import.meta.url)).split(path.sep).join('/').replace(/\/+$/, '');
const scratchDirs = ['tmp', '.scratch'].map(dir => `${here}/${dir}`);
/** Names are independent of header parsing: malformed dev images still reach the visible failure path. */
function imageFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory()
    ? imageFiles(path.join(dir, d.name), `${prefix}${d.name}/`)
    : /\.(png|jpg|webp)$/.test(d.name) ? [`${prefix}${d.name}`] : []).sort();
}

/**
 * With hmr off, Vite never restarts for an edit to this file or to anything it imports (its restart check sits behind hmr),
 * so a merge could leave the open game reading maps with old tools until someone restarted it (28 Oct: Berlin's shadows
 * missing until 5173 was restarted). This puts that restart back; open pages still only change when refreshed.
 */
function restartOnConfigChange(): Plugin {
  return {
    name: 'restart-on-config-change',
    apply: 'serve',
    configureServer(server) {
      const watched = new Set([server.config.configFile, ...server.config.configFileDependencies]
        .filter((f): f is string => Boolean(f)).map(f => path.resolve(f)));
      let restarting = false;
      server.watcher.on('change', (file: string) => {
        if (restarting || !watched.has(path.resolve(file))) return;
        restarting = true;
        server.config.logger.info(`${path.relative(server.config.root, file)} changed, restarting the dev server`, { timestamp: true });
        server.restart().catch((e: unknown) => {
          restarting = false;
          server.config.logger.error(String(e));
        });
      });
    },
  };
}

/**
 * With hmr off, refreshes need the generated art catalogs invalidated when their files change. Otherwise a new picture can
 * remain missing until the dev server restarts. The content's module follows its files itself (contentBundle).
 */
function globsFollowNewFiles(): Plugin {
  return {
    name: 'globs-follow-new-files',
    configureServer(server) {
      const root = server.config.root;
      const lists: Array<[string, string]> = [
        [path.join(root, 'src/art/images') + path.sep, path.join(root, 'src/art/images.ts')],
      ];
      const stale = (file: string) => {
        for (const [dir, holder] of lists) {
          if (!path.resolve(file).startsWith(dir)) continue;
          for (const mod of server.moduleGraph.getModulesByFile(holder) ?? []) server.moduleGraph.invalidateModule(mod);
        }
      };
      server.watcher.on('add', stale);
      server.watcher.on('unlink', stale);
      // The art images' sizes change with any image added, removed or written again.
      const images = path.join(root, 'src/art/images') + path.sep;
      const resized = (file: string) => {
        if (!path.resolve(file).startsWith(images)) return;
        for (const id of [ART_FILES, ART_SOURCES]) {
          const mod = server.moduleGraph.getModuleById('\0' + id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
      };
      for (const event of ['add', 'unlink', 'change']) server.watcher.on(event, resized);
    },
  };
}

/**
 * Content and both art catalogs share one selection for each build. The game gets the content read, checked and packed
 * (tools/production_content.ts contentForGame), never its files, so the YAML reader and the check stay out of it
 * (contentCheckStaysOut). JSON.parse, as V8 reads a large literal faster that way.
 */
function contentBundle() {
  let root = '', production = false, selected: BuildContent | undefined;
  const selection = () => selected ??= selectBuildContent(readBuildFiles(root), !production || process.env[INCLUDE_DEV_MAPS] === '1');
  const plugin: Plugin = {
    name: 'content-bundle',
    configResolved(config) { root = config.root; production = config.command === 'build'; selected = undefined; },
    buildStart() { selected = undefined; },
    resolveId: id => id === CONTENT ? '\0' + id : undefined,
    load(id) {
      if (id !== '\0' + CONTENT) return;
      const files = selection().files;
      for (const file of files.keys()) this.addWatchFile(path.join(root, file));
      const built = contentForGame(loadContent(files));
      // The dev server's page lists the problems; a build has none to show.
      if (production && built.errors.length) this.error(['The content has problems:', ...built.errors.map(e => `${e.file}${e.line ? `:${e.line}` : ''}  ${e.message}`)].join('\n'));
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(built))});`;
    },
    configureServer(server) {
      const stale = (file: string) => {
        if (!path.resolve(file).startsWith(path.join(root, 'content') + path.sep)) return;
        selected = undefined;
        const mod = server.moduleGraph.getModuleById('\0' + CONTENT);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      for (const event of ['add', 'unlink', 'change']) server.watcher.on(event, stale);
    },
  };
  return { plugin, selection };
}
const content = contentBundle();

/**
 * The game gets its content read and checked already (contentBundle), and checks saves with zod's small edition (src/game/state.ts),
 * so none of these has a place in it. One value imported from src/content/content.ts, or one save check written with the full
 * zod, would bring them back without a word (about 210 kB of minified script did until 18 Nov); a build that holds any stops.
 */
function contentCheckStaysOut(): Plugin {
  const kept: Array<[string, RegExp]> = [
    ['the YAML reader, node_modules/yaml', /\/node_modules\/yaml\//], ['the full zod, node_modules/zod/v4/classic', /\/node_modules\/zod\/v4\/classic\//],
    ['src/content/content.ts', /\/src\/content\/content\.ts$/], ['src/content/schemas.ts', /\/src\/content\/schemas\.ts$/],
  ];
  return {
    name: 'content-check-stays-out',
    apply: 'build',
    generateBundle(_, bundle) {
      const ids = Object.values(bundle).flatMap(o => o.type === 'chunk' ? Object.entries(o.modules).filter(([, m]) => m.renderedLength > 0).map(([id]) => id) : []);
      const held = kept.filter(([, re]) => ids.some(id => re.test(id))).map(([what]) => `  ${what}`);
      if (held.length) this.error([
        'The game holds code that only reads or checks content, or the full zod:', ...held,
        'The game takes only types from src/content/content.ts and src/content/schemas.ts (import type), and zod from zod/mini.',
      ].join('\n'));
    },
  };
}

/**
 * In development each master is served as a build ships it: its WebP copy, only while the copy is current. A master whose
 * copy is missing or stale is listed with no file, so the game shows its hot pink box rather than the master or an old copy:
 * a converter that stopped is seen, never covered (the owner, 2026-10-28). `npm run dev` makes copies in the background
 * (webpInBackground below), and the reload after shows them. A copy whose master is gone is left out, as a build refuses it.
 */
function devArtFiles(dir: string, names: string[]): Array<{ key: string; served: boolean }> {
  const copyOf = currentCopyOf();
  return names.filter(n => !n.endsWith('.webp')).map(n => copyOf(path.join(dir, n))
    ? { key: n.replace(/\.(png|jpg)$/, '.webp'), served: true } : { key: n, served: false });
}

/** Art URLs and sizes share the same catalog. Development lists both formats' sizes; builds import WebP only. */
function artFiles(): Plugin {
  let root = '';
  let production = false;
  let productionEnvironment = false;
  return {
    name: 'art-files',
    configResolved(config) {
      root = config.root;
      production = config.command === 'build';
      productionEnvironment = config.isProduction;
    },
    buildStart() {
      if (!production) return;
      if (!productionEnvironment) this.warn('Building with a non-production NODE_ENV; the art catalog still uses WebP only.');
      const maps = content.selection().maps;
      const bad = stale().filter(m => keepScenery(m.slot, maps)), extra = orphans().filter(slot => keepScenery(slot, maps));
      if (bad.length || extra.length) this.error([
        'Production art requires current WebP copies; source masters are never bundled.',
        ...bad.map(m => `Missing or stale WebP: ${m.slot}`),
        ...extra.map(slot => `WebP without its master: ${slot}`),
        'Run node tools/art_webp.ts, then build again.',
      ].join('\n'));
    },
    resolveId: (id) => (id === ART_FILES || id === ART_SOURCES ? '\0' + id : undefined),
    load(id) {
      if (id !== '\0' + ART_FILES && id !== '\0' + ART_SOURCES) return;
      const dir = path.join(root, 'src/art/images');
      const maps = content.selection().maps;
      const entries = Object.entries(imageFactsUnder(dir)).filter(([file]) => !production || (file.endsWith('.webp') && keepScenery(file, maps)));
      if (production) {
        const files = new Set(entries.map(([file]) => file));
        const unreadable = masters().filter(m => keepScenery(m.slot, maps) && !files.has(`${m.slot}.webp`));
        if (unreadable.length) this.error(`Unreadable WebP art: ${unreadable.map(m => m.slot).join(', ')}. Run node tools/art_webp.ts --all to regenerate copies even if their record hashes match.`);
      }
      if (id === '\0' + ART_FILES) return `export default ${JSON.stringify(Object.fromEntries(entries.map(([k, f]) => [`./images/${k}`, f])))};`;
      // Generated imports are deliberately absent for masters in a build. A runtime condition around an eager
      // import.meta.glob is too late: its asset imports can already have emitted files before tree shaking.
      const listed = production ? entries.map(([file]) => ({ key: file, served: true })) : devArtFiles(dir, imageFiles(dir));
      const imports = listed.map((f, i) => f.served ? `import image${i} from ${JSON.stringify(path.join(dir, f.key) + '?url')};` : '').filter(Boolean).join('\n');
      const values = listed.map((f, i) => `${JSON.stringify('./images/' + f.key)}: ${f.served ? `image${i}` : 'null'}`).join(',\n');
      return `${imports}\nexport const webpOnly = ${production};\nexport default {${values}};`;
    },
  };
}

/**
 * `npm run dev` keeps the WebP copies current in the background (the owner, 2026-10-28: the lag between a new PNG and its
 * WebP "happens in the background and I don't see them until later when I reload the page"). The server starting, or a
 * master written, runs tools/art_webp.ts once the files have been quiet a few seconds; meanwhile a new or
 * changed master shows the hot pink box (devArtFiles above), and a reload after shows the copy. Only `npm run dev` sets THAT80SGAME_WEBP_WATCH: a check's server
 * must never write the tree it is reading, and copies made this way are files to commit like any other.
 */
function webpInBackground(): Plugin {
  return {
    name: 'webp-in-background',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root, logger = server.config.logger;
      // The public repository has no tools/art_webp.ts, and its copies are already current, so its dev server makes none.
      if (process.env.THAT80SGAME_WEBP_WATCH !== '1' || !existsSync(path.join(root, 'tools/art_webp.ts'))) return;
      const art = path.join(root, 'src/art/images') + path.sep;
      let timer: ReturnType<typeof setTimeout> | undefined, child: ChildProcess | undefined, again = false, closed = false;
      const schedule = () => { clearTimeout(timer); if (!closed) timer = setTimeout(run, 3000); };
      const run = () => {
        // One run at a time; files written during one get another after it.
        if (child) { again = true; return; }
        let out = '';
        // Node's compile cache stays in the project, as npm test keeps it (tools/run_unit_tests.ts).
        const env = { ...process.env, NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE ?? path.join(root, 'tmp', 'node_compile_cache') };
        child = spawn(process.execPath, [path.join(root, 'tools/art_webp.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout?.on('data', d => { out += d; });
        child.stderr?.on('data', d => { out += d; });
        child.on('exit', code => {
          child = undefined;
          const made = /(\d+) made:/.exec(out)?.[1], removed = (out.match(/Removed /g) ?? []).length;
          if (code !== 0) logger.error(`WebP copies: tools/art_webp.ts stopped (exit ${code}); new or changed masters show hot pink meanwhile.\n${out.trim().split('\n').slice(-8).join('\n')}`, { timestamp: true });
          else if (made || removed) logger.info(`WebP copies: ${made ?? 0} made, ${removed} removed; a reload shows them.`, { timestamp: true });
          if (again) { again = false; schedule(); }
        });
      };
      const relevant = (file: string) => {
        const f = path.resolve(file);
        return f.startsWith(art) && /\.(png|jpg)$/.test(f);
      };
      for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, (file: string) => { if (relevant(file)) schedule(); });
      server.httpServer?.once('close', () => { closed = true; clearTimeout(timer); child?.kill('SIGTERM'); });
      schedule();
    },
  };
}

/**
 * licenses.txt at the top of the built site (tools/third_party_licenses.ts), made from the list Vite's build.license writes.
 * Vite writes that list in generateBundle without an order, so this runs after it ('post') and leaves the list out.
 */
function thirdPartyLicenses(): Plugin {
  let root = '';
  return {
    name: 'third-party-licenses',
    apply: 'build',
    configResolved(config) { root = config.root; },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const list = bundle[VITE_LICENSES];
        if (!list || list.type !== 'asset') return this.error(`Vite wrote no ${VITE_LICENSES}: is build.license on?`);
        delete bundle[VITE_LICENSES];
        const source = typeof list.source === 'string' ? list.source : Buffer.from(list.source).toString('utf8');
        const { entries, problems } = completeLicenses(JSON.parse(source) as LicenseEntry[], readTexts(textsDir(root)));
        if (problems.length) return this.error(['The licenses of the bundled packages are not complete:', ...problems].join('\n'));
        this.emitFile({ type: 'asset', fileName: LICENSES_FILE, source: renderLicenses(entries) });
      },
    },
  };
}

/**
 * What the Settings page prints at its foot (src/build_stamp.ts): the commit the build was made from, whether the checkout had
 * changes not yet committed, and when it was made (the owner, 2026-11-08 and 2026-11-11). The dev server's is from when it started.
 * THAT80SGAME_BUILD_STAMP, the same three fields as JSON, sets it instead: tools/publish/publish.ts gives its two builds one stamp so
 * that they can come out byte for byte the same. It goes in index.html, never in a script (stampPage below).
 */
function buildStamp(): { sha: string; changed: boolean; time: string } {
  const given = process.env.THAT80SGAME_BUILD_STAMP;
  if (given) {
    const s = JSON.parse(given) as Record<string, unknown>;
    if (typeof s.sha !== 'string' || !s.sha || typeof s.changed !== 'boolean' || typeof s.time !== 'string' || Number.isNaN(Date.parse(s.time)))
      throw new Error(`THAT80SGAME_BUILD_STAMP needs {"sha": text, "changed": true or false, "time": an ISO time}, not ${given}`);
    return { sha: s.sha, changed: s.changed, time: s.time };
  }
  const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: here, encoding: 'utf8' }).trim(); } catch { return ''; } };
  return { sha: git(['rev-parse', '--short', 'HEAD']) || 'unknown', changed: git(['status', '--porcelain', '--untracked-files=no']) !== '', time: new Date().toISOString() };
}

/**
 * The stamp in index.html, as data the page reads (src/build_stamp.ts), and not in the scripts. Written into a script, it changed
 * that script, and so its name and the names of the scripts that import it, with every build, code changed or not; a page left
 * open across a release then found a script it fetched late gone. In the page, a script keeps its name until its own code changes.
 */
function stampPage(stamp: { sha: string; changed: boolean; time: string }): Plugin {
  return {
    name: 'stamp-page',
    transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'application/json', id: 'build-stamp' }, children: JSON.stringify(stamp), injectTo: 'head' }],
  };
}

/**
 * version.json at the top of the built site, and from the dev server: the build's commit and time, the stamp the page itself
 * carries in index.html. A page left open across a release reads it when a file it fetches late is missing, to learn whether
 * a newer release took that file away (src/release_check.ts; the owner, 15 Nov: "Noticing a newer release would be better").
 */
function versionFile(stamp: { sha: string; time: string }): Plugin {
  const json = JSON.stringify({ sha: stamp.sha, time: stamp.time });
  return {
    name: 'version-file',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(json);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: json });
    },
  };
}

const stamp = buildStamp();

export default defineConfig({
  base: './',
  plugins: [content.plugin, contentCheckStaysOut(), restartOnConfigChange(), globsFollowNewFiles(), artFiles(), webpInBackground(), thirdPartyLicenses(), stampPage(stamp), versionFile(stamp)],
  // The check tools give each server they start a dependency cache of its own (tools/harness.ts startServer), so
  // servers running side by side never rebuild a cache another one's pages are using; `npm run dev` keeps the default.
  cacheDir: process.env.THAT80SGAME_VITE_CACHE || undefined,
  server: {
    // Linked worktrees share the installed dependencies. Fonts imported through their real path
    // must remain readable even before Vite has traversed the CSS import that names them.
    fs: { allow: [here, realpathSync(path.join(here, 'node_modules'))] },
    // A fixed port, and fail rather than silently moving to another one.
    port: 5173,
    strictPort: true,
    // No updates pushed to an open page (the owner, 2026-10-03): an edit never reloads a game in play, or a page a
    // browser check has open. Files are still watched, so refreshing the page picks up every edit, and a file added or
    // removed (above). An edit to this file or a tool it imports restarts the server (restartOnConfigChange).
    hmr: false,
    // Ignore only this checkout's scratch directories. An ancestor named .scratch (an isolated worktree) or tmp
    // must not hide the whole project's source files from the watcher.
    watch: { ignored: (file: string) => {
      const normalized = file.split(path.sep).join('/').replace(/\/+$/, '');
      return scratchDirs.some(dir => normalized === dir || normalized.startsWith(dir + '/'));
    } },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // No <link rel=modulepreload> for the chunks the main script imports: WebKit (every iPhone browser) kept one that dropped as
    // failed, and every Reload came back to the startup page without asking for it again, until the tab was closed; imported
    // without the hint, it is asked for again (tools/network_cut_checks.ts, and a real dropped connection through a proxy). Found
    // late, one round trip later: 0.3 s more to the title on the slow phone setting, which Pixi's browser pieces built into the
    // main script win back (src/main.ts). The owner, 15 Nov, picked "Pixi in, preloading off".
    modulePreload: false,
    // The main script holds the title globe's worker as well (59 kB, src/ui/title_globe_load.ts).
    chunkSizeWarningLimit: 2100,
    // Every picture ships as its own file. Vite's default wrote each one under 4 KB into the main script as text (32 of them, 110 kB,
    // which put the script over the warning above and compressed badly); over HTTP/2 small files cost little (card fable_release_gaps).
    assetsInlineLimit: 0,
    // The list thirdPartyLicenses turns into licenses.txt.
    license: { fileName: VITE_LICENSES },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The world tests (beijing_world, world_events) step a world thousands of times and ran past Vitest's 5 s default on a
    // loaded machine (docs/lessons_learned.md); one generous deadline for all, rather than each test raising its own.
    testTimeout: 60_000,
  },
});

