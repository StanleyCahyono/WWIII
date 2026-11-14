/**
 * Scenario registry + derived static indexes (catalog lookups, map graph). Static data is
 * never stored in the save; the state references it by `scenarioId`/`scenarioVersion`.
 * Caches are keyed by the scenario object, so they are safe in a Web Worker and in Node.
 */
import type { BuildingType, MissileType, NodeId, TechNode, UnitType, UnitLevelStats, CountryId } from '../data-types';
import type { GameState } from '../state';
import type { Scenario } from './types';
import { buildMapIndex, type MapIndex } from '../systems/mapindex';

const registry = new Map<string, Scenario>();

export function registerScenario(s: Scenario): void {
  registry.set(s.id, s);
}
export function getScenarioById(id: string): Scenario | undefined {
  return registry.get(id);
}
export function scenarioOf(state: GameState): Scenario {
  const s = registry.get(state.scenarioId);
  if (!s) throw new Error(`Scenario "${state.scenarioId}" is not registered. Call registerScenario() before using this state.`);
  return s;
}

export interface CatalogIndex {
  units: Map<string, UnitType>;
  buildings: Map<string, BuildingType>;
  techs: Map<string, TechNode>;
  missiles: Map<string, MissileType>;
  /** tech id → techs that list it as a prerequisite */
  techChildren: Map<string, string[]>;
  prices: Record<string, number>;
}

export interface Static {
  scenario: Scenario;
  cat: CatalogIndex;
  map: MapIndex;
  /** country → land node ids it owns at start (homeland). */
  homeland: Map<CountryId, NodeId[]>;
}

const statics = new WeakMap<Scenario, Static>();

export function getStatic(s: Scenario): Static {
  let st = statics.get(s);
  if (st) return st;
  const c = s.catalog;
  const techChildren = new Map<string, string[]>();
  for (const t of c.techs) for (const p of t.prereqs) {
    const l = techChildren.get(p) ?? [];
    l.push(t.id);
    techChildren.set(p, l);
  }
  const prices: Record<string, number> = {};
  for (const r of c.resources) prices[r.id] = r.referencePrice;
  const homeland = new Map<CountryId, NodeId[]>();
  for (const n of s.map.nodes) {
    if (n.kind === 'land' && !n.outside && n.country) {
      const l = homeland.get(n.country) ?? [];
      l.push(n.id);
      homeland.set(n.country, l);
    }
  }
  st = {
    scenario: s,
    cat: {
      units: new Map(c.units.map((u) => [u.id, u])),
      buildings: new Map(c.buildings.map((b) => [b.id, b])),
      techs: new Map(c.techs.map((t) => [t.id, t])),
      missiles: new Map(c.missiles.map((m) => [m.id, m])),
      techChildren,
      prices,
    },
    map: buildMapIndex(s.map),
    homeland,
  };
  statics.set(s, st);
  return st;
}

export function S(state: GameState): Static {
  return getStatic(scenarioOf(state));
}

export function unitStats(t: UnitType, level: number): UnitLevelStats {
  let best = t.levels[0];
  for (const l of t.levels) if (l.level <= level && l.level >= best.level) best = l;
  return best;
}
export function maxLevel(t: UnitType): number {
  return t.levels.reduce((m, l) => Math.max(m, l.level), 1);
}
