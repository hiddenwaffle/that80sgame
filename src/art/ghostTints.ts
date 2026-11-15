import type { LookId } from './characters.ts';

/** Today's four painted ghost shapes and the giant's own larger one, each with tintable layers (tools/ghost_tint_layers.py). */
export type GhostShape = 'green' | 'red' | 'orange' | 'cream' | 'giant';

/**
 * Every maze ghost its own colour, so no two groups look alike (the owner, 2026-10-29): one of the four painted shapes,
 * its grey body tinted to the colour, its eyes drawn over untinted. A shape tinted with its own colour gives back its
 * painting. The frightened blue ghost keeps its own picture. Kept apart from lookArt.ts so the art loader can find
 * which shape's pictures a ghost uses without importing the drawing code.
 */
export const GHOST_TINTS: Partial<Record<LookId, { shape: GhostShape; color: number; foil?: true }>> = {
  ghost_green: { shape: 'green', color: 0x3c6441 },
  ghost_red: { shape: 'red', color: 0x8b151b },
  ghost_orange: { shape: 'orange', color: 0xfa9021 },
  ghost_cream: { shape: 'cream', color: 0xf3ecd3 },
  ghost_pink: { shape: 'cream', color: 0xf08bb8 },
  ghost_cyan: { shape: 'orange', color: 0x3cc3df },
  ghost_yellow: { shape: 'red', color: 0xf6cf2f },
  ghost_lime: { shape: 'green', color: 0x95c43a },
  ghost_purple: { shape: 'orange', color: 0x7c47a6 },
  ghost_white: { shape: 'cream', color: 0xf7f7f4 },
  ghost_brown: { shape: 'red', color: 0x8a5a36 },
  ghost_magenta: { shape: 'green', color: 0xc8247e },
  ghost_teal: { shape: 'orange', color: 0x1d8a7e },
  ghost_grey: { shape: 'red', color: 0x8b8e90 },
  // In holographic foil rather than tinted (ghostFoil.ts); its colour, a pastel pink, is only for its code drawing.
  ghost_giant: { shape: 'giant', color: 0xe58ab8, foil: true },
};

/** The art slots a look's pictures start with: a tinted ghost's are its shape's layers. */
export function lookSlotPrefix(look: string): string {
  const tint = GHOST_TINTS[look as LookId];
  return tint ? `looks/ghost_tint_${tint.shape}_` : `looks/${look}_`;
}
