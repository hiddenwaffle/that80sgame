import { Matrix, type FillStyle, type StrokeStyle, type Texture } from 'pixi.js';
import type { Cloth } from './cloth_wave.ts';
import { art } from './images.ts';

/** Map-specific art changes the picture, never the prop kind, foot or placement. */
export function sceneryProp(map: string, kind: string): Texture | null {
  return art(`scenery/${map}/props/${kind}`) ?? art(`props/${kind}`);
}

/** Repeating materials use world coordinates, including the rounded corner's neighbouring ground. */
export class SceneryMaterials {
  private readonly fills = new Map<string, FillStyle>();
  readonly bank?: StrokeStyle;
  /** Ground the bank does not run along, for a bank of stone that a bridge's deck has no need of. */
  readonly bankExcept?: string;
  /** Whether water here has a stone quay along its north side (src/world/terrainView.ts). */
  readonly quay?: boolean;
  /** Whether pavements here have a border of small stones along their edges, round the big slabs, as Berlin's do. */
  readonly mosaic?: boolean;

  constructor(map: string) {
    // Berlin's canal has stone banks.
    if (map === 'berlin') {
      this.bank = { color: 0xb5b2a7, width: 7, cap: 'butt', join: 'round' };
      this.bankExcept = 'bridge';
      this.quay = true;
      this.mosaic = true;
    }
    if (map !== 'border' && map !== 'field') return;
    const material = (slot: string, size: number, color = 0xffffff): FillStyle | undefined => {
      const texture = art(`scenery/${map}/terrain/${slot}`);
      return texture ? { texture, color, textureSpace: 'global', matrix: new Matrix().scale(size / texture.width, size / texture.height) } : undefined;
    };
    const add = (id: string, slot: string, size: number, color?: number) => {
      const fill = material(slot, size, color);
      if (fill) this.fills.set(id, fill);
    };
    add('grass', 'grass', 128);
    add('grass_dark', 'grass', 128, 0xbfcdba);
    if (map === 'field') return;
    add('sand', 'soil', 128);
    add('path', 'soil', 128, 0xead7be);
    // The deck is two terrain rows tall; its fasteners stay at the top and bottom, not at each tile seam.
    add('bridge', 'bridge', 64);
    const bank = material('bank', 64);
    if (bank) this.bank = { ...bank, width: 7, alpha: 0.6, cap: 'round', join: 'round' };
  }

  /** The border bridge's planks turned a quarter, for a deck two tiles wide going up the map from `left`: its fasteners run along the deck's sides. */
  uprightDeck(left: number): FillStyle | null {
    const texture = art('scenery/border/terrain/bridge');
    return texture ? { texture, textureSpace: 'global', matrix: new Matrix().scale(64 / texture.width, 64 / texture.height).rotate(Math.PI / 2).translate(left + 64, 0) } : null;
  }

  has(id: string): boolean { return this.fills.has(id); }
  fill(id: string, fallback: number): FillStyle | number { return this.fills.get(id) ?? fallback; }
}

