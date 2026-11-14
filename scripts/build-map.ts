/**
 * World 120 map pipeline (deterministic). Run: `npm run map:build` (= `npx tsx scripts/build-map.ts`).
 *
 * Source: Natural Earth 1:50m admin-0 via world-atlas@2.0.2 (public domain), bundled in node_modules.
 * Output: src/data/generated/map.json (MapData) and src/data/generated/geometry.json (MapGeometry).
 * See docs/MAP.md for the full description, budgets and policies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CityDef, DisputedArea, EdgeKind, MapCountryDef, MapData, MapEdge, MapGeometry, MapNode, Resource, Terrain,
} from '../src/engine/data-types';
import { MANIFEST } from '../src/data/countries';
import { CITY_SEEDS } from '../src/data/cities';
import { DISPUTED_SPECS } from '../src/data/territory-manifest';
import type { Pt, Poly, MultiPoly, Ring } from './map/geo';
import {
  haversineKm, hashStr, bearing, compass8, densifyRing, round3, cleanRing, orientPoly, bboxOfMulti, normLon,
  closestBoundaryPoint, multiContains, signedArea, poleOfInaccessibility, type BBox,
} from './map/geo';
import { loadSource, vkey } from './map/source';
import { classifyFeatures, ownerParts } from './map/owners';
import { buildOwner, provinceCenterForPoly, type ProvinceDraft, type CityPlaced } from './map/provinces';
import { buildSea, zoneNear, zonesNear, type SeaResult, W as SEA_W, H as SEA_H, RES as SEA_RES } from './map/sea';
import { clipBox } from './map/clip';
import { STRAITS, CANALS, SEA_LINKS, RASTER_BARRIERS } from './map/crossings';
import { POPULATION_M, TERRAIN_BOXES, DEPOSIT_BIAS, NAMED_SEAS, KEY_DEPOSITS, ISLAND_NAMES, REGION_NAMES, oceanName } from './map/regions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/data/generated');

const CONFIG = {
  simplifyTolDeg: 0.01,
  provinceScale: 0.6,
  areaCoef: 0.0125,
  popCoef: 1.4,
  smallCountryKm2: 25000,
  sea: {
    coastSpacingKm: 390,
    offshoreSlope: 1.8,
    maxSpacingKm: 2000,
    polarSouthSpacingKm: 1200,
    minForcedComponentKm2: 2000,
    lloydIterations: 2,
    dilateCells: 6,
    tolInner: 0.1,
    tolOuter: 0.12,
  },
  acquired: '2026-11-14',
};

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const errors: string[] = [];
const warnings: string[] = [];

// ───────────────────────────── 1. Source + territory manifest ─────────────────────────────
const src = loadSource(CONFIG.simplifyTolDeg);
log(`source ${src.features.length} features, ${src.rawPoints} → ${src.simplifiedPoints} points`);
const classified = classifyFeatures(src);
const partsByOwner = ownerParts(classified);

// ───────────────────────────── 2. Provinces ─────────────────────────────
interface Prov extends ProvinceDraft { id: number; key: string; local: number }
const provinces: Prov[] = [];
const placedCities: CityPlaced[] = [];
const intraAdj: [number, number, number][] = [];
const labelAtByOwner = new Map<string, Pt>();
const areaByOwner = new Map<string, number>();
let decorativeParts = 0;
for (const m of MANIFEST) {
  const parts = partsByOwner.get(m.id)!;
  const area = parts.reduce((s, p) => s + p.areaKm2, 0);
  areaByOwner.set(m.id, area);
  const cities = CITY_SEEDS.filter((c) => c.country === m.id);
  const target = Math.round(CONFIG.provinceScale * (CONFIG.areaCoef * Math.sqrt(area) + CONFIG.popCoef * Math.sqrt(POPULATION_M[m.id] ?? 1)));
  const res = buildOwner(m.id, parts, cities, target);
  warnings.push(...res.warnings.map((w) => `${m.id}: ${w}`));
  decorativeParts += res.decorativeParts;
  const base = provinces.length;
  res.provinces.forEach((p, i) => {
    provinces.push({ ...p, id: base + i, key: `p:${m.id}:${String(i).padStart(3, '0')}`, local: i });
  });
  for (const [k, w] of res.adj) {
    const [a, b] = k.split('|').map(Number);
    intraAdj.push([base + a, base + b, w]);
  }
  placedCities.push(...res.cities);
  labelAtByOwner.set(m.id, parts.length ? provinceCenterForPoly(parts[0].poly, parts[0].centroid) : [0, 0]);
}
log(`provinces: ${provinces.length} (decorative islet parts: ${decorativeParts})`);

// ───────────────────────────── 3. Sea zones ─────────────────────────────
const landPolys: Poly[] = src.features.flatMap((f) => f.parts.map((p) => p.poly));
const sea: SeaResult = buildSea(landPolys, [], CONFIG.sea, RASTER_BARRIERS);
log(`sea zones: ${sea.zones.length} (water components ${sea.stats.waterComponents}, forced seeds ${sea.stats.forcedSeeds})`);

// ───────────────────────────── 4. Nodes ─────────────────────────────
const nodes: MapNode[] = [];
const nodePolys: MultiPoly[] = [];
const ownerOfFeature = new Map<number, string | null>(classified.map((c) => [c.feature.index, c.owner]));
for (const p of provinces) {
  nodes.push({
    id: p.id, key: p.key, kind: 'land', name: '', country: p.owner,
    ...(p.territory ? { territory: { ...p.territory } } : {}),
    terrain: 'open', center: [round3(normLon(p.center[0])), round3(p.center[1])], coastal: false, deposit: null,
    population: 0, areaKm2: Math.round(p.areaKm2), ...(p.city ? { city: p.city.key } : {}), shape: p.id,
  });
  nodePolys.push(p.polys);
}
const seaBase = nodes.length;
sea.zones.forEach((z, i) => {
  nodes.push({
    id: seaBase + i, key: `s:${String(i).padStart(4, '0')}`, kind: 'sea', name: '', country: null,
    terrain: 'high_seas', center: [round3(z.center[0]), round3(z.center[1])], coastal: false, deposit: null,
    population: 0, areaKm2: Math.round(z.areaKm2), shape: seaBase + i,
  });
  nodePolys.push(sea.polygons[i]);
});
const outsideBase = nodes.length;
const outsideByCode = new Map<string, number>();
for (const c of classified) {
  if (c.owner) continue;
  if (!c.feature.parts.length) continue;
  const id = nodes.length;
  const big = c.feature.parts[0];
  const status = c.entry.role === 'antarctica' ? 'antarctica' : c.entry.role === 'disputed' ? 'disputed' : 'outside_campaign';
  const center = provinceCenterForPoly(big.poly, big.centroid);
  nodes.push({
    id, key: `x:${c.entry.code}:0`, kind: 'land', name: c.entry.display, country: null,
    territory: { code: c.entry.code, name: c.entry.display, status }, outside: true,
    terrain: 'open', center: [round3(normLon(center[0])), round3(center[1])], coastal: false, deposit: null,
    population: 0, areaKm2: Math.round(c.feature.parts.reduce((s, p) => s + p.areaKm2, 0)), shape: id,
  });
  nodePolys.push(c.feature.parts.map((p) => p.poly));
  outsideByCode.set(c.entry.code, id);
}
log(`nodes: ${nodes.length} (land ${provinces.length}, sea ${sea.zones.length}, outside ${nodes.length - outsideBase})`);

// spatial index for province lookup
const GRID = 2;
const provGrid = new Map<string, number[]>();
const provBBox: BBox[] = provinces.map((p) => bboxOfMulti(p.polys));
provinces.forEach((p, i) => {
  const b = provBBox[i];
  for (let x = Math.floor(b[0] / GRID); x <= Math.floor(b[2] / GRID); x++) for (let y = Math.floor(b[1] / GRID); y <= Math.floor(b[3] / GRID); y++) {
    const nx = ((((x * GRID + 180) % 360) + 360) % 360) - 180;
    const k = `${Math.floor(nx / GRID)},${y}`;
    let a = provGrid.get(k);
    if (!a) provGrid.set(k, (a = []));
    a.push(i);
  }
});
function provinceAt(lon: number, lat: number, owners?: Set<string>): number {
  const k = `${Math.floor(normLon(lon) / GRID)},${Math.floor(lat / GRID)}`;
  for (const i of provGrid.get(k) ?? []) {
    const p = provinces[i];
    if (owners && !owners.has(p.owner)) continue;
    if (multiContains(p.polys, lon, lat) || multiContains(p.polys, lon + 360, lat) || multiContains(p.polys, lon - 360, lat)) return i;
  }
  return -1;
}
function nearestProvince(lon: number, lat: number, owner: string, maxKm: number): number {
  const hit = provinceAt(lon, lat, new Set([owner]));
  if (hit >= 0) return hit;
  let best = -1, bd = Infinity;
  provinces.forEach((p, i) => {
    if (p.owner !== owner) return;
    for (const pg of p.polys) for (const shift of [0, 360, -360]) {
      const q = closestBoundaryPoint([pg[0]], lon + shift, lat);
      const d = haversineKm([lon + shift, lat], q);
      if (d < bd) { bd = d; best = i; }
    }
  });
  return bd <= maxKm ? best : -1;
}

// ───────────────────────────── 5. Edges ─────────────────────────────
const edgeMap = new Map<string, MapEdge>();
function addEdge(a: number, b: number, kind: EdgeKind, extra: Partial<MapEdge> = {}): void {
  if (a === b) return;
  const [x, y] = a < b ? [a, b] : [b, a];
  const key = `${x}|${y}|${kind}`;
  if (edgeMap.has(key)) return;
  const ca = nodes[x].center, cb = nodes[y].center;
  const km = Math.max(1, Math.round(haversineKm(ca, cb)));
  const e: MapEdge = { a: x, b: y, kind, km, ...extra };
  if (Math.abs(ca[0] - cb[0]) > 180) e.wraps = true;
  edgeMap.set(key, e);
}
// 5a. intra-part land borders
for (const [a, b] of intraAdj) addEdge(a, b, 'land');
// 5b. land borders across source features (shared topology arcs)
{
  let samples = 0;
  for (const arc of src.sharedArcs) {
    const oa = ownerOfFeature.get(arc.features[0]), ob = ownerOfFeature.get(arc.features[1]);
    if (!oa || !ob) continue;
    const owners = new Set([oa, ob]);
    for (let i = 0; i < arc.coords.length - 1; i++) {
      const p = arc.coords[i], q = arc.coords[i + 1];
      const L = haversineKm(p, q);
      const m = Math.max(1, Math.ceil(L / 4));
      const cl = Math.cos((((p[1] + q[1]) / 2) * Math.PI) / 180);
      let dx = (q[0] - p[0]) * cl, dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const eps = 0.003;
      const nLon = (-dy * eps) / Math.max(0.1, cl), nLat = dx * eps;
      for (let k = 0; k < m; k++) {
        const t = (k + 0.5) / m;
        const sx = p[0] + (q[0] - p[0]) * t, sy = p[1] + (q[1] - p[1]) * t;
        const a = provinceAt(sx + nLon, sy + nLat, owners);
        const b = provinceAt(sx - nLon, sy - nLat, owners);
        samples++;
        if (a >= 0 && b >= 0 && a !== b) addEdge(a, b, 'land');
      }
    }
  }
  log(`cross-border sampling: ${samples} samples`);
}
// 5c. reviewed straits
const straitLog: string[] = [];
for (const s of STRAITS) {
  const a = nearestProvince(s.a[0], s.a[1], s.countries[0], 40);
  const b = nearestProvince(s.b[0], s.b[1], s.countries[1], 40);
  if (a < 0 || b < 0) { errors.push(`strait "${s.label}": endpoint not resolved (${a}, ${b})`); continue; }
  if (a === b) { straitLog.push(`skipped "${s.label}" (same province ${provinces[a].key})`); continue; }
  if (provinces[a].owner === 'IDN' && provinces[b].owner === 'IDN') { errors.push(`strait "${s.label}" links Indonesian provinces`); continue; }
  if (provinces[a].part === provinces[b].part && provinces[a].owner === provinces[b].owner) { straitLog.push(`skipped "${s.label}" (same landmass part, land border exists)`); continue; }
  addEdge(a, b, 'strait', { label: s.label });
  straitLog.push(`${s.label}: ${provinces[a].key} ↔ ${provinces[b].key}`);
}
// 5d. coast edges
const coastZones: Set<number>[] = provinces.map(() => new Set<number>());
provinces.forEach((p, i) => {
  let coastalVerts = 0;
  for (const pg of p.polys) for (const ring of pg) for (const v of ring) {
    const lon = normLon(v[0]);
    if (!src.coastKeys.has(vkey(lon, v[1]))) continue;
    coastalVerts++;
    zonesNear(sea, lon, v[1], 2, coastZones[i]);
  }
  if (coastalVerts > 0 && coastZones[i].size === 0) {
    // narrow bays closed at raster resolution: take the nearest zone to any coastal vertex
    for (const pg of p.polys) for (const ring of pg) for (const v of ring) {
      const lon = normLon(v[0]);
      if (!src.coastKeys.has(vkey(lon, v[1]))) continue;
      const z = zoneNear(sea, lon, v[1], 8);
      if (z >= 0) coastZones[i].add(z);
    }
  }
  for (const z of [...coastZones[i]].sort((x, y) => x - y)) addEdge(i, seaBase + z, 'coast');
});
// 5e. sea adjacency
for (const [k] of [...sea.adjacency.entries()].sort()) {
  const [a, b] = k.split('|').map(Number);
  addEdge(seaBase + a, seaBase + b, 'sea');
}
// 5f. canals
for (const c of CANALS) {
  const za = zoneNear(sea, c.seaA[0], c.seaA[1], 30), zb = zoneNear(sea, c.seaB[0], c.seaB[1], 30);
  const via = nearestProvince(c.via[0], c.via[1], c.viaCountry, 40);
  if (za < 0 || zb < 0 || via < 0) { errors.push(`canal "${c.label}" unresolved (${za}, ${zb}, ${via})`); continue; }
  if (za === zb) {
    if (c.optional) { straitLog.push(`skipped optional canal "${c.label}" (both ends in one sea zone)`); continue; }
    errors.push(`canal "${c.label}": both ends in the same sea zone`);
    continue;
  }
  addEdge(seaBase + za, seaBase + zb, 'canal', { via, label: c.label });
}
// 5g. reviewed sea links across raster-closed narrows
const seaLinkLog: string[] = [];
for (const s of SEA_LINKS) {
  const za = zoneNear(sea, s.a[0], s.a[1], 30), zb = zoneNear(sea, s.b[0], s.b[1], 30);
  if (za < 0 || zb < 0) { errors.push(`sea link "${s.label}" unresolved`); continue; }
  if (za === zb) { seaLinkLog.push(`${s.label}: same zone (open water)`); continue; }
  const key = `${Math.min(seaBase + za, seaBase + zb)}|${Math.max(seaBase + za, seaBase + zb)}|sea`;
  if (edgeMap.has(key)) { seaLinkLog.push(`${s.label}: already adjacent`); continue; }
  addEdge(seaBase + za, seaBase + zb, 'sea', { label: s.label });
  seaLinkLog.push(`${s.label}: added s:${za} ↔ s:${zb}`);
}

// ───────────────────────────── 6. Components ─────────────────────────────
function components(filter: (e: MapEdge) => boolean, members: (n: MapNode) => boolean): Int32Array {
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const e of edgeMap.values()) if (filter(e)) { const a = find(e.a), b = find(e.b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  const comp = new Int32Array(nodes.length).fill(-1);
  const ids = new Map<number, number>();
  for (const n of nodes) if (members(n)) { const r = find(n.id); if (!ids.has(r)) ids.set(r, ids.size); comp[n.id] = ids.get(r)!; }
  return comp;
}
let basin = components((e) => e.kind === 'sea' || e.kind === 'canal', (n) => n.kind === 'sea');
const caspianZone = zoneNear(sea, 50.5, 41.5, 30);
const basinSizes = new Map<number, number>();
for (let i = seaBase; i < outsideBase; i++) basinSizes.set(basin[i], (basinSizes.get(basin[i]) ?? 0) + 1);
const mainBasin = [...basinSizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
const caspianBasin = caspianZone >= 0 ? basin[seaBase + caspianZone] : -1;
// auto-bridge any other enclosed basin (narrows closed at raster resolution): find the smallest
// raster water gap from the basin's shore cells to a zone of another basin (Caspian excluded).
const autoLinks: string[] = [];
for (const [b] of [...basinSizes.entries()].sort((x, y) => x[0] - y[0])) {
  if (b === mainBasin || b === caspianBasin) continue;
  const inB = (z: number) => basin[seaBase + z] === b;
  const ok = (z: number) => z >= 0 && !inB(z) && basin[seaBase + z] !== caspianBasin;
  let best: [number, number] | null = null, bd = Infinity;
  const R = 14;
  for (let v = 0; v < SEA_W * SEA_H; v++) {
    const z = sea.label[v];
    if (z < 0 || !inB(z)) continue;
    const r = (v / SEA_W) | 0, c = v - r * SEA_W;
    const shore = sea.land[v - 1] || sea.land[v + 1] || (r > 0 && sea.land[v - SEA_W]) || (r < SEA_H - 1 && sea.land[v + SEA_W]);
    if (!shore) continue;
    const cl = Math.cos(((90 - (r + 0.5) * SEA_RES) * Math.PI) / 180);
    for (let dr = -R; dr <= R; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= SEA_H) continue;
      for (let dc = -R; dc <= R; dc++) {
        const u = sea.label[rr * SEA_W + ((c + dc + SEA_W) % SEA_W)];
        if (!ok(u)) continue;
        const d = Math.hypot(dr, dc * cl) * SEA_RES * 111.32;
        if (d < bd) { bd = d; best = [seaBase + z, seaBase + u]; }
      }
    }
  }
  if (best && bd <= 80) {
    addEdge(best[0], best[1], 'sea', { label: 'Narrows (auto-linked)' });
    autoLinks.push(`${nodes[best[0]].key} ↔ ${nodes[best[1]].key} (water gap ${Math.round(bd)} km)`);
  } else errors.push(`enclosed sea basin ${b} could not be linked: ${nodes.filter((n) => n.kind === 'sea' && basin[n.id] === b).map((n) => `${n.key}@${n.center}`).join(', ')}`);
}
basin = components((e) => e.kind === 'sea' || e.kind === 'canal', (n) => n.kind === 'sea');
const landmass = components((e) => e.kind === 'land' || e.kind === 'strait', (n) => n.kind === 'land' && !n.outside);
for (const n of nodes) {
  if (n.kind === 'sea') n.basin = basin[n.id];
  else if (!n.outside) n.landmass = landmass[n.id];
}
const edges = [...edgeMap.values()].sort((x, y) => x.a - y.a || x.b - y.b || x.kind.localeCompare(y.kind));
log(`edges: ${edges.length}`);

// coastal flags
const coastCount = new Int32Array(nodes.length);
for (const e of edges) if (e.kind === 'coast') { coastCount[e.a]++; coastCount[e.b]++; }
for (const n of nodes) { if (!n.outside) n.coastal = coastCount[n.id] > 0; }
for (let i = seaBase; i < outsideBase; i++) nodes[i].terrain = coastCount[i] > 0 || sea.zones[i - seaBase].touchesLand ? 'coastal_waters' : 'high_seas';

// ───────────────────────────── 7. Terrain, deposits, population ─────────────────────────────
const inBox = (b: [number, number, number, number], p: Pt) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
function baseTerrain(p: Pt, key: string): Terrain {
  const q: Pt = [p[0], p[1]];
  for (const t of TERRAIN_BOXES) if (inBox(t.box, q) || inBox(t.box, [q[0] + 360, q[1]])) return t.terrain;
  const lat = p[1], alat = Math.abs(lat);
  const u = (hashStr(key + ':t') % 1000) / 1000;
  if (lat > 66 || lat < -55) return 'tundra';
  if (lat >= 50) return u < 0.75 ? 'forest' : 'open';
  if (alat < 10) return u < 0.7 ? 'jungle' : 'forest';
  if (alat < 23) return u < 0.6 ? 'open' : 'forest';
  return u < 0.65 ? 'open' : 'forest';
}
const cityByKey = new Map(placedCities.map((c) => [c.key, c]));
for (const p of provinces) {
  const n = nodes[p.id];
  const city = p.city;
  n.terrain = city && city.population >= 1500 ? 'urban' : city && city.population >= 300 ? 'suburban' : baseTerrain(n.center, n.key);
}
for (const c of classified) {
  if (c.owner) continue;
  const id = outsideByCode.get(c.entry.code);
  if (id !== undefined) nodes[id].terrain = c.entry.role === 'antarctica' ? 'tundra' : baseTerrain(nodes[id].center, nodes[id].key);
}
const BASE_W: Record<Terrain, Partial<Record<Resource, number>>> = {
  open: { supplies: 4, components: 2, fuel: 1, rare: 0.6, manpower: 1, money: 0.3, electronics: 0.2 },
  forest: { supplies: 2.5, components: 2, fuel: 1, rare: 1, manpower: 0.6, money: 0.2, electronics: 0.2 },
  jungle: { supplies: 3, rare: 1.5, fuel: 1, components: 0.8, manpower: 0.8 },
  mountains: { rare: 3, components: 2.5, supplies: 0.6, fuel: 0.5, manpower: 0.3 },
  desert: { fuel: 3, rare: 2, components: 0.6, supplies: 0.2 },
  tundra: { fuel: 3, rare: 2.5, components: 1 },
  suburban: { supplies: 2, components: 2, electronics: 1.5, manpower: 2, money: 1.5 },
  urban: {},
  high_seas: {},
  coastal_waters: {},
};
const DEPOSIT_P: Partial<Record<Terrain, number>> = { open: 0.36, forest: 0.34, jungle: 0.34, mountains: 0.42, desert: 0.42, tundra: 0.38, suburban: 0.3 };
const RESOURCE_ORDER: Resource[] = ['supplies', 'components', 'electronics', 'fuel', 'rare', 'manpower', 'money'];
for (const p of provinces) {
  const n = nodes[p.id];
  const prob = DEPOSIT_P[n.terrain] ?? 0;
  const u = (hashStr(n.key + ':d') % 100000) / 100000;
  if (u >= prob) continue;
  const w: Record<string, number> = {};
  for (const r of RESOURCE_ORDER) w[r] = BASE_W[n.terrain][r] ?? 0;
  for (const b of DEPOSIT_BIAS) if (inBox(b.box, n.center)) for (const [r, m] of Object.entries(b.weights)) w[r] = (w[r] || 0.3) * (m as number);
  const total = RESOURCE_ORDER.reduce((s, r) => s + w[r], 0);
  if (total <= 0) continue;
  let v = ((hashStr(n.key + ':r') % 100000) / 100000) * total;
  for (const r of RESOURCE_ORDER) { v -= w[r]; if (v < 0) { n.deposit = r; break; } }
}
const keyDepositLog: string[] = [];
for (const k of KEY_DEPOSITS) {
  const hit = provinceAt(k.at[0], k.at[1]);
  if (hit < 0) { errors.push(`key deposit ${k.name} is not inside a playable province`); continue; }
  nodes[hit].deposit = k.deposit;
  keyDepositLog.push(`${k.name} → ${nodes[hit].key}`);
}
const DENSITY: Partial<Record<Terrain, number>> = { open: 1, forest: 0.5, jungle: 0.4, mountains: 0.25, desert: 0.04, tundra: 0.01, suburban: 3, urban: 4 };
for (const m of MANIFEST) {
  const own = provinces.filter((p) => p.owner === m.id);
  const totalK = (POPULATION_M[m.id] ?? 1) * 1000;
  const cityK = placedCities.filter((c) => c.country === m.id).reduce((s, c) => s + c.population, 0);
  const rural = Math.max(totalK * 0.1, totalK - cityK);
  const wts = own.map((p) => p.areaKm2 * (DENSITY[nodes[p.id].terrain] ?? 0.5) * (p.territory ? 0.3 : 1));
  const sw = wts.reduce((s, x) => s + x, 0) || 1;
  own.forEach((p, i) => { nodes[p.id].population = Math.max(1, Math.round((rural * wts[i]) / sw)); });
}

// ───────────────────────────── 8. Names ─────────────────────────────
const manifestName = new Map(MANIFEST.map((m) => [m.id, m.name]));
/** Island name for an owner part (nearest authored island point inside or within 40 km). */
function islandNameFor(owner: string, partIdx: number): { name: string; at: Pt } | null {
  const part = partsByOwner.get(owner)![partIdx];
  if (!part) return null;
  const pb = bboxOfMulti([part.poly]);
  let best: { name: string; at: Pt } | null = null, bd = Infinity;
  for (const [nm, lon, lat] of ISLAND_NAMES) {
    for (const sh of [0, 360, -360]) {
      const x = lon + sh;
      if (x < pb[0] - 1 || x > pb[2] + 1 || lat < pb[1] - 1 || lat > pb[3] + 1) continue;
      const d = multiContains([part.poly], x, lat) ? 0 : haversineKm([x, lat], closestBoundaryPoint([part.poly[0]], x, lat));
      if (d < bd && d <= 40) { bd = d; best = { name: nm, at: [x, lat] }; }
    }
  }
  return best;
}
for (const m of MANIFEST) {
  const own = provinces.filter((p) => p.owner === m.id);
  const cities = placedCities.filter((c) => c.country === m.id);
  const used = new Map<string, number>();
  const anchor = labelAtByOwner.get(m.id)!;
  const provsPerPart = new Map<number, number>();
  for (const p of own) provsPerPart.set(p.part, (provsPerPart.get(p.part) ?? 0) + 1);
  const partHasCity = new Set(cities.map((c) => c.part));
  for (const p of own) {
    const n = nodes[p.id];
    let name: string;
    const island = !p.city && !partHasCity.has(p.part) ? islandNameFor(m.id, p.part) : null;
    if (p.city) name = p.city.name;
    else if (island) {
      name = (provsPerPart.get(p.part) ?? 1) === 1 ? island.name : `${compass8(bearing([normLon(island.at[0]), island.at[1]], [normLon(p.center[0]), p.center[1]]))} ${island.name}`;
    } else if (p.territory && (provsPerPart.get(p.part) ?? 1) === 1 && own.filter((q) => q.territory?.code === p.territory!.code).length === 1) {
      name = p.territory.name;
    } else {
      let best: CityPlaced | null = null, bd = Infinity;
      const c0: Pt = [normLon(p.center[0]), p.center[1]];
      for (const c of cities) {
        if (c.part !== p.part && p.territory) continue;
        const d = haversineKm(c0, [normLon(c.placed[0]), c.placed[1]]);
        if (d < bd) { bd = d; best = c; }
      }
      const radius = Math.min(900, Math.max(320, 0.3 * Math.sqrt(areaByOwner.get(m.id)!)));
      if (best && bd <= radius && best.part === p.part) name = `${compass8(bearing([normLon(best.placed[0]), best.placed[1]], c0))} ${best.name}`;
      else {
        let reg: [string, number, number] | null = null, rd = 650;
        for (const [o, nm, lon, lat] of REGION_NAMES) {
          if (o !== m.id) continue;
          const d = haversineKm(c0, [lon, lat]);
          if (d < rd) { rd = d; reg = [nm, lon, lat]; }
        }
        if (reg) name = rd < 120 ? reg[0] : `${compass8(bearing([reg[1], reg[2]], c0))} ${reg[0]}`;
        else {
          const region = p.territory?.name ?? manifestName.get(m.id)!;
          name = `${region} — ${compass8(bearing([normLon(anchor[0]), anchor[1]], c0))}`;
        }
      }
    }
    const k = used.get(name) ?? 0;
    used.set(name, k + 1);
    n.name = name;
  }
  // number duplicates
  const seen = new Map<string, number>();
  for (const p of own) {
    const n = nodes[p.id];
    if ((used.get(n.name) ?? 0) > 1 || n.name.includes(' — ')) {
      const c = (seen.get(n.name) ?? 0) + 1;
      seen.set(n.name, c);
      if ((used.get(n.name) ?? 0) > 1) n.name = `${n.name} ${c}`;
    }
  }
}
{
  const base: string[] = [];
  const anchorOf: Pt[] = [];
  for (let i = seaBase; i < outsideBase; i++) {
    const c = nodes[i].center;
    let best: (typeof NAMED_SEAS)[number] | null = null, br = Infinity;
    for (const s of NAMED_SEAS) {
      const d = haversineKm(c, s.at) / s.radiusKm;
      if (d <= 1 && d < br) { br = d; best = s; }
    }
    if (best) base.push(best.name);
    else {
      const lat = Math.round(c[1]), lon = Math.round(c[0]);
      base.push(`${oceanName(c[0], c[1])} ${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`);
    }
    anchorOf.push(best ? best.at : c);
  }
  const groups = new Map<string, number[]>();
  base.forEach((b, i) => { const g = groups.get(b) ?? []; g.push(i); groups.set(b, g); });
  for (const [b, idx] of groups) {
    if (idx.length === 1) { nodes[seaBase + idx[0]].name = b; continue; }
    const avg: Pt = NAMED_SEAS.find((s) => s.name === b)?.at ?? [
      idx.reduce((s, i) => s + nodes[seaBase + i].center[0], 0) / idx.length,
      idx.reduce((s, i) => s + nodes[seaBase + i].center[1], 0) / idx.length,
    ];
    const names = idx.map((i) => {
      const c = nodes[seaBase + i].center;
      return haversineKm(avg, c) < 120 ? `${b} — Central` : `${b} — ${compass8(bearing(avg, c))}`;
    });
    const cnt = new Map<string, number>();
    names.forEach((n) => cnt.set(n, (cnt.get(n) ?? 0) + 1));
    const seen = new Map<string, number>();
    idx.forEach((i, k) => {
      let nm = names[k];
      if ((cnt.get(nm) ?? 0) > 1) { const s = (seen.get(nm) ?? 0) + 1; seen.set(nm, s); nm = `${nm} ${s}`; }
      nodes[seaBase + i].name = nm;
    });
  }
}

