/**
 * Two sparring on the spot (the ninjas of the martial arts street): where one is in the round `t` seconds in, the
 * other's moves mirroring its own. `dx` is how far it is toward its partner from its spot, `lift` how high it is off the
 * ground, `lean` how far forward it leans, `squash` below 1 flatter; `shout` while it strikes.
 *
 * A round: bouncing in their stances, the lead lunges as the other gives way, bouncing, the other lunges, bouncing, then
 * both leap in and clash in the air, land, and bounce again.
 */
export const SPAR_ROUND = 3.2;

export interface SparPose {
  dx: number;
  lift: number;
  lean: number;
  squash: number;
  shout: boolean;
}

export function sparPose(t: number, lead: boolean): SparPose {
  const k = ((t % SPAR_ROUND) + SPAR_ROUND) % SPAR_ROUND;
  const arc = (from: number, to: number) => (k >= from && k < to ? Math.sin((Math.PI * (k - from)) / (to - from)) : 0);
  const stance: SparPose = { dx: 0, lift: 1.2 * Math.abs(Math.sin(k * Math.PI * 5)), lean: 0.06, squash: 1, shout: false };
  // Each takes a turn: lunging in, or giving way to the other's lunge.
  const turns: Array<[number, number, boolean]> = [[0.4, 0.75, lead], [1.15, 1.5, !lead]];
  for (const [from, to, mine] of turns) {
    const s = arc(from, to);
    if (k < from || k >= to) continue;
    return mine
      ? { dx: 9 * s, lift: 2 * s, lean: 0.06 + 0.3 * s, squash: 1, shout: true }
      : { dx: -5 * s, lift: 0, lean: 0.06 - 0.26 * s, squash: 1 - 0.08 * s, shout: false };
  }
  // Both leap in, meeting in the air, and land with a squash.
  if (k >= 1.9 && k < 2.55) {
    const s = arc(1.9, 2.55);
    return { dx: 8 * s, lift: 16 * s, lean: 0.06 + 0.25 * s, squash: 1 + 0.05 * s, shout: s > 0.6 };
  }
  if (k >= 2.55 && k < 2.7) return { ...stance, lift: 0, squash: 1 - 0.14 * arc(2.55, 2.7) };
  return stance;
}
