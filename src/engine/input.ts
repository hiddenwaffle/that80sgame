/**
 * Keyboard and gamepad input as game actions. Touch and mouse go through the
 * interface directly (buttons, tapping the map), but they also mark touch as
 * the last device used, so the game can show its touch buttons.
 */

export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'menu' | 'dev';

/** The actions a player can put on other keys. The developer key stays where it is. */
export const REMAPPABLE = ['up', 'down', 'left', 'right', 'confirm', 'cancel', 'menu'] as const;
export type RemappableAction = (typeof REMAPPABLE)[number];
export type KeyBindings = Record<RemappableAction, string[]>;

const KEYS: Record<string, Action> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyZ: 'confirm',
  Enter: 'confirm',
  Space: 'confirm',
  NumpadEnter: 'confirm',
  KeyX: 'cancel',
  Escape: 'cancel',
  Backspace: 'cancel',
  KeyC: 'menu',
  Tab: 'menu',
  KeyM: 'menu',
  Backquote: 'dev',
};

/** The keys each action starts on, as keyboard codes. */
export function defaultBindings(): KeyBindings {
  const b: KeyBindings = { up: [], down: [], left: [], right: [], confirm: [], cancel: [], menu: [] };
  for (const [code, action] of Object.entries(KEYS)) if (action !== 'dev') b[action].push(code);
  return b;
}

/**
 * A key's name as a player would say it. Letters and digits name themselves; other keys
 * are looked up in the `keys` group of messages.yaml by their keyboard code, and a code
 * with no entry is shown as it is.
 */
export function keyName(code: string, named: (code: string) => string | undefined = () => undefined): string {
  const letter = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code);
  if (letter) return letter[1]!;
  return named(code) ?? code;
}

/** Codes a player cannot choose: Escape keeps a binding as it is, and the developer key is fixed. */
const RESERVED = new Set(['Escape', ...Object.entries(KEYS).filter(([, a]) => a === 'dev').map(([c]) => c)]);

export type Rebind = { ok: true; bindings: KeyBindings } | { ok: false; reason: 'reserved' } | { ok: false; reason: 'last_key'; action: RemappableAction };

/**
 * Puts `code` first on `action`. The key leaves any other action; the action keeps its
 * other keys. A change that would leave some action with no key at all is refused, so a
 * player can never lock themselves out of a menu.
 */
export function rebind(b: KeyBindings, action: RemappableAction, code: string): Rebind {
  if (RESERVED.has(code)) return { ok: false, reason: 'reserved' };
  const next = structuredClone(b);
  for (const a of REMAPPABLE) if (a !== action) next[a] = next[a].filter((k) => k !== code);
  next[action] = [code, ...next[action].filter((k) => k !== code)];
  for (const a of REMAPPABLE) if (!next[a].length) return { ok: false, reason: 'last_key', action: a };
  return { ok: true, bindings: next };
}

export type Device = 'keyboard' | 'gamepad' | 'touch' | 'mouse';

/**
 * Keys and the mouse until the first tap, on every screen (the owner, 2026-11-11): a list shows its cursor and glove at rest until a
 * finger has touched the page. A press made before the game listens counts, as the phone notice's Play on Phone (index.html notes it).
 */
const firstDevice = (): Device =>
  (typeof window === 'undefined' ? null : (window as unknown as { firstInputDevice?: Device | null }).firstInputDevice) ?? 'keyboard';
let deviceNow: Device | null = null;
const deviceWatchers = new Set<(d: Device) => void>();

/** The device the player used last. Lists ask it when they are built, which a tap can do before any update reaches them. */
export function currentDevice(): Device {
  return deviceNow ?? firstDevice();
}

/** Records the device the player has just used, and tells the watchers at once. The game's Input calls it; the unit tests do too. */
export function noteDevice(d: Device): void {
  if (d === currentDevice()) return;
  deviceNow = d;
  for (const f of [...deviceWatchers]) f(d);
}

/**
 * Calls `f` as soon as the device changes, even under a finger: for drawing that follows the device (a list's cursor band) and
 * changes no layout. Pages that lay out again use Input's onDeviceChange, which waits for the finger to lift. Returns the way to stop.
 */
export function watchDevice(f: (d: Device) => void): () => void {
  deviceWatchers.add(f);
  return () => void deviceWatchers.delete(f);
}