// ───────────────────────────── 9. Cities ─────────────────────────────
const cities: CityDef[] = [];
const provinceOfCity = new Map<string, number>();
for (const p of provinces) if (p.city) provinceOfCity.set(p.city.key, p.id);
for (const c of CITY_SEEDS) {
  const pc = cityByKey.get(c.key);
  const node = provinceOfCity.get(c.key);
  if (!pc || node === undefined) { errors.push(`city ${c.key} has no province`); continue; }
  const lonlat: [number, number] = [round3(normLon(pc.placed[0])), round3(pc.placed[1])];
  cities.push({ key: c.key, name: c.name, country: c.country, lonlat, node, population: c.population, capital: c.capital, port: c.port, tier: c.tier });
  if (c.port && !nodes[node].coastal) errors.push(`port ${c.key} is in non-coastal province ${nodes[node].key}`);
}

// ───────────────────────────── 10. Countries ─────────────────────────────
const countries: MapCountryDef[] = MANIFEST.map((m) => {
  const own = provinces.filter((p) => p.owner === m.id).map((p) => p.id);
  const capitals = cities.filter((c) => c.country === m.id && c.capital);
  if (capitals.length !== 1) errors.push(`${m.id} has ${capitals.length} capitals`);
  const ownSet = new Set(own);
  const neigh = new Set<string>();
  let oceanCoast = false;
  for (const e of edges) {
    if ((e.kind === 'land' || e.kind === 'strait') && (ownSet.has(e.a) !== ownSet.has(e.b))) {
      const other = ownSet.has(e.a) ? nodes[e.b] : nodes[e.a];
      if (other.country) neigh.add(other.country);
    }
    if (e.kind === 'coast' && (ownSet.has(e.a) || ownSet.has(e.b))) {
      const s = ownSet.has(e.a) ? e.b : e.a;
      if (nodes[s].basin !== caspianBasinFinal()) oceanCoast = true;
    }
  }
  const coastal = own.some((id) => nodes[id].coastal);
  const area = areaByOwner.get(m.id)!;
  const small = area < CONFIG.smallCountryKm2;
  const cap = capitals[0];
  const la = small && cap ? cap.lonlat : labelAtByOwner.get(m.id)!;
  return {
    id: m.id, name: m.name, region: m.region, capital: cap?.key ?? '', provinces: own,
    landNeighbors: [...neigh].sort(), coastal, landlocked: !oceanCoast, ...(small ? { small: true } : {}),
    labelAt: [round3(normLon(la[0])), round3(la[1])],
  };
});
function caspianBasinFinal(): number { return caspianZone >= 0 ? (nodes[seaBase + caspianZone].basin ?? -1) : -1; }

