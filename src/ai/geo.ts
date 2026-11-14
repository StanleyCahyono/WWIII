/**
 * Static geography analysis (public map data only), cached per MapData object.
 * Pure function of the map ⇒ caching never affects determinism.
 */
import type { CountryId, MapData, NodeId } from '../engine/data-types';
import type { Geography } from './types';

export interface Geo {
  n: number;
  /** Land + strait adjacency (ground movement in land mode). */
  land: NodeId[][];
  /** Sea/canal adjacency between sea zones. */
  sea: NodeId[][];
  /** Coast edges: land → adjacent sea zones and sea → adjacent coastal land. */
  coast: NodeId[][];
  isLand: Uint8Array;
  outside: Uint8Array;
  lon: Float64Array;
  lat: Float64Array;
  /** Homeland country per node (static). */
  homeland: (CountryId | null)[];
  cityByNode: Map<NodeId, { key: string; tier: number; capital: boolean; port: boolean; country: CountryId }>;
  countryGeo: Map<CountryId, Geography>;
  /** Fraction of homeland provinces off the main landmass (0..1). */
  offMain: Map<CountryId, number>;
  countryNodes: Map<CountryId, NodeId[]>;
  capitals: Map<CountryId, NodeId>;
  /** Static VP per node (province 1 + city tier+1 + capital 4). */
  vp: Float64Array;
}

const cache = new WeakMap<MapData, Geo>();

export function geoOf(map: MapData): Geo {
  const c = cache.get(map);
  if (c) return c;
  const g = build(map);
  cache.set(map, g);
  return g;
}

function build(map: MapData): Geo {
  const n = map.nodes.length;
  const land: NodeId[][] = Array.from({ length: n }, () => []);
  const sea: NodeId[][] = Array.from({ length: n }, () => []);
  const coast: NodeId[][] = Array.from({ length: n }, () => []);
  const isLand = new Uint8Array(n);
  const outside = new Uint8Array(n);
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const homeland: (CountryId | null)[] = new Array(n).fill(null);
  for (const nd of map.nodes) {
    isLand[nd.id] = nd.kind === 'land' ? 1 : 0;
    outside[nd.id] = nd.outside ? 1 : 0;
    lon[nd.id] = nd.center[0];
    lat[nd.id] = nd.center[1];
    homeland[nd.id] = nd.country ?? null;
  }
  for (const e of map.edges) {
    if (e.kind === 'land' || e.kind === 'strait') {
      if (outside[e.a] || outside[e.b]) continue;
      land[e.a].push(e.b);
      land[e.b].push(e.a);
    } else if (e.kind === 'sea' || e.kind === 'canal') {
      sea[e.a].push(e.b);
      sea[e.b].push(e.a);
    } else if (e.kind === 'coast') {
      coast[e.a].push(e.b);
      coast[e.b].push(e.a);
    }
  }
  for (const l of [land, sea, coast]) for (const a of l) a.sort((x, y) => x - y);
  const cityByNode = new Map<NodeId, { key: string; tier: number; capital: boolean; port: boolean; country: CountryId }>();
  const capitals = new Map<CountryId, NodeId>();
  const vp = new Float64Array(n);
  for (const nd of map.nodes) if (nd.kind === 'land' && !nd.outside) vp[nd.id] = 1;
  for (const ci of map.cities) {
    cityByNode.set(ci.node, { key: ci.key, tier: ci.tier, capital: ci.capital, port: ci.port, country: ci.country });
    vp[ci.node] += ci.tier + 1 + (ci.capital ? 4 : 0);
    if (ci.capital) capitals.set(ci.country, ci.node);
  }
  // landmass owners (by 'landmass' field when present, otherwise components over land edges)
  const lm = new Int32Array(n).fill(-1);
  let next = 0;
  for (const nd of map.nodes) {
    if (nd.kind !== 'land' || nd.outside) continue;
    if (nd.landmass !== undefined) lm[nd.id] = nd.landmass;
  }
  if (map.nodes.some((nd) => nd.kind === 'land' && !nd.outside && nd.landmass === undefined)) {
    lm.fill(-1);
    for (let s = 0; s < n; s++) {
      if (!isLand[s] || outside[s] || lm[s] >= 0) continue;
      const id = next++;
      const st = [s];
      lm[s] = id;
      while (st.length) {
        const x = st.pop() as number;
        for (const y of land[x]) if (lm[y] < 0) { lm[y] = id; st.push(y); }
      }
    }
  }
  const lmOwners = new Map<number, Set<CountryId>>();
  for (let i = 0; i < n; i++) {
    const h = homeland[i];
    if (!h || lm[i] < 0) continue;
    (lmOwners.get(lm[i]) ?? lmOwners.set(lm[i], new Set()).get(lm[i])!).add(h);
  }
  const countryNodes = new Map<CountryId, NodeId[]>();
  for (let i = 0; i < n; i++) {
    const h = homeland[i];
    if (h && isLand[i] && !outside[i]) (countryNodes.get(h) ?? countryNodes.set(h, []).get(h)!).push(i);
  }
  const countryGeo = new Map<CountryId, Geography>();
  const offMain = new Map<CountryId, number>();
  for (const mc of map.countries) {
    const nodes = countryNodes.get(mc.id) ?? [];
    const cnt = new Map<number, number>();
    for (const p of nodes) cnt.set(lm[p], (cnt.get(lm[p]) ?? 0) + 1);
    let main = -1, mainCount = 0;
    for (const [k, v] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) if (v > mainCount) { main = k; mainCount = v; }
    const off = nodes.length ? 1 - mainCount / nodes.length : 0;
    offMain.set(mc.id, off);
    const unshared = (lmOwners.get(main)?.size ?? 0) <= 1;
    const coastal = mc.coastal ?? nodes.some((p) => coast[p].length > 0);
    const landlocked = mc.landlocked ?? !coastal;
    countryGeo.set(mc.id, landlocked ? 'landlocked' : off >= 0.5 || unshared ? 'maritime' : 'coastal');
  }
  return { n, land, sea, coast, isLand, outside, lon, lat, homeland, cityByNode, countryGeo, offMain, countryNodes, capitals, vp };
}

const R = 6371;
export function km(g: Geo, a: NodeId, b: NodeId): number {
  const la1 = (g.lat[a] * Math.PI) / 180, la2 = (g.lat[b] * Math.PI) / 180;
  const dla = la2 - la1;
  const dlo = (((g.lon[b] - g.lon[a] + 540) % 360) - 180) * (Math.PI / 180);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function kmLL(a: [number, number], b: [number, number]): number {
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180;
  const dla = la2 - la1;
  const dlo = (((b[0] - a[0] + 540) % 360) - 180) * (Math.PI / 180);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Multi-source BFS over land adjacency with a hop limit. `pass(node)` decides whether a node can
 * be traversed (it is still reported when reached). Returns hop distances (−1 = unreached).
 */
export function landBfs(g: Geo, sources: NodeId[], maxHops: number, pass: (n: NodeId) => boolean, out?: Int16Array): Int16Array {
  const d = out ?? new Int16Array(g.n);
  d.fill(-1);
  let frontier: NodeId[] = [];
  for (const s of sources) if (d[s] < 0) { d[s] = 0; frontier.push(s); }
  for (let h = 1; h <= maxHops && frontier.length; h++) {
    const nx: NodeId[] = [];
    for (const x of frontier) {
      if (h > 1 && !pass(x)) continue;
      for (const y of g.land[x]) if (d[y] < 0) { d[y] = h; nx.push(y); }
    }
    frontier = nx;
  }
  return d;
}
