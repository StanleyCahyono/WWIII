/**
 * Per-viewer observation model.
 *
 * Sensors (per country): its stacks (visual sight + radar), its cities (CITY_SIGHT_KM visual +
 * radar buildings), and territory sight (stacks standing on nodes it owns are seen visually).
 * A viewer sees through its own sensors plus those of coalition members and countries granting it
 * `shared_intel` (visionSources). Stacks owned by vision sources are fully identified.
 *
 * Detection per target UNIT (so a mixed stack can be detected via one member while others stay
 * hidden):
 *  - VISUAL within sight: all domains except subsurface (needs an ASW-capable observer);
 *    signature 3 (stealth) only within STEALTH_VISUAL_FRACTION of sight.
 *    Identified if within IDENTIFY_FRACTION of sight, or the observer is a recon unit, or the
 *    target stands in an observer-owned city; otherwise unidentified (owner + member count).
 *  - RADAR within radarKm: only if the target domain is in radarDetects and its signature ≤
 *    sensitivity → `contact` (broad domain + position only).
 * Contacts not currently detected become `stale` (fields frozen as of observedAt) and are
 * dropped after STALE_KEEP_MIN. Levels are recomputed from CURRENT sensors every step, so losing
 * one of two sensors leaves exactly what the remaining sensor justifies.
 */
import type { CountryId, Domain, NodeId } from '../data-types';
import type { Contact, ContactLevel, GameState, Stack } from '../state';
import { CITY_SIGHT_KM, IDENTIFY_FRACTION, STALE_KEEP_MIN, STEALTH_VISUAL_FRACTION } from '../rules';
import { S } from '../scenario/registry';
import { distKm } from './mapindex';
import { hash32 } from '../rng';
import { cmpId, sortedStacks, stacksReadonly, stackLL, takeOwnerChanges, ustats, utype, visionSources } from './world';
import { sumEffect } from './economy';

/**
 * Visibility spatial grid (acceleration structure only — results never depend on it): VIS_BIN_DEG
 * cells, and an EXACT cover of a sensor's range (every cell that can hold a point within `km`
 * great-circle distance, computed with the same Earth radius as distKm plus a small margin).
 * Fine cells keep each sensor's footprint tight, so a moving stack only invalidates the sensors
 * that can actually reach it.
 */
