import { Container, Graphics, Text } from 'pixi.js';
import type { Actor } from '../world/actor.ts';
import type { Battle } from './battle.ts';
import { FONT } from '../render/fonts.ts';
import { EASE, motion } from '../render/motion.ts';
import { AFTER, aimEllipse, aimScale, beatAt, buildDome, buildWarhead, domePose, drawBeam, drawReticle, drawShock, drawTrail, drawVeil, locksAt, STRIKE, veilAlpha, warheadHeight, warheadStretch } from '../render/nukeStrike.ts';
import { INK, PAPER, POP_YELLOW, RED_INK } from '../render/palette.ts';
import { drawNukeAsh, NukeCloud } from './nukeCloud.ts';

type Rect = { x: number; y: number; w: number; h: number };
const CLOCK_SHADOW = { x: 4, y: 5 };
const CLOCK_LINE = 2;

/** Placeholder warning placard. All motion is slow pulsing or a moving sweep,
 * not strobing; Reduce Motion keeps the same information in a still pose. Once the target is `locked` (the fuse has
 * run out and the strike is coming) it turns to a red plate, still, its bar empty. */
export class FinaleClock {
  static bounds(r: Rect): Rect {
    return { x: r.x - CLOCK_LINE / 2, y: r.y - CLOCK_LINE / 2,
      w: r.w + CLOCK_SHADOW.x + CLOCK_LINE / 2, h: r.h + CLOCK_SHADOW.y + CLOCK_LINE / 2 };
  }
  readonly container = new Container();
  private readonly art = new Graphics();
  private readonly label = new Text({ text: '', style: { fontFamily: FONT.headline, fontWeight: '700', fill: PAPER } });
  private readonly digits = new Text({ text: '', style: { fontFamily: FONT.headline, fontWeight: '700', fill: POP_YELLOW } });
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor() { this.container.eventMode = 'none'; this.container.addChild(this.art, this.label, this.digits); }

  draw(rect: Rect, u: number, seconds: number, max: number, time: number, label: string, overpowered: boolean, locked = false, compact = false): void {
    this.rect = rect;
    const { w, h } = rect;
    this.container.position.set(rect.x, rect.y);
    const urgent = !overpowered && seconds <= 5;
    const pulse = motion.reduced || locked ? 0.5 : (1 + Math.sin(time * (urgent ? 8 : 3))) / 2;
    const color = locked ? PAPER : overpowered ? 0x74d8c5 : urgent ? 0xff7352 : POP_YELLOW;
    const g = this.art.clear();
    g.rect(CLOCK_SHADOW.x, CLOCK_SHADOW.y, w, h).fill(INK);
    g.rect(0, 0, w, h).fill(locked ? RED_INK : 0x24272e).stroke({ width: CLOCK_LINE, color: INK });
    g.rect(2, 2, w - 4, h - 4).stroke({ width: 2 + pulse * 2, color, alpha: 0.45 + pulse * 0.4 });
    const edge = Math.max(4, u * 0.3);
    // Hazard chevrons above and below the display, clipped by their own coordinates.
    for (let x = 4; !compact && x < w - 5; x += 18) {
      const end = Math.min(w - 4, x + 10);
      g.poly([x, 3, end, 3, Math.max(x, end - 4), 3 + edge, x, 3 + edge]).fill({ color, alpha: 0.75 });
      g.rect(x, h - edge - 3, end - x, edge).fill({ color, alpha: 0.6 });
    }
    const pad = u * 0.7;
    this.label.text = label;
    this.label.style.fontSize = Math.round(u * 0.95);
    this.label.scale.set(1);
    const labelRoom = w - pad * 2 - (overpowered ? 0 : u * (compact ? 3 : 7));
    this.label.style.wordWrap = compact;
    this.label.style.wordWrapWidth = labelRoom;
    if (this.label.width > labelRoom) this.label.scale.set(labelRoom / this.label.width);
    this.label.position.set(pad, h * (compact ? 0.36 : 0.3) - this.label.height / 2);
    this.digits.visible = !overpowered;
    this.digits.text = Math.max(0, seconds).toFixed(1);
    this.digits.style.fontSize = Math.round(u * (compact ? 1.4 : 2.6));
    this.digits.style.fill = color;
    this.digits.anchor.set(1, 0.5);
    this.digits.scale.set(motion.reduced || locked ? 1 : 1 + pulse * (urgent ? 0.06 : 0.02));
    this.digits.position.set(w - pad, h * 0.36);
    const frac = locked ? 0 : overpowered ? 1 : Math.max(0, Math.min(1, seconds / max));
    const bw = w - pad * 2, by = h * (compact ? 0.8 : 0.7), bh = u * (compact ? 0.35 : 0.65);
    g.rect(pad, by, bw, bh).fill(INK).stroke({ width: 1, color: PAPER, alpha: 0.65 });
    if (frac > 0) g.rect(pad, by, bw * frac, bh).fill(color);
    for (let i = 1; i < 15; i++) g.rect(pad + bw * i / 15, by, 2, bh).fill({ color: INK, alpha: 0.75 });
    if (!motion.reduced && !overpowered && frac > 0) {
      const sx = pad + bw * frac;
      g.circle(sx, by + bh / 2, u * (0.55 + pulse * 0.2)).fill({ color, alpha: 0.18 });
      g.circle(sx, by + bh / 2, u * 0.22).fill(PAPER);
    }
  }
}

