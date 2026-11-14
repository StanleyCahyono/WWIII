/** Static, public scenario data for the UI thread (map index, catalog, manifest). */
import { getMapIndex } from '../../data/map-index';
import { CATALOG, unitById, buildingById, techById, resourceById, missileById } from '../../data/catalog/index';
import { MANIFEST, REGION_ORDER, manifestById } from '../../data/countries';
import type { MapGeometry, MapNode, CityDef, Resource } from '../../engine/data-types';
import { RESOURCES } from '../../engine/data-types';

export const MAP = getMapIndex();
export const NODES: readonly MapNode[] = MAP.data.nodes;
export const CITIES: readonly CityDef[] = MAP.data.cities;
export { CATALOG, unitById, buildingById, techById, resourceById, missileById, MANIFEST, REGION_ORDER, manifestById, RESOURCES };

export const cityByNode = new Map<number, CityDef>();
for (const c of CITIES) if (!cityByNode.has(c.node) || c.capital) cityByNode.set(c.node, c);

export function countryName(id: string | null | undefined): string {
  if (!id) return 'Unowned';
  return manifestById.get(id)?.name ?? MAP.countryById.get(id)?.name ?? id;
}

export function nodeName(n: number | null | undefined): string {
  if (n === null || n === undefined || n < 0) return '—';
  const node = NODES[n];
  if (!node) return `#${n}`;
  const c = cityByNode.get(n);
  return c ? `${c.name} (${node.name})` : node.name;
}

export function placeName(n: number | null | undefined): string {
  if (n === null || n === undefined || n < 0) return '—';
  const c = cityByNode.get(n);
  return c ? c.name : NODES[n]?.name ?? `#${n}`;
}

export const RESOURCE_LABEL: Record<Resource, string> = {
  supplies: 'Supplies',
  components: 'Components',
  electronics: 'Electronics',
  fuel: 'Fuel',
  rare: 'Rare materials',
  manpower: 'Manpower',
  money: 'Money',
};
export const RESOURCE_SHORT: Record<Resource, string> = {
  supplies: 'SUP',
  components: 'CMP',
  electronics: 'ELC',
  fuel: 'FUL',
  rare: 'RAR',
  manpower: 'MAN',
  money: 'MNY',
};

export const TERRAIN_LABEL: Record<string, string> = {
  open: 'Open ground',
  mountains: 'Mountains',
  forest: 'Forest',
  urban: 'Urban',
  suburban: 'Suburban',
  jungle: 'Jungle',
  tundra: 'Tundra',
  desert: 'Desert',
  high_seas: 'High seas',
  coastal_waters: 'Coastal waters',
};

export const REGION_COUNTS: Record<string, number> = (() => {
  const r: Record<string, number> = {};
  for (const m of MANIFEST) r[m.region] = (r[m.region] ?? 0) + 1;
  return r;
})();

let geomP: Promise<MapGeometry> | null = null;
export function loadGeometry(): Promise<MapGeometry> {
  if (!geomP) geomP = import('../../data/generated/geometry.json').then((m) => (m.default ?? m) as unknown as MapGeometry);
  return geomP;
}

export const APP_VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.1.0';