const VIS_BIN_DEG = 1;
const EARTH_R = 6371;
const LON_CELLS = Math.round(360 / VIS_BIN_DEG);
function vbin(lon: number, lat: number): number {
  let l = lon;
  while (l < -180) l += 360;
  while (l >= 180) l -= 360;
  return (Math.floor((l + 180) / VIS_BIN_DEG) % LON_CELLS) * 1000 + Math.floor((lat + 90) / VIS_BIN_DEG);
}
const coverCache = new Map<number, Map<number, Map<number, number[]>>>();
let coverCacheSize = 0;
/** Sorted cell keys covering every point within `km` of (lon, lat). Memoized (pure). */
export function visCover(lon: number, lat: number, km: number): number[] {
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
  const seen = new Set<number>();
  for (let i = lo0; i <= lo1; i++) {
    const li = ((i % LON_CELLS) + LON_CELLS) % LON_CELLS;
    for (let j = la0; j <= la1; j++) {
      const k = li * 1000 + j;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out.sort((x, y) => x - y);
}

const LEVEL_RANK: Record<ContactLevel, number> = { stale: 0, contact: 1, unidentified: 2, identified: 3 };

export function contactId(state: GameState, viewer: CountryId, stackId: string): string {
  return 'k' + hash32(`${viewer}\u0000${stackId}\u0000${state.seed}`).toString(36);
}

interface Det {
  level: ContactLevel;
  units: Set<number>; // indices of visually detected units
  domain: Domain | 'land';
  src: Set<string>;
  /** level*10 + domain priority of the best detection (order-independent merge). */
  rank: number;
}

function unitDomain(state: GameState, s: Stack, idx: number): Domain {
  const t = utype(state, s.units[idx].type);
  if (t.domain === 'air' && s.moveClass === 'air' && s.air && (s.air.state === 'landed' || s.air.state === 'refueling')) return 'land';
  if (t.family === 'helicopter') return 'air';
  return t.domain === 'strategic' ? 'land' : t.domain;
}

interface Sensor {
  key: string;
  owner: CountryId;
  ll: [number, number];
  sight: number;
  radar: number;
  sens: number;
  detects: Domain[];
  recon: boolean;
  asw: boolean;
  id: string;
}

interface TypeInfo {
  sight: number;
  radar: number;
  sens: number;
  detects: Domain[];
  recon: boolean;
  asw: boolean;
  sig: number;
  baseDomain: Domain;
  airplane: boolean;
  terrainSight: Partial<Record<string, number>>;
}
const typeInfoCache = new WeakMap<object, Map<string, TypeInfo[]>>();
let lastScenario: object | null = null;
let lastMap: Map<string, TypeInfo[]> | null = null;
function typeInfo(state: GameState, type: string, level: number): TypeInfo {
  const st0 = S(state);
  let m: Map<string, TypeInfo[]> | undefined | null = lastScenario === st0.scenario ? lastMap : typeInfoCache.get(st0.scenario);
  if (!m) {
    m = new Map();
    typeInfoCache.set(st0.scenario, m);
  }
  lastScenario = st0.scenario;
  lastMap = m;
  let arr = m.get(type);
  if (!arr) {
    arr = [];
    m.set(type, arr);
  }
  let ti = arr[level];
  if (ti) return ti;
  const t = utype(state, type);
  const st = ustats(state, { type, level } as never);
  const ts: Partial<Record<string, number>> = {};
  for (const [terr, v] of Object.entries(t.terrain)) if (v?.sight !== undefined) ts[terr] = v.sight;
  ti = {
    sight: st.sightKm,
    radar: st.radarKm,
    sens: st.radarSensitivity ?? (st.radarKm > 0 ? 1 : 0),
    detects: (st.radarDetects ?? (st.radarKm > 0 ? ['air'] : [])) as Domain[],
    recon: t.family === 'recon',
    asw: (st.attack.submarine ?? 0) > 0,
    sig: st.signature,
    baseDomain: t.family === 'helicopter' ? 'air' : t.domain === 'strategic' ? 'land' : t.domain,
    airplane: t.domain === 'air' && t.family !== 'helicopter',
    terrainSight: ts,
  };
  arr[level] = ti;
  return ti;
}

interface StackProfile {
  pos: object;
  units: object;
  len: number;
  techv: number;
  air: string | null;
  sight: number;
  radar: number;
  sens: number;
  detects: Domain[];
  recon: boolean;
  asw: boolean;
  dom: Domain[];
  sig: number[];
  ll?: [number, number];
  bin?: number;
  skey?: string;
}
const profileCache = new WeakMap<Stack, StackProfile>();
/** Sensor/target profile of a stack, cached until its position, roster, air state or tech levels change. */
function profileOf(state: GameState, s: Stack): StackProfile {
  const techv = state.ids.techv ?? 0;
  const air = s.air ? s.air.state : null;
  const c = profileCache.get(s);
  if (c && c.pos === s.pos && c.units === s.units && c.len === s.units.length && c.techv === techv && c.air === air) return c;
  let sight = 0, radar = 0, sens = 0, recon = false, asw = false;
  let det: Domain[] = [];
  const terr = s.pos.kind === 'node' ? S(state).map.terrain[s.pos.node] : null;
  const landedAir = s.moveClass === 'air' && (air === 'landed' || air === 'refueling');
  const dom: Domain[] = [];
  const sig: number[] = [];
  for (const u of s.units) {
    const ti = typeInfo(state, u.type, u.level);
    dom.push(ti.airplane && landedAir ? 'land' : ti.baseDomain);
    sig.push(ti.sig);
    if (u.hp <= 0) continue;
    const sm = terr ? ti.terrainSight[terr] ?? 1 : 1;
    if (ti.sight * sm > sight) sight = ti.sight * sm;
    if (ti.radar > radar) radar = ti.radar;
    if (ti.sens > sens) sens = ti.sens;
    if (ti.detects.length) det = det.length ? [...new Set([...det, ...ti.detects])] : ti.detects;
    if (ti.recon) recon = true;
    if (ti.asw) asw = true;
  }
  const p: StackProfile = { pos: s.pos, units: s.units, len: s.units.length, techv, air, sight, radar, sens, detects: det, recon, asw, dom, sig };
  profileCache.set(s, p);
  return p;
}

const CITY_RADAR_DOMAINS: Domain[] = ['air', 'sea', 'land'];
const NO_DOMAINS: Domain[] = [];
const DOMAIN_PRI: Record<string, number> = { air: 4, sea: 3, subsurface: 2, land: 1, strategic: 0 };
function detRank(level: ContactLevel, domain: string): number {
  return LEVEL_RANK[level] * 10 + (DOMAIN_PRI[domain] ?? 0);
}

/** Persistent per-stack record (position, bin, sensor group, territorial observer). */
interface TRec {
  s: Stack;
  pr: StackProfile;
  ll: [number, number];
  bin: number;
  moving: boolean;
  group: string | null;
  terr: CountryId | null;
  terrNode: NodeId | null;
}
interface Group {
  owner: CountryId;
  recs: TRec[];
  sensor: Sensor | null;
}
/** One sensor's detection of one target (cached between runs). */
interface Hit {
  sid: string;
  level: ContactLevel;
  units: number[];
  domain: Domain | 'land';
}
interface SensorCacheEntry {
  snap: Sensor;
  hits: Hit[];
}
interface VisCache {
  recs: Map<string, TRec>;
  list: readonly Stack[] | null;
  bins: Map<number, TRec[]>;
  binOwners: Map<number, Map<CountryId, number>>;
  groups: Map<string, Group>;
  countryGroups: Map<CountryId, Set<string>>;
  terr: Map<CountryId, TRec[]>;
  cityKey: string;
  citySensors: Map<CountryId, Sensor[]>;
  sensors: Map<string, SensorCacheEntry>;
  countryDets: Map<CountryId, Map<string, Det>>;
  countryFoot: Map<CountryId, Map<string, number[]>>;
  binToCountries: Map<number, Map<CountryId, number>>;
  ownv: number;
  result: Map<CountryId, Map<string, Det>>;
}
const visCaches = new WeakMap<GameState, VisCache>();
let incrementalEnabled = true;
/** Test hook: disable the incremental cache (every run becomes a full recompute). */
export function setIncrementalVisibility(on: boolean): void {
  incrementalEnabled = on;
}
function sameSensor(a: Sensor | undefined, b: Sensor): boolean {
  if (!a) return false;
  if (a === b) return true;
  if (a.id !== b.id || a.ll[0] !== b.ll[0] || a.ll[1] !== b.ll[1] || a.sight !== b.sight || a.radar !== b.radar || a.sens !== b.sens || a.recon !== b.recon || a.asw !== b.asw) return false;
  if (a.detects !== b.detects) {
    if (a.detects.length !== b.detects.length) return false;
    for (let i = 0; i < a.detects.length; i++) if (a.detects[i] !== b.detects[i]) return false;
  }
  return true;
}
function newCache(): VisCache {
  return { recs: new Map(), list: null, bins: new Map(), binOwners: new Map(), groups: new Map(), countryGroups: new Map(), terr: new Map(), cityKey: '', citySensors: new Map(), sensors: new Map(), countryDets: new Map(), countryFoot: new Map(), binToCountries: new Map(), ownv: -1, result: new Map() };
}
const idCache = new Map<string, number>();
function idn(id: string): number {
  let n = idCache.get(id);
  if (n === undefined) {
    let i = id.length;
    while (i > 0 && id.charCodeAt(i - 1) >= 48 && id.charCodeAt(i - 1) <= 57) i--;
    n = Number(id.slice(i)) || 0;
    if (idCache.size > 500000) idCache.clear();
    idCache.set(id, n);
  }
  return n;
}
function binInsert(vc: VisCache, r: TRec): void {
  let l = vc.bins.get(r.bin);
  if (!l) {
    l = [];
    vc.bins.set(r.bin, l);
  }
  const n = idn(r.s.id);
  let lo = 0, hi = l.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (idn(l[mid].s.id) < n) lo = mid + 1;
    else hi = mid;
  }
  l.splice(lo, 0, r);
  const oc = vc.binOwners.get(r.bin) ?? vc.binOwners.set(r.bin, new Map()).get(r.bin)!;
  oc.set(r.s.owner, (oc.get(r.s.owner) ?? 0) + 1);
}
function binRemove(vc: VisCache, r: TRec): void {
  const l = vc.bins.get(r.bin);
  if (l) {
    const i = l.indexOf(r);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) vc.bins.delete(r.bin);
  }
  const oc = vc.binOwners.get(r.bin);
  if (oc) {
    const v = (oc.get(r.s.owner) ?? 0) - 1;
    if (v > 0) oc.set(r.s.owner, v);
    else oc.delete(r.s.owner);
    if (!oc.size) vc.binOwners.delete(r.bin);
  }
}
function groupKey(r: TRec): string | null {
  const pr = r.pr;
  if (pr.sight <= 0 && pr.radar <= 0) return null;
  const s = r.s;
  return s.pos.kind === 'node' ? (pr.skey ??= `${s.owner}|${s.pos.node}|${pr.recon ? 1 : 0}${pr.asw ? 1 : 0}`) : `${s.owner}|${r.ll[0]},${r.ll[1]}|${pr.recon ? 1 : 0}${pr.asw ? 1 : 0}|m${s.id}`;
}
function rebuildGroup(state: GameState, g: Group, key: string): void {
  if (!g.recs.length) {
    g.sensor = null;
    return;
  }
  let sight = 0, radar = 0, sens = 0;
  let det: Domain[] = NO_DOMAINS;
  const first = g.recs[0];
  const rm = state.countries[g.owner]?.modifiers['radar_range_mult'];
  for (const r of g.recs) {
    const pr = r.pr;
    const rr = rm !== undefined && pr.radar > 0 ? pr.radar * rm : pr.radar;
    if (pr.sight > sight) sight = pr.sight;
    if (rr > radar) radar = rr;
    if (pr.sens > sens) sens = pr.sens;
    if (pr.detects.length) det = det.length ? [...new Set([...det, ...pr.detects])] : pr.detects;
  }
  g.sensor = { key, owner: g.owner, ll: first.ll, sight, radar, sens, detects: det, recon: first.pr.recon, asw: first.pr.asw, id: first.s.id };
}
const citySensorCache = new WeakMap<object, Map<string, Sensor>>();
const citySig = new WeakMap<Sensor, number>();
const cityKeysCache = new WeakMap<object, string[]>();
function sortedCityKeys(state: GameState): string[] {
  let keys = cityKeysCache.get(state.cities);
  if (!keys) {
    keys = Object.keys(state.cities).sort();
    cityKeysCache.set(state.cities, keys);
  }
  return keys;
}
function buildCitySensors(state: GameState): Map<CountryId, Sensor[]> {
  const out = new Map<CountryId, Sensor[]>();
  const m = S(state).map;
  let cs = citySensorCache.get(state.cities);
  if (!cs) {
    cs = new Map();
    citySensorCache.set(state.cities, cs);
  }
  for (const k of sortedCityKeys(state)) {
    const c = state.cities[k];
    const o = state.provinces[c.node]?.owner;
    if (!o) continue;
    const rm = state.countries[o]?.modifiers['radar_range_mult'] ?? 1;
    let bsig = c.buildings.length + rm * 1e6;
    for (const b of c.buildings) bsig = bsig * 31 + b.level * 131 + b.condition * 7 + b.type.length;
    let sen = cs.get(k);
    if (sen && sen.owner === o && citySig.get(sen) === bsig) {
      (out.get(o) ?? out.set(o, []).get(o)!).push(sen);
      continue;
    }
    const radar = c.buildings.length ? sumEffect(state, c.buildings, 'radarKm') * rm : 0;
    const sens = radar > 0 ? Math.max(1, Math.floor(sumEffect(state, c.buildings, 'radarSensitivity', false))) : 0;
    if (!sen || sen.owner !== o || sen.radar !== radar || sen.sens !== sens) {
      sen = { key: `city:${k}`, owner: o, ll: [m.lon[c.node], m.lat[c.node]], sight: CITY_SIGHT_KM, radar, sens, detects: radar > 0 ? CITY_RADAR_DOMAINS : NO_DOMAINS, recon: false, asw: false, id: `city:${k}` };
      cs.set(k, sen);
    }
    citySig.set(sen, bsig);
    (out.get(o) ?? out.set(o, []).get(o)!).push(sen);
  }
  return out;
}

