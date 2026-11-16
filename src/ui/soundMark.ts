import { Container, Graphics } from 'pixi.js';
import { INK } from '../render/palette.ts';
import { button } from './widgets.ts';

/** A speaker struck out with an X, in ink, `size` across and tall: the mark's picture. */
function speakerOff(size: number): Graphics {
  const s = size;
  const g = new Graphics();
  // The speaker, facing right: its box and its cone.
  g.rect(0, s * 0.34, s * 0.22, s * 0.32).fill(INK);
  g.poly([s * 0.2, s * 0.34, s * 0.5, s * 0.08, s * 0.5, s * 0.92, s * 0.2, s * 0.66]).fill(INK);
  const w = Math.max(2, Math.round(s * 0.12));
  g.moveTo(s * 0.64, s * 0.32).lineTo(s, s * 0.68).moveTo(s, s * 0.32).lineTo(s * 0.64, s * 0.68).stroke({ color: INK, width: w, cap: 'round' });
  return g;
}

/**
 * The mark the game shows while its sound has failed for good (AudioSystem `problem`): a loud corner button, as the map's
 * and the fight's are, with a speaker struck out, at the top left of every page and over everything. Tapped or clicked, the
 * game says what went wrong and offers a reload (the owner, 15 Nov: "just not play anything at all and show a mute icon
 * that if the player taps, tells them it can reload to try to get the sounds working again").
 */
export class SoundMark {
  readonly container = new Container();
  private readonly onTap: () => void;

  constructor(onTap: () => void) {
    this.onTap = onTap;
    this.container.visible = false;
    this.container.label = 'sound_mark';
  }

  get shown(): boolean {
    return this.container.visible;
  }

  set shown(on: boolean) {
    this.container.visible = on;
  }

  /** Drawn again at the layout's unit, its top left at `x`, `y` on the upright screen. */
  layout(unit: number, x: number, y: number): void {
    for (const c of this.container.removeChildren()) c.destroy({ children: true });
    // As wide as its picture needs, with the loud buttons' slanted end.
    const icon = speakerOff(Math.round(unit * 1.4));
    const b = button('', unit, this.onTap, { slab: true, icon, size: Math.round(unit * 1.05), w: Math.round(icon.width + unit * 2.2) });
    this.container.addChild(b);
    this.container.position.set(Math.round(x), Math.round(y));
  }
}