/** Original code-drawing bounds, including ink. Fitting pictures here keeps bases and label coordinates fixed. */
export interface SceneryPropBounds { x: number; y: number; width: number; height: number; overlay?: { x: number; y: number; scaleX: number; scaleY: number }; labels?: Record<string, { x: number; y: number; size?: number }>; cloth?: Cloth }
const FIELD_PROP_BOUNDS: Record<string, SceneryPropBounds> = {
  "alley_awning_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "alley_bamboo_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "alley_closed_gate": {"x": -67.5, "y": -48.23545662, "width": 135, "height": 48.83545662},
  "alley_entry_overhang": {"x": -68.6, "y": -154.5, "width": 137.2, "height": 152.7},
  "alley_flowers": {"x": -9.5, "y": -15.11190173, "width": 18, "height": 15.41190173},
  "alley_lantern_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "alley_laundry_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "alley_paper_screen": {"x": -52, "y": -67.1, "width": 102.1, "height": 68.2},
  "alley_school_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "alley_sign_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "alley_theatre_screen": {"x": -50.1, "y": -67.1, "width": 100.2, "height": 68.2},
  "antique_stall": {"x": -29.45, "y": -36.35, "width": 58.9, "height": 36.85},
  "barrier": {"x": -22, "y": -25.7, "width": 42.7, "height": 27.2},
  "book_table": {"x": -26.4, "y": -26.3, "width": 52.8, "height": 26.3},
  "brush_shop": {"x": -35.6, "y": -69.23545662, "width": 71.2, "height": 69.83545662},
  "cart": {"x": -27.5, "y": -31.0, "width": 64.3, "height": 31.8},
  "courtyard": {"x": -68.5, "y": -72.23545662, "width": 137, "height": 72.83545662},
  "entry_basket": {"x": -15.45, "y": -30.04927823, "width": 30.9, "height": 31.09855645},
  "entry_bundles": {"x": -20.4, "y": -40.4, "width": 40.8, "height": 40.8},
  "entry_crate": {"x": -10.5, "y": -25.5, "width": 21, "height": 26},
  "entry_loose_crate": {"x": -14.5, "y": -28.5, "width": 29, "height": 29},
  "entry_loose_planter": {"x": -16.35, "y": -49.45, "width": 34.7, "height": 49.85},
  "entry_pier": {"x": -10.6, "y": -35.4, "width": 21.2, "height": 36},
  "entry_planter": {"x": -10.5, "y": -35.3, "width": 21, "height": 35.8},
  "entry_sacks": {"x": -21.35, "y": -32.05, "width": 40.7, "height": 29.9},
  "entry_storage": {"x": -18.5, "y": -39.5, "width": 37, "height": 40},
  "entry_water_jar": {"x": -19.45, "y": -44.4, "width": 38.9, "height": 46.85},
  "lantern_post": {"x": -4.35, "y": -45.4, "width": 21.3, "height": 45.75},
  "laundry": {"x": -46, "y": -39, "width": 92, "height": 40},
  "martial_school": {"x": -63.6, "y": -91.23545662, "width": 127.2, "height": 91.83545662, "labels": {"武馆": {"x": 0, "y": -46.4, "size": 12}}},
  "poplar": {"x": -13.55, "y": -80.55, "width": 27.1, "height": 81.05},
  "post_row": {"x": -51.45, "y": -20.9, "width": 102.9, "height": 21.35},
  "produce_stall": {"x": -31.5, "y": -49.5, "width": 63, "height": 49.9},
  "school_supply": {"x": -35.6, "y": -69.23545662, "width": 71.2, "height": 69.83545662},
  "scroll_stall": {"x": -29.5, "y": -48.5, "width": 59, "height": 48.95},
  "shop_books": {"x": -70.6, "y": -84.23545662, "width": 144.05, "height": 86.58545662},
  "shop_duck": {"x": -70.6, "y": -84.23545662, "width": 144.05, "height": 84.88545662},
  "shop_grocer": {"x": -70.6, "y": -84.23545662, "width": 144.05, "height": 85.08545662},
  "shop_repair": {"x": -70.6, "y": -84.23545662, "width": 144.05, "height": 85.03545662},
  "shop_tea": {"x": -70.6, "y": -84.23545662, "width": 144.05, "height": 84.88545662},
  "signpost": {"x": -30.65, "y": -56.65, "width": 67.3, "height": 57.15, "labels": {"BERLIN": {"x": -4, "y": -43.4, "size": 12}, "5 KM": {"x": -4, "y": -33, "size": 9}}},
  "snack_kiosk": {"x": -35.6, "y": -69.23545662, "width": 71.2, "height": 69.83545662},
  "square_flag": {"x": -10.4, "y": -79.95, "width": 38.9, "height": 80.35, "cloth": {"x": 0.25, "y": 0.47}},
  "staff_rack": {"x": -23.4, "y": -43.3, "width": 46.8, "height": 43.7},
  "tea_stand": {"x": -27.5, "y": -48.5, "width": 55, "height": 49},
  "tea_table": {"x": -30.35, "y": -21.5, "width": 60.7, "height": 21.85},
  "theatre": {"x": -69.6, "y": -95.23545662, "width": 139.2, "height": 99.63545662, "labels": {"戏院": {"x": 0, "y": -59.3, "size": 15}}},
  "training_dummy": {"x": -19.05497259, "y": -36.7, "width": 38.10994519, "height": 41.1},
  "water_temple": {"x": -58.6, "y": -146.23545662, "width": 117.2, "height": 150.68545662, "overlay": {"x": 0, "y": -38, "scaleX": 0.74, "scaleY": 0.62}},
};
export function sceneryPropBounds(map: string, kind: string): SceneryPropBounds | null {
  return map === 'field' && art(`scenery/${map}/props/${kind}`) ? FIELD_PROP_BOUNDS[kind] ?? null : null;
}

/** A map material clipped by caller-owned geometry, with its repeat origin in world coordinates. */
export function sceneryMaterial(map: string, slot: string, width: number, height = width, x = 0, y = 0): FillStyle | undefined {
  const texture = art(`scenery/${map}/terrain/${slot}`);
  return texture ? { texture, textureSpace: 'global', matrix: new Matrix().scale(width / texture.width, height / texture.height).translate(x, y) } : undefined;
}
