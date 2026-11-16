import { Application } from 'pixi.js';
// Pixi's browser pieces (input, accessibility, the DOM, filters), built into this script rather than fetched by Pixi on demand
// as the renderer starts (see app.init's skipExtensionImports): one file fewer that can fail to arrive at startup (the owner,
// 15 Nov: "it seems like adding the file makes sense").
import 'pixi.js/browser';
import { artFailed, artForMap, artProgress, artReady, artSources, loadArt, whenArtReady } from './art/images.ts';
import { contentFiles } from './content/bundle.ts';
import { loadContent } from './content/content.ts';
import { devStartMap, devStartsInPlay, installDev, showContentErrors } from './dev/dev.ts';
import { installFrameReadout } from './dev/frame_readout.ts';
import { blockContextMenu } from './engine/contextMenu.ts';
import { divideTicker, FrameDivider } from './engine/frame_divider.ts';
import { STALE_MS } from './engine/turn.ts';
import { Game } from './game/game.ts';
import { loadSettings } from './game/settings.ts';
import { loadGame } from './game/state.ts';
import { density, drawDensity } from './render/density.ts';
import { loadFonts } from './render/fonts.ts';
import { motion } from './render/motion.ts';
import { PAPER } from './render/palette.ts';
import { releaseWatch } from './release_check.ts';
import { closeNotice, hideLoader, loaderArtProgress, loaderBootProgress, loaderStill } from './ui/loader.ts';
import { titleGlobeFields } from './ui/title_globe_load.ts';
import { globeViewportMapWidth } from './ui/title_globe_sdf.ts';