// ───────────────────────────── 11. Disputed areas ─────────────────────────────
const disputed: DisputedArea[] = [];
for (const d of DISPUTED_SPECS) {
  let ids: number[] = [];
  if (d.featureCode) {
    const id = outsideByCode.get(d.featureCode);
    if (id !== undefined) ids = [id];
  } else if (d.administeredBy) {
    const set = new Set<number>();
    for (const p of provinces) {
      if (p.owner !== d.administeredBy) continue;
      const c = nodes[p.id].center;
      if (d.bbox && inBox(d.bbox, c)) set.add(p.id);
    }
    for (const rp of d.refPoints ?? []) {
      const hit = provinceAt(rp[0], rp[1], new Set([d.administeredBy]));
      if (hit >= 0) set.add(hit);
    }
    ids = [...set].sort((a, b) => a - b);
  }
  if (!ids.length) { errors.push(`disputed area ${d.id} resolved to no nodes`); continue; }
  disputed.push({ id: d.id, name: d.name, nodes: ids, administeredBy: d.administeredBy, source: `${d.source}. Claimants: ${d.claimants.join(', ')}.`, displayPolicy: d.displayPolicy });
}

// ───────────────────────────── 12. Geometry ─────────────────────────────
function splitAntimeridian(m: MultiPoly): MultiPoly {
  const out: MultiPoly = [];
  for (const p of m) {
    let x0 = Infinity, x1 = -Infinity;
    for (const [x] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (x0 >= -180 && x1 <= 180) { out.push(p); continue; }
    for (const [lo, hi, sh] of [[-540, -180, 360], [-180, 180, 0], [180, 540, -360]] as const) {
      if (x1 <= lo || x0 >= hi) continue;
      const parts = clipBox(p as unknown as Parameters<typeof clipBox>[0], lo, -90, hi, 90) as unknown as MultiPoly;
      for (const q of parts) out.push(q.map((r) => r.map(([x, y]) => [x + sh, y] as Pt)));
    }
  }
  return out;
}
function finalize(m: MultiPoly): number[][][][] {
  const res: number[][][][] = [];
  for (const p of splitAntimeridian(m)) {
    const rings: Ring[] = [];
    p.forEach((r, i) => {
      const d = densifyRing(r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]], 1);
      const c = cleanRing(d.map(([x, y]) => [round3(Math.max(-180, Math.min(180, x))), round3(y)] as Pt));
      if (c) rings.push(c);
      else if (i === 0) rings.length = 0;
    });
    if (!rings.length) continue;
    res.push(orientPoly(rings) as number[][][]);
  }
  return res;
}
const shapes: MapGeometry['shapes'] = nodes.map((n, i) => {
  const polygons = finalize(nodePolys[i]);
  if (!polygons.length) errors.push(`node ${n.key} has empty geometry`);
  const b = polygons.length ? bboxOfMulti(polygons as MultiPoly) : ([n.center[0], n.center[1], n.center[0], n.center[1]] as BBox);
  return { node: n.id, polygons, bbox: b.map(round3) as [number, number, number, number] };
});
const outlines: MapGeometry['outlines'] = classified.map((c) => ({
  code: c.entry.code,
  name: c.entry.display,
  playable: c.owner !== null,
  polygons: finalize(c.feature.parts.map((p) => p.poly)),
}));