function detectFrom(state: GameState, c: CountryId, sen: Sensor, vc: VisCache, keys: number[]): Hit[] {
  const r = Math.max(sen.sight, sen.radar);
  const m = S(state).map;
  const hits: Hit[] = [];
  for (const k of keys) {
    const l = vc.bins.get(k);
    if (!l) continue;
    const os = vc.binOwners.get(k)!;
    if (os.size === 1 && os.has(c)) continue; // only own stacks there
    for (const tg of l) {
      const s = tg.s;
      if (s.owner === c) continue;
      if (Math.abs(tg.ll[1] - sen.ll[1]) * 111 > r + 1) continue; // cheap latitude reject
      const d = distKm(sen.ll[0], sen.ll[1], tg.ll[0], tg.ll[1]);
      if (d > r) continue;
      const vis: number[] = [];
      let radHit = false;
      let radDomain: Domain | 'land' = 'land';
      const dom = tg.pr.dom, sig = tg.pr.sig;
      for (let i = 0; i < dom.length; i++) {
        if (d <= sen.sight && (dom[i] !== 'subsurface' || sen.asw) && (sig[i] < 3 || d <= sen.sight * STEALTH_VISUAL_FRACTION)) vis.push(i);
        if (d <= sen.radar && sig[i] <= sen.sens && sen.detects.includes(dom[i])) {
          if (!radHit || (DOMAIN_PRI[dom[i]] ?? 0) > (DOMAIN_PRI[radDomain] ?? 0)) radDomain = dom[i];
          radHit = true;
        }
      }
      if (vis.length) {
        const inCity = s.pos.kind === 'node' && state.provinces[s.pos.node]?.owner === c && m.cityByNode.has(s.pos.node);
        const ident = sen.recon || d <= sen.sight * IDENTIFY_FRACTION || inCity;
        hits.push({ sid: s.id, level: ident ? 'identified' : 'unidentified', units: vis, domain: dom[vis[0]] });
      } else if (radHit) hits.push({ sid: s.id, level: 'contact', units: [], domain: radDomain });
    }
  }
  return hits;
}

