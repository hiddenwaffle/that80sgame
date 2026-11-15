import { hundredList, noProgress, saveProgress, type Progress } from '../game/achievements.ts';
import { Container, Graphics, Text } from 'pixi.js';
import { freeSpot, groundFrom } from '../battle/formation.ts';
import type { Content } from '../content/content.ts';
import { artForMap, warmArt, whenArtReady } from '../art/images.ts';
import { ISO_SCENE_ART } from '../art/iso_scene_art.ts';
import { buildScene } from '../world/scene_pictures.ts';
import type { ContentError } from '../content/screenplay.ts';
import { TERRAINS, TILE } from '../content/terrain.ts';
import type { Game } from '../game/game.ts';
import { gainXp, newGame, requirementsMet, saveGame, xpToNext } from '../game/state.ts';
import type { Screen } from '../ui/screens.ts';
import { MenuList, type MenuItem } from '../ui/widgets.ts';
import { readScreen } from '../engine/turn.ts';
import { clearIfInked } from '../render/clear_if_inked.ts';
/**
 * Developer mode. On in `npm run dev`, or anywhere with ?dev in the address.
 *
 * - `dev.help()` in the browser console lists the commands.
 * - Backquote (`) toggles the overlay: collision, triggers, exits, spawns, patrols and their territories.
 * - F2, or three taps in the panel's top-left corner, opens the jump menu.
 * - Address options start anywhere: ?dev&map=field&spawn=from_border&level=3&flags=tank_defeated
 *   Others: battle=tank, scene=boss_approach, pellet, god, peace, noclip, fast, title.
 *   This experiment branch always uses the turn queue.
 */
function devEnabled(params: URLSearchParams): boolean {
  return import.meta.env.DEV || params.has('dev') || safeGet('that80sgame.dev') === '1';
}

/** Whether the address starts dev mode in play (a map, a fight, or a scene) rather than at the title. */
export function devStartsInPlay(): boolean {
  const params = new URLSearchParams(location.search);
  return devEnabled(params) && !params.has('title') && Boolean(params.get('map') || params.get('battle') || params.get('scene'));
}

export function sceneHome(c: Content, name: string, seen = new Set<string>()): string | null {
    if (seen.has(name)) return null;
    seen.add(name);
    for (const m of c.maps.values()) {
      if (m.props.on_enter === name || m.objects.some((o) => o.props.scene === name)) return m.id;
    }
    for (const [enc, e] of Object.entries(c.encounters)) {
      if (e.cry === name || e.after === name) {
        const m = [...c.maps.values()].find(m=>m.objects.some(o=>o.type==='enemy' && o.props.encounter===enc));
        if (m) return m.id;
      }
    }
    for (const [id, s] of c.scenes) {
      if (s.steps.some((st) => st.kind === 'command' && st.name === 'run' && st.args[0] === name)) {
        const home = sceneHome(c, id, seen);
        if (home) return home;
      }
    }
    return null;
}


/** Art for a direct map, battle or scene URL must arrive before installDev constructs its world. */
export function devStartMap(c: Content): string {
  const p=new URLSearchParams(location.search);
  if (p.get('map')) return p.get('map')!;
  const enc=p.get('battle');
  if (enc) return [...c.maps.values()].find(m=>m.objects.some(o=>o.props.encounter===enc))?.id??c.party.start.map;
  return p.get('scene') ? sceneHome(c,p.get('scene')!)??c.party.start.map : c.party.start.map;
}

/** Achievements as a player might have them: `some` is a first win and most of the way through a second run; `hundred` is
 * everything but the hidden one, and `all` everything. */
function sampleProgress(c: Content, how: string): Progress {
  const list = hundredList(c);
  const p = noProgress();
  if (how === 'tank') p.tankAtOneTrained = true;
  if (how === 'some' || how === 'all' || how === 'hundred') {
    p.finished = true;
    const ghosts = list.ghostGroups.flat();
    const whole = how !== 'some';
    p.pellets = whole ? list.pellets : list.pellets.slice(0, 4);
    p.ghosts = whole ? ghosts : ghosts.slice(0, 9);
    p.patrols = whole ? list.patrols : list.patrols.slice(0, 11);
    p.tank = true;
    p.warsawMet = true;
    p.warsaw = true;
  }
  if (how === 'all' || how === 'hundred') p.tankAtOneTrained = true;
  if (how === 'all') p.unnuked = true;
  // The game beaten with the tank left standing: the level 1 win is still a secret.
  if (how === 'notank') {
    p.finished = p.warsawMet = p.warsaw = true;
    p.pellets = list.pellets.slice(0, 5);
    p.ghosts = list.ghostGroups.flat().slice(0, 12);
    p.patrols = list.patrols.slice(0, 4);
  }
  return p;
}

