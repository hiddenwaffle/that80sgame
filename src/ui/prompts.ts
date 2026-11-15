import { Container, Graphics } from 'pixi.js';
import { keyName, type Device, type KeyBindings, type RemappableAction } from '../engine/input.ts';
import type { GameContext } from '../game/context.ts';
import { INK, PAPER } from '../render/palette.ts';
import { keyTop } from './print.ts';

/**
 * Which key or button does an action, as a small printed key cap, for players on a keyboard or
 * a gamepad. Touch and mouse players get none: they tap what they see.
 */

/** A gamepad's buttons, by where they sit: the four face buttons, and the D-pad's sides. */
export type PadButton = 'top' | 'bottom' | 'left' | 'right' | 'pad_up' | 'pad_down' | 'pad_left' | 'pad_right';

export type Prompt = { kind: 'key'; label: string } | { kind: 'pad'; button: PadButton } | null;

/** The gamepad's fixed buttons for each action (see Input.pollGamepads). */
const PAD: Record<RemappableAction, PadButton> = {
  confirm: 'bottom',
  cancel: 'right',
  menu: 'top',
  up: 'pad_up',
  down: 'pad_down',
  left: 'pad_left',
  right: 'pad_right',
};

/**
 * The prompt for an action on a device: on a keyboard, the first key the action is on, named
 * shortly (`named` looks a code up in messages.yaml); on a gamepad, its fixed button; otherwise none.
 */
export function promptFor(action: RemappableAction, device: Device, bindings: KeyBindings, named: (code: string) => string | undefined = () => undefined): Prompt {
  if (device === 'keyboard') {
    const code = bindings[action]?.[0];
    return code ? { kind: 'key', label: keyName(code, named) } : null;
  }
  if (device === 'gamepad') return { kind: 'pad', button: PAD[action] };
  return null;
}

/** A small printed key with its name, or a gamepad's buttons with the one to press filled in. */
export function keyCap(prompt: NonNullable<Prompt>, unit: number): Container {
  if (prompt.kind === 'key') return keyTop(prompt.label, unit);
  const c = new Container();
  const h = Math.round(unit * 1.35);
  const g = new Graphics();
  const mid = h / 2;
  const d = h * 0.3;
  const r = h * 0.14;
  const b = prompt.button;
  if (b.startsWith('pad_')) {
    // The D-pad: a cross, with the side to press filled.
    const arm = h * 0.22;
    const arms: Array<[PadButton, number, number]> = [['pad_up', 0, -1], ['pad_down', 0, 1], ['pad_left', -1, 0], ['pad_right', 1, 0]];
    for (const [name, dx, dy] of arms) {
      const x = mid + dx * d - arm / 2;
      const y = mid + dy * d - arm / 2;
      g.rect(x, y, arm, arm).fill(name === b ? INK : PAPER).stroke({ width: 1.2, color: INK });
    }
    g.rect(mid - arm / 2, mid - arm / 2, arm, arm).fill(PAPER).stroke({ width: 1.2, color: INK });
  } else {
    // The face buttons: four in a diamond, with the one to press filled.
    const faces: Array<[PadButton, number, number]> = [['top', 0, -1], ['bottom', 0, 1], ['left', -1, 0], ['right', 1, 0]];
    for (const [name, dx, dy] of faces) g.circle(mid + dx * d, mid + dy * d, r).fill(name === b ? INK : PAPER).stroke({ width: 1.2, color: INK });
  }
  c.addChild(g);
  return c;
}

/** A key's short name for a cap: the `keycaps` group of messages.yaml first, then the `keys` group. */
export function capName(g: Pick<GameContext, 'content'>): (code: string) => string | undefined {
  return (code) => g.content.messages.keycaps?.[code] ?? g.content.messages.keys?.[code];
}
