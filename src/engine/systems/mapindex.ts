/**
 * Static map graph index: adjacency arrays, coordinates, spatial bins, great-circle distance
 * and a generic A* with typed edge eligibility. Built once per MapData object (cached by the
 * scenario registry) — never depends on ownership or rights.
 */
import type { CityKey, MapData, MapEdge, NodeId, Terrain } from '../data-types';
import { PATH_MAX_EXPANSIONS, SPATIAL_BIN_DEG } from '../rules';

export interface MapIndex {
  data: MapData;
  n: number;
  edges: MapEdge[];
  /** node → incident edge indices (sorted by neighbour id for determinism) */
  adj: number[][];
  lon: Float64Array;
  lat: Float64Array;
  isLand: Uint8Array;
  outside: Uint8Array;
  coastal: Uint8Array;
  terrain: Terrain[];
  cityByNode: Map<NodeId, CityKey>;
  portNodes: Set<NodeId>;
  nodeBins: Map<number, NodeId[]>;
  /** Playable land node ids. */
  playable: NodeId[];
  /** Memo of rights-independent optimal paths (see movement.staticPath for the key). */
  staticCache: Map<string, PathResult | null>;
}

const R = 6371;
export function distKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  let dLon = lon2 - lon1;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  dLon *= toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function binKey(lon: number, lat: number): number {
  let l = lon;
  while (l < -180) l += 360;
  while (l >= 180) l -= 360;
  return (Math.floor(l / SPATIAL_BIN_DEG) + 500) * 1000 + (Math.floor(lat / SPATIAL_BIN_DEG) + 500);
}
/**
 * Fine spatial grid (acceleration structure only — results never depend on it) used by visibility
 * and combat target search: FINE_BIN_DEG cells, and an EXACT cover of a radius (every cell that can
 * hold a point within `km` great-circle distance, computed with distKm's Earth radius plus a small
 * margin). Fine cells keep sensor footprints tight, so a moving stack only invalidates the sensors
 * that can actually reach it.
 */
export const FINE_BIN_DEG = 1;
const VIS_BIN_DEG = FINE_BIN_DEG;
const EARTH_R = R;
const LON_CELLS = Math.round(360 / VIS_BIN_DEG);
export function fineBin(lon: number, lat: number): number {
  let l = lon;
  while (l < -180) l += 360;
  while (l >= 180) l -= 360;
  return (Math.floor((l + 180) / VIS_BIN_DEG) % LON_CELLS) * 1000 + Math.floor((lat + 90) / VIS_BIN_DEG);
}
const coverCache = new Map<number, Map<number, Map<number, number[]>>>();
let coverCacheSize = 0;
/** Sorted cell keys covering every point within `km` of (lon, lat). Memoized (pure). */
export function fineCover(lon: number, lat: number, km: number, memo = true): number[] {
  if (!memo) return coverRaw(lon, lat, km);
  let a = coverCache.get(km);
  if (!a) {
    a = new Map();
    coverCache.set(km, a);
  }
  let b = a.get(lon);
  if (!b) {
    if (coverCacheSize > 200000) {
      coverCache.clear();
      coverCacheSize = 0;
      a = new Map();
      coverCache.set(km, a);
    }
    b = new Map();
    a.set(lon, b);
  }
  let res = b.get(lat);
  if (!res) {
    res = coverRaw(lon, lat, km);
    b.set(lat, res);
    coverCacheSize++;
  }
  return res;
}
function coverRaw(lon: number, lat: number, km: number): number[] {
  const MARGIN = 1e-6; // degrees (floating-point safety)
  const delta = km / EARTH_R; // angular radius (rad)
  const dDeg = (delta * 180) / Math.PI + MARGIN;
  const latMin = Math.max(-90, lat - dDeg);
  const latMax = Math.min(90, lat + dDeg);
  const phi = (lat * Math.PI) / 180;
  let full = latMax >= 90 || latMin <= -90 || delta >= Math.PI / 2;
  let dLon = 180;
  if (!full) {
    const x = Math.sin(delta) / Math.cos(phi);
    if (x >= 1) full = true;
    else dLon = (Math.asin(x) * 180) / Math.PI + MARGIN;
  }
  if (dLon >= 180) full = true;
  const out: number[] = [];
  const la0 = Math.floor((latMin + 90) / VIS_BIN_DEG), la1 = Math.floor((latMax + 90) / VIS_BIN_DEG);
  let lo0: number, lo1: number;
  if (full) {
    lo0 = 0;
    lo1 = LON_CELLS - 1;
  } else {
    lo0 = Math.floor((lon - dLon + 180) / VIS_BIN_DEG);
    lo1 = Math.floor((lon + dLon + 180) / VIS_BIN_DEG);
    if (lo1 - lo0 >= LON_CELLS - 1) {
      lo0 = 0;
      lo1 = LON_CELLS - 1;
    }
  }
  // lo1 - lo0 < LON_CELLS here, so every (lon, lat) cell appears once
  let wrapped = false;
  for (let i = lo0; i <= lo1; i++) {
    const li = ((i % LON_CELLS) + LON_CELLS) % LON_CELLS;
    if (li !== i) wrapped = true;
    for (let j = la0; j <= la1; j++) out.push(li * 1000 + j);
  }
  return wrapped ? out.sort((x, y) => x - y) : out;
}

