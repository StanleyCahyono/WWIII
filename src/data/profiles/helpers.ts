/** Small authoring helpers shared by the region files (owner: profiles agent). */
import type { OpeningDecision } from '../../engine/data-types';

export type Screen = 'research' | 'economy' | 'cities' | 'diplomacy' | 'forces' | 'market' | 'map';

/** Opening decision shorthand: D(id, screen, title, detail). */
export function D(id: string, screen: Screen, title: string, detail: string): OpeningDecision {
  return { id, title, detail, screen };
}
