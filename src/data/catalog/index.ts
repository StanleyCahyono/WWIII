/**
 * Catalog entry point — World Command: World 120.
 *
 * Dependency-free apart from the static data contract (no milsymbol here; rendering lives in
 * ./symbol-render.ts) so the engine and its Web Worker can import the catalog cheaply.
 */
import type {
  BuildingType,
  BuildingTypeId,
  MissileType,
  MissileTypeId,
  Resource,
  ResourceDef,
  SymbolCrosswalkEntry,
  SymbolEntityKey,
  TechId,
  TechNode,
  UnitType,
  UnitTypeId,
} from '../../engine/data-types';
import { BUILDING_TYPES } from './buildings';
import { MISSILE_TYPES } from './missiles';
import { RESOURCE_DEFS } from './resources';
import { SYMBOL_CROSSWALK } from './sidc';
import { TECH_NODES } from './tech';
import { UNIT_TYPES } from './units';

export const CATALOG_VERSION = '2026-11-14.1';

export const CATALOG = {
  version: CATALOG_VERSION,
  resources: RESOURCE_DEFS,
  units: UNIT_TYPES,
  buildings: BUILDING_TYPES,
  techs: TECH_NODES,
  missiles: MISSILE_TYPES,
  symbols: SYMBOL_CROSSWALK,
} as const;

function byId<T extends { id: string }>(xs: readonly T[]): ReadonlyMap<string, T> {
  return new Map(xs.map((x) => [x.id, x]));
}

export const resourceById: ReadonlyMap<Resource, ResourceDef> = byId(RESOURCE_DEFS) as ReadonlyMap<Resource, ResourceDef>;
export const unitById: ReadonlyMap<UnitTypeId, UnitType> = byId(UNIT_TYPES);
export const buildingById: ReadonlyMap<BuildingTypeId, BuildingType> = byId(BUILDING_TYPES);
export const techById: ReadonlyMap<TechId, TechNode> = byId(TECH_NODES);
export const missileById: ReadonlyMap<MissileTypeId, MissileType> = byId(MISSILE_TYPES);
export const symbolByKey: ReadonlyMap<SymbolEntityKey, SymbolCrosswalkEntry> = new Map(SYMBOL_CROSSWALK.map((s) => [s.key, s]));

/** Units whose blueprint a tech unlocks, and units a tech upgrades (reverse indexes for the research screen). */
export const unitsUnlockedBy: ReadonlyMap<TechId, UnitTypeId[]> = (() => {
  const m = new Map<TechId, UnitTypeId[]>();
  for (const u of UNIT_TYPES) if (u.unlockTech) m.set(u.unlockTech, [...(m.get(u.unlockTech) ?? []), u.id]);
  return m;
})();

/** Starter blueprints (unlockTech null) available to every country from day 1. */
export const STARTER_UNITS: UnitTypeId[] = UNIT_TYPES.filter((u) => u.unlockTech === null).map((u) => u.id);

export * from './resources';
export * from './units';
export * from './buildings';
export * from './tech';
export * from './missiles';
export * from './sidc';