/**
 * Detections per country — INCREMENTAL and order-independent.
 * Persistent per-stack records live in spatial bins (each bin sorted by stack id). Each run only
 * stacks whose position/roster/air state changed (or that are in motion) are re-binned; their bins
 * are marked changed. Sensor groups (co-located stacks of one owner) are rebuilt only when a member
 * changed. A country is recomputed only if its sensors, its territorial observations, or any bin
 * within its sensor footprint changed (or ownership changed); within a recomputed country each
 * sensor's hit list is reused unless its footprint changed. The merge is order-independent
 * (max level, highest-priority domain, union of units/sources), so results equal a full recompute
 * exactly (tested on random ticks).
 */
export function computeDetections(state: GameState, opts: { full?: boolean } = {}): Map<CountryId, Map<string, Det>> {
  const useCache = incrementalEnabled && !opts.full;
  let vc = useCache ? visCaches.get(state) : undefined;
  if (!vc) {
    vc = newCache();
    if (useCache) visCaches.set(state, vc);
  }
  const mm = S(state).map;
  const list = stacksReadonly(state);
  const ownv = state.ids.ownv ?? 0;
  let ownChanged = vc.ownv !== ownv;
  // targeted ownership change: only the countries that gained/lost territory are recomputed
  const ownLog = !useCache ? null : ownChanged && vc.ownv >= 0 ? takeOwnerChanges(state, vc.ownv) : (takeOwnerChanges(state, -2), null);
  const ownCountries = ownLog ? ownLog.countries : null;
  if (ownLog) ownChanged = false;
  const terrRecheck = !!ownLog;
  vc.ownv = ownv;
  const changedBins = new Set<number>();
  const dirtyGroups = new Set<string>();
  const dirtyCountries = new Set<CountryId>();
  const touchGroup = (r: TRec, add: boolean) => {
    const gk = r.group;
    if (!gk) return;
    let g = vc!.groups.get(gk);
    if (!g) {
      g = { owner: r.s.owner, recs: [], sensor: null };
      vc!.groups.set(gk, g);
      (vc!.countryGroups.get(r.s.owner) ?? vc!.countryGroups.set(r.s.owner, new Set()).get(r.s.owner)!).add(gk);
    }
    if (add) {
      const n = idn(r.s.id);
      let i = 0;
      while (i < g.recs.length && idn(g.recs[i].s.id) < n) i++;
      g.recs.splice(i, 0, r);
    } else {
      const i = g.recs.indexOf(r);
      if (i >= 0) g.recs.splice(i, 1);
    }
    dirtyGroups.add(gk);
    dirtyCountries.add(r.s.owner);
  };
  const terrOf = (r: TRec): [CountryId | null, NodeId | null] => {
    const s = r.s;
    const node: NodeId | null = s.pos.kind === 'node' ? s.pos.node : s.pos.kind === 'edge' ? s.pos.to : null;
    if (node === null) return [null, null];
    const o = state.provinces[node]?.owner ?? null;
    if (!o || o === s.owner) return [null, null];
    return [o, node];
  };
  const removeRec = (r: TRec) => {
    binRemove(vc!, r);
    changedBins.add(r.bin);
    touchGroup(r, false);
    if (r.terr) dirtyCountries.add(r.terr);
    vc!.recs.delete(r.s.id);
  };
  const addRec = (s: Stack, pr: StackProfile) => {
    const ll: [number, number] = s.pos.kind === 'node' ? (pr.ll ??= [mm.lon[s.pos.node], mm.lat[s.pos.node]]) : stackLL(state, s);
    const bin = s.pos.kind === 'node' ? (pr.bin ??= vbin(ll[0], ll[1])) : vbin(ll[0], ll[1]);
    const r: TRec = { s, pr, ll, bin, moving: s.pos.kind !== 'node', group: null, terr: null, terrNode: null };
    r.group = groupKey(r);
    [r.terr, r.terrNode] = terrOf(r);
    vc!.recs.set(s.id, r);
    binInsert(vc!, r);
    changedBins.add(bin);
    touchGroup(r, true);
    if (r.terr) dirtyCountries.add(r.terr);
  };
  // removed stacks (only when the stack list changed)
  if (vc.list !== list) {
    const live = new Set<string>();
    for (const s of list) if (!s.aboard) live.add(s.id);
    for (const r of [...vc.recs.values()]) if (!live.has(r.s.id) || state.stacks[r.s.id] !== r.s) removeRec(r);
    vc.list = list;
  }
  for (const s of list) {
    if (s.aboard) continue;
    const pr = profileOf(state, s);
    const r = vc.recs.get(s.id);
    if (!r) addRec(s, pr);
    else if (r.s !== s || r.pr !== pr || r.moving) {
      removeRec(r);
      addRec(s, pr);
    } else if (ownChanged || terrRecheck) {
      const [t, n] = terrOf(r);
      if (t !== r.terr || n !== r.terrNode) {
        if (r.terr) dirtyCountries.add(r.terr);
        if (t) dirtyCountries.add(t);
        r.terr = t;
        r.terrNode = n;
      }
    }
  }
  for (const gk of dirtyGroups) {
    const g = vc.groups.get(gk)!;
    rebuildGroup(state, g, gk);
    if (!g.recs.length) {
      vc.groups.delete(gk);
      vc.countryGroups.get(g.owner)?.delete(gk);
    }
  }
  const cityKey = `${ownv}|${state.ids.econv ?? 0}|${state.ids.techv ?? 0}`;
  if (vc.cityKey !== cityKey) {
    const next = buildCitySensors(state);
    for (const c of new Set([...next.keys(), ...vc.citySensors.keys()])) {
      const a = vc.citySensors.get(c) ?? [];
      const b = next.get(c) ?? [];
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) dirtyCountries.add(c);
    }
    vc.citySensors = next;
    vc.cityKey = cityKey;
  }
  if (ownCountries) for (const c of ownCountries) dirtyCountries.add(c);
  if (ownChanged || dirtyCountries.size || changedBins.size) {
    // territorial observations per country (rebuilt only when something moved or ownership changed)
    vc.terr = new Map();
    for (const r of vc.recs.values()) if (r.terr) (vc.terr.get(r.terr) ?? vc.terr.set(r.terr, []).get(r.terr)!).push(r);
    for (const l of vc.terr.values()) l.sort((a, b) => idn(a.s.id) - idn(b.s.id));
  } else return vc.result;
  for (const k of changedBins) {
    const m = vc.binToCountries.get(k);
    if (m) for (const c of m.keys()) dirtyCountries.add(c);
  }
  for (const c of state.countryOrder) {
    if (!ownChanged && !dirtyCountries.has(c) && vc.countryDets.has(c)) continue;
    if ((globalThis as any).__wcprof) (globalThis as any).__wcprof['v.dirtyC'] = ((globalThis as any).__wcprof['v.dirtyC'] ?? 0) + 1;
    const sens: Sensor[] = [];
    for (const gk of vc.countryGroups.get(c) ?? []) {
      const g = vc.groups.get(gk);
      if (g?.sensor) sens.push(g.sensor);
    }
    for (const x of vc.citySensors.get(c) ?? []) sens.push(x);
    sens.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const dets = new Map<string, Det>();
    const upd = (sid: string, level: ContactLevel, unitIdx: number[], domain: Domain | 'land', src: string) => {
      const rank = detRank(level, domain);
      let d = dets.get(sid);
      if (!d) {
        d = { level, units: new Set(), domain, src: new Set(), rank };
        dets.set(sid, d);
      } else if (rank > d.rank) {
        d.level = level;
        d.domain = domain;
        d.rank = rank;
      }
      if (level !== 'contact') for (const i of unitIdx) d.units.add(i);
      d.src.add(src);
    };
    const keyRefs: number[][] = [];
    const sensKeys: string[] = [];
    for (const sen of sens) {
      const r = Math.max(sen.sight, sen.radar);
      if (r <= 0) continue;
      const keys = visCover(sen.ll[0], sen.ll[1], r);
      keyRefs.push(keys);
      sensKeys.push(sen.key);
      const entry = vc.sensors.get(sen.key);
      let valid = !ownChanged && !(ownCountries && ownCountries.has(c)) && !!entry && sameSensor(entry.snap, sen);
      if (valid) for (const k of keys) if (changedBins.has(k)) { valid = false; break; }
      let hits: Hit[];
      if (valid) hits = entry!.hits;
      else {
        if ((globalThis as any).__wcprof) (globalThis as any).__wcprof['v.senRecomp'] = ((globalThis as any).__wcprof['v.senRecomp'] ?? 0) + 1;
        hits = detectFrom(state, c, sen, vc, keys);
        vc.sensors.set(sen.key, { snap: sen, hits });
      }
      if ((globalThis as any).__wcprof) { (globalThis as any).__wcprof['v.sensVisited'] = ((globalThis as any).__wcprof['v.sensVisited'] ?? 0) + 1; (globalThis as any).__wcprof['v.hitsMerged'] = ((globalThis as any).__wcprof['v.hitsMerged'] ?? 0) + hits.length; }
      for (const h of hits) upd(h.sid, h.level, h.units, h.domain, sen.id);
    }
    for (const r of vc.terr.get(c) ?? []) {
      const vis: number[] = [];
      const dom = r.pr.dom;
      for (let i = 0; i < dom.length; i++) {
        if (dom[i] === 'subsurface' || dom[i] === 'air') continue;
        if (r.pr.sig[i] >= 3) continue;
        vis.push(i);
      }
      if (vis.length) upd(r.s.id, mm.cityByNode.has(r.terrNode as number) ? 'identified' : 'unidentified', vis, dom[vis[0]], `territory:${r.terrNode}`);
    }
    // footprint index (bin → country refcounts), updated per sensor only when its bin list changed
    let foot = vc.countryFoot.get(c);
    if (!foot) {
      foot = new Map();
      vc.countryFoot.set(c, foot);
    }
    const inc = (keys: number[], d: number) => {
      for (const k of keys) {
        let m = vc!.binToCountries.get(k);
        if (!m) {
          m = new Map();
          vc!.binToCountries.set(k, m);
        }
        const v = (m.get(c) ?? 0) + d;
        if (v > 0) m.set(c, v);
        else {
          m.delete(c);
          if (!m.size) vc!.binToCountries.delete(k);
        }
      }
    };
    const seenSen = new Set<string>();
    for (let i = 0; i < sensKeys.length; i++) {
      const sk = sensKeys[i];
      seenSen.add(sk);
      const prev = foot.get(sk);
      if (prev === keyRefs[i]) continue;
      if (prev) inc(prev, -1);
      inc(keyRefs[i], 1);
      foot.set(sk, keyRefs[i]);
    }
    for (const [sk, keys] of [...foot]) if (!seenSen.has(sk)) {
      inc(keys, -1);
      foot.delete(sk);
    }
    vc.countryDets.set(c, dets);
    vc.result.set(c, dets);
  }
  if (vc.sensors.size > 4 * (vc.recs.size + 2000)) {
    const live = new Set<string>();
    for (const g of vc.groups.values()) if (g.sensor) live.add(g.sensor.key);
    for (const l of vc.citySensors.values()) for (const x of l) live.add(x.key);
    for (const k of [...vc.sensors.keys()]) if (!live.has(k)) vc.sensors.delete(k);
  }
  return vc.result;
}