async function boot() {
  // From the loading page on, a right click doesn't open the browser's menu.
  blockContextMenu(document);
  // A newer release on the site (src/release_check.ts): a piece of code that does not arrive asks. Until the game is made,
  // nothing is lost by reloading for it, so the page does at once (once).
  window.addEventListener('vite:preloadError', () => void releaseWatch.missing());
  releaseWatch.listen((sha) => { if (!releaseWatch.reloadedFor(sha)) releaseWatch.reload(sha); });
  // Battery saver as stored, until the game binds its own settings: the first frames and the globe's bake follow it too.
  const stored = loadSettings();
  density.bind(() => stored.batterySaver);
  // Bake in parallel with Pixi, fonts and title art, using the viewport and density already known.
  const globeWidth = () => globeViewportMapWidth(window.innerWidth, window.innerHeight, drawDensity());
  const stopGlobeProgress = titleGlobeFields.subscribe(() => {
    const p = titleGlobeFields.status;
    loaderBootProgress('globe', p.phase === 'ready' ? 1 : p.total ? p.completed / p.total : 0);
  });
  const globeReady = titleGlobeFields.request(globeWidth());
  loaderBootProgress('script', 1);
  const host = document.getElementById('game')!;
  const app = new Application();
  await app.init({
    antialias: true,
    autoDensity: true,
    resolution: drawDensity(),
    background: PAPER,
    // WebGL only: as a single preference Pixi only put it first and fell back to WebGPU or Canvas, where the game's WebGL
    // shaders leave a title with no world map; as a one-item list it throws, and startup says so (Fable review F2).
    preference: ['webgl'],
    // Imported above, so Pixi does not fetch them again.
    skipExtensionImports: true,
    width: host.clientWidth || window.innerWidth,
    height: host.clientHeight || window.innerHeight,
  });
  host.appendChild(app.canvas);
  // On a screen faster than 60 Hz, draw only one frame in two or so (src/engine/frame_divider.ts): the game's logic moves 60 times
  // a second, so the frames skipped would only repeat the picture.
  const frames = new FrameDivider();
  divideTicker(app.ticker, frames);
  installFrameReadout(frames);
  // A lost graphics context cannot always be recovered on phones. The game saves
  // often, so reloading from the save is the safe way back.
  app.canvas.addEventListener('webglcontextlost', () => {
    // Saved first, where the game is at rest, so the reload's Continue starts from here (Fable review, a one-liner).
    try { (window as unknown as { __game?: { game?: { autosave(): void } } }).__game?.game?.autosave(); } catch { /* the reload comes anyway */ }
    window.setTimeout(() => location.reload(), 1500);
  });
  await loadFonts();
  loaderBootProgress('fonts', 1);
  const { content, errors } = loadContent(contentFiles());
  if (errors.length) showContentErrors(errors);
  if (!content) throw new Error('The content has errors that stop the game from starting. See the list above.');
  const initialMap = devStartsInPlay() ? devStartMap(content) : loadGame(content)?.map ?? content.party.start.map;
  // Title first, then the initial chapter behind it. `?art=off` keeps the
  // code drawings, for comparing.
  await loadArt(new URLSearchParams(location.search).get('art') !== 'off', content, initialMap);
  loaderBootProgress('art', 1);
  const globeWaitAt = performance.now();
  await globeReady;
  // A window enlarged during boot may need the larger bucket before its first title.
  await titleGlobeFields.request(globeWidth());
  const globeWaitMs = performance.now() - globeWaitAt;
  stopGlobeProgress();
  // Direct play waits for its destination chapter, rather than fetching earlier chapters first. The
  // ball starting again from the share already in.
  if (devStartsInPlay()) {
    loaderArtProgress(artProgress(artForMap(initialMap)), true);
    await whenArtReady({ slots: artForMap(initialMap), onProgress: (p) => loaderArtProgress(p) });
  }

  // `?seed=N` plays the run that seed gives (the same every time); `?lockstep` leaves the stepping to a
  // test driver (tools/pilot.ts).
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed');
  const game = new Game(app, content, { seed: seed === null ? undefined : Number(seed) >>> 0, lockstep: params.has('lockstep') });
  const titleShowing = () => game.titleShowing;
  // A bake started on the title can finish after play begins. Its failure must
  // not put a startup page over the running game.
  titleGlobeFields.onError = error => { if (titleShowing()) showFailure(error); };
  const upgradeTitleGlobe = () => {
    if (titleShowing()) void titleGlobeFields.request(globeWidth()).catch(() => undefined);
  };
  // The game's own Reduce motion setting, now loaded, for when the loading page comes back.
  loaderStill(motion.reduced);
  game.relayout();
  let pending = false;
  let drawn = drawDensity();
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      drawn = drawDensity();
      app.renderer.resolution = drawn;
      // Keep the current sharp field visible until the larger worker result can replace it.
      upgradeTitleGlobe();
      game.relayout();
    });
  };
  // Density can change without resize or media-query events, and with Battery saver. Check it in the existing
  // render loop; only a changed value schedules layout or another worker request.
  let titleWasShowing = false;
  app.ticker.add(() => {
    const showing = titleShowing();
    // Resizes during play defer the larger bake until the title is shown again.
    if (showing && !titleWasShowing) upgradeTitleGlobe();
    titleWasShowing = showing;
    if (drawDensity() !== drawn) schedule();
  });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  // Turning a phone from one side straight to the other changes no size, so the turn itself is heard,
  // and the layout is made once more when the screen's angle has settled.
  const turned = () => {
    game.phoneTurned();
    schedule();
    window.setTimeout(() => game.turnUnsure && schedule(), STALE_MS + 100);
  };
  window.addEventListener('orientationchange', turned);
  screen.orientation?.addEventListener('change', turned);

  const devStarted = installDev(game);
  if (!devStarted) game.showTitle();
  hideLoader();
  // Tools can interact once the initial chapter is ready; full-prefetch completion is separate. `art` says, in a build too,
  // which pictures are pink, the file each came from and each map's (tools/network_cut_checks.ts).
  const art = { failed: artFailed, sources: artSources, forMap: artForMap };
  const handle = { shown: true, get ready() { return titleGlobeFields.current !== null && (!titleShowing() || titleGlobeFields.status.phase !== 'failed') && artReady(artForMap(game.world?.map.id ?? initialMap)); }, get globe() { return { ...titleGlobeFields.status, bootWaitAt: globeWaitAt, bootWaitMs: globeWaitMs }; }, get allArtReady() { return artReady(); }, art, game };
  (window as unknown as { __game: unknown }).__game = handle;
  // Every line of the latest fight, for pasting (the log page keeps only the last few): type fightLog() in the browser's
  // console; copy(fightLog()) puts it on the clipboard. Always there, with or without the dev tools.
  (window as unknown as { fightLog: () => string }).fightLog = () => game.fightTranscript.join('\n');
}

/**
 * Startup stopped: a plain first line for the player and a Reload button (index.html showStartupFailure), with the error itself
 * under them for anyone reporting it. It used to be a developer's red text on white (Fable review F3, 2026-11-09).
 */
function showFailure(err: unknown): void {
  if (document.getElementById('startup-failure')) return;
  closeNotice();
  hideLoader();
  console.error(err);
  const raw = err instanceof Error
    ? err.stack?.includes(err.message) ? err.stack : [String(err), err.stack].filter(Boolean).join('\n')
    : String(err);
  // Pixi throws this when WebGL is missing or turned off: the game's shaders need it (see app.init's preference).
  const missing = /font did not load|Failed to fetch|NetworkError|Importing a module script failed|dynamically imported module/i.test(raw);
  const plain = /No available renderer/.test(raw) ? 'This game needs WebGL, which this browser does not have or has turned off.'
    : missing ? 'Part of the game did not arrive. Check the connection, then reload.'
    : 'Something stopped the game from starting.';
  (window as unknown as { showStartupFailure(plain: string, detail: string): void }).showStartupFailure(plain, raw);
  // A part that did not arrive may be one a newer release took away: then the page reloads for it (the listener above).
  if (missing) void releaseWatch.missing();
}

boot().catch((err) => {
  titleGlobeFields.dispose();
  showFailure(err);
});