export function installDev(game: Game): boolean {
  const params = new URLSearchParams(location.search);
  if (!devEnabled(params)) return false;
  game.dev.enabled = true;
  // `?ach=none|some|notank|tank|hundred|all`: achievements as a player might have them, for looking at the page.
  const ach = params.get('ach');
  if (ach) saveProgress(sampleProgress(game.content, ach));

  const overlay = new DevOverlay(game);
  game.devLayer.addChild(overlay.container);
  game.onRender.push(() => overlay.render());

  const log = (...a: unknown[]) => console.log('%c[dev]', 'color:#b3261e;font-weight:bold', ...a);
  const findEncounterMap = (enc: string) => [...game.content.maps.values()].find((m) => m.objects.some((o) => o.type === 'enemy' && o.props.encounter === enc));
  const firstSpawn = (map: string) => game.content.maps.get(map)?.objects.find((o) => o.type === 'spawn')?.name ?? '';


  /**
   * Gets the game ready for a jump: no fight (refused), no scene, no page or menu
   * (including the title page), and marked as being played.
   */
  const prepareJump = async (): Promise<boolean> => {
    if (game.fightInProgress()) {
      log('A fight is in progress. End it first with dev.win() or dev.lose().');
      game.toast('Finish the fight first');
      return false;
    }
    await game.settle();
    game.clearScreens();
    game.beginPlay();
    return true;
  };

  const api = {
    help() {
      log(`Commands:
  dev.maps()                 maps and their spawn points
  dev.warp(map, spawn?)      go to a map (first spawn if none given)
  dev.scenes()               list scene names
  dev.scene(name)            play a scene now
  dev.skip()                 stop the scene that is playing
  dev.battle(encounter)      start a fight (goes to its map first)
  dev.win() / dev.lose()     end the current fight
  dev.flag(name, on=true)    set a story flag; dev.flags() lists them
  dev.give(item, n=1)        add items; dev.dots(n) adds Dots
  dev.level(n)               raise everyone to level n
  dev.pellet()               take the speed pellet's bonus
  dev.heal()                 full HP and MP
  dev.god(), dev.noclip(), dev.peace(), dev.fast()   toggles
  dev.speed(x)               game speed, 1 is normal
  dev.pause(), dev.step()    freeze, and advance one step
  dev.overlay()              toggle the debug overlay
  dev.state(), dev.save(), dev.newGame(), dev.where()
  fightLog()                 every line of the latest fight (always there, without ?dev too)`);
    },
    maps() {
      const out: Record<string, string[]> = {};
      for (const m of game.content.maps.values()) out[m.id] = m.objects.filter((o) => o.type === 'spawn').map((o) => o.name);
      return out;
    },
    async warp(map: string, spawn?: string) {
      const m = game.content.maps.get(map);
      if (!m) return log(`No map "${map}". Maps: ${[...game.content.maps.keys()].join(', ')}`);
      const sp = spawn ?? firstSpawn(map);
      if (!(await prepareJump())) return;
      // Returns once the party is on the map. The map's chapter page and arrival scene,
      // if not yet seen, go on playing; waiting for them would wait on the player.
      await game.prepareArt(artForMap(map));
      void game.changeMap(map, sp, { instant: true });
      return `${map}:${sp}`;
    },
    scenes: () => [...game.content.scenes.keys()],
    async scene(name: string) {
      if (!game.content.scenes.has(name)) return log(`No scene "${name}".`);
      if (!(await prepareJump())) return;
      // From the title there is no map yet: go to the one the scene belongs on, quietly.
      if (!game.world) {
        const home = sceneHome(game.content, name) ?? game.content.party.start.map;
        markArrived(home);
        await game.prepareArt(artForMap(home));
        game.enterMap(home, firstSpawn(home));
      }
      void game.runScene(name);
      return name;
    },
    skip: () => game.story.skip(),
    async battle(enc: string) {
      if (!(await prepareJump())) return;
      const map = findEncounterMap(enc);
      if (!map) return log(`No map has enemies for "${enc}".`);
      if (game.state.map !== map.id) {
        const enemy = map.objects.find((o) => o.type === 'enemy' && o.props.encounter === enc)!;
        const sp = map.objects.filter((o) => o.type === 'spawn').sort((a, b) => Math.hypot(a.x - enemy.x, a.y - enemy.y) - Math.hypot(b.x - enemy.x, b.y - enemy.y))[0];
        await game.changeMap(map.id, sp?.name ?? '', { instant: true });
      }
      const w = game.world!;
      const enemies = w.enemies.filter((e) => String(e.obj?.props.encounter) === enc);
      if (!enemies.length) return log(`"${enc}" has already been beaten on this save.`);
      for (const e of enemies) w.reveal(e.id);
      const first = enemies[0]!;
      // Four tiles off, from whichever side has the straightest open walk to the enemy (left first),
      // as a player would come: never across a wall or round a corner of rock.
      const ground = groundFrom(w, first.x, first.y);
      const sides: Array<[number, number, 'left' | 'right' | 'up' | 'down']> = [[-4, 0, 'right'], [0, 4, 'up'], [4, 0, 'left'], [0, -4, 'down']];
      const open = sides
        .map(([dx, dy, face]) => ({ x: first.x + dx * TILE, y: first.y + dy * TILE, face }))
        .filter((s) => !w.collision.blocked(s.x, s.y) && ground.detour(s.x, s.y) !== undefined)
        .sort((a, b) => ground.detour(a.x, a.y)! - ground.detour(b.x, b.y)!);
      const pick = open[0];
      const [px, py] = pick ? [pick.x, pick.y] : freeSpot(w, first.x - 4 * TILE, first.y, ground);
      w.placeParty(px, py, pick?.face ?? (px <= first.x ? 'right' : 'left'));
      void game.startBattle(enc, enemies).then((o) => o === 'won' && w === game.world && w.defeatEncounter(enc));
      return enc;
    },
    win: () => game.battle?.forceEnd('won'),
    lose: () => game.battle?.forceEnd('lost'),
    flag(name: string, on = true) {
      game.state.flags[name] = on;
      return game.state.flags;
    },
    flags: () => game.state.flags,
    give(item: string, n = 1) {
      game.state.items[item] = (game.state.items[item] ?? 0) + n;
      return game.state.items;
    },
    dots(n: number) {
      game.state.dots = Math.max(0, game.state.dots + n);
      return game.state.dots;
    },
    level(n: number) {
      for (const id of game.state.order) {
        const m = game.state.members[id]!;
        while (m.level < n) gainXp(game.content, m, xpToNext(game.content, m.level) - m.xp);
        m.hp = m.maxHp;
        m.mp = m.maxMp;
      }
      return game.state.members;
    },
    pellet() {
      game.world?.applyPickup('speed');
      game.state.taken.push('field:speed_pellet');
      // The party walks faster once it has the pellet.
      const w = game.world;
      if (w) for (const a of w.party) a.speed = w.partySpeed();
      return game.state.order.map((id) => `${id} speed ${game.state.members[id]!.speed}`);
    },
    heal: () => void game.rest(),
    god: (on?: boolean) => (game.dev.god = on ?? !game.dev.god),
    noclip: (on?: boolean) => (game.dev.noclip = on ?? !game.dev.noclip),
    peace: (on?: boolean) => (game.dev.peace = on ?? !game.dev.peace),
    fast: (on?: boolean) => (game.dev.fastText = on ?? !game.dev.fastText),
    speed: (x: number) => (game.loop.timeScale = x),
    pause: () => (game.loop.paused = !game.loop.paused),
    step: () => game.loop.stepOnce(),
    overlay: (on?: boolean) => (game.dev.overlay = on ?? !game.dev.overlay),
    state: () => game.state,
    save: () => saveGame(game.state),
    newGame() {
      game.state = newGame(game.content);
      return game.state;
    },
    /** Walks the leader to a named map object and waits until arrival or a map change. */
    async goto(name: string, timeout = 30) {
      const w = game.world;
      const o = w?.object(name);
      if (!w || !o) return `No object "${name}" on this map.`;
      const tx = o.x + o.w / 2;
      const ty = o.y + (o.h ? o.h / 2 : 0);
      if (!w.walkLeaderTo(tx, ty)) return `No path to "${name}".`;
      const start = game.time;
      while (game.time - start < timeout) {
        await game.delay(0.1);
        if (game.world !== w) return `arrived in ${game.state.map}`;
        if (!w.walking && Math.hypot(w.leader.x - tx, w.leader.y - ty) < 24) return `at ${name}`;
        // A fight on the way ends the walk; after a scene on the way, it carries on.
        if (game.battle) return `a fight started on the way to ${name}`;
        if (!w.walking && !game.storyBusy()) w.walkLeaderTo(tx, ty);
      }
      return `timed out walking to ${name}`;
    },
    /** Walks up to someone and talks to them. */
    async talk(name: string) {
      const r = await api.goto(name);
      const npc = game.world?.actor(name);
      if (npc) game.world!.talkTo(npc);
      return r;
    },
    /** Waits until no scene, screen, fight, or map change is in progress. */
    async idle(timeout = 60) {
      const start = game.time;
      while (game.time - start < timeout) {
        await game.delay(0.2);
        if (!game.storyBusy() && !game.screensOpen() && !game.battle && !game.dialogue.open) return true;
      }
      return false;
    },
    /** Waits until a fight is under way. */
    async waitBattle(timeout = 30) {
      const start = game.time;
      while (game.time - start < timeout) {
        await game.delay(0.1);
        if (game.battle && game.battle.phase === 'active') return game.battle.encounter;
      }
      return null;
    },
    /** Presses on through dialogue, front pages, and victory boxes by itself. */
    autoplay: (on?: boolean) => (autoplay = on ?? !autoplay),
    where() {
      const w = game.world;
      if (!w) return null;
      return { map: w.map.id, x: Math.round(w.leader.x), y: Math.round(w.leader.y), tile: [Math.floor(w.leader.x / TILE), Math.floor((w.leader.y - 1) / TILE)] };
    },
    /** Page pixels for a panel point, for the checks' taps. */
    page: (x: number, y: number) => game.panelToPage(x, y),
    /** Where a display object was drawn, as a box on the upright panel, with the panel's size. */
    box: (o: Container) => {
      const b = o.getBounds();
      const pts = [game.panel.toLocal({ x: b.x, y: b.y }), game.panel.toLocal({ x: b.x + b.width, y: b.y + b.height })];
      const x = Math.min(pts[0]!.x, pts[1]!.x);
      const y = Math.min(pts[0]!.y, pts[1]!.y);
      return { x, y, w: Math.abs(pts[1]!.x - pts[0]!.x), h: Math.abs(pts[1]!.y - pts[0]!.y), pw: game.layout.panel.w, ph: game.layout.panel.h };
    },
    /** Shows a newspaper picture's scene alone over the game, as large as fits, without the newsprint dots; no name takes it away. */
    async photo(name?: string) {
      game.app.stage.getChildByLabel('dev_photo')?.destroy({ children: true });
      if (!name) return 'cleared';
      const need = ISO_SCENE_ART[name];
      if (need) {
        const map = { arcade: 'town', border: 'border', field: 'field', berlin: 'berlin', rescue: 'berlin', ending: 'field' }[need.group] ?? 'town';
        warmArt(map);
        await whenArtReady({ slots: artForMap(map) });
      }
      const s = buildScene(name, 1536, 1024);
      if (!s) return `no scene ${name}`;
      const box = new Container();
      box.label = 'dev_photo';
      const k = Math.min(game.app.screen.width / 1536, game.app.screen.height / 1024);
      const mask = new Graphics().rect(0, 0, 1536, 1024).fill(0xffffff);
      box.addChild(new Graphics().rect(0, 0, 1536, 1024).fill(0x000000), s.view, mask);
      s.view.mask = mask;
      box.scale.set(k);
      box.position.set((game.app.screen.width - 1536 * k) / 2, (game.app.screen.height - 1024 * k) / 2);
      game.app.stage.addChild(box);
      return 'shown';
    },
    turn: () => game.turn,
    game,
  };
  (window as unknown as { dev: typeof api }).dev = api;
  // `photo=<picture>`: once a map is up, its scene alone over it, full size and without the dots (dev.photo).
  const photo = new URLSearchParams(location.search).get('photo');
  if (photo) void (async () => { while (!game.world) await new Promise((r) => setTimeout(r, 100)); await api.photo(photo); })();

  let autoplay = false;
  let autoTimer = 0;
  game.onUpdate.push((dt) => {
    if (!autoplay) return;
    autoTimer -= dt;
    if (autoTimer > 0) return;
    autoTimer = 0.15;
    if (game.dialogue.open) {
      game.dialogue.advance();
      return;
    }
    const top = (game as unknown as { screens: Screen[] }).screens.at(-1);
    if (top && 'hasMenu' in top && !(top as unknown as { hasMenu: boolean }).hasMenu) (top as unknown as { finish: () => void }).finish();
    else if (game.battle && game.battle.phase === 'won') game.input.press('confirm');
  });

  /** Marks a map's chapter page and arrival scene as already seen, so a jump there does not play them. A page the story has not reached yet stays unseen, to show when it does. */
  function markArrived(map: string) {
    game.state.flags[`entered:${map}`] = true;
    for (const ch of game.content.frame.chapters) {
      if (ch.map === map && !game.state.chapters.includes(ch.id) && requirementsMet(game.state, ch.requires)) game.state.chapters.push(ch.id);
    }
  }

  // Keyboard: backquote toggles the overlay, F2 opens the jump menu.
  game.onUpdate.push(() => {
    if (game.input.pressed('dev') && !game.screensOpen()) game.dev.overlay = !game.dev.overlay;
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F2') {
      e.preventDefault();
      openJumpMenu(game);
    }
  });
  // Three quick taps in the panel's top-left corner open the jump menu on phones.
  let taps: number[] = [];
  window.addEventListener('pointerdown', (e) => {
    const [x, y] = game.pageToPanel(e.clientX, e.clientY);
    if (x >= 0 && y >= 0 && x < 48 && y < 48) {
      const now = performance.now();
      taps = [...taps.filter((t) => now - t < 700), now];
      if (taps.length >= 3) {
        taps = [];
        openJumpMenu(game);
      }
    }
  });

  // Address options.
  if (params.has('god')) game.dev.god = true;
  if (params.has('peace')) game.dev.peace = true;
  if (params.has('noclip')) game.dev.noclip = true;
  if (params.has('fast')) game.dev.fastText = true;
  if (params.has('overlay')) game.dev.overlay = true;
  const map = params.get('map');
  const battle = params.get('battle');
  const scene = params.get('scene');
  // `?credits`: straight to the credits, which is where beating the game's notification shows.
  if (params.has('credits')) {
    game.beginPlay();
    void game.fin();
    return true;
  }
  if (!devStartsInPlay()) {
    log('Developer mode is on. Type dev.help() for commands.');
    return false;
  }
  game.beginPlay();
  for (const f of (params.get('flags') ?? '').split(',').filter(Boolean)) game.state.flags[f] = true;
  const level = Number(params.get('level') ?? 0);
  if (level > 1) api.level(level);
  if (map) {
    const spawn = params.get('spawn') ?? firstSpawn(map);
    // With `arrive`, the map's chapter page and arrival scene play as on a normal entry.
    if (params.has('arrive')) void game.changeMap(map, spawn, { instant: true });
    else {
      markArrived(map);
      game.enterMap(map, spawn);
    }
  }
  // Fights already won on this visit, as if the party had cleared them: `cleared=maze_1,maze_5`.
  for (const enc of (params.get('cleared') ?? '').split(',').filter(Boolean)) game.world?.defeatEncounter(enc);
  if (params.has('pellet')) api.pellet();
  if (battle) void api.battle(battle);
  else if (scene) void api.scene(scene);
  log(`Started at ${map ?? '(current map)'}. Type dev.help() for commands.`);
  return true;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The jump menu: warp to any spawn, play any scene, start any fight, flip toggles. */
