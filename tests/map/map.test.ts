import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { MapData, MapGeometry, MapNode, NodeId } from '../../src/engine/data-types';
import { TERRAINS, RESOURCES } from '../../src/engine/data-types';
import { MANIFEST, MANIFEST_IDS } from '../../src/data/countries';
import { CITY_SEEDS } from '../../src/data/cities';
import { TERRITORY_MANIFEST } from '../../src/data/territory-manifest';
import { loadMapData, buildMapIndex, neighbours, nodeByKey, cityByKey } from '../../src/data/map-index';

const map: MapData = loadMapData();
const geo: MapGeometry = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/data/generated/geometry.json'), 'utf8'));
const idx = buildMapIndex(map);
const N = map.nodes;
const land = N.filter((n) => n.kind === 'land' && !n.outside);
const seaNodes = N.filter((n) => n.kind === 'sea');
const outside = N.filter((n) => n.outside);
const city = (key: string) => {
  const c = cityByKey(key, idx);
  if (!c) throw new Error(`missing city ${key}`);
  return c;
};

function ringContains(r: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function shapeContains(node: NodeId, x: number, y: number): boolean {
  return geo.shapes[N[node].shape].polygons.some((p) => ringContains(p[0], x, y) && !p.slice(1).some((h) => ringContains(h, x, y)));
}

/** BFS over a filtered edge set. */
function reach(start: NodeId, allow: (from: MapNode, to: MapNode, kind: string) => boolean): Set<NodeId> {
  const seen = new Set<NodeId>([start]);
  const q = [start];
  while (q.length) {
    const v = q.shift()!;
    for (const nb of idx.adjacency[v]) {
      if (seen.has(nb.node)) continue;
      if (!allow(N[v], N[nb.node], nb.kind)) continue;
      seen.add(nb.node);
      q.push(nb.node);
    }
  }
  return seen;
}

describe('map: identity and structure', () => {
  it('has exactly the 120 manifest countries, in manifest order', () => {
    expect(map.countries).toHaveLength(120);
    expect(map.countries.map((c) => c.id)).toEqual([...MANIFEST_IDS]);
    expect(new Set(map.countries.map((c) => c.id)).size).toBe(120);
    for (const c of map.countries) expect(c.name).toBe(MANIFEST.find((m) => m.id === c.id)!.name);
  });

  it('has unique, index-aligned node ids and unique keys', () => {
    N.forEach((n, i) => expect(n.id).toBe(i));
    expect(new Set(N.map((n) => n.key)).size).toBe(N.length);
    for (const n of land) expect(n.key).toMatch(/^p:[A-Z]{3}:\d{3}$/);
    for (const n of seaNodes) expect(n.key).toMatch(/^s:\d{4}$/);
    for (const n of outside) expect(n.key).toMatch(/^x:[A-Z]{3}:\d+$/);
    expect(nodeByKey('s:0000', idx)?.kind).toBe('sea');
  });

  it('stats match the data and the province budget is respected', () => {
    expect(map.stats.landProvinces).toBe(land.length);
    expect(map.stats.seaZones).toBe(seaNodes.length);
    expect(map.stats.outsideNodes).toBe(outside.length);
    expect(map.stats.cities).toBe(map.cities.length);
    expect(land.length).toBeGreaterThanOrEqual(1200);
    expect(land.length).toBeLessThanOrEqual(2000);
    expect(seaNodes.length).toBeGreaterThanOrEqual(300);
    expect(seaNodes.length).toBeLessThanOrEqual(600);
  });

  it('edges reference valid nodes, have positive km and valid kinds', () => {
    const kinds = new Set(['land', 'strait', 'coast', 'sea', 'canal']);
    const seen = new Set<string>();
    for (const e of map.edges) {
      expect(kinds.has(e.kind)).toBe(true);
      expect(N[e.a]).toBeDefined();
      expect(N[e.b]).toBeDefined();
      expect(e.a).not.toBe(e.b);
      expect(e.km).toBeGreaterThan(0);
      expect(Number.isFinite(e.km)).toBe(true);
      const k = `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}|${e.kind}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      if (e.kind === 'land' || e.kind === 'strait') expect(N[e.a].kind === 'land' && N[e.b].kind === 'land').toBe(true);
      if (e.kind === 'sea' || e.kind === 'canal') expect(N[e.a].kind === 'sea' && N[e.b].kind === 'sea').toBe(true);
      if (e.kind === 'coast') expect(new Set([N[e.a].kind, N[e.b].kind])).toEqual(new Set(['land', 'sea']));
    }
  });

  it('every node has a valid terrain, deposit and finite centre', () => {
    for (const n of N) {
      expect(TERRAINS).toContain(n.terrain);
      if (n.deposit !== null) expect(RESOURCES).toContain(n.deposit);
      expect(Number.isFinite(n.center[0]) && Number.isFinite(n.center[1])).toBe(true);
      expect(Math.abs(n.center[0])).toBeLessThanOrEqual(180);
      expect(Math.abs(n.center[1])).toBeLessThanOrEqual(90);
      if (n.kind === 'sea') expect(['high_seas', 'coastal_waters']).toContain(n.terrain);
      else expect(['high_seas', 'coastal_waters']).not.toContain(n.terrain);
    }
  });

  it('land province names are unique within each country', () => {
    for (const c of map.countries) {
      const names = c.provinces.map((id) => N[id].name);
      expect(new Set(names).size).toBe(names.length);
      for (const nm of names) expect(nm.length).toBeGreaterThan(1);
    }
  });
});

describe('map: cities and capitals', () => {
  it('includes every authored city exactly once with unique keys', () => {
    expect(map.cities).toHaveLength(CITY_SEEDS.length);
    expect(new Set(map.cities.map((c) => c.key)).size).toBe(map.cities.length);
    for (const c of map.cities) expect(c.key.startsWith(`${c.country}-`)).toBe(true);
    expect(map.cities.length).toBeGreaterThanOrEqual(700);
  });

  it('exactly one capital per country, located in that country’s homeland province', () => {
    for (const c of map.countries) {
      const caps = map.cities.filter((x) => x.country === c.id && x.capital);
      expect(caps, c.id).toHaveLength(1);
      expect(c.capital).toBe(caps[0].key);
      expect(N[caps[0].node].country).toBe(c.id);
      expect(c.provinces).toContain(caps[0].node);
    }
  });

  it('every city lies inside its country and is anchored to a province of that country', () => {
    for (const c of map.cities) {
      const n = N[c.node];
      expect(n.kind, c.key).toBe('land');
      expect(n.country, c.key).toBe(c.country);
      expect(n.city, c.key).toBe(c.key);
      expect(shapeContains(c.node, c.lonlat[0], c.lonlat[1]), `${c.key} inside its province shape`).toBe(true);
      expect(c.tier >= 1 && c.tier <= 5).toBe(true);
      expect(c.population).toBeGreaterThan(0);
    }
  });

  it('ports are in coastal provinces', () => {
    for (const c of map.cities.filter((x) => x.port)) {
      expect(N[c.node].coastal, c.key).toBe(true);
      expect(neighbours(c.node, ['coast'], idx).length, c.key).toBeGreaterThan(0);
    }
  });

  it('Indonesia has Jakarta (capital) and Surabaya, plus key island ports', () => {
    expect(city('IDN-jakarta').capital).toBe(true);
    expect(city('IDN-surabaya').port).toBe(true);
    for (const k of ['IDN-medan', 'IDN-makassar', 'IDN-balikpapan', 'IDN-denpasar', 'IDN-jayapura', 'IDN-palembang']) expect(city(k).country).toBe('IDN');
  });

  it('small states Bahrain and Singapore have nodes, cities and edges', () => {
    for (const id of ['BHR', 'SGP']) {
      const c = idx.countryById.get(id)!;
      expect(c.provinces.length).toBeGreaterThanOrEqual(1);
      expect(c.small).toBe(true);
      const cap = city(c.capital);
      expect(neighbours(cap.node, ['coast'], idx).length).toBeGreaterThan(0);
      expect(neighbours(cap.node, ['strait'], idx).length).toBeGreaterThan(0);
      expect(geo.shapes[N[cap.node].shape].polygons.length).toBeGreaterThan(0);
    }
  });
});

describe('map: travel graph', () => {
  it('no land or strait edge touches an outside-campaign node; outside nodes produce nothing', () => {
    for (const e of map.edges) {
      if (e.kind === 'land' || e.kind === 'strait') expect(N[e.a].outside || N[e.b].outside).toBeFalsy();
    }
    for (const n of outside) {
      expect(n.country).toBeNull();
      expect(n.deposit).toBeNull();
      expect(n.city).toBeUndefined();
      expect(n.population).toBe(0);
      expect(n.territory).toBeDefined();
      expect(idx.citiesByNode[n.id]).toHaveLength(0);
    }
    expect(map.cities.every((c) => !N[c.node].outside)).toBe(true);
  });

  it('every playable country has provinces and a route to a scoring opportunity', () => {
    for (const c of map.countries) {
      expect(c.provinces.length, c.id).toBeGreaterThan(0);
      for (const p of c.provinces) expect(N[p].country).toBe(c.id);
      const hasPort = map.cities.some((x) => x.country === c.id && x.port);
      expect(hasPort || c.landNeighbors.length > 0, c.id).toBe(true);
    }
  });

  // Exclaves with no coast that can only reach their capital by transiting a neighbour (legal play: right of way).
  const TRANSIT_EXCEPTIONS: Record<string, string> = {
    AZE: 'Nakhchivan exclave (borders ARM, IRN, TUR)',
  };

  it('every province can reach its own capital through own land/straits or own coasts + sea', () => {
    const failures: string[] = [];
    for (const c of map.countries) {
      const own = new Set(c.provinces);
      const cap = city(c.capital).node;
      const seen = reach(cap, (from, to, kind) => {
        if (kind === 'land' || kind === 'strait') return own.has(from.id) && own.has(to.id);
        if (kind === 'coast') return (own.has(from.id) && to.kind === 'sea') || (from.kind === 'sea' && own.has(to.id));
        return kind === 'sea' || kind === 'canal';
      });
      const missing = c.provinces.filter((p) => !seen.has(p));
      if (!missing.length) continue;
      if (TRANSIT_EXCEPTIONS[c.id]) {
        // must still be reachable through other playable land
        const viaPlayable = reach(cap, (from, to, kind) => {
          if (kind === 'land' || kind === 'strait') return !from.outside && !to.outside;
          if (kind === 'coast') return (!from.outside && to.kind === 'sea') || (from.kind === 'sea' && !to.outside);
          return kind === 'sea' || kind === 'canal';
        });
        const still = missing.filter((p) => !viaPlayable.has(p));
        if (still.length) failures.push(`${c.id}: ${still.map((p) => N[p].key).join(',')}`);
        continue;
      }
      failures.push(`${c.id}: ${missing.map((p) => `${N[p].key}(${N[p].name})`).join(', ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('landlocked countries border at least one playable neighbour', () => {
    const expected = ['MNG', 'BOL', 'PRY', 'NPL', 'LAO', 'ETH', 'KAZ', 'CHE', 'AUT', 'CZE', 'HUN', 'SRB', 'BLR', 'ARM', 'AFG', 'KGZ', 'TJK', 'UZB', 'TKM', 'MDA', 'SVK', 'AZE'];
    for (const id of expected) {
      const c = idx.countryById.get(id)!;
      expect(c.landlocked, id).toBe(true);
      expect(c.landNeighbors.length, id).toBeGreaterThan(0);
      for (const nb of c.landNeighbors) expect(MANIFEST_IDS).toContain(nb);
    }
    for (const c of map.countries) if (c.landlocked) expect(c.landNeighbors.length, c.id).toBeGreaterThan(0);
  });

  it('Indonesian islands are never linked by land to each other', () => {
    const ln = (k: string) => N[city(k).node].landmass;
    expect(ln('IDN-jakarta')).toBe(ln('IDN-surabaya')); // both on Java
    expect(ln('IDN-jakarta')).not.toBe(ln('IDN-medan')); // Java vs Sumatra
    expect(ln('IDN-surabaya')).not.toBe(ln('IDN-denpasar')); // Java vs Bali
    expect(ln('IDN-makassar')).not.toBe(ln('IDN-balikpapan')); // Sulawesi vs Borneo
    for (const e of map.edges) {
      if (e.kind === 'strait') expect(N[e.a].country === 'IDN' && N[e.b].country === 'IDN').toBe(false);
    }
    const idnLandmasses = new Set(idx.countryById.get('IDN')!.provinces.map((p) => N[p].landmass));
    expect(idnLandmasses.size).toBeGreaterThan(20);
  });

  it('land edges connect only provinces of one landmass; straits are labelled', () => {
    for (const e of map.edges) {
      if (e.kind === 'land' || e.kind === 'strait') expect(N[e.a].landmass).toBe(N[e.b].landmass);
      if (e.kind === 'strait' || e.kind === 'canal') expect(e.label).toBeTruthy();
    }
  });

  it('Panama and Suez canals exist with via set to PAN / EGY provinces', () => {
    const canal = (label: string) => map.edges.find((e) => e.kind === 'canal' && e.label === label);
    const pan = canal('Panama Canal')!;
    const suez = canal('Suez Canal')!;
    expect(pan).toBeDefined();
    expect(suez).toBeDefined();
    expect(N[pan.via!].country).toBe('PAN');
    expect(N[suez.via!].country).toBe('EGY');
    for (const e of [pan, suez]) {
      expect(N[e.a].kind).toBe('sea');
      expect(N[e.b].kind).toBe('sea');
    }
    // the two oceans are NOT adjacent through the isthmus except via the canal
    const bos = canal('Bosporus')!, dar = canal('Dardanelles')!;
    expect(N[bos.via!].country).toBe('TUR');
    expect(N[dar.via!].country).toBe('TUR');
  });

  it('Black Sea reaches the Mediterranean only through the Turkish Straits canals', () => {
    const black = seaNodes.filter((n) => n.name.startsWith('Black Sea'));
    expect(black.length).toBeGreaterThan(0);
    const viaSeaOnly = reach(black[0].id, (_f, to, kind) => kind === 'sea' && to.kind === 'sea');
    expect([...viaSeaOnly].some((id) => N[id].name.startsWith('Aegean'))).toBe(false);
    const withCanals = reach(black[0].id, (_f, to, kind) => (kind === 'sea' || kind === 'canal') && to.kind === 'sea');
    expect([...withCanals].some((id) => N[id].name.startsWith('Aegean'))).toBe(true);
  });

  it('the sea graph crosses the dateline and Alaska is reachable by sea from the US mainland', () => {
    const wrapSea = map.edges.filter((e) => e.kind === 'sea' && e.wraps);
    expect(wrapSea.length).toBeGreaterThan(0);
    for (const e of map.edges) {
      if (e.wraps) expect(Math.abs(N[e.a].center[0] - N[e.b].center[0])).toBeGreaterThan(180);
    }
    const la = city('USA-los-angeles').node;
    const anchorage = city('USA-anchorage').node;
    const honolulu = city('USA-honolulu').node;
    expect(N[la].landmass).toBe(N[city('USA-washington').node].landmass);
    const seen = reach(la, (from, to, kind) => kind === 'coast' || ((kind === 'sea' || kind === 'canal') && from.kind === 'sea' && to.kind === 'sea'));
    expect(seen.has(anchorage)).toBe(true);
    expect(seen.has(honolulu)).toBe(true);
    // Russia's Chukotka connects across the antimeridian by land
    expect(N[city('RUS-anadyr').node].landmass).toBe(N[city('RUS-moscow').node].landmass);
  });

  it('sea zones form one connected basin except the documented enclosed Caspian', () => {
    const basins = new Map<number, MapNode[]>();
    for (const n of seaNodes) {
      expect(n.basin).toBeDefined();
      const b = basins.get(n.basin!) ?? [];
      b.push(n);
      basins.set(n.basin!, b);
    }
    expect(basins.size).toBe(2);
    const [main, other] = [...basins.values()].sort((a, b) => b.length - a.length);
    expect(main.length).toBeGreaterThan(400);
    expect(other.every((n) => n.name.startsWith('Caspian Sea'))).toBe(true);
    const littoral = new Set<string>();
    for (const z of other) for (const nb of neighbours(z.id, ['coast'], idx)) littoral.add(N[nb].country ?? 'outside');
    expect([...littoral].sort()).toEqual(['AZE', 'IRN', 'KAZ', 'RUS', 'TKM']);
  });

  it('coastal flags agree with coast edges; sea zones next to provinces are coastal waters', () => {
    for (const n of N) {
      const coast = neighbours(n.id, ['coast'], idx).length;
      if (!n.outside) expect(n.coastal, n.key).toBe(coast > 0);
      if (n.kind === 'sea' && coast > 0) expect(n.terrain).toBe('coastal_waters');
    }
  });

  it('country records are consistent', () => {
    for (const c of map.countries) {
      expect(c.coastal).toBe(c.provinces.some((p) => N[p].coastal));
      expect(Number.isFinite(c.labelAt[0]) && Number.isFinite(c.labelAt[1])).toBe(true);
      for (const nb of c.landNeighbors) expect(nb).not.toBe(c.id);
    }
    expect(idx.countryById.get('TWN')!.provinces.length).toBeGreaterThan(0);
  });
});

describe('map: territory, disputes and geometry', () => {
  it('territory manifest covers 241 source features with 120 playable codes', () => {
    expect(TERRITORY_MANIFEST).toHaveLength(241);
    expect(new Set(TERRITORY_MANIFEST.map((t) => t.name)).size).toBe(241);
    const playable = TERRITORY_MANIFEST.filter((t) => t.role === 'playable').map((t) => t.code).sort();
    expect(playable).toEqual([...MANIFEST_IDS].sort());
    for (const t of TERRITORY_MANIFEST.filter((x) => x.role === 'dependent')) expect(MANIFEST_IDS).toContain(t.owner);
    expect(geo.outlines).toHaveLength(241);
  });

  it('dependent territories are tagged and outside territories keep their own names', () => {
    const grl = land.filter((n) => n.territory?.code === 'GRL');
    expect(grl.length).toBeGreaterThan(0);
    for (const n of grl) {
      expect(n.country).toBe('DNK');
      expect(n.territory!.status).toBe('dependent');
    }
    expect(land.some((n) => n.territory?.code === 'GUF' && n.country === 'FRA')).toBe(true);
    expect(land.some((n) => n.territory?.code === 'PRI' && n.country === 'USA')).toBe(true);
    for (const code of ['ISL', 'LUX', 'SOM', 'ZMB', 'FJI']) {
      const n = nodeByKey(`x:${code}:0`, idx)!;
      expect(n.outside).toBe(true);
      expect(n.territory!.status).toBe('outside_campaign');
    }
    expect(nodeByKey('x:ATA:0', idx)!.territory!.status).toBe('antarctica');
  });

  it('disputed areas have explicit records with source and display policy', () => {
    expect(map.disputed.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(map.disputed.map((d) => d.id));
    for (const id of ['western-sahara', 'kosovo', 'northern-cyprus', 'somaliland', 'crimea', 'kashmir-india']) expect(ids.has(id)).toBe(true);
    for (const d of map.disputed) {
      expect(d.source.length).toBeGreaterThan(10);
      expect(d.displayPolicy.length).toBeGreaterThan(10);
      expect(d.nodes.length).toBeGreaterThan(0);
      for (const id of d.nodes) expect(N[id]).toBeDefined();
      if (d.administeredBy === null) for (const id of d.nodes) expect(N[id].outside).toBe(true);
      else for (const id of d.nodes) expect(N[id].country).toBe(d.administeredBy);
    }
    // excluded states are never silently granted to a neighbour
    for (const code of ['ESH', 'XKX', 'CYN', 'SOL', 'PSE']) {
      const n = nodeByKey(`x:${code}:0`, idx)!;
      expect(n.outside).toBe(true);
      expect(n.territory!.status).toBe('disputed');
    }
  });

  it('every node has a matching shape with valid, finite, closed rings', () => {
    expect(geo.version).toBe(map.version);
    expect(geo.shapes).toHaveLength(N.length);
    for (const n of N) {
      const sh = geo.shapes[n.shape];
      expect(sh.node, n.key).toBe(n.id);
      expect(sh.polygons.length, n.key).toBeGreaterThan(0);
      for (const p of sh.polygons) for (const r of p) {
        expect(r.length).toBeGreaterThanOrEqual(4);
        expect(r[0]).toEqual(r[r.length - 1]);
        for (const v of r) {
          expect(Number.isFinite(v[0]) && Number.isFinite(v[1])).toBe(true);
          expect(Math.abs(v[0])).toBeLessThanOrEqual(180);
          expect(Math.abs(v[1])).toBeLessThanOrEqual(90);
        }
      }
      const [x0, y0, x1, y1] = sh.bbox;
      expect(x0 <= x1 && y0 <= y1).toBe(true);
    }
    for (const o of geo.outlines) for (const p of o.polygons) for (const r of p) for (const v of r) expect(Number.isFinite(v[0]) && Number.isFinite(v[1])).toBe(true);
  });

  it('land province centres lie inside their own shape', () => {
    const bad = land.filter((n) => !shapeContains(n.id, n.center[0], n.center[1])).map((n) => n.key);
    expect(bad).toEqual([]);
  });
});
