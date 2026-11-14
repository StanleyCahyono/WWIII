/**
 * TEST-ONLY mini world (never offered in the product).
 *
 *   Continent grid 6×5 (node id = y*6 + x; lon = 2x, lat = 10 − 2y):
 *        x: 0    1    2    3    4    5
 *   y=0   ARD  BOR  BOR  BOR* ESK  ESK      * node 3 controls the Borvian Canal (S_NW ↔ S_NE)
 *   y=1   ARD  BOR  BOR  BOR  ESK  ESK
 *   y=2   ARD  ARD  BOR  BOR  FAL  FAL
 *   y=3   ARD  ARD  DUN  DUN  FAL  FAL      DUN = landlocked
 *   y=4   ARD  ARD  DUN  OUT  FAL  FAL      OUT = outside-campaign land (node 27)
 *   Island CEL (38–41) south, linked to FAL node 28 by the Falen Strait (via 28).
 *   Esk Isle (42, ESK) far north (sea access only). Outside islet 43.
 *   Sea zones 30–37.
 */
import type { CityDef, CountryProfile, MapCountryDef, MapData, MapEdge, MapNode, Terrain } from '../../src/engine/data-types';
import type { Scenario } from '../../src/engine/scenario/types';
import { createCampaign } from '../../src/engine/scenario/create';
import { distKm } from '../../src/engine/systems/mapindex';
import type { Difficulty, GameState } from '../../src/engine/state';
import { MINI_CATALOG } from './mini-catalog';

const GRID_OWNER: (string | null)[][] = [
  ['ARD', 'BOR', 'BOR', 'BOR', 'ESK', 'ESK'],
  ['ARD', 'BOR', 'BOR', 'BOR', 'ESK', 'ESK'],
  ['ARD', 'ARD', 'BOR', 'BOR', 'FAL', 'FAL'],
  ['ARD', 'ARD', 'DUN', 'DUN', 'FAL', 'FAL'],
  ['ARD', 'ARD', 'DUN', null, 'FAL', 'FAL'],
];
const TERRAIN: Terrain[] = ['open', 'forest', 'mountains', 'open', 'urban', 'desert', 'suburban', 'open', 'jungle', 'tundra'];

export const N = {
  ardCapital: 12,
  ardWestport: 24,
  borCapital: 8,
  borCanal: 3,
  dunCapital: 20,
  dunLow: 26,
  outside: 27,
  eskCapital: 5,
  falCapital: 23,
  falStrand: 28,
  celCapital: 38,
  celEast: 39,
  celSouth: 40,
  celSE: 41,
  eskIsle: 42,
  outsideIslet: 43,
  S_W: 30,
  S_NW: 31,
  S_NE: 32,
  S_E: 33,
  S_SW: 34,
  S_SE: 35,
  S_ISL: 36,
  S_FAR: 37,
} as const;

