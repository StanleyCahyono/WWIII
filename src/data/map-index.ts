/**
 * Typed, dependency-free access to the generated World 120 map (src/data/generated/map.json).
 * Usable from the engine (Node and Web Worker) and from the UI. Geometry (polygons) lives in
 * src/data/generated/geometry.json and is NOT imported here, so the engine never loads it.
 *
 * Owner: map agent. Regenerate the data with `npm run map:build`.
 */
import type { CityDef, CityKey, CountryId, EdgeKind, MapCountryDef, MapData, MapEdge, MapNode, NodeId } from '../engine/data-types';
import mapJson from './generated/map.json';

/** The static map data (shared instance — treat as read-only). */
export function loadMapData(): MapData {
  return mapJson as unknown as MapData;
}

export interface Neighbour {
  /** Node on the other end of the edge. */
  node: NodeId;
  /** Index into MapData.edges. */
  edge: number;
  kind: EdgeKind;
  km: number;
}

export interface MapIndex {
  data: MapData;
  nodeByKey: ReadonlyMap<string, MapNode>;
  cityByKey: ReadonlyMap<CityKey, CityDef>;
  countryById: ReadonlyMap<CountryId, MapCountryDef>;
  /** Cities anchored to each node (index = NodeId). */
  citiesByNode: readonly (readonly CityDef[])[];
  /** Adjacency list (index = NodeId), sorted by neighbour id then edge kind for determinism. */
  adjacency: readonly (readonly Neighbour[])[];
}

/** Build lookup tables for a MapData (pure; does not mutate the data). */
export function buildMapIndex(data: MapData = loadMapData()): MapIndex {
  const nodeByKey = new Map<string, MapNode>();
  for (const n of data.nodes) nodeByKey.set(n.key, n);
  const cityByKey = new Map<CityKey, CityDef>();
  const citiesByNode: CityDef[][] = data.nodes.map(() => []);
  for (const c of data.cities) {
    cityByKey.set(c.key, c);
    citiesByNode[c.node]?.push(c);
  }
  const countryById = new Map<CountryId, MapCountryDef>();
  for (const c of data.countries) countryById.set(c.id, c);
  const adjacency: Neighbour[][] = data.nodes.map(() => []);
  data.edges.forEach((e: MapEdge, i: number) => {
    adjacency[e.a].push({ node: e.b, edge: i, kind: e.kind, km: e.km });
    adjacency[e.b].push({ node: e.a, edge: i, kind: e.kind, km: e.km });
  });
  for (const list of adjacency) list.sort((x, y) => x.node - y.node || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
  return { data, nodeByKey, cityByKey, countryById, citiesByNode, adjacency };
}

let cached: MapIndex | null = null;

/** Lazily built shared index over the bundled map. */
export function getMapIndex(): MapIndex {
  if (!cached) cached = buildMapIndex();
  return cached;
}

export function nodeByKey(key: string, index: MapIndex = getMapIndex()): MapNode | undefined {
  return index.nodeByKey.get(key);
}

export function cityByKey(key: CityKey, index: MapIndex = getMapIndex()): CityDef | undefined {
  return index.cityByKey.get(key);
}

/** Neighbouring node ids, optionally restricted to some edge kinds. */
export function neighbours(id: NodeId, kinds?: readonly EdgeKind[], index: MapIndex = getMapIndex()): NodeId[] {
  const out: NodeId[] = [];
  for (const n of index.adjacency[id] ?? []) if (!kinds || kinds.includes(n.kind)) out.push(n.node);
  return out;
}

/** Land provinces (homeland) of a country. */
export function provincesOf(country: CountryId, index: MapIndex = getMapIndex()): NodeId[] {
  return index.countryById.get(country)?.provinces.slice() ?? [];
}