function openJumpMenu(game: Game): void {
  if (game.topScreen() instanceof JumpMenu) return;
  const dev = (window as unknown as { dev: Record<string, (...a: unknown[]) => unknown> }).dev;
  const screen = new JumpMenu(game, dev);
  game.pushScreen(screen);
}

class JumpMenu implements Screen {
  readonly container = new Container();
  readonly opaque = false;
  readonly blocking = true;
  private menu!: MenuList;
  private readonly game: Game;
  private readonly dev: Record<string, (...a: unknown[]) => unknown>;
  private page: 'main' | 'warp' | 'scene' | 'battle' = 'main';

  constructor(game: Game, dev: Record<string, (...a: unknown[]) => unknown>) {
    this.game = game;
    this.dev = dev;
    this.layout();
  }

  private close(): void {
    this.game.popScreen(this);
  }

  private items(): MenuItem[] {
    const g = this.game;
    const d = this.dev;
    const back = { label: '< Back', onChoose: () => this.go('main') };
    switch (this.page) {
      case 'warp': {
        const out: MenuItem[] = [];
        for (const m of g.content.maps.values()) {
          for (const o of m.objects.filter((x) => x.type === 'spawn')) out.push({ label: `${m.id} : ${o.name}`, onChoose: () => { this.close(); void d.warp!(m.id, o.name); } });
        }
        return [back, ...out];
      }
      case 'scene':
        return [back, ...[...g.content.scenes.keys()].map((s) => ({ label: s, onChoose: () => { this.close(); void d.scene!(s); } }))];
      case 'battle':
        return [back, ...Object.keys(g.content.encounters).map((e) => ({ label: e, onChoose: () => { this.close(); void d.battle!(e); } }))];
      default:
        return [
          { label: 'Warp', onChoose: () => this.go('warp') },
          { label: 'Play a scene', onChoose: () => this.go('scene') },
          { label: 'Start a fight', onChoose: () => this.go('battle') },
          { label: 'Overlay', detail: g.dev.overlay ? 'on' : 'off', onChoose: () => { d.overlay!(); this.layout(); } },
          { label: 'God mode', detail: g.dev.god ? 'on' : 'off', onChoose: () => { d.god!(); this.layout(); } },
          { label: 'Walk through walls', detail: g.dev.noclip ? 'on' : 'off', onChoose: () => { d.noclip!(); this.layout(); } },
          { label: 'No fights', detail: g.dev.peace ? 'on' : 'off', onChoose: () => { d.peace!(); this.layout(); } },
          { label: 'Fast text', detail: g.dev.fastText ? 'on' : 'off', onChoose: () => { d.fast!(); this.layout(); } },
          { label: 'Take speed pellet', onChoose: () => { d.pellet!(); this.close(); } },
          { label: 'Level up', onChoose: () => { d.level!((g.state.members[g.state.order[0]!]?.level ?? 1) + 1); this.close(); } },
          { label: 'Heal', onChoose: () => { d.heal!(); this.close(); } },
          { label: 'Close', onChoose: () => this.close() },
        ];
    }
  }