export function buildMiniMap(): MapData {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const coastalSet = new Set<number>();
  const addEdge = (a: number, b: number, kind: MapEdge['kind'], extra: Partial<MapEdge> = {}) => {
    const na = nodes[a], nb = nodes[b];
    edges.push({ a, b, kind, km: Math.round(distKm(na.center[0], na.center[1], nb.center[0], nb.center[1])), ...extra });
    if (kind === 'coast') coastalSet.add(nodes[a].kind === 'land' ? a : b);
  };
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
    const id = y * 6 + x;
    const owner = GRID_OWNER[y][x];
    nodes.push({
      id,
      key: owner ? `p:${owner}:${id}` : 'x:OUT:0',
      kind: 'land',
      name: owner ? `${owner} Province ${id}` : 'Outer Marches',
      country: owner,
      outside: owner ? undefined : true,
      territory: owner ? undefined : { code: 'OUT', name: 'Outer Marches', status: 'outside_campaign' },
      terrain: TERRAIN[(x * 3 + y * 7) % TERRAIN.length],
      center: [2 * x, 10 - 2 * y],
      coastal: false,
      deposit: (x + y) % 3 === 0 ? (['fuel', 'rare', 'components', 'electronics'] as const)[(x + 2 * y) % 4] : null,
      population: 200,
      areaKm2: 40000,
      shape: id,
      landmass: 1,
    });
  }
  const sea = (id: number, name: string, lon: number, lat: number) => nodes.push({ id, key: `s:${id}`, kind: 'sea', name, country: null, terrain: 'high_seas', center: [lon, lat], coastal: false, deposit: null, population: 0, areaKm2: 200000, shape: id, basin: 1 });
  sea(30, 'West Sea', -2.5, 6);
  sea(31, 'North-West Sea', 2, 12.5);
  sea(32, 'North-East Sea', 9, 12.5);
  sea(33, 'East Sea', 12.5, 6);
  sea(34, 'South-West Sea', 1, -2);
  sea(35, 'South-East Sea', 10, -2);
  sea(36, 'Island Sea', 5, -9);
  sea(37, 'Far North Sea', 11, 16.5);
  const land = (id: number, owner: string | null, name: string, lon: number, lat: number, terrain: Terrain, landmass: number) =>
    nodes.push({ id, key: owner ? `p:${owner}:${id}` : 'x:OUT:1', kind: 'land', name, country: owner, outside: owner ? undefined : true, territory: owner ? undefined : { code: 'OUT', name: 'Outer Islet', status: 'outside_campaign' }, terrain, center: [lon, lat], coastal: false, deposit: id === 41 ? 'rare' : null, population: 150, areaKm2: 30000, shape: id, landmass });
  land(38, 'CEL', 'Celesta Heights', 4, -4, 'urban', 2);
  land(39, 'CEL', 'East Celesta', 6, -4, 'forest', 2);
  land(40, 'CEL', 'South Celesta', 4, -6.5, 'open', 2);
  land(41, 'CEL', 'Celesta Cape', 6, -6.5, 'jungle', 2);
  land(42, 'ESK', 'Esk Isle', 11, 15, 'tundra', 3);
  land(43, null, 'Outer Islet', -1, -6, 'open', 4);
  // land grid edges
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
    const id = y * 6 + x;
    if (x < 5) addEdge(id, id + 1, 'land');
    if (y < 4) addEdge(id, id + 6, 'land');
  }
  // island
  addEdge(38, 39, 'land');
  addEdge(38, 40, 'land');
  addEdge(39, 41, 'land');
  addEdge(40, 41, 'land');
  // coasts
  for (const id of [0, 6, 12, 18, 24]) addEdge(id, 30, 'coast');
  for (const id of [0, 1, 2]) addEdge(id, 31, 'coast');
  for (const id of [3, 4, 5]) addEdge(id, 32, 'coast');
  for (const id of [5, 11, 17, 23, 29]) addEdge(id, 33, 'coast');
  for (const id of [24, 25]) addEdge(id, 34, 'coast');
  for (const id of [28, 29]) addEdge(id, 35, 'coast');
  for (const id of [38, 39, 40, 41]) addEdge(id, 36, 'coast');
  addEdge(38, 34, 'coast');
  addEdge(39, 35, 'coast');
  addEdge(42, 37, 'coast');
  addEdge(43, 34, 'coast');
  // sea lanes
  addEdge(30, 31, 'sea');
  addEdge(30, 34, 'sea');
  addEdge(32, 33, 'sea');
  addEdge(33, 35, 'sea');
  addEdge(34, 36, 'sea');
  addEdge(35, 36, 'sea');
  addEdge(32, 37, 'sea');
  addEdge(31, 32, 'canal', { via: 3, label: 'Borvian Canal' });
  addEdge(28, 39, 'strait', { via: 28, label: 'Falen Strait' });
  for (const n of nodes) if (coastalSet.has(n.id)) n.coastal = true;

  const city = (key: string, name: string, country: string, node: number, tier: 1 | 2 | 3 | 4 | 5, capital: boolean, port: boolean, population: number): CityDef => ({ key, name, country, lonlat: nodes[node].center, node, population, capital, port, tier });
  const cities: CityDef[] = [
    city('ARD-ardena', 'Ardena', 'ARD', 12, 3, true, true, 3000),
    city('ARD-westport', 'Westport', 'ARD', 24, 2, false, true, 800),
    city('BOR-borgrad', 'Borgrad', 'BOR', 8, 3, true, false, 1500),
    city('BOR-canalport', 'Canalport', 'BOR', 3, 2, false, true, 600),
    city('DUN-dunholm', 'Dunholm', 'DUN', 20, 2, true, false, 700),
    city('DUN-lowmere', 'Lowmere', 'DUN', 26, 1, false, false, 200),
    city('ESK-eskar', 'Eskar', 'ESK', 5, 3, true, true, 1200),
    city('ESK-isle', 'Isleport', 'ESK', 42, 1, false, true, 100),
    city('FAL-falen', 'Falen', 'FAL', 23, 3, true, true, 1300),
    city('FAL-strand', 'Strand', 'FAL', 28, 2, false, true, 500),
    city('CEL-celesta', 'Celesta', 'CEL', 38, 3, true, true, 1400),
    city('CEL-southbay', 'Southbay', 'CEL', 40, 1, false, true, 200),
  ];
  for (const c of cities) nodes[c.node].city = c.key;
  const ids = ['ARD', 'BOR', 'CEL', 'DUN', 'ESK', 'FAL'];
  const names: Record<string, string> = { ARD: 'Ardenia', BOR: 'Borvia', CEL: 'Celesta', DUN: 'Dunmark', ESK: 'Eskland', FAL: 'Falenia' };
  const countries: MapCountryDef[] = ids.map((id) => {
    const provinces = nodes.filter((n) => n.country === id).map((n) => n.id);
    const nb = new Set<string>();
    for (const e of edges) {
      if (e.kind !== 'land' && e.kind !== 'strait') continue;
      const ca = nodes[e.a].country, cb = nodes[e.b].country;
      if (ca === id && cb && cb !== id) nb.add(cb);
      if (cb === id && ca && ca !== id) nb.add(ca);
    }
    const coastal = provinces.some((p) => nodes[p].coastal);
    return { id, name: names[id], region: 'Europe', capital: cities.find((c) => c.country === id && c.capital)!.key, provinces, landNeighbors: [...nb].sort(), coastal, landlocked: !coastal, labelAt: nodes[provinces[0]].center };
  });
  return {
    version: 'mini-map-1',
    provenance: { source: 'test fixture', license: 'n/a', acquired: '2026-11-14', notes: 'Synthetic test-only geography.' },
    nodes,
    edges,
    cities,
    countries,
    disputed: [],
    stats: { landProvinces: nodes.filter((n) => n.kind === 'land' && !n.outside).length, seaZones: nodes.filter((n) => n.kind === 'sea').length, outsideNodes: nodes.filter((n) => n.outside).length, cities: cities.length },
  };
}

