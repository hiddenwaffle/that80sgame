/**
 * What the isometric newspaper scenes (src/world/iso_scenes.ts) draw from art files, by the art group whose page shows each:
 * the looks of their figures beyond the party's, and their props' slots. Kept apart so the art loader can read it without the
 * drawing code.
 */
export const ISO_SCENE_ART: Record<string, { group: string; looks: string[]; slots: string[] }> = {
  house_gearup: { group: 'arcade', looks: ['blue_thing'], slots: [] },
  maze_ghostbusting: { group: 'border', looks: ['ghost_giant', 'ghost_red', 'ghost_cyan', 'ghost_orange', 'ghost_pink'], slots: ['props/flower_white'] },
  bridge_crossing: {
    group: 'field', looks: [],
    slots: ['scenery/border/props/birch', 'scenery/border/props/spruce', 'props/flower_poppy', 'props/flower_white', 'props/flower_yellow', 'props/flower_cornflower', 'props/flower_daisy', 'props/flower_marigold', 'props/flower_cosmos', 'props/flower_lupine'],
  },
  temple_students: { group: 'berlin', looks: [], slots: ['props/tank_wreck', 'props/willow'] },
  // The game-over and rescue pages, and the epilogue's three.
  inferno: { group: 'defeat', looks: [], slots: [] },
  warsaw_rescue: { group: 'rescue', looks: [], slots: ['scenery/berlin/wall/panels'] },
  separate_ways: {
    group: 'ending', looks: [],
    slots: ['scenery/border/props/birch', 'scenery/border/props/spruce', 'props/flower_poppy', 'props/flower_white', 'props/flower_yellow', 'props/flower_cornflower', 'props/flower_daisy', 'props/flower_marigold', 'props/flower_cosmos', 'props/flower_lupine'],
  },
  fireside: { group: 'ending', looks: [], slots: [] },
  ceo: { group: 'ending', looks: [], slots: [] },
};
