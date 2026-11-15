import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { masters, stale, orphans, kitStale, kitWebpDir, kitDir, currentCopyOf } from './tools/webp_record.ts';
import { imageFactsUnder, imageSize } from './tools/image_size.ts';
import { kitMaps, readKitArt } from './tools/kit_art.ts';
import { INCLUDE_DEV_MAPS, keepScenery, readBuildFiles, selectBuildContent, type BuildContent } from './tools/production_content.ts';
import { completeLicenses, LICENSES_FILE, readTexts, renderLicenses, textsDir, VITE_LICENSES, type LicenseEntry } from './tools/third_party_licenses.ts';

/** The module listing each art image's size in bytes and pixels (`artFiles` below). */
const ART_FILES = 'virtual:art-files';
const CONTENT_FILES = 'virtual:content-files';
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
 * With hmr off, refreshes need the content glob and generated art catalogs invalidated when their files change.
 * Otherwise a new content file or picture can remain missing until the dev server restarts.
 */
function globsFollowNewFiles(): Plugin {
  return {
    name: 'globs-follow-new-files',
    configureServer(server) {
      const root = server.config.root;
      const lists: Array<[string, string]> = [
        [path.join(root, 'content') + path.sep, path.join(root, 'src/content/bundle.ts')],
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

/** Content and both art catalogs share one selection for each build. */
function contentBundle() {
  let root = '', production = false, selected: BuildContent | undefined;
  const selection = () => selected ??= selectBuildContent(readBuildFiles(root), !production || process.env[INCLUDE_DEV_MAPS] === '1');
  const plugin: Plugin = {
    name: 'content-bundle',
    configResolved(config) { root = config.root; production = config.command === 'build'; selected = undefined; },
    buildStart() { selected = undefined; },
    resolveId: id => id === CONTENT_FILES ? '\0' + id : undefined,
    load(id) {
      if (id !== '\0' + CONTENT_FILES) return;
      const files = selection().files;
      for (const file of files.keys()) this.addWatchFile(path.join(root, file));
      return `export default ${JSON.stringify(Object.fromEntries(files))};`;
    },
    configureServer(server) {
      const stale = (file: string) => {
        if (!path.resolve(file).startsWith(path.join(root, 'content') + path.sep)) return;
        selected = undefined;
        const mod = server.moduleGraph.getModuleById('\0' + CONTENT_FILES);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      for (const event of ['add', 'unlink', 'change']) server.watcher.on(event, stale);
    },
  };
  return { plugin, selection };
}
const content = contentBundle();

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


/** The module holding the kit compositions the maps name (`kit_art`, tools/kit_art.ts) and the images they draw from. */
const KIT_ART = 'virtual:kit-art';
function kitArt(): Plugin {
  let root = '';
  let production = false;
  return {
    name: 'kit-art',
    configResolved(config) {
      root = config.root;
      production = config.command === 'build';
    },
    buildStart() {
      if (!production) return;
      // An unchecked tile must name the scan it needs before its fallback looks like a missing WebP.
      for (const [mapId, composition] of kitMaps(root)) {
        if (content.selection().maps.has(mapId)) readKitArt(root, mapId, composition, { requireScanned: true });
      }
      // Like the art, a build holds the WebP copies only, so each must be there and made from the master as it is now.
      // Unreachable compositions may be unfinished. Validate only imported images here; check_content still audits the full library.
      const bad = kitStale(content.selection().maps);
      if (bad.length) this.error([
        'Production kit art requires current WebP copies; the masters under art/tiled are never bundled.',
        ...bad.map(m => `Missing or stale WebP: ${m.slot}`),
        'Run node tools/art_webp.ts, then build again.',
      ].join('\n'));
    },
    resolveId: (id) => (id === KIT_ART ? '\0' + id : undefined),
    load(id) {
      if (id !== '\0' + KIT_ART) return;
      const arts: Record<string, unknown> = {};
      const images = new Map<string, { file: string | null; bytes: number; width: number; height: number }>();
      const copyOf = production ? null : currentCopyOf();
      for (const [mapId, composition] of kitMaps(root)) {
        if (!content.selection().maps.has(mapId)) continue;
        // A composition that cannot be read stops the build or the dev page with its reason, not a map that quietly draws without it.
        const read = readKitArt(root, mapId, composition, { requireScanned: production });
        arts[mapId] = read.art;
        for (const img of read.images) {
          // The build imports the WebP copy; the dev server too, only while it is current (else no file: the hot pink box, as above).
          let file: string | null = img.file, bytes = img.bytes;
          if (copyOf) {
            file = copyOf(img.file);
            if (file) bytes = statSync(file).size;
          }
          if (production) {
            file = img.file.startsWith(kitDir + path.sep) ? path.join(kitWebpDir, path.relative(kitDir, img.file).replace(/\.(png|jpg)$/, '.webp')) : img.file.replace(/\.(png|jpg)$/, '.webp');
            const size = imageSize(new Uint8Array(readFileSync(file)));
            if (!size || size.width !== img.width || size.height !== img.height) this.error(`The WebP copy of ${img.slot} is not the size of its master. Run node tools/art_webp.ts --all.`);
            bytes = statSync(file).size;
          }
          images.set(img.slot, { file, bytes, width: img.width, height: img.height });
        }
        this.addWatchFile(path.join(root, composition));
      }
      const list = [...images].map(([slot, v]) => ({ slot, ...v }));
      const imports = list.map((img, i) => img.file ? `import kit${i} from ${JSON.stringify(img.file + '?url')};` : '').filter(Boolean).join('\n');
      const entries = list.map((img, i) => `${JSON.stringify(img.slot)}: { url: ${img.file ? `kit${i}` : 'null'}, bytes: ${img.bytes}, width: ${img.width}, height: ${img.height} }`).join(',\n');
      return `${imports}\nexport const kitImages = {${entries}};\nexport default ${JSON.stringify(arts)};`;
    },
    configureServer(server) {
      // A composition, a tileset or a map edited or added: the module is read again at the next refresh.
      const stale = (file: string) => {
        const f = path.resolve(file);
        if (!f.startsWith(path.join(root, 'art/tiled') + path.sep) && !f.startsWith(path.join(root, 'content/maps') + path.sep)) return;
        const mod = server.moduleGraph.getModuleById('\0' + KIT_ART);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      for (const event of ['add', 'unlink', 'change']) server.watcher.on(event, stale);
    },
  };
}

/**
 * `npm run dev` keeps the WebP copies current in the background (the owner, 2026-10-28: the lag between a new PNG and its
 * WebP "happens in the background and I don't see them until later when I reload the page"). The server starting, or a
 * master, composition or map written, runs tools/art_webp.ts once the files have been quiet a few seconds; meanwhile a new or
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
      const art = path.join(root, 'src/art/images') + path.sep, kit = path.join(root, 'art/tiled') + path.sep;
      const copies = path.join(root, 'art/tiled/webp') + path.sep, maps = path.join(root, 'content/maps') + path.sep;
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
        if (f.startsWith(art)) return /\.(png|jpg)$/.test(f);
        if (f.startsWith(maps)) return f.endsWith('.tmj');
        return f.startsWith(kit) && !f.startsWith(copies) && /\.(png|jpg|tmj|tsx|json)$/.test(f);
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
 * that they can come out byte for byte the same.
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

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  plugins: [content.plugin, restartOnConfigChange(), globsFollowNewFiles(), artFiles(), kitArt(), webpInBackground(), thirdPartyLicenses()],
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
    chunkSizeWarningLimit: 2000,
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

