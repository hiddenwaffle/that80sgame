import type { Content } from '../content/content.ts';
import { LOOK, type LookPart } from '../render/look.ts';
import { CHAPTER_PICTURE } from './pictures.ts';
import { ISO_SCENE_ART } from './iso_scene_art.ts';
import { lookSlotPrefix } from './ghostTints.ts';

export type ArtChapter = 'arcade' | 'border' | 'field' | 'berlin';
export const ART_CHAPTERS: readonly ArtChapter[] = ['arcade', 'border', 'field', 'berlin'];
export function artChapter(map: string): ArtChapter { return map === 'border' || map === 'field' || map === 'berlin' ? map : 'arcade'; }

/** Selected slots only: look overrides and format selection have already been resolved by the loader. */
export function artGroups(content: Content, available: readonly string[]): Map<string, string[]> {
  const slots = new Set(available);
  const groups = new Map<string, Set<string>>();
  const add = (group: string, ...names: string[]) => {
    const set = groups.get(group) ?? new Set<string>(); groups.set(group,set);
    names.filter(n => slots.has(n)).forEach(n => set.add(n));
  };
  const look = (group: string, name: string) => {
    const body=name==='worker'||name.startsWith('german_')?'german':name;
    // A ghost in its own colour uses its painted shape's tintable layers (src/art/ghostTints.ts).
    add(group,...available.filter(s=>s.startsWith(lookSlotPrefix(body))||s===`portraits/${body}`));
  };
  // The game-over and chapter pages draw their pictures as scenes (src/world/scene_pictures.ts), so they wait for no file.
  add('defeat');
  add('rescue');
  for (const group of ART_CHAPTERS) {
    add(group);
    // All party members can appear in opening scenes, menus and battles, including their downed portraits.
    Object.values(content.party.members).forEach(m => look(group,m.look));
  }
  for (const map of content.maps.values()) {
    const group = artChapter(map.id);
    // Static map materials are indirect dependencies, just like the terrain's graffiti.
    add(group, ...available.filter(slot => slot.startsWith(`scenery/${map.id}/`)));
    for (const o of map.objects) {
      if (typeof o.props.sketch === 'string' && !LOOK.has(o.props.sketch as LookPart)) continue;
      if (o.type === 'npc') look(group,String(o.props.look));
      if (o.type === 'enemy') {
        const name=content.enemies[String(o.props.kind)]?.look;
        if (name) look(group,name);
      }
      // A palm the plants replace is drawn from the map's own pictures, which come with its scenery above.
      if (o.type === 'prop') add(group,`props/${String(o.props.kind)}`);
    }
    // Terrain overlays and battle damage variants are not separate map objects.
    if (group==='berlin') add(group,'scenery/border/terrain/bridge');
  }
  // An isometric picture draws its figures and props from their art, so the group its page comes with waits for them.
  for (const need of Object.values(ISO_SCENE_ART)) {
    need.looks.forEach(l => look(need.group, l));
    add(need.group, ...need.slots);
  }
  // Late illustrations are deliberately absent from startup. This includes the retired pictures in the credits.
  // A picture drawn as a scene needs no file of its own (the six files the drawn pages replaced were removed on 11 Nov).
  const earlyPictures=new Set([...Object.values(CHAPTER_PICTURE),...Object.keys(ISO_SCENE_ART)].map(n=>`pictures/${n}`));
  add('ending',...available.filter(s=>s.startsWith('pictures/')&&!earlyPictures.has(s)));
  // A selected slot no group asks for still comes, last, so new art is fetched before it has a group; a test holds this empty.
  const assigned=new Set([...groups.values()].flatMap(s=>[...s]));
  add('extras',...available.filter(s=>!assigned.has(s)));
  return new Map([...groups].map(([name,set])=>[name,[...set]]));
}

/** Neighbouring chapters first, with explicit loss paths ahead of distant art. */
export function nearbyArt(map: string): string[] {
  const at=ART_CHAPTERS.indexOf(artChapter(map));
  const near=ART_CHAPTERS.filter((_,i)=>i!==at).sort((a,b)=> {
    const ai=ART_CHAPTERS.indexOf(a),bi=ART_CHAPTERS.indexOf(b);
    return Math.abs(ai-at)-Math.abs(bi-at) || bi-ai;
  });
  return [...new Set(['defeat',...(map==='berlin'?['rescue','field']:[]),...near,'rescue','ending','extras'])];
}