// Final fix-up: centres and cities must lie inside their rounded output shapes.
{
  let moved = 0;
  const inside = (id: number, q: Pt) => multiContains(shapes[id].polygons as MultiPoly, q[0], q[1]);
  const pull = (id: number, q: Pt): Pt => {
    const polys = shapes[id].polygons as MultiPoly;
    const big = polys.reduce((a, b) => (Math.abs(signedArea(a[0])) >= Math.abs(signedArea(b[0])) ? a : b));
    const target = poleOfInaccessibility(big);
    for (const f of [0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) {
      const t: Pt = [round3(q[0] + (target[0] - q[0]) * f), round3(q[1] + (target[1] - q[1]) * f)];
      if (inside(id, t)) return t;
    }
    return [round3(target[0]), round3(target[1])];
  };
  for (const n of nodes) {
    if (n.kind !== 'land' || inside(n.id, n.center)) continue;
    n.center = pull(n.id, n.center);
    moved++;
  }
  for (const c of cities) {
    if (inside(c.node, c.lonlat)) continue;
    c.lonlat = pull(c.node, c.lonlat);
    nodes[c.node].center = [c.lonlat[0], c.lonlat[1]];
    moved++;
  }
  if (moved) log(`fix-up: moved ${moved} centres/cities inside their rounded shapes`);
}

// ───────────────────────────── 13. Validation + output ─────────────────────────────
for (const p of provinces) {
  const deg = edges.filter((e) => (e.a === p.id || e.b === p.id) && (e.kind === 'land' || e.kind === 'strait' || e.kind === 'coast')).length;
  if (deg === 0) errors.push(`isolated province ${p.key} (${nodes[p.id].name}) has no land, strait or coast edge`);
}
const landProvinces = provinces.length;
if (landProvinces < 1200 || landProvinces > 2000) errors.push(`land province count ${landProvinces} outside 1200–2000`);
for (const e of edges) {
  if ((e.kind === 'land' || e.kind === 'strait') && (nodes[e.a].outside || nodes[e.b].outside)) errors.push(`land edge touches outside node: ${nodes[e.a].key}–${nodes[e.b].key}`);
  if ((e.kind === 'land' || e.kind === 'strait') && (nodes[e.a].kind !== 'land' || nodes[e.b].kind !== 'land')) errors.push(`land edge on sea node`);
}
const basinCount = new Set(nodes.filter((n) => n.kind === 'sea').map((n) => n.basin)).size;
const kindCount: Record<string, number> = {};
for (const e of edges) kindCount[e.kind] = (kindCount[e.kind] ?? 0) + 1;

const provenance = {
  source: 'Natural Earth 1:50m Cultural Vectors, Admin 0 – Countries (via world-atlas@2.0.2 countries-50m.json)',
  license: 'Public domain (Natural Earth terms of use); world-atlas packaging ISC',
  acquired: CONFIG.acquired,
  notes: `Arc-level Douglas–Peucker ${CONFIG.simplifyTolDeg}° (topology-preserving). Provinces: Voronoi of cities + Halton/Lloyd seeds per landmass part (never across water). Sea zones: 0.05° raster, Poisson-like seeds, connectivity-checked. Reviewed straits/canals in scripts/map/crossings.ts. Territory manifest in src/data/territory-manifest.ts. See docs/MAP.md.`,
};
const body = { nodes, edges, cities, countries, disputed };
const version = `w120-map-${CONFIG.acquired}-${hashStr(JSON.stringify(body)).toString(16).padStart(8, '0')}`;
const mapData: MapData = {
  version, provenance, ...body,
  stats: { landProvinces, seaZones: sea.zones.length, outsideNodes: nodes.length - outsideBase, cities: cities.length },
};
const geometry: MapGeometry = { version, shapes, outlines };

log('straits:\n  ' + straitLog.join('\n  '));
log('sea links:\n  ' + seaLinkLog.join('\n  '));
if (autoLinks.length) log('auto-linked basins:\n  ' + autoLinks.join('\n  '));
if (warnings.length) log(`warnings (${warnings.length}):\n  ` + warnings.join('\n  '));
log(`edges by kind: ${JSON.stringify(kindCount)}; sea basins: ${basinCount} (main ${mainBasin}, caspian ${caspianBasinFinal()})`);
if (errors.length) {
  console.error(`\n${errors.length} ERROR(S):\n  ` + errors.slice(0, 200).join('\n  '));
  process.exitCode = 1;
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const mapJson = JSON.stringify(mapData);
const geoJson = JSON.stringify(geometry);
fs.writeFileSync(path.join(OUT_DIR, 'map.json'), mapJson);
fs.writeFileSync(path.join(OUT_DIR, 'geometry.json'), geoJson);
log(`wrote map.json ${(mapJson.length / 1e6).toFixed(2)} MB, geometry.json ${(geoJson.length / 1e6).toFixed(2)} MB; version ${version}`);
log(`stats: ${JSON.stringify(mapData.stats)}`);