interface ViewerMemo {
  srcs: CountryId[];
  dets: (Map<string, Det> | undefined)[];
  merged: Map<string, Det>;
  staleCount: number;
}
const viewerMemos = new WeakMap<GameState, Map<CountryId, ViewerMemo>>();

/**
 * Recompute every viewer's contact table.
 * A current contact is only rewritten when a visible field changes (level, domain, position,
 * owner, member count, unit types, sources); its `observedAt` then records that tick. The view
 * reports current contacts as observed at `clock.lastVisibility`. When a contact goes stale its
 * `observedAt` becomes the last refresh at which it was still seen and its unit HP snapshot is
 * frozen. Viewers whose inputs are unchanged (same detection maps, same vision sources) are
 * skipped except for stale-contact expiry — results are identical to processing every viewer.
 */
export function updateVisibility(state: GameState): void {
  const P = (globalThis as any).__wcprof as Record<string, number> | undefined;
  const t0 = P ? performance.now() : 0;
  const dets = computeDetections(state);
  if (P) P['v.detect'] = (P['v.detect'] ?? 0) + performance.now() - t0;
  const t = state.clock.tick;
  const prevRefresh = state.clock.lastVisibility ?? t;
  let memos = viewerMemos.get(state);
  if (!memos) {
    memos = new Map();
    viewerMemos.set(state, memos);
  }
  let dirtyV = 0;
  for (const viewer of state.countryOrder) {
    const table = (state.contacts[viewer] ??= {});
    const srcs = visionSources(state, viewer);
    const srcDets = srcs.map((c) => dets.get(c));
    const memo = memos.get(viewer);
    let clean = !!memo && memo.srcs === srcs && memo.dets.length === srcDets.length;
    if (clean) for (let i = 0; i < srcDets.length; i++) if (memo!.dets[i] !== srcDets[i]) { clean = false; break; }
    if (clean) {
      if (memo!.staleCount > 0) memo!.staleCount = expireStale(table, t);
      continue;
    }
    dirtyV++;
    let merged = new Map<string, Det>();
    if (srcs.length === 1) {
      const d = srcDets[0];
      if (d) merged = d;
    } else for (const d of srcDets) {
      if (!d) continue;
      for (const [sid, det] of d) {
        const st = state.stacks[sid];
        if (!st || st.owner === viewer) continue;
        let x = merged.get(sid);
        if (!x) {
          x = { level: det.level, units: new Set(det.units), domain: det.domain, src: new Set(det.src), rank: det.rank };
          merged.set(sid, x);
        } else {
          if (det.rank > x.rank) { x.level = det.level; x.domain = det.domain; x.rank = det.rank; }
          for (const u of det.units) x.units.add(u);
          for (const s of det.src) x.src.add(s);
        }
      }
    }
    const allied = srcs.length > 1 ? new Set(srcs) : null;
    const seen = new Set<string>();
    const ids = cidCache(state, viewer);
    for (const [sid, det] of merged) {
      const s = state.stacks[sid];
      if (!s || s.owner === viewer) continue;
      if (allied && allied.has(s.owner)) continue; // allied stacks are projected live by the view
      let cid = ids.get(sid);
      if (!cid) {
        cid = contactId(state, viewer, sid);
        ids.set(sid, cid);
      }
      seen.add(cid);
      const ll = stackLL(state, s);
      const prev = table[cid];
      const idx = det.level === 'contact' ? [] : [...det.units].sort((a, b) => a - b);
      const lon = round4(ll[0]), lat = round4(ll[1]);
      const node = s.pos.kind === 'node' ? s.pos.node : null;
      const owner = det.level === 'contact' ? null : s.owner;
      const count = det.level === 'contact' ? null : idx.length;
      if (prev && prev.level === det.level && prev.domain === det.domain && prev.stack === sid) {
        let changed = false;
        if (prev.lonlat[0] !== lon || prev.lonlat[1] !== lat) { prev.lonlat = [lon, lat]; changed = true; }
        if (prev.node !== node) { prev.node = node; changed = true; }
        if (prev.owner !== owner) { prev.owner = owner; changed = true; }
        if (prev.count !== count) { prev.count = count; changed = true; }
        if (det.level === 'identified') {
          const u = prev.units;
          let same = !!u && u.length === idx.length;
          if (same) for (let i = 0; i < idx.length; i++) if (u![i].type !== s.units[idx[i]].type || u![i].i !== idx[i]) { same = false; break; }
          if (!same) { prev.units = idx.map((i) => ({ type: s.units[i].type, hpPct: hpPct(s, i), i })); changed = true; }
        }
        let sameSrc = det.src.size === prev.sources.length;
        if (sameSrc) for (const x of prev.sources) if (!det.src.has(x)) { sameSrc = false; break; }
        if (!sameSrc) { prev.sources = [...det.src].sort(); changed = true; }
        if (changed) prev.observedAt = t;
        continue;
      }
      table[cid] = {
        id: cid,
        stack: sid,
        level: det.level,
        domain: det.domain,
        lonlat: [lon, lat],
        node,
        observedAt: t,
        firstSeenAt: prev?.firstSeenAt ?? t,
        owner,
        count,
        units: det.level === 'identified' ? idx.map((i) => ({ type: s.units[i].type, hpPct: hpPct(s, i), i })) : null,
        sources: [...det.src].sort(),
      };
    }
    let stale = 0;
    for (const cid of Object.keys(table)) {
      if (seen.has(cid)) continue;
      const c = table[cid];
      if (c.level !== 'stale') {
        // freeze: last seen at the previous refresh, with the HP snapshot of that moment
        c.level = 'stale';
        c.sources = [];
        c.observedAt = Math.max(c.observedAt, prevRefresh);
        const st = state.stacks[c.stack];
        if (c.units && st) c.units = c.units.map((u) => ({ type: u.type, hpPct: u.i !== undefined && st.units[u.i] && st.units[u.i].type === u.type ? hpPct(st, u.i) : u.hpPct, i: u.i }));
      }
      if (t - c.observedAt > STALE_KEEP_MIN) delete table[cid];
      else stale++;
    }
    memos.set(viewer, { srcs, dets: srcDets, merged, staleCount: stale });
  }
  state.clock.lastVisibility = t;
  if (P) P['v.dirtyViewers'] = (P['v.dirtyViewers'] ?? 0) + dirtyV;
}
function expireStale(table: Record<string, Contact>, t: number): number {
  let stale = 0;
  for (const cid of Object.keys(table)) {
    const c = table[cid];
    if (c.level !== 'stale') continue;
    if (t - c.observedAt > STALE_KEEP_MIN) delete table[cid];
    else stale++;
  }
  return stale;
}
function hpPct(s: Stack, i: number): number {
  const u = s.units[i];
  return Math.round((u.hp / u.maxHp) * 100);
}
const cidCaches = new WeakMap<GameState, Map<CountryId, Map<string, string>>>();
function cidCache(state: GameState, viewer: CountryId): Map<string, string> {
  let m = cidCaches.get(state);
  if (!m) {
    m = new Map();
    cidCaches.set(state, m);
  }
  let v = m.get(viewer);
  if (!v) {
    v = new Map();
    m.set(viewer, v);
  }
  return v;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Is the stack currently (not stale) observed by viewer? */
export function canSee(state: GameState, viewer: CountryId, stackId: string): boolean {
  const s = state.stacks[stackId];
  if (!s) return false;
  if (s.owner === viewer) return true;
  if (s.owner !== viewer && visionSources(state, viewer).includes(s.owner) && !s.aboard) return true;
  const c = state.contacts[viewer]?.[contactId(state, viewer, stackId)];
  return !!c && c.level !== 'stale';
}
export function contactLevel(state: GameState, viewer: CountryId, stackId: string): ContactLevel | null {
  const c = state.contacts[viewer]?.[contactId(state, viewer, stackId)];
  return c ? c.level : null;
}
/** Resolve a viewer's contact id to a real stack id (only if currently observed). */
export function resolveContact(state: GameState, viewer: CountryId, cid: string): string | null {
  const c = state.contacts[viewer]?.[cid];
  if (c && c.level !== 'stale' && state.stacks[c.stack]) return c.stack;
  // live projection of allied (vision-source) stacks
  const srcs = visionSources(state, viewer);
  if (srcs.length > 1) for (const s of sortedStacks(state)) if (s.owner !== viewer && srcs.includes(s.owner) && !s.aboard && contactId(state, viewer, s.id) === cid) return s.id;
  return null;
}

/** Allied (vision-source) stacks are fully identified and projected live (never stored as contacts). */
export function alliedContacts(state: GameState, viewer: CountryId): Contact[] {
  const srcs = visionSources(state, viewer);
  if (srcs.length <= 1) return [];
  const ids = cidCache(state, viewer);
  const out: Contact[] = [];
  const t = state.clock.tick;
  for (const s of sortedStacks(state)) {
    if (s.owner === viewer || s.aboard || !srcs.includes(s.owner)) continue;
    let cid = ids.get(s.id);
    if (!cid) {
      cid = contactId(state, viewer, s.id);
      ids.set(s.id, cid);
    }
    const ll = stackLL(state, s);
    out.push({ id: cid, stack: s.id, level: 'identified', domain: unitDomain(state, s, 0), lonlat: [round4(ll[0]), round4(ll[1])], node: s.pos.kind === 'node' ? s.pos.node : null, observedAt: t, firstSeenAt: t, owner: s.owner, count: s.units.length, units: s.units.map((u) => ({ type: u.type, hpPct: Math.round((u.hp / u.maxHp) * 100) })), sources: [`ally:${s.owner}`] });
  }
  return out;
}
/** Does viewer currently observe a node (any sensor/territory covering it)? */
export function observesNode(state: GameState, viewer: CountryId, node: NodeId): boolean {
  const m = S(state).map;
  for (const src of visionSources(state, viewer)) {
    if (state.provinces[node]?.owner === src) return true;
    for (const s of Object.values(state.stacks)) {
      if (s.owner !== src || s.aboard) continue;
      const ll = stackLL(state, s);
      const sight = Math.max(0, ...s.units.map((u) => Math.max(ustats(state, u).sightKm, ustats(state, u).radarKm)));
      if (distKm(ll[0], ll[1], m.lon[node], m.lat[node]) <= sight) return true;
    }
    for (const k of Object.keys(state.cities)) {
      const c = state.cities[k];
      if (state.provinces[c.node]?.owner !== src) continue;
      if (distKm(m.lon[c.node], m.lat[c.node], m.lon[node], m.lat[node]) <= CITY_SIGHT_KM) return true;
    }
  }
  return false;
}