  private go(page: JumpMenu['page']): void {
    this.page = page;
    this.menu.index = 0;
    this.layout();
  }

  layout(): void {
    const g = this.game;
    const p = g.layout.panel;
    const u = Math.max(12, g.layout.unit * 0.8);
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    const shade = new Graphics().rect(0, 0, p.w, p.h).fill({ color: 0x000000, alpha: 0.45 });
    shade.eventMode = 'static';
    this.container.addChild(shade);
    const idx = this.menu?.index ?? 0;
    this.menu = new MenuList(this.items(), { title: `Developer · ${this.page}` });
    this.menu.index = idx;
    this.menu.onCancel = () => (this.page === 'main' ? this.close() : this.go('main'));
    this.menu.build(u, u * 16, { w: p.w - u, h: p.h - u * 2 });
    this.menu.container.position.set((p.w - this.menu.width) / 2, (p.h - this.menu.height) / 2);
    this.container.addChild(this.menu.container);
  }

  update(): void {
    this.menu.update(this.game.input);
    if (this.game.input.pressed('dev')) this.close();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Collision, triggers, exits, spawns, patrols, and live numbers. */
class DevOverlay {
  readonly container = new Container();
  private readonly info: Text;
  private readonly game: Game;
  private frames = 0;
  private fpsTime = performance.now();
  private fps = 0;

  constructor(game: Game) {
    this.game = game;
    this.info = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 11, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, lineHeight: 13 } });
    this.info.position.set(6, 6);
    this.container.addChild(this.info);
  }

  render(): void {
    const g = this.game;
    const w = g.world;
    this.frames++;
    const now = performance.now();
    if (now - this.fpsTime > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
    this.container.visible = g.dev.overlay;
    if (w) clearIfInked(w.debug);
    if (!g.dev.overlay) return;
    const s = readScreen();
    const turnLine = `turn ${g.turn}  angle ${screen.orientation?.angle ?? '-'}/${(window as unknown as { orientation?: number }).orientation ?? '-'}  phone ${s.phone ? 'yes' : 'no'}  ${screen.width}x${screen.height}`;
    if (!w) {
      this.info.text = turnLine;
      return;
    }
    const d = w.debug;
    const m = w.map;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (TERRAINS[m.terrain[y * m.width + x]!]!.solid) d.rect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    d.fill({ color: 0xff0000, alpha: 0.18 });
    for (const b of w.collision.boxes) d.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    d.fill({ color: 0xff00ff, alpha: 0.4 });
    for (const o of m.objects) {
      if (o.type === 'trigger') d.rect(o.x, o.y, o.w, o.h).stroke({ width: 1.5, color: 0xffd23f });
      if (o.type === 'exit') d.rect(o.x, o.y, o.w, o.h).stroke({ width: 2, color: 0x2f7fff });
      if (o.type === 'spawn' || o.type === 'point') d.circle(o.x, o.y, 3).fill(o.type === 'spawn' ? 0x00c853 : 0x00b8d4);
    }
    // Each encounter's unconditional alley notice boundary, and faintly its unchanged pursuit reach.
    const drawn = new Set<unknown>();
    for (const [e, patrol] of w.patrols) {
      const name = e.obj?.props.encounter;
      if (drawn.has(name)) continue;
      drawn.add(name);
      for (const [tx, ty] of patrol.reachTiles()) d.rect(tx * TILE, ty * TILE, TILE, TILE);
      d.fill({ color: 0xff3b1f, alpha: 0.12 });
      for (const b of patrol.noticeTerritory) d.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).stroke({ width: 1.5, color: 0xff3b1f });
    }
    for (const e of w.enemies) {
      const pat = e.obj?.props.patrol;
      if (typeof pat === 'string') {
        const [px, py] = pat.split(',').map(Number) as [number, number];
        d.moveTo(e.homeX, e.homeY).lineTo(e.homeX + px * TILE, e.homeY + py * TILE).stroke({ width: 1, color: 0xff3b1f });
      }
    }
    const l = w.leader;
    d.rect(l.x - 8, l.y - 8, 16, 8).stroke({ width: 1, color: 0x00ff00 });
    const b = g.battle;
    const lines = [
      `${this.fps} fps  map ${m.id}  tile ${Math.floor(l.x / TILE)},${Math.floor((l.y - 1) / TILE)}  (${Math.round(l.x)}, ${Math.round(l.y)})`,
      turnLine,
      `dots ${g.state.dots}  flags ${Object.keys(g.state.flags).filter((k) => g.state.flags[k] && !k.includes(':')).join(' ') || '-'}`,
      `${g.dev.god ? 'GOD ' : ''}${g.dev.noclip ? 'NOCLIP ' : ''}${g.dev.peace ? 'PEACE ' : ''}${g.dev.fastText ? 'FAST ' : ''}scene ${g.story.current ?? '-'}`,
    ];
    if (b) {
      lines.push(`battle ${b.encounter}  clock ${b.clock.toFixed(1)}s ${b.clockRunning ? 'running' : 'held'}`);
      for (const f of b.fighters) lines.push(`  ${f.name.padEnd(14)} hp ${String(f.hp).padStart(4)}  ${f.side === 'party' ? `bar ${f.bar.toFixed(0)}` : f.countdown !== null ? `blast in ${f.countdown.toFixed(1)}` : `next ${f.timer.toFixed(1)}`}`);
    }
    this.info.text = lines.join('\n');
  }
}

/** Shows content mistakes over the game in development, as the page loads; fixed and saved, a refresh clears them. */
export function showContentErrors(errors: ContentError[]): void {
  let el = document.getElementById('content-errors');
  if (!errors.length) {
    el?.remove();
    return;
  }
  for (const e of errors) console.error(`${e.file}${e.line ? `:${e.line}` : ''}  ${e.message}`);
  if (!el) {
    el = document.createElement('pre');
    el.id = 'content-errors';
    el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:40vh;overflow:auto;margin:0;padding:10px;background:#fff4c2;color:#1b1a1f;border:2px solid #1b1a1f;font:12px/1.4 monospace;z-index:10;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = `Content problems (fix, save, and refresh the page):\n` + errors.map((e) => `${e.file}${e.line ? `:${e.line}` : ''}  ${e.message}`).join('\n');
}