const aroundCache = new Map<number, Map<number, Map<number, number[]>>>();
/** All bin keys whose cells may contain points within `km` of (lon,lat). Memoized (pure). */
export function binsAround(lon: number, lat: number, km: number): number[] {
  let a = aroundCache.get(lon);
  if (!a) {
    if (aroundCache.size > 50000) aroundCache.clear();
    a = new Map();
    aroundCache.set(lon, a);
  }
  let b = a.get(lat);
  if (!b) {
    b = new Map();
    a.set(lat, b);
  }
  let res = b.get(km);
  if (!res) {
    res = binsAroundRaw(lon, lat, km);
    b.set(km, res);
  }
  return res;
}
function binsAroundRaw(lon: number, lat: number, km: number): number[] {
  const dLat = km / 111 + SPATIAL_BIN_DEG;
  const cos = Math.max(0.05, Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180));
  const dLon = Math.min(180, km / (111 * cos) + SPATIAL_BIN_DEG);
  const out = new Set<number>();
  const nLat = Math.ceil((2 * dLat) / SPATIAL_BIN_DEG);
  const nLon = Math.ceil((2 * dLon) / SPATIAL_BIN_DEG);
  for (let i = 0; i <= nLat; i++) {
    const la = Math.max(-90, Math.min(89.999, lat - dLat + i * SPATIAL_BIN_DEG));
    for (let j = 0; j <= nLon; j++) out.add(binKey(lon - dLon + j * SPATIAL_BIN_DEG, la));
  }
  return [...out];
}
/** Interpolate along a great circle (approximately linear in lon/lat for short hops, wrap-aware). */
export function lerpLonLat(a: [number, number], b: [number, number], t: number): [number, number] {
  let dl = b[0] - a[0];
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  let lon = a[0] + dl * t;
  if (lon >= 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lon, a[1] + (b[1] - a[1]) * t];
}

export function buildMapIndex(map: MapData): MapIndex {
  const n = map.nodes.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  map.edges.forEach((e, i) => {
    adj[e.a].push(i);
    adj[e.b].push(i);
  });
  for (let i = 0; i < n; i++) {
    adj[i].sort((x, y) => {
      const ox = map.edges[x].a === i ? map.edges[x].b : map.edges[x].a;
      const oy = map.edges[y].a === i ? map.edges[y].b : map.edges[y].a;
      return ox - oy || x - y;
    });
  }
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const isLand = new Uint8Array(n);
  const outside = new Uint8Array(n);
  const coastal = new Uint8Array(n);
  const terrain: Terrain[] = [];
  const nodeBins = new Map<number, NodeId[]>();
  const playable: NodeId[] = [];
  for (const nd of map.nodes) {
    lon[nd.id] = nd.center[0];
    lat[nd.id] = nd.center[1];
    isLand[nd.id] = nd.kind === 'land' ? 1 : 0;
    outside[nd.id] = nd.outside ? 1 : 0;
    coastal[nd.id] = nd.coastal ? 1 : 0;
    terrain[nd.id] = nd.terrain;
    const k = binKey(nd.center[0], nd.center[1]);
    const l = nodeBins.get(k) ?? [];
    l.push(nd.id);
    nodeBins.set(k, l);
    if (nd.kind === 'land' && !nd.outside && nd.country) playable.push(nd.id);
  }
  const cityByNode = new Map<NodeId, CityKey>();
  const portNodes = new Set<NodeId>();
  for (const c of map.cities) {
    cityByNode.set(c.node, c.key);
    if (c.port) portNodes.add(c.node);
  }
  return { data: map, n, edges: map.edges, adj, lon, lat, isLand, outside, coastal, terrain, cityByNode, portNodes, nodeBins, playable, staticCache: new Map() };
}