/** What the strike is showing, for the checks: its stage and progress, the target's middle and size (the shock ring's
 * after impact), the white's opacity, and from the grand pass the seconds in, the burst it is on, the brackets locked,
 * the warhead's height (null when none shows) and the dome's opacity. */
export type NukeFrame = {
  stage: 'targeting' | 'impact' | 'cloud'; progress: number; x: number; y: number; radius: number; white: number;
  t: number; beat: number; locks: number; warhead: number | null; dome: number;
};

/**
 * The strike, in the world. The deadline locks the outcome before this starts; damage is applied once at impact,
 * after the visible targeting buildup. The grand pass (src/render/nukeStrike.ts): on the rifle's bursts the field
 * darkens round a target fitted to the party whose brackets lock one a burst, a red guide beam lands and a paper
 * warhead falls down it, touching down at impact; then the owner's white and silence, unchanged, and through the
 * thinning white a fireball dome, an inked shock ring with a dust wall, and the cloud born hot. The INCOMING! panel and
 * the focus lines are the battle interface's, from the frames this reports (BattleUi.tacticalNuke).
 */
export function tacticalNuke(b: Battle, boss: Actor, members: Actor[], detonate: () => void,
  keep: () => boolean, fire: () => void, observe: (frame: NukeFrame | null) => void): Promise<void> {
  const w = b.world, game = b.game;
  const ash = new Graphics(); ash.visible = false; w.fx.addChild(ash);
  const g = new Graphics(); g.label = 'nuke_cloud'; g.eventMode = 'none'; w.fx.addChild(g);
  // Over the whole printed screen, including the frame and battle interface.
  const white = new Graphics(); white.label = 'nuke_whiteout'; white.eventMode = 'none'; white.alpha = 0;
  game.root.addChild(white);
  let hearing: ReturnType<typeof game.audio.blastAftermath> | null = null;
  const fromX = boss.x, fromY = boss.y;
  const centre = () => ({ x: members.reduce((n, a) => n + a.x, 0) / Math.max(1, members.length),
    y: members.reduce((n, a) => n + a.y, 0) / Math.max(1, members.length) });
  const start = centre();
  const radius = Math.max(65, ...members.map(a => Math.hypot(a.x - start.x, a.y - start.y) + a.size * 2));
  const direction = boss.x >= start.x ? 1 : -1;
  const band = b.ui.effectBand(true);
  const [left, ceiling] = w.panelToWorldSettled(band.left + 6, band.top + 6);
  const [right] = w.panelToWorldSettled(band.right - 6, band.bottom);
  const retreatSpeed = 28;
  // Keep the whole cloud upright. Move its broad foot within the scorch mark on
  // narrow screens instead of bending its column diagonally to reach a centred cap.
  const cloudHeight = Math.max(40, (start.y - ceiling) * w.ground * 0.86);
  const cloudRadius = Math.min(radius * 1.7, (right - left) / 3.2, cloudHeight * 0.74);
  const cloudX = Math.max(left + cloudRadius * 1.42, Math.min(right - cloudRadius * 1.42, start.x));
  // Keep the established blast anchor, but let the larger crown grow offscreen.
  const smoke = new NukeCloud(cloudRadius * 1.5, cloudHeight * 1.5);
  smoke.view.position.set(cloudX, start.y); smoke.view.scale.y = 1 / w.ground;
  smoke.view.visible = false; w.fx.addChild(smoke.view);
  // The grand pass's layers: the darkened field under everything else here, the fireball dome behind the cloud, and
  // the beam and warhead upright over the target.
  const aim = aimEllipse(members, left, right);
  const veil = new Graphics(); veil.label = 'nuke_veil'; veil.eventMode = 'none'; veil.alpha = 0;
  drawVeil(veil, aim, (aim.size * 2.6) / w.ground);
  w.fx.addChildAt(veil, w.fx.getChildIndex(ash));
  const top = w.panelToWorldSettled(band.left, b.ui.effectBand(false).top)[1];
  const h0 = Math.max(aim.size * 4, (aim.y - top) * w.ground);
  const long = Math.min(aim.size * 2.4, cloudHeight / 4);
  const air = new Container(); air.label = 'nuke_air'; air.eventMode = 'none';
  air.position.set(aim.x, aim.y); air.scale.y = 1 / w.ground;
  const beam = new Graphics(), trail = new Graphics(), warhead = buildWarhead(long, aim.size);
  warhead.visible = false;
  air.addChild(beam, trail, warhead); w.fx.addChild(air);
  const domeRadius = Math.min(cloudRadius * 1.6, cloudHeight * 0.55, (right - left) * 0.45);
  const dome = buildDome(domeRadius, aim.size);
  dome.view.position.set(cloudX, start.y); dome.view.scale.y = 1 / w.ground; dome.view.visible = false;
  w.fx.addChildAt(dome.view, w.fx.getChildIndex(smoke.view));
  const previousHidden = members.map(a => a.hidden);
  const facing = boss.facing;
  const impactAt = STRIKE.impact, aftermath = 5, total = impactAt + aftermath;
  let t = 0, fired = -1, impacted = false, shook = false;
  let retreatX = fromX, retreatStopped = false;
  const retreat = (elapsed: number) => {
    if (!motion.reduced) {
      const target = fromX + direction * retreatSpeed * elapsed;
      // Scripted animation still needs a ground footprint. Sweep the whole advance so a slow frame cannot
      // skip Berlin's fence, and stop rather than slide sideways while the rifle remains aimed at the party.
      while (!retreatStopped && direction * (target - retreatX) > .001) {
        const next = retreatX + direction * Math.min(2, Math.abs(target - retreatX));
        if (w.collision.blocked(next, fromY)) retreatStopped = true;
        else retreatX = next;
      }
      boss.x = retreatX;
    }
    boss.facing = facing;
  };
  const draw = () => {
    const { x, y } = centre();
    const still = motion.reduced;
    const aiming = t < impactAt;
    const pulse = still ? 0.5 : (1 + Math.sin(t * 7)) / 2;
    // Back away through the blast and its aftermath until scenery stops him,
    // keeping the gun pointed at the party even after leaving the viewport.
    retreat(t);
    g.clear();
    if (aiming) {
      const { beat, since } = beatAt(fired, t);
      const scale = aimScale(aim, beat, since, still);
      veil.alpha = veilAlpha(t, still);
      drawReticle(g, aim, scale, beat, since, pulse, still);
      // The beam and the falling warhead, its shadow on the ground growing as it nears, and a ring thrown out as the
      // beam lands.
      beam.clear(); trail.clear();
      drawBeam(beam, t, h0, aim.size, still);
      let nose: number | null = null;
      if (t >= STRIKE.drop) {
        nose = warheadHeight(t, h0, still);
        warhead.visible = true;
        warhead.position.set(0, -nose);
        warhead.scale.set(1, warheadStretch(still));
        warhead.alpha = still ? Math.min(1, (t - STRIKE.drop) / 0.06) : 1;
        drawTrail(trail, nose, h0, long, aim.size, still);
        trail.alpha = warhead.alpha;
        const near = 1 - nose / h0;
        g.ellipse(aim.x, aim.y, aim.size * (0.4 + 1.4 * near), aim.size * (0.4 + 1.4 * near)).fill({ color: INK, alpha: (0.15 + 0.35 * near) * warhead.alpha });
      }
      const ring = (t - STRIKE.beamDown) / 0.5;
      if (!still && ring > 0 && ring < 1) {
        const r = aim.size * (1 + 5 * EASE.out(ring));
        g.circle(aim.x, aim.y, r).stroke({ width: aim.size * 0.3 * (1 - ring), color: RED_INK, alpha: 1 - ring });
      }
      observe({ stage: 'targeting', progress: t / impactAt, x: aim.x, y: aim.y, radius: Math.max(aim.rx, aim.ry) * scale, white: 0,
        t, beat, locks: locksAt(beat), warhead: nose, dome: 0 });
      return;
    }
    const age = t - impactAt, k = Math.min(1, age / aftermath);
    // One white cut, then exponential recovery with a pale tail. Never fully clears
    // before the defeat newspaper. Reduce Motion has only a faint, steady haze.
    white.clear().rect(0, 0, game.layout.vw, game.layout.vh).fill(0xffffff);
    white.alpha = still ? 0.12 : 0.16 + 0.84 * Math.pow(2, -Math.max(0, age - 0.5) / 0.3);
    hearing?.update(age);
    smoke.view.visible = true; smoke.draw(age, still);
    const pose = domePose(age, still);
    dome.view.visible = pose.alpha > 0;
    dome.view.alpha = pose.alpha; dome.view.scale.set(pose.scale, pose.scale / w.ground); dome.ink.alpha = pose.ink;
    // The shake lands with the rumble rolling in, as the picture returns, rather than under the white.
    if (!shook && age >= AFTER.shake) {
      shook = true;
      if (!still) w.shakeTime = 0.65;
    }
    // The char and ash are static geometry beneath these animated puffs.
    drawShock(g, x, y, radius, age, aim.size, still);
    const shock = radius * (still ? 1.4 : 0.3 + EASE.out(Math.min(1, Math.max(0, age - AFTER.shock) / AFTER.shockRun)) * 3.4);
    observe({ stage: age < 0.5 ? 'impact' : 'cloud', progress: k, x, y, radius: shock, white: white.alpha,
      t, beat: 4, locks: 4, warhead: null, dome: pose.alpha });
  };
  draw();
  return new Promise(resolve => w.addTask({
    step: dt => {
      if (!keep() || g.destroyed) return true;
      t += dt;
      if (t < impactAt && Math.floor(t / STRIKE.beat) !== fired) { fired = Math.floor(t / STRIKE.beat); fire(); }
      if (t >= impactAt && !impacted) {
        impacted = true;
        hearing = game.audio.blastAftermath(); hearing.update(0);
        // End the music at impact; only the ringing and rumble return through the cloud.
        game.audio.music(null);
        for (const a of members) a.hidden = true;
        drawNukeAsh(ash, start.x, start.y, radius, members); ash.visible = true;
        detonate();
        // Under the white, the targeting is cleared away.
        if (!veil.destroyed) veil.destroy();
        if (!air.destroyed) air.destroy({ children: true });
      }
      draw();
      return t >= total;
    },
    resolve: () => {
      hearing?.stop();
      // A strike that ran its course and left nobody standing has lost the fight: the scorched paving and the ash
      // stay, the party still hidden, while the defeat page comes and goes, since the camera holds on them until
      // another map or the title replaces this world (Battle.run). Anyone still standing (god mode), or a fight ended
      // some other way meanwhile (a developer's win), gets the field back.
      const wiped = impacted && keep() && members.every(a => a.ko);
      const clear = () => {
        // A cancelled scene can destroy the map before this cleanup runs.
        if (!g.destroyed) g.destroy();
        if (!wiped && !ash.destroyed) ash.destroy();
        if (!smoke.view.destroyed) smoke.view.destroy({ children: true });
        if (!white.destroyed) white.destroy();
        for (const v of [veil, air, dome.view]) if (!v.destroyed) v.destroy({ children: true });
        if (!wiped) members.forEach((a, i) => { a.hidden = previousHidden[i]!; });
      };
      // Keep the haze and the scorched field behind the incoming newspaper instead of
      // clearing to a bare battlefield for the page-turn. Cancellation and Reduce Motion clear at once.
      if (t >= total && keep() && !motion.reduced) {
        let tail = 0;
        const haze = white.alpha;
        w.addTask({ step: dt => {
          tail += dt;
          retreat(total + tail);
          if (!smoke.view.destroyed) smoke.draw(aftermath + tail, motion.reduced);
          if (!white.destroyed) white.alpha = haze * Math.max(0, 1 - tail / 0.45);
          return tail >= 0.45;
        }, resolve: clear });
      } else clear();
      boss.facing = facing; boss.y = fromY;
      observe(null); resolve();
    },
  }));
}