export class Input {
  /** Keyboard code to action. Starts as the defaults; the Controls page can change it. */
  private keys: Record<string, Action> = { ...KEYS };
  /** While set, the next key press goes here instead of to the game, for choosing a key. */
  private captureFn: ((code: string) => void) | null = null;
  private held = new Set<Action>();
  /** The keys down now, by code, so an action two keys share stays held until both are up. */
  private heldCodes = new Set<string>();
  private pressedQueue = new Set<Action>();
  private pressedNow = new Set<Action>();
  private padHeld = new Set<Action>();
  /** Gamepad buttons pressed while the gate was shut, which count only once let go and pressed again. */
  private padStale = new Set<Action>();
  private repeatTimers = new Map<Action, number>();
  private pointers = new Set<number>();
  /** Whether a pointer (a finger, a pressed mouse button, a pen) is down on the page now. A page that would rebuild under a
   * finger waits for it to lift, or the row it pressed is gone and the tap reaches nothing (Fable review P4, 2026-11-09). */
  get pointerHeld(): boolean { return this.pointers.size > 0; }
  /** Whether this pointer is still down: Pixi 8 never passes on a pointercancel, so a drag can ask whether its finger is gone. */
  pointerDown(id: number): boolean { return this.pointers.has(id); }
  private deviceChangePending = false;
  /** The device the player used last (see currentDevice). */
  get lastDevice(): Device {
    return currentDevice();
  }
  /** Fixed steps run so far: a list that sees it missed some was under another page, and comes back as a list newly shown. */
  steps = 0;
  /** Set while a text field has focus, so typing does not move the party. */
  suspended = false;
  /** Off for a test run stepped in lockstep, where nothing from outside may change the play. */
  gamepads = true;
  onDeviceChange: ((d: Device) => void) | null = null;
  /**
   * Shut while it says so (the game: while the loading page is up): key presses and gamepad buttons are dropped, and one held
   * down then counts only once let go and pressed again (the owner, 14 Nov: "on the loading screen, all inputs carry through
   * onto the title screen"). Taps are kept off by the loading page itself, which takes them until it has gone.
   */
  gate: (() => boolean) | null = null;

  constructor() {
    // Each Input starts from the first guess, as a new page load does.
    deviceNow = firstDevice();
    window.addEventListener('keydown', (e) => {
      // Keys typed into a text field belong to it, never to the game.
      if (this.suspended || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (this.captureFn && !e.repeat) {
        e.preventDefault();
        const f = this.captureFn;
        this.captureFn = null;
        f(e.code);
        return;
      }
      // A key pressed with Cmd, Ctrl or Alt is the browser's or the system's (a Mac sends no key-up for a key let go while
      // Cmd is down, which left a direction held), not the game's (Fable review P13, 2026-11-09).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const a = this.keys[e.code];
      if (!a) return;
      // A key the game uses does only the game's thing: no scrolling, no moving focus away (Tab), no quick find.
      if (a !== 'dev') e.preventDefault();
      this.setDevice('keyboard');
      // A key whose press was never taken (held since before the game listened, or pressed behind the gate) only repeats;
      // it counts once let go and pressed again.
      if (e.repeat && !this.heldCodes.has(e.code)) return;
      if (this.gate?.()) return;
      if (!e.repeat) this.pressedQueue.add(a);
      this.heldCodes.add(e.code);
      this.held.add(a);
    });
    window.addEventListener('keyup', (e) => {
      // Cmd let go: whatever was down with it sends no key-up of its own on a Mac.
      if (e.key === 'Meta') {
        for (const code of this.heldCodes) { const k = this.keys[code]; if (k) this.held.delete(k); }
        this.heldCodes.clear();
        return;
      }
      this.heldCodes.delete(e.code);
      const a = this.keys[e.code];
      // An action stays held while another of its keys is down (ArrowRight and D, say).
      if (a && ![...this.heldCodes].some((code) => this.keys[code] === a)) this.held.delete(a);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.heldCodes.clear();
      this.pointers.clear();
      setTimeout(() => this.notifyDeviceChange(), 0);
    });
    window.addEventListener('pointerdown', (e) => {
      this.pointers.add(e.pointerId);
      this.setDevice(e.pointerType === 'mouse' ? 'mouse' : 'touch');
    }, { capture: true });
    window.addEventListener('pointermove', (e) => {
      // A mouse moved after touch (a laptop with a touch screen, a tablet's trackpad) takes over again, so the mouse over a list
      // moves its cursor. Only from touch: on a desktop the key caps stay until a click, as before.
      if (e.pointerType === 'mouse' && (e.movementX || e.movementY) && this.lastDevice === 'touch') this.setDevice('mouse');
    }, { capture: true });
    const released = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      // Pixi must deliver pointertap to the original hit target before a device
      // change can rebuild menus or move fighters. A task also follows capture listeners.
      setTimeout(() => this.notifyDeviceChange(), 0);
    };
    window.addEventListener('pointerup', released, { capture: true });
    window.addEventListener('pointercancel', released, { capture: true });
  }

