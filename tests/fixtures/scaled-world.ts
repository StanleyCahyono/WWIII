/**
 * TEST-ONLY synthetic world for scale/starvation/benchmark tests: 120 countries on a 48×30 grid
 * (1,440 land provinces, 12 per country) ringed by sea zones, 240 cities and ~2,000 stacks.
 */
import type { CityDef, CountryProfile, MapCountryDef, MapData, MapEdge, MapNode, Terrain } from '../../src/engine/data-types';
import type { Scenario } from '../../src/engine/scenario/types';
import { distKm } from '../../src/engine/systems/mapindex';
import { MINI_CATALOG } from './mini-catalog';

const W = 48, H = 30, BW = 4, BH = 3;
const TER: Terrain[] = ['open', 'forest', 'mountains', 'urban', 'desert', 'suburban', 'jungle', 'tundra'];

export function buildScaledScenario(): Scenario {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const cid = (bx: number, by: number) => `C${String(by * (W / BW) + bx).padStart(3, '0')}`;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = y * W + x;
    const c = cid(Math.floor(x / BW), Math.floor(y / BH));
    nodes.push({ id, key: `p:${c}:${id}`, kind: 'land', name: `${c}-${id}`, country: c, terrain: TER[(x * 5 + y * 3) % TER.length], center: [-168 + x * 7, -58 + y * 4], coastal: false, deposit: (x * 7 + y) % 5 === 0 ? 'fuel' : null, population: 150, areaKm2: 50000, shape: id, landmass: 1 });
  }
  const add = (a: number, b: number, kind: MapEdge['kind']) => edges.push({ a, b, kind, km: Math.round(distKm(nodes[a].center[0], nodes[a].center[1], nodes[b].center[0], nodes[b].center[1])) });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = y * W + x;
    if (x < W - 1) add(id, id + 1, 'land');
    if (y < H - 1) add(id, id + W, 'land');
  }
  // sea ring: one zone per 4 border cells
  const seaIds: number[] = [];
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x);
  for (let y = 1; y < H; y++) border.push(y * W + W - 1);
  for (let x = W - 2; x >= 0; x--) border.push((H - 1) * W + x);
  for (let y = H - 2; y >= 1; y--) border.push(y * W);
  for (let i = 0; i < border.length; i += 4) {
    const id = nodes.length;
    const anchor = nodes[border[i]].center;
    nodes.push({ id, key: `s:${id}`, kind: 'sea', name: `Sea ${id}`, country: null, terrain: 'high_seas', center: [anchor[0] + (anchor[0] < 0 ? -3 : 3), anchor[1] + (anchor[1] < 0 ? -2 : 2)], coastal: false, deposit: null, population: 0, areaKm2: 1e6, shape: id, basin: 1 });
    for (let k = i; k < Math.min(i + 4, border.length); k++) {
      add(border[k], id, 'coast');
      nodes[border[k]].coastal = true;
    }
    if (seaIds.length) add(seaIds[seaIds.length - 1], id, 'sea');
    seaIds.push(id);
  }
  add(seaIds[seaIds.length - 1], seaIds[0], 'sea');
  const cities: CityDef[] = [];
  const countries: MapCountryDef[] = [];
  const profiles: Record<string, CountryProfile> = {};
  for (let by = 0; by < H / BH; by++) for (let bx = 0; bx < W / BW; bx++) {
    const c = cid(bx, by);
    const cells: number[] = [];
    for (let y = by * BH; y < by * BH + BH; y++) for (let x = bx * BW; x < bx * BW + BW; x++) cells.push(y * W + x);
    const coastalCell = cells.find((n) => nodes[n].coastal);
    const capNode = coastalCell ?? cells[5];
    const secNode = cells.find((n) => n !== capNode && n !== cells[5]) ?? cells[0];
    const cap: CityDef = { key: `${c}-cap`, name: `${c} Capital`, country: c, lonlat: nodes[capNode].center, node: capNode, population: 1000, capital: true, port: !!coastalCell, tier: 3 };
    const sec: CityDef = { key: `${c}-sec`, name: `${c} Second`, country: c, lonlat: nodes[secNode].center, node: secNode, population: 400, capital: false, port: nodes[secNode].coastal, tier: ((bx + by) % 2) + 1 as 1 | 2 };
    cities.push(cap, sec);
    nodes[capNode].city = cap.key;
    nodes[secNode].city = sec.key;
    countries.push({ id: c, name: `Country ${c}`, region: 'Europe', capital: cap.key, provinces: cells, landNeighbors: [], coastal: !!coastalCell, landlocked: !coastalCell, labelAt: nodes[cells[0]].center });
    const forces: CountryProfile['forces'] = [];
    const mk = (unit: string, at: string, n: number) => forces.push({ unit, count: n, at, readiness: 90 });
    for (let i = 0; i < 6; i++) mk('inf', cap.key, 2);
    for (let i = 0; i < 4; i++) mk('inf', sec.key, 1);
    mk('tank', cap.key, 2);
    mk('tank', sec.key, 1);
    mk('arty', cap.key, 1);
    mk('scout', sec.key, 1);
    mk('fighter', cap.key, 2);
    if (coastalCell) mk('frigate', cap.key, 1);
    else mk('sam', cap.key, 1);
    mk('sam', sec.key, 1);
    profiles[c] = {
      id: c,
      name: `Country ${c}`,
      region: 'Europe',
      doctrine: (['western', 'eastern', 'european'] as const)[(bx + by) % 3],
      template: 'scaled',
      startDifficulty: 'moderate',
      summary: 'scaled test country',
      cities: [cap, sec].map((x) => ({ city: x.key, functions: [], buildings: x.capital ? [{ type: 'barracks', level: 1 }] : [], output: { supplies: 60 * x.tier, components: 30 * x.tier, electronics: 10 * x.tier, fuel: 25 * x.tier, rare: 5 * x.tier, manpower: 15 * x.tier, money: 150 * x.tier } })),
      stockpile: { supplies: 3000, components: 1500, electronics: 800, fuel: 1500, rare: 300, manpower: 1500, money: 8000 },
      forces,
      techs: [],
      lift: 1,
      maintenanceSlots: 1,
      tradeNeeds: [],
      openingDecisions: [],
      personality: { aggression: ((bx * 7 + by * 3) % 10) / 10, caution: 0.5, trade: 0.5, loyalty: 0.5, expansion: 0.5, research: 0.5 },
    };
  }
  const map: MapData = {
    version: 'scaled-1',
    provenance: { source: 'synthetic', license: 'n/a', acquired: '2026-11-14', notes: 'test only' },
    nodes,
    edges,
    cities,
    countries,
    disputed: [],
    stats: { landProvinces: W * H, seaZones: seaIds.length, outsideNodes: 0, cities: cities.length },
  };
  return { id: 'scaled-fixture', version: 'scaled-1', name: 'Scaled Fixture (test only)', map, catalog: MINI_CATALOG, profiles, seats: countries.map((c) => c.id), startDate: '2031-04-01', testOnly: true };
}

let cached: Scenario | null = null;
export function scaledScenario(): Scenario {
  return (cached ??= buildScaledScenario());
}