function profile(id: string, name: string, extra: Partial<CountryProfile>, map: MapData): CountryProfile {
  const cities = map.cities.filter((c) => c.country === id);
  return {
    id,
    name,
    region: 'Europe',
    doctrine: 'western',
    template: 'fixture',
    startDifficulty: 'moderate',
    summary: `${name} (test fixture)`,
    cities: cities.map((c) => ({ city: c.key, functions: c.capital ? ['industrial', 'finance'] : ['agriculture'], buildings: c.capital ? [{ type: 'barracks', level: 1 }] : [], output: { supplies: 60 * c.tier, components: 30 * c.tier, electronics: 10 * c.tier, fuel: 20 * c.tier, rare: 5 * c.tier, manpower: 15 * c.tier, money: 120 * c.tier } })),
    stockpile: { supplies: 3000, components: 1500, electronics: 800, fuel: 1500, rare: 300, manpower: 1500, money: 8000 },
    forces: [],
    techs: [],
    lift: 1,
    maintenanceSlots: 1,
    tradeNeeds: [],
    openingDecisions: [],
    personality: { aggression: 0.5, caution: 0.5, trade: 0.5, loyalty: 0.5, expansion: 0.5, research: 0.5 },
    ...extra,
  };
}

export function buildMiniScenario(): Scenario {
  const map = buildMiniMap();
  const profiles: Record<string, CountryProfile> = {
    ARD: profile('ARD', 'Ardenia', {
      doctrine: 'western',
      techs: ['str_missile_complex'],
      forces: [
        { unit: 'inf', count: 3, at: 'ARD-ardena', designation: '1st Ardenian Corps' },
        { unit: 'tank', count: 2, at: 'ARD-ardena', designation: '1st Armoured' },
        { unit: 'arty', count: 1, at: 'ARD-ardena', designation: 'Ardena Battery' },
        { unit: 'fighter', count: 2, at: 'ARD-ardena', designation: '1st Air Wing' },
        { unit: 'frigate', count: 2, at: 'ARD-westport', designation: 'Western Squadron' },
      ],
      lift: 3,
      maintenanceSlots: 2,
      personality: { aggression: 0.8, caution: 0.3, trade: 0.5, loyalty: 0.5, expansion: 0.8, research: 0.5 },
    }, map),
    BOR: profile('BOR', 'Borvia', {
      doctrine: 'eastern',
      forces: [
        { unit: 'inf', count: 2, at: 'BOR-borgrad', designation: 'Borgrad Guards' },
        { unit: 'sam', count: 1, at: 'BOR-borgrad', designation: 'Borgrad AD' },
        { unit: 'inf', count: 1, at: 'BOR-canalport', designation: 'Canal Watch' },
      ],
    }, map),
    CEL: profile('CEL', 'Celesta', {
      doctrine: 'european',
      forces: [
        { unit: 'inf', count: 2, at: 'CEL-celesta', designation: 'Island Guard' },
        { unit: 'frigate', count: 1, at: 'CEL-celesta', designation: 'Home Fleet' },
        { unit: 'sub', count: 1, at: 'CEL-southbay', designation: 'Silent Group' },
      ],
      personality: { aggression: 0.2, caution: 0.7, trade: 0.8, loyalty: 0.7, expansion: 0.2, research: 0.6 },
    }, map),
    DUN: profile('DUN', 'Dunmark', { forces: [{ unit: 'inf', count: 2, at: 'DUN-dunholm', designation: 'Dun Rifles' }], personality: { aggression: 0.3, caution: 0.6, trade: 0.7, loyalty: 0.6, expansion: 0.3, research: 0.4 } }, map),
    ESK: profile('ESK', 'Eskland', { forces: [{ unit: 'inf', count: 2, at: 'ESK-eskar', designation: 'Esk Brigade' }, { unit: 'frigate', count: 1, at: 'ESK-eskar', designation: 'Esk Flotilla' }], relations: [{ with: 'FAL', status: 'right_of_way', trust: 20 }] }, map),
    FAL: profile('FAL', 'Falenia', { forces: [{ unit: 'inf', count: 3, at: 'FAL-falen', designation: 'Falen Corps' }, { unit: 'tank', count: 1, at: 'FAL-falen', designation: 'Falen Armour' }, { unit: 'scout', count: 1, at: 'FAL-strand', designation: 'Strand Scouts' }] }, map),
  };
  return { id: 'mini-fixture', version: 'mini-1', name: 'Mini Fixture (test only)', map, catalog: MINI_CATALOG, profiles, seats: ['ARD', 'BOR', 'CEL', 'DUN', 'ESK', 'FAL'], startDate: '2031-04-01', testOnly: true };
}

let cached: Scenario | null = null;
export function miniScenario(): Scenario {
  return (cached ??= buildMiniScenario());
}

export function newMiniGame(opts: { seed?: number; human?: string | null; difficulty?: Difficulty } = {}): GameState {
  return createCampaign({ seed: opts.seed ?? 42, humanCountry: opts.human === undefined ? 'ARD' : opts.human, difficulty: opts.difficulty ?? 'normal', scenario: miniScenario() });
}