  private setDevice(d: Device) {
    if (d !== this.lastDevice) {
      noteDevice(d);
      this.deviceChangePending = true;
      this.notifyDeviceChange();
    }
  }

  private notifyDeviceChange(): void {
    if (this.pointers.size || !this.deviceChangePending) return;
    this.deviceChangePending = false;
    this.onDeviceChange?.(this.lastDevice);
  }

  /** Called once per fixed step, before game logic. */
  update(dt: number): void {
    this.steps++;
    this.pressedNow = this.pressedQueue;
    this.pressedQueue = new Set();
    // A repeat counts only on the step it fires, so one left over from walking cannot move the next menu.
    this.repeatFired.clear();
    this.pollGamepads();
    // Held directions repeat after a delay, for moving through menus.
    for (const a of ['up', 'down', 'left', 'right'] as const) {
      if (this.isHeld(a)) {
        const t = (this.repeatTimers.get(a) ?? -0.35) + dt;
        if (t >= 0.09) {
          this.repeatTimers.set(a, 0);
          this.repeatFired.add(a);
        } else {
          this.repeatTimers.set(a, t);
        }
      } else {
        this.repeatTimers.delete(a);
      }
    }
  }

  private repeatFired = new Set<Action>();

  private pollGamepads() {
    const pads = this.gamepads && navigator.getGamepads ? navigator.getGamepads() : [];
    const now = new Set<Action>();
    for (const p of pads) {
      if (!p) continue;
      const b = (i: number) => Boolean(p.buttons[i]?.pressed);
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      // A stick counts only its stronger direction, so a push a little off straight is not two presses.
      const across = Math.abs(ax) >= Math.abs(ay);
      if (b(12) || (!across && ay < -0.5)) now.add('up');
      if (b(13) || (!across && ay > 0.5)) now.add('down');
      if (b(14) || (across && ax < -0.5)) now.add('left');
      if (b(15) || (across && ax > 0.5)) now.add('right');
      if (b(0)) now.add('confirm');
      if (b(1)) now.add('cancel');
      if (b(9) || b(3)) now.add('menu');
    }
    const shut = this.gate?.() ?? false;
    for (const a of now) {
      if (this.padHeld.has(a)) continue;
      if (shut) this.padStale.add(a);
      else {
        this.pressedNow.add(a);
        this.setDevice('gamepad');
      }
    }
    for (const a of this.padStale) if (!now.has(a)) this.padStale.delete(a);
    this.padHeld = now;
  }

  isHeld(a: Action): boolean {
    return this.held.has(a) || (this.padHeld.has(a) && !this.padStale.has(a));
  }

  /** Whether a gamepad is currently supplying an action, rather than merely connected. */
  get gamepadActive(): boolean {
    return this.padHeld.size > 0;
  }

  /** True on the step the action was first pressed. */
  pressed(a: Action): boolean {
    return this.pressedNow.has(a);
  }

  /** Like pressed, but also fires repeatedly while a direction is held. For menus. */
  pressedOrRepeat(a: Action): boolean {
    if (this.pressedNow.has(a)) return true;
    if (this.repeatFired.has(a)) {
      this.repeatFired.delete(a);
      return true;
    }
    return false;
  }

  /** Clears pending presses, for example when a menu opens on the same step. */
  consume(a?: Action): void {
    if (a) this.pressedNow.delete(a);
    else this.pressedNow.clear();
  }

  /** Puts actions on the given keys. The developer key keeps its place. */
  setBindings(b: KeyBindings): void {
    const keys: Record<string, Action> = {};
    for (const [code, action] of Object.entries(KEYS)) if (action === 'dev') keys[code] = action;
    for (const action of REMAPPABLE) for (const code of b[action] ?? []) if (!keys[code]) keys[code] = action;
    this.keys = keys;
    this.held.clear();
    this.heldCodes.clear();
  }

  /** Hands the next key press to `fn` instead of the game. */
  captureNext(fn: (code: string) => void): void {
    this.captureFn = fn;
  }

  cancelCapture(): void {
    this.captureFn = null;
  }

  /** Simulates a press, for touch buttons and dev tools. */
  press(a: Action): void {
    this.pressedQueue.add(a);
  }

  /** The direction held, as a vector, for walking. */
  moveVector(): [number, number] {
    let x = 0;
    let y = 0;
    if (this.isHeld('left')) x -= 1;
    if (this.isHeld('right')) x += 1;
    if (this.isHeld('up')) y -= 1;
    if (this.isHeld('down')) y += 1;
    // Analogue sticks give finer control.
    const pads = this.gamepads && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.25) {
        x = ax;
        y = ay;
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? [x / len, y / len] : [x, y];
  }
}