export function other(e: MapEdge, n: NodeId): NodeId {
  return e.a === n ? e.b : e.a;
}
export function nodeDist(m: MapIndex, a: NodeId, b: NodeId): number {
  return distKm(m.lon[a], m.lat[a], m.lon[b], m.lat[b]);
}
export function nodeLL(m: MapIndex, a: NodeId): [number, number] {
  return [m.lon[a], m.lat[a]];
}
export function edgeBetween(m: MapIndex, a: NodeId, b: NodeId): number {
  for (const ei of m.adj[a]) if (other(m.edges[ei], a) === b) return ei;
  return -1;
}
export function nodesWithin(m: MapIndex, lon: number, lat: number, km: number, filter?: (n: NodeId) => boolean): NodeId[] {
  const out: NodeId[] = [];
  for (const k of binsAround(lon, lat, km)) {
    const l = m.nodeBins.get(k);
    if (!l) continue;
    for (const id of l) if ((!filter || filter(id)) && distKm(lon, lat, m.lon[id], m.lat[id]) <= km) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

// ───────────────────────────── A* ─────────────────────────────

export interface StepCost {
  /** Cost in hours. */
  hours: number;
}
export type EdgeEval = (edgeIdx: number, from: NodeId, to: NodeId) => StepCost | null;

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] < key || (k[p] === key && v[p] <= val)) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop() as number, lv = v.pop() as number;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk, mv = lv;
        if (l < n && (k[l] < mk || (k[l] === mk && v[l] < mv))) { m = l; mk = k[l]; mv = v[l]; }
        if (r < n && (k[r] < mk || (k[r] === mk && v[r] < mv))) { m = r; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m];
        i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export interface PathResult {
  nodes: NodeId[];
  edges: number[];
  hours: number;
}

/**
 * A* from `from` to `to`. `heurKmh` is the maximum possible speed (admissible heuristic).
 * Deterministic: ties broken by node id via heap ordering.
 */
export function astar(m: MapIndex, from: NodeId, to: NodeId, evalEdge: EdgeEval, heurKmh: number): PathResult | null {
  if (from === to) return { nodes: [from], edges: [], hours: 0 };
  const g = new Map<number, number>();
  const prevEdge = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new Heap();
  const h = (n: number) => (heurKmh > 0 ? nodeDist(m, n, to) / heurKmh : 0);
  g.set(from, 0);
  heap.push(h(from), from);
  let expansions = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed.has(cur)) continue;
    if (cur === to) break;
    closed.add(cur);
    if (++expansions > PATH_MAX_EXPANSIONS) return null;
    const gc = g.get(cur) as number;
    for (const ei of m.adj[cur]) {
      const nb = other(m.edges[ei], cur);
      if (closed.has(nb)) continue;
      const c = evalEdge(ei, cur, nb);
      if (!c) continue;
      const ng = gc + c.hours;
      const og = g.get(nb);
      if (og === undefined || ng < og - 1e-12) {
        g.set(nb, ng);
        prevEdge.set(nb, ei);
        heap.push(ng + h(nb), nb);
      }
    }
  }
  if (!g.has(to) || !prevEdge.has(to)) return null;
  const nodes: NodeId[] = [to];
  const edges: number[] = [];
  let c = to;
  while (c !== from) {
    const ei = prevEdge.get(c) as number;
    edges.push(ei);
    c = other(m.edges[ei], c);
    nodes.push(c);
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, hours: g.get(to) as number };
}

/** Breadth-first hop distances from a set of sources (bounded). */
export function hopDistances(m: MapIndex, sources: NodeId[], maxHops: number, pass: (ei: number, from: NodeId, to: NodeId) => boolean): Map<NodeId, number> {
  const d = new Map<NodeId, number>();
  let frontier = [...sources].sort((a, b) => a - b);
  for (const s of frontier) d.set(s, 0);
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: NodeId[] = [];
    for (const cur of frontier) for (const ei of m.adj[cur]) {
      const nb = other(m.edges[ei], cur);
      if (d.has(nb) || !pass(ei, cur, nb)) continue;
      d.set(nb, hop);
      next.push(nb);
    }
    frontier = next;
  }
  return d;
}
