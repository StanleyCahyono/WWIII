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
import { distKm, FINE_BIN_DEG, fineBin as vbin, fineCover as visCover } from './mapindex';
import { hash32 } from '../rng';
import { cmpId, idNum, sortedStacks, stacksOfOwner, stacksReadonly, stackLL, takeOwnerChanges, ustats, utype, visionSources } from './world';
import { econChangesSince, sumEffect } from './economy';
import { derived } from '../derived';

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
  /** memo: sorted unit indices (Det objects are replaced, never mutated, once published) */
  sorted?: number[];
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
  /** a stack sensor in transit (its cover is not memoized) */
  moving?: boolean;
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
  types: string[];
  levels: number[];
  alive: boolean[];
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
  if (c && c.pos === s.pos && c.len === s.units.length && c.air === air) {
    if (c.units === s.units && c.techv === techv) return c;
    // a new roster array, or a tech completion elsewhere, with the same members (type, level,
    // alive) yields the same profile (it depends only on the members' own type/level)
    let same = true;
    for (let i = 0; i < s.units.length; i++) {
      const u = s.units[i];
      if (u.type !== c.types[i] || u.level !== c.levels[i] || (u.hp > 0) !== c.alive[i]) { same = false; break; }
    }
    if (same) {
      c.units = s.units;
      c.techv = techv;
      return c;
    }
  }
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
  const p: StackProfile = { pos: s.pos, units: s.units, len: s.units.length, techv, air, sight, radar, sens, detects: det, recon, asw, dom, sig, types: s.units.map((u) => u.type), levels: s.units.map((u) => u.level), alive: s.units.map((u) => u.hp > 0) };
  profileCache.set(s, p);
  return p;
}

const CITY_RADAR_DOMAINS: Domain[] = ['air', 'sea', 'land'];
const NO_UNITS: number[] = [];
const NO_HITS: Hit[] = [];
const NO_DOMAINS: Domain[] = [];
const DOMAIN_PRI: Record<string, number> = { air: 4, sea: 3, subsurface: 2, land: 1, strategic: 0 };
function detRank(level: ContactLevel, domain: string): number {
  return LEVEL_RANK[level] * 10 + (DOMAIN_PRI[domain] ?? 0);
}

/** Persistent per-stack record (position, bin, sensor group, territorial observer). */
interface TRec {
  s: Stack;
  /** numeric stack id (sort key inside cells and groups) */
  n: number;
  pr: StackProfile;
  ll: [number, number];
  /** Math.cos of ll's latitude in radians (the per-point factor of distKm, cached) */
  cl: number;
  bin: number;
  moving: boolean;
  group: string | null;
  /** the group object of `group` (set while the record is a member) */
  g: Group | null;
  terr: CountryId | null;
  terrNode: NodeId | null;
}
interface Group {
  key: string;
  /** sensor slot of `key` */
  slot: number;
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
  /** source id (sensor id) — a Hit is also the sensor's Contribution */
  src: string;
}
/** One source's contribution to a country's detection of a target (sensor hit or territory). */
type Contribution = Omit<Hit, 'sid'>;
interface SensorEntry {
  snap: Sensor;
  owner: CountryId;
  hits: Hit[];
  keys: number[];
}
interface VisCache {
  /** Cache generation (a reset cache gets a new one; viewer memos compare it). */
  gen: number;
  recs: Map<string, TRec>;
  list: readonly Stack[] | null;
  /** dense cell index (`cellIx`) → records in the cell (sorted by stack id) + per-owner counts */
  cells: (Cell | undefined)[];
  groups: Map<string, Group>;
  /** economy version the city sensors reflect (-1 = never built) */
  cityEconv: number;
  /** last seen radar_range_mult per country */
  rm: Map<CountryId, number | undefined>;
  /** city key → current city sensor */
  citySensors: Map<string, Sensor>;
  /**
   * Sensor slots: every sensor key (group key or `city:<key>`) is interned once to a small integer
   * (never released); the per-sensor tables below are arrays indexed by slot.
   */
  slotOf: Map<string, number>;
  keyOf: string[];
  /** per slot: stamp of the last run that marked the sensor invalid */
  stamp: number[];
  epoch: number;
  /** current sensor snapshot per slot (groups and cities) */
  cur: (Sensor | undefined)[];
  /** evaluated sensors (hits + covered cells) per slot */
  sensors: (SensorEntry | undefined)[];
  /** dense cell index → slots of the sensors whose cover includes the cell */
  cellSensors: (Set<number> | undefined)[];
  /** country → target → source key → contribution */
  contrib: Map<CountryId, Map<string, Map<string, Contribution>>>;
  /** country → target → merged detection (persistent; Det objects replaced when they change) */
  dets: Map<CountryId, Map<string, Det>>;
  /** target → countries holding a Det for it */
  detBy: Map<string, Set<CountryId>>;
  /** country → targets whose Det changed or that moved, since the last updateVisibility */
  touched: Map<CountryId, Set<string>>;
  ownv: number;
}
const visCaches = new WeakMap<GameState, VisCache>();
let incrementalEnabled = true;
let cacheGen = 0;
/** Test hook: disable the incremental cache (every run becomes a full recompute). */
export function setIncrementalVisibility(on: boolean): void {
  incrementalEnabled = on;
}
function sameSensor(a: Sensor | undefined, b: Sensor): boolean {
  if (!a) return false;
  if (a === b) return true;
  if (a.id !== b.id || a.owner !== b.owner || a.ll[0] !== b.ll[0] || a.ll[1] !== b.ll[1] || a.sight !== b.sight || a.radar !== b.radar || a.sens !== b.sens || a.recon !== b.recon || a.asw !== b.asw) return false;
  if (a.detects !== b.detects) {
    if (a.detects.length !== b.detects.length) return false;
    for (let i = 0; i < a.detects.length; i++) if (a.detects[i] !== b.detects[i]) return false;
  }
  return true;
}
function slotFor(vc: VisCache, key: string): number {
  let n = vc.slotOf.get(key);
  if (n === undefined) {
    n = vc.keyOf.length;
    vc.keyOf.push(key);
    vc.stamp.push(-1);
    vc.cur.push(undefined);
    vc.sensors.push(undefined);
    vc.slotOf.set(key, n);
  }
  return n;
}
function newCache(): VisCache {
  return { gen: ++cacheGen, recs: new Map(), list: null, cells: new Array(CELL_COUNT), groups: new Map(), cityEconv: -1, rm: new Map(), citySensors: new Map(), slotOf: new Map(), keyOf: [], stamp: [], epoch: 0, cur: [], sensors: [], cellSensors: new Array(CELL_COUNT), contrib: new Map(), dets: new Map(), detBy: new Map(), touched: new Map(), ownv: -1 };
}
interface Cell {
  recs: TRec[];
  owners: Map<CountryId, number>;
}
/**
 * Fine-cell keys are `lonIndex * 1000 + latIndex` (lonIndex < 360 / FINE_BIN_DEG, latIndex ≤
 * 180 / FINE_BIN_DEG); they map 1:1 onto a dense array index.
 */
const LAT_SLOTS = Math.round(180 / FINE_BIN_DEG) + 1;
const CELL_COUNT = Math.round(360 / FINE_BIN_DEG) * LAT_SLOTS;
function cellIx(k: number): number {
  return ((k / 1000) | 0) * LAT_SLOTS + (k % 1000);
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
  const ix = cellIx(r.bin);
  let cell = vc.cells[ix];
  if (!cell) {
    cell = { recs: [], owners: new Map() };
    vc.cells[ix] = cell;
  }
  const l = cell.recs;
  const n = r.n;
  let lo = 0, hi = l.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (l[mid].n < n) lo = mid + 1;
    else hi = mid;
  }
  l.splice(lo, 0, r);
  const oc = cell.owners;
  oc.set(r.s.owner, (oc.get(r.s.owner) ?? 0) + 1);
}
function binRemove(vc: VisCache, r: TRec): void {
  const ix = cellIx(r.bin);
  const cell = vc.cells[ix];
  if (!cell) return;
  const l = cell.recs;
  const i = l.indexOf(r);
  if (i >= 0) l.splice(i, 1);
  const oc = cell.owners;
  const v = (oc.get(r.s.owner) ?? 0) - 1;
  if (v > 0) oc.set(r.s.owner, v);
  else oc.delete(r.s.owner);
  if (!l.length) vc.cells[ix] = undefined;
}
/** Co-located stacks of one owner form one sensor group; a stack in transit is its own group. */
function groupKey(r: TRec): string | null {
  const pr = r.pr;
  if (pr.sight <= 0 && pr.radar <= 0) return null;
  const s = r.s;
  return s.pos.kind === 'node' ? (pr.skey ??= `${s.owner}|${s.pos.node}|${pr.recon ? 1 : 0}${pr.asw ? 1 : 0}`) : `${s.owner}|m${s.id}|${pr.recon ? 1 : 0}${pr.asw ? 1 : 0}`;
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
  g.sensor = { key, owner: g.owner, ll: first.ll, sight, radar, sens, detects: det, recon: first.pr.recon, asw: first.pr.asw, id: first.s.id, moving: first.moving };
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
/** Current city sensors by city key (a sensor object is reused while its snapshot is unchanged). */
function buildCitySensors(state: GameState): Map<string, Sensor> {
  const out = new Map<string, Sensor>();
  for (const k of sortedCityKeys(state)) {
    const sen = citySensorFor(state, k);
    if (sen) out.set(k, sen);
  }
  return out;
}
/** Sensor of one city (null when the city has no owner). */
function citySensorFor(state: GameState, k: string): Sensor | null {
  const m = S(state).map;
  let cs = citySensorCache.get(state.cities);
  if (!cs) {
    cs = new Map();
    citySensorCache.set(state.cities, cs);
  }
  const c = state.cities[k];
  const o = state.provinces[c.node]?.owner;
  if (!o) return null;
  const rm = state.countries[o]?.modifiers['radar_range_mult'] ?? 1;
  let bsig = c.buildings.length + rm * 1e6;
  for (const b of c.buildings) bsig = bsig * 31 + b.level * 131 + b.condition * 7 + b.type.length;
  let sen = cs.get(k);
  if (sen && sen.owner === o && citySig.get(sen) === bsig) return sen;
  const radar = c.buildings.length ? sumEffect(state, c.buildings, 'radarKm') * rm : 0;
  const sens = radar > 0 ? Math.max(1, Math.floor(sumEffect(state, c.buildings, 'radarSensitivity', false))) : 0;
  if (!sen || sen.owner !== o || sen.radar !== radar || sen.sens !== sens) {
    sen = { key: `city:${k}`, owner: o, ll: [m.lon[c.node], m.lat[c.node]], sight: CITY_SIGHT_KM, radar, sens, detects: radar > 0 ? CITY_RADAR_DOMAINS : NO_DOMAINS, recon: false, asw: false, id: `city:${k}` };
    cs.set(k, sen);
  }
  citySig.set(sen, bsig);
  return sen;
}

const TO_RAD = Math.PI / 180;
const EARTH_KM = 6371;
function detectFrom(state: GameState, c: CountryId, sen: Sensor, vc: VisCache, keys: number[]): Hit[] {
  const r = Math.max(sen.sight, sen.radar);
  const m = S(state).map;
  // allocated on the first hit (most re-evaluations find nothing); never mutated once returned
  let hits: Hit[] = NO_HITS;
  const slon = sen.ll[0], slat = sen.ll[1];
  const scl = Math.cos(slat * TO_RAD);
  for (const k of keys) {
    const cell = vc.cells[cellIx(k)];
    if (!cell) continue;
    const os = cell.owners;
    if (os.size === 1 && os.has(c)) continue; // only own stacks there
    for (const tg of cell.recs) {
      const s = tg.s;
      if (s.owner === c) continue;
      const tlat = tg.ll[1];
      if (Math.abs(tlat - slat) * 111 > r + 1) continue; // cheap latitude reject
      // = distKm(slon, slat, tlon, tlat), with both cosines cached (same operations and order)
      const dLat = (tlat - slat) * TO_RAD;
      let dLon = tg.ll[0] - slon;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      dLon *= TO_RAD;
      const a = Math.sin(dLat / 2) ** 2 + scl * tg.cl * Math.sin(dLon / 2) ** 2;
      const d = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
      if (d > r) continue;
      let vis: number[] = NO_UNITS;
      let radHit = false;
      let radDomain: Domain | 'land' = 'land';
      const dom = tg.pr.dom, sig = tg.pr.sig;
      for (let i = 0; i < dom.length; i++) {
        if (d <= sen.sight && (dom[i] !== 'subsurface' || sen.asw) && (sig[i] < 3 || d <= sen.sight * STEALTH_VISUAL_FRACTION)) {
          if (vis === NO_UNITS) vis = [];
          vis.push(i);
        }
        if (d <= sen.radar && sig[i] <= sen.sens && sen.detects.includes(dom[i])) {
          if (!radHit || (DOMAIN_PRI[dom[i]] ?? 0) > (DOMAIN_PRI[radDomain] ?? 0)) radDomain = dom[i];
          radHit = true;
        }
      }
      if (vis.length) {
        const inCity = s.pos.kind === 'node' && state.provinces[s.pos.node]?.owner === c && m.cityByNode.has(s.pos.node);
        const ident = sen.recon || d <= sen.sight * IDENTIFY_FRACTION || inCity;
        if (hits === NO_HITS) hits = [];
        hits.push({ sid: s.id, level: ident ? 'identified' : 'unidentified', units: vis, domain: dom[vis[0]], src: sen.id });
      } else if (radHit) {
        if (hits === NO_HITS) hits = [];
        hits.push({ sid: s.id, level: 'contact', units: NO_UNITS, domain: radDomain, src: sen.id });
      }
    }
  }
  return hits;
}

function territoryContribution(mm: { cityByNode: Map<NodeId, string> }, r: TRec): Contribution | null {
  const vis: number[] = [];
  const dom = r.pr.dom;
  for (let i = 0; i < dom.length; i++) {
    if (dom[i] === 'subsurface' || dom[i] === 'air') continue;
    if (r.pr.sig[i] >= 3) continue;
    vis.push(i);
  }
  if (!vis.length) return null;
  return { level: mm.cityByNode.has(r.terrNode as number) ? 'identified' : 'unidentified', units: vis, domain: dom[vis[0]], src: `territory:${r.terrNode}` };
}
function sameHit(a: Hit, b: Hit): boolean {
  if (a.level !== b.level || a.domain !== b.domain || a.src !== b.src || a.units.length !== b.units.length) return false;
  for (let i = 0; i < a.units.length; i++) if (a.units[i] !== b.units[i]) return false;
  return true;
}
/** Update the cell → sensor index from one sorted cover to another (only the differences). */
function diffCells(idx: (Set<number> | undefined)[], key: number, a: number[], b: number[]): void {
  if (a === b) return;
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) {
      const x = cellIx(a[i]);
      const ks = idx[x];
      if (ks) {
        ks.delete(key);
        if (!ks.size) idx[x] = undefined;
      }
      i++;
    } else if (i >= a.length || b[j] < a[i]) {
      const x = cellIx(b[j]);
      let ks = idx[x];
      if (!ks) {
        ks = new Set();
        idx[x] = ks;
      }
      ks.add(key);
      j++;
    } else {
      i++;
      j++;
    }
  }
}
function mergeContributions(cs: Map<string, Contribution>): Det {
  let d: Det | null = null;
  for (const x of cs.values()) {
    const rank = detRank(x.level, x.domain);
    if (!d) d = { level: x.level, units: new Set(), domain: x.domain, src: new Set(), rank };
    else if (rank > d.rank) {
      d.level = x.level;
      d.domain = x.domain;
      d.rank = rank;
    }
    if (x.level !== 'contact') for (const i of x.units) d.units.add(i);
    d.src.add(x.src);
  }
  return d as Det;
}
function sameDet(a: Det, b: Det): boolean {
  if (a.level !== b.level || a.domain !== b.domain || a.rank !== b.rank || a.units.size !== b.units.size || a.src.size !== b.src.size) return false;
  for (const u of a.units) if (!b.units.has(u)) return false;
  for (const s of a.src) if (!b.src.has(s)) return false;
  return true;
}

/**
 * Detections per country — INCREMENTAL and order-independent.
 * Persistent per-stack records live in fine spatial cells (VIS_BIN_DEG, each cell sorted by stack
 * id). Each run only stacks whose position/roster/air state changed (or that are in transit) are
 * re-binned; their cells are marked changed. Sensor groups (co-located stacks of one owner) are
 * rebuilt only when a member changed. A sensor is re-evaluated only if its snapshot changed or a
 * changed cell lies inside its exact cover (cell → sensors index); ownership changes mark the cells
 * of the changed nodes (in-city identification) and re-check territorial observers. Each country
 * keeps, per target, the contributions of every source (sensor hit or territory); a target's
 * merged Det (max level, highest-priority domain, union of units/sources) is rebuilt only when one
 * of its contributions changed. Results equal a full recompute exactly (tested on random ticks).
 */
export function computeDetections(state: GameState, opts: { full?: boolean } = {}): Map<CountryId, Map<string, Det>> {
  return runDetections(state, !!opts.full).dets;
}
function runDetections(state: GameState, full: boolean): VisCache {
  const useCache = incrementalEnabled && !full;
  let vc = useCache ? visCaches.get(state) : undefined;
  const mm = S(state).map;
  const list = stacksReadonly(state);
  const ownv = state.ids.ownv ?? 0;
  // targeted ownership change: the journal names the changed nodes; otherwise start from scratch
  let ownNodes: Set<NodeId> | null = null;
  if (vc && vc.ownv !== ownv) {
    const log = takeOwnerChanges(state, vc.ownv);
    if (log) ownNodes = log.nodes;
    else vc = undefined;
  } else if (!vc && useCache) takeOwnerChanges(state, -2); // a full (uncached) pass leaves the log to the cache
  if (!vc) {
    vc = newCache();
    if (useCache) visCaches.set(state, vc);
  }
  const V = vc;
  V.ownv = ownv;
  const changedBins = new Set<number>();
  const dirtyGroups = new Set<Group>();
  const dirtyPairs = new Map<CountryId, Set<string>>();
  const moved: string[] = [];
  const setContrib = (c: CountryId, sid: string, key: string, x: Contribution | null) => {
    let cm = V.contrib.get(c);
    if (!cm) {
      if (!x) return;
      cm = new Map();
      V.contrib.set(c, cm);
    }
    let tm = cm.get(sid);
    if (x) {
      if (!tm) {
        tm = new Map();
        cm.set(sid, tm);
      }
      tm.set(key, x);
    } else {
      if (!tm || !tm.delete(key)) return;
      if (!tm.size) cm.delete(sid);
    }
    (dirtyPairs.get(c) ?? dirtyPairs.set(c, new Set()).get(c)!).add(sid);
  };
  const touchGroup = (r: TRec, add: boolean) => {
    const gk = r.group;
    if (!gk) return;
    let g = add ? V.groups.get(gk) : r.g ?? V.groups.get(gk);
    if (!g) {
      g = { key: gk, slot: slotFor(V, gk), owner: r.s.owner, recs: [], sensor: null };
      V.groups.set(gk, g);
    }
    if (add) {
      const n = r.n;
      let i = 0;
      while (i < g.recs.length && g.recs[i].n < n) i++;
      g.recs.splice(i, 0, r);
      r.g = g;
    } else {
      const i = g.recs.indexOf(r);
      if (i >= 0) g.recs.splice(i, 1);
      r.g = null;
    }
    dirtyGroups.add(g);
  };
  // territorial observer of a record → (tOwner, tNode) (two out-values: no tuple per call)
  let tOwner = null as CountryId | null;
  let tNode = null as NodeId | null;
  const terrOf = (r: TRec): void => {
    const s = r.s;
    const node: NodeId | null = s.pos.kind === 'node' ? s.pos.node : s.pos.kind === 'edge' ? s.pos.to : null;
    tOwner = null;
    tNode = null;
    if (node === null) return;
    const o = state.provinces[node]?.owner ?? null;
    if (!o || o === s.owner) return;
    tOwner = o;
    tNode = node;
  };
  const removeRec = (r: TRec) => {
    binRemove(V, r);
    changedBins.add(r.bin);
    touchGroup(r, false);
    if (r.terr) setContrib(r.terr, r.s.id, 'T', null);
    V.recs.delete(r.s.id);
    moved.push(r.s.id);
  };
  const addRec = (s: Stack, pr: StackProfile) => {
    const ll: [number, number] = s.pos.kind === 'node' ? (pr.ll ??= [mm.lon[s.pos.node], mm.lat[s.pos.node]]) : stackLL(state, s);
    const bin = s.pos.kind === 'node' ? (pr.bin ??= vbin(ll[0], ll[1])) : vbin(ll[0], ll[1]);
    const r: TRec = { s, n: idn(s.id), pr, ll, cl: Math.cos(ll[1] * TO_RAD), bin, moving: s.pos.kind !== 'node', group: null, g: null, terr: null, terrNode: null };
    r.group = groupKey(r);
    terrOf(r);
    r.terr = tOwner;
    r.terrNode = tNode;
    V.recs.set(s.id, r);
    binInsert(V, r);
    changedBins.add(bin);
    touchGroup(r, true);
    if (r.terr) setContrib(r.terr, s.id, 'T', territoryContribution(mm, r));
    moved.push(s.id);
  };
  // removed stacks (only when the stack list changed)
  if (V.list !== list) {
    // (deleting the visited entry while iterating a Map is safe)
    for (const r of V.recs.values()) if (state.stacks[r.s.id] !== r.s || r.s.aboard) removeRec(r);
    V.list = list;
  }
  const techv = state.ids.techv ?? 0;
  for (const s of list) {
    if (s.aboard) continue;
    const r = V.recs.get(s.id);
    if (r && !r.moving && !ownNodes && r.s === s) {
      // unchanged stationary record (same checks as profileOf's identity fast path)
      const c = r.pr;
      if (c.pos === s.pos && c.units === s.units && c.len === s.units.length && c.techv === techv && c.air === (s.air ? s.air.state : null)) continue;
    }
    const pr = profileOf(state, s);
    if (!r) addRec(s, pr);
    else if (r.moving && r.s === s && r.pr === pr && s.pos.kind !== 'node') {
      // in transit: refresh the position in place when the cell and territorial observer are unchanged
      const ll = stackLL(state, s);
      const bin = vbin(ll[0], ll[1]);
      terrOf(r);
      if (tOwner === r.terr && tNode === r.terrNode) {
        if (bin !== r.bin) {
          // crossed into another cell: move the record between cells (group and territory unchanged)
          binRemove(V, r);
          changedBins.add(r.bin);
          r.bin = bin;
          binInsert(V, r);
        }
        r.ll = ll;
        r.cl = Math.cos(ll[1] * TO_RAD);
        changedBins.add(bin);
        if (r.g) dirtyGroups.add(r.g);
        moved.push(s.id);
      } else {
        removeRec(r);
        addRec(s, pr);
      }
    } else if (r.s !== s || r.pr !== pr || r.moving) {
      removeRec(r);
      addRec(s, pr);
    } else if (ownNodes) {
      terrOf(r);
      const t = tOwner, n = tNode;
      if (t !== r.terr || n !== r.terrNode) {
        if (r.terr) setContrib(r.terr, s.id, 'T', null);
        r.terr = t;
        r.terrNode = n;
        if (t) setContrib(t, s.id, 'T', territoryContribution(mm, r));
      }
    }
  }
  // in-city identification depends on the owner of the target's node
  if (ownNodes) for (const n of ownNodes) changedBins.add(vbin(mm.lon[n], mm.lat[n]));
  // national radar-range modifier changes re-derive that country's sensor groups and city sensors
  let rmChanged: Set<CountryId> | null = null;
  for (const c of state.countryOrder) {
    const rm = state.countries[c]?.modifiers['radar_range_mult'];
    if (!V.rm.has(c)) V.rm.set(c, rm); // first run: every sensor is new anyway
    else if (V.rm.get(c) !== rm) {
      (rmChanged ??= new Set()).add(c);
      V.rm.set(c, rm);
    }
  }
  if (rmChanged) for (const g of V.groups.values()) if (rmChanged.has(g.owner)) dirtyGroups.add(g);
  // sensors whose snapshot changed / appeared / disappeared: a list of slots in first-marking order
  // (exactly the iteration order of a set of keys), deduplicated by a per-run stamp
  const ep = ++V.epoch;
  const stamp = V.stamp;
  const invalid: number[] = [];
  for (const g of dirtyGroups) {
    const gk = g.key;
    const slot = g.slot;
    rebuildGroup(state, g, gk);
    if (!g.recs.length && V.groups.get(gk) === g) V.groups.delete(gk);
    const prev = V.cur[slot];
    if (!g.sensor) {
      if (prev) {
        V.cur[slot] = undefined;
        if (stamp[slot] !== ep) { stamp[slot] = ep; invalid.push(slot); }
      }
    } else if (!sameSensor(prev, g.sensor)) {
      V.cur[slot] = g.sensor;
      if (stamp[slot] !== ep) { stamp[slot] = ep; invalid.push(slot); }
    }
  }
  // city sensors: re-derived only at locations announced by the economy journal (buildings,
  // condition), ownership changes and radar-modifier changes; full rebuild when the journal can't tell
  const econv = state.ids.econv ?? 0;
  if (V.cityEconv !== econv || ownNodes || rmChanged) {
    let nodes: Set<NodeId> | 'all' | null = V.cityEconv < 0 ? 'all' : V.cityEconv === econv ? new Set() : econChangesSince(state, V.cityEconv);
    if (!nodes) nodes = 'all';
    if (nodes !== 'all') {
      if (ownNodes) for (const n of ownNodes) nodes.add(n);
      if (rmChanged) for (const k of sortedCityKeys(state)) {
        const o = state.provinces[state.cities[k].node]?.owner;
        if (o && rmChanged.has(o)) nodes.add(state.cities[k].node);
      }
    }
    const setCity = (k: string, sen: Sensor | null) => {
      const prev = V.citySensors.get(k);
      if (prev === (sen ?? undefined)) return;
      if (prev) {
        const slot = slotFor(V, prev.key);
        V.cur[slot] = undefined;
        if (stamp[slot] !== ep) { stamp[slot] = ep; invalid.push(slot); }
      }
      if (sen) {
        const slot = slotFor(V, sen.key);
        V.citySensors.set(k, sen);
        V.cur[slot] = sen;
        if (stamp[slot] !== ep) { stamp[slot] = ep; invalid.push(slot); }
      } else V.citySensors.delete(k);
    };
    if (nodes === 'all') {
      const next = buildCitySensors(state);
      for (const [k, sen] of next) setCity(k, sen);
      for (const k of [...V.citySensors.keys()]) if (!next.has(k)) setCity(k, null);
    } else for (const n of nodes) {
      const k = mm.cityByNode.get(n);
      if (k && state.cities[k]) setCity(k, citySensorFor(state, k));
    }
    V.cityEconv = econv;
  }
  for (const b of changedBins) {
    const ks = V.cellSensors[cellIx(b)];
    if (ks) for (const slot of ks) if (stamp[slot] !== ep) { stamp[slot] = ep; invalid.push(slot); }
  }
  // re-evaluate invalid sensors (order-independent: contributions are keyed by sensor); only
  // hits that differ from the previous evaluation touch the targets' contributions
  for (const slot of invalid) {
    const key = V.keyOf[slot];
    const old = V.sensors[slot];
    const sen = V.cur[slot];
    const r = sen ? Math.max(sen.sight, sen.radar) : 0;
    const keys = sen && r > 0 ? visCover(sen.ll[0], sen.ll[1], r, !sen.moving) : NO_UNITS;
    const hits = sen && r > 0 ? detectFrom(state, sen.owner, sen, V, keys) : [];
    if (old && sen && old.owner === sen.owner && old.hits.length) {
      // lock-step fast path (usually identical), then a keyed diff of the remainder
      const oh = old.hits;
      let i = 0;
      while (i < oh.length && i < hits.length && oh[i].sid === hits[i].sid && sameHit(oh[i], hits[i])) i++;
      if (i < oh.length || i < hits.length) {
        const prev = new Map<string, Hit>();
        for (let x = i; x < oh.length; x++) prev.set(oh[x].sid, oh[x]);
        for (let x = i; x < hits.length; x++) {
          const h = hits[x];
          const p = prev.get(h.sid);
          if (p) prev.delete(h.sid);
          if (!p || !sameHit(p, h)) setContrib(sen.owner, h.sid, key, h);
        }
        for (const sid of prev.keys()) setContrib(old.owner, sid, key, null);
      }
    } else {
      if (old) for (const h of old.hits) setContrib(old.owner, h.sid, key, null);
      if (sen) for (const h of hits) setContrib(sen.owner, h.sid, key, h);
    }
    diffCells(V.cellSensors, slot, old ? old.keys : NO_UNITS, keys);
    if (!sen) V.sensors[slot] = undefined;
    else if (old) {
      old.snap = sen;
      old.owner = sen.owner;
      old.hits = hits;
      old.keys = keys;
    } else V.sensors[slot] = { snap: sen, owner: sen.owner, hits, keys };
  }
  // rebuild the merged detections of targets whose contributions changed
  const touch = (c: CountryId, sid: string) => (V.touched.get(c) ?? V.touched.set(c, new Set()).get(c)!).add(sid);
  for (const c of state.countryOrder) if (!V.dets.has(c)) V.dets.set(c, new Map());
  for (const [c, sids] of dirtyPairs) {
    let dm = V.dets.get(c);
    if (!dm) {
      dm = new Map();
      V.dets.set(c, dm);
    }
    const cm = V.contrib.get(c);
    for (const sid of sids) {
      const cs = cm?.get(sid);
      const old = dm.get(sid);
      if (!cs) {
        if (old) {
          dm.delete(sid);
          const by = V.detBy.get(sid);
          if (by) {
            by.delete(c);
            if (!by.size) V.detBy.delete(sid);
          }
          touch(c, sid);
        }
        continue;
      }
      const nd = mergeContributions(cs);
      if (old && sameDet(old, nd)) continue;
      dm.set(sid, nd);
      if (!old) (V.detBy.get(sid) ?? V.detBy.set(sid, new Set()).get(sid)!).add(c);
      touch(c, sid);
    }
  }
  // targets that moved / changed roster: every country observing them refreshes the contact
  for (const sid of moved) {
    const by = V.detBy.get(sid);
    if (by) for (const c of by) touch(c, sid);
  }
  return V;
}

interface ViewerMemo {
  srcs: CountryId[];
  gen: number;
  /** lower bound of the tick after which some stale contact expires (Infinity = none) */
  nextExpire: number;
}
const viewerMemos = new WeakMap<GameState, Map<CountryId, ViewerMemo>>();

/**
 * Recompute every viewer's contact table.
 * A current contact is only rewritten when a visible field changes (level, domain, position,
 * owner, member count, unit types, sources); its `observedAt` then records that tick. The view
 * reports current contacts as observed at `clock.lastVisibility`. When a contact goes stale its
 * `observedAt` becomes the last refresh at which it was still seen and its unit HP snapshot is
 * frozen. INCREMENTAL: a viewer with unchanged vision sources only revisits the targets whose
 * detection changed or that moved in one of its sources (`touched`); a viewer whose sources
 * changed (or a cold cache) is processed in full. Results are identical to processing every
 * viewer in full (tested against a cold clone).
 */
export function updateVisibility(state: GameState): void {
  const vc = runDetections(state, false);
  const dets = vc.dets;
  const t = state.clock.tick;
  const prevRefresh = state.clock.lastVisibility ?? t;
  let memos = viewerMemos.get(state);
  if (!memos) {
    memos = new Map();
    viewerMemos.set(state, memos);
  }
  for (const viewer of state.countryOrder) {
    const table = (state.contacts[viewer] ??= {});
    const srcs = visionSources(state, viewer);
    const memo = memos.get(viewer);
    const ids = cidCache(state, viewer);
    const allied = srcs.length > 1 ? new Set(srcs) : null;
    if (memo && memo.srcs === srcs && memo.gen === vc.gen) {
      // incremental: only touched targets
      let cand: Set<string> | undefined;
      if (srcs.length === 1) cand = vc.touched.get(viewer);
      else for (const c of srcs) {
        const tt = vc.touched.get(c);
        if (!tt) continue;
        if (!cand) cand = new Set(tt);
        else for (const x of tt) cand.add(x);
      }
      if (cand) for (const sid of cand) {
        const det = srcs.length === 1 ? dets.get(viewer)?.get(sid) : mergedFor(state, viewer, srcs, dets, sid);
        const s = state.stacks[sid];
        if (det && s && s.owner !== viewer && !(allied && allied.has(s.owner))) {
          writeContact(state, table, ids, viewer, sid, s, det, t);
          continue;
        }
        let cid = ids.get(sid);
        if (!cid) {
          cid = contactId(state, viewer, sid);
          ids.set(sid, cid);
        }
        const c = table[cid];
        if (c && c.level !== 'stale') {
          freeze(state, c, prevRefresh);
          memo.nextExpire = Math.min(memo.nextExpire, c.observedAt + STALE_KEEP_MIN);
        }
      }
      if (t > memo.nextExpire) memo.nextExpire = expireStale(table, t);
      continue;
    }
    // full pass
    let merged = new Map<string, Det>();
    if (srcs.length === 1) {
      const d = dets.get(viewer);
      if (d) merged = d;
    } else for (const c of srcs) {
      const d = dets.get(c);
      if (!d) continue;
      for (const sid of d.keys()) if (!merged.has(sid)) {
        const x = mergedFor(state, viewer, srcs, dets, sid);
        if (x) merged.set(sid, x);
      }
    }
    const seen = new Set<string>();
    for (const [sid, det] of merged) {
      const s = state.stacks[sid];
      if (!s || s.owner === viewer) continue;
      if (allied && allied.has(s.owner)) continue; // allied stacks are projected live by the view
      seen.add(writeContact(state, table, ids, viewer, sid, s, det, t));
    }
    let nextExpire = Infinity;
    for (const cid of Object.keys(table)) {
      if (seen.has(cid)) continue;
      const c = table[cid];
      if (c.level !== 'stale') freeze(state, c, prevRefresh);
      if (t - c.observedAt > STALE_KEEP_MIN) {
        delete table[cid];
        tableChanged(table);
      } else nextExpire = Math.min(nextExpire, c.observedAt + STALE_KEEP_MIN);
    }
    memos.set(viewer, { srcs, gen: vc.gen, nextExpire });
  }
  vc.touched.clear();
  state.clock.lastVisibility = t;
}
/** Merge of the vision sources' detections of one target (null if none applies). */
function mergedFor(state: GameState, viewer: CountryId, srcs: CountryId[], dets: Map<CountryId, Map<string, Det>>, sid: string): Det | null {
  const st = state.stacks[sid];
  if (!st || st.owner === viewer) return null;
  // a target detected by exactly one source: its Det as is (a merge of one is a copy of it; Det
  // objects are never mutated once published)
  let only: Det | null = null;
  let n = 0;
  for (const c of srcs) {
    const det = dets.get(c)?.get(sid);
    if (det) {
      only = det;
      if (++n > 1) break;
    }
  }
  if (n <= 1) return only;
  let x: Det | null = null;
  for (const c of srcs) {
    const det = dets.get(c)?.get(sid);
    if (!det) continue;
    if (!x) x = { level: det.level, units: new Set(det.units), domain: det.domain, src: new Set(det.src), rank: det.rank };
    else {
      if (det.rank > x.rank) {
        x.level = det.level;
        x.domain = det.domain;
        x.rank = det.rank;
      }
      for (const u of det.units) x.units.add(u);
      for (const s of det.src) x.src.add(s);
    }
  }
  return x;
}
/** Freeze a contact that is no longer detected: last seen at the previous refresh, HP snapshot of that moment. */
function freeze(state: GameState, c: Contact, prevRefresh: number): void {
  c.level = 'stale';
  c.sources = [];
  c.observedAt = Math.max(c.observedAt, prevRefresh);
  const st = state.stacks[c.stack];
  if (c.units && st) c.units = c.units.map((u) => ({ type: u.type, hpPct: u.i !== undefined && st.units[u.i] && st.units[u.i].type === u.type ? hpPct(st, u.i) : u.hpPct, i: u.i }));
}
/** Create or refresh one current contact; returns its id. */
function writeContact(state: GameState, table: Record<string, Contact>, ids: Map<string, string>, viewer: CountryId, sid: string, s: Stack, det: Det, t: number): string {
  let cid = ids.get(sid);
  if (!cid) {
    cid = contactId(state, viewer, sid);
    ids.set(sid, cid);
  }
  let lon: number, lat: number;
  if (!s.aboard && s.pos.kind === 'node') {
    // = stackLL for a stack standing on a node (no array allocation)
    const mm = S(state).map;
    lon = round4(mm.lon[s.pos.node]);
    lat = round4(mm.lat[s.pos.node]);
  } else {
    const ll = stackLL(state, s);
    lon = round4(ll[0]);
    lat = round4(ll[1]);
  }
  const prev = table[cid];
  const idx = det.level === 'contact' ? NO_UNITS : (det.sorted ??= [...det.units].sort((a, b) => a - b));
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
    if (!sameSrc) { prev.sources = sortedSources(det); changed = true; }
    if (changed) prev.observedAt = t;
    return cid;
  }
  if (prev && prev.stack === sid && prev.id === cid) {
    // level/domain changed: refresh the existing record in place (same fields and values as a new one)
    prev.level = det.level;
    prev.domain = det.domain;
    prev.lonlat = [lon, lat];
    prev.node = node;
    prev.observedAt = t;
    prev.owner = owner;
    prev.count = count;
    prev.units = det.level === 'identified' ? idx.map((i) => ({ type: s.units[i].type, hpPct: hpPct(s, i), i })) : null;
    prev.sources = sortedSources(det);
    return cid;
  }
  if (!prev) tableChanged(table);
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
    sources: sortedSources(det),
  };
  return cid;
}
/** Sorted source ids of a detection (a fresh array per contact). */
function sortedSources(det: Det): string[] {
  if (det.src.size === 1) for (const x of det.src) return [x];
  return [...det.src].sort();
}
function expireStale(table: Record<string, Contact>, t: number): number {
  let next = Infinity;
  for (const cid of Object.keys(table)) {
    const c = table[cid];
    if (c.level !== 'stale') continue;
    if (t - c.observedAt > STALE_KEEP_MIN) {
      delete table[cid];
      tableChanged(table);
    } else next = Math.min(next, c.observedAt + STALE_KEEP_MIN);
  }
  return next;
}
/** Key-set version of each contact table (bumped by every insert/delete in this module). */
const tableVersions = new WeakMap<object, number>();
function tableChanged(table: object): void {
  tableVersions.set(table, (tableVersions.get(table) ?? 0) + 1);
}
const sortedKeyMemo = new WeakMap<object, { v: number; keys: string[] }>();
/**
 * Sorted contact ids of a contact table (shared, read-only). Memoized per table object and key-set
 * version: contact tables are only written by updateVisibility (this module).
 */
export function sortedContactIds(table: Record<string, Contact>): readonly string[] {
  const v = tableVersions.get(table) ?? 0;
  const e = sortedKeyMemo.get(table);
  if (e && e.v === v) return e.keys;
  const keys = Object.keys(table).sort();
  sortedKeyMemo.set(table, { v, keys });
  return keys;
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
  const out: Contact[] = [];
  const t = state.clock.tick;
  forEachAlliedStack(state, viewer, (s, cid, ll, domain) => {
    out.push({ id: cid, stack: s.id, level: 'identified', domain, lonlat: ll, node: s.pos.kind === 'node' ? s.pos.node : null, observedAt: t, firstSeenAt: t, owner: s.owner, count: s.units.length, units: s.units.map((u) => ({ type: u.type, hpPct: Math.round((u.hp / u.maxHp) * 100) })), sources: [`ally:${s.owner}`] });
  });
  return out;
}
/** The allied stacks behind `alliedContacts`, in the same order, with their contact id and rounded position. */
export function forEachAlliedStack(state: GameState, viewer: CountryId, visit: (s: Stack, cid: string, lonlat: [number, number], domain: Domain) => void): void {
  const srcs = visionSources(state, viewer);
  if (srcs.length <= 1) return;
  const ids = cidCache(state, viewer);
  // per-owner lists are each in sortedStacks order (cmpId); with several sources k-way merge them.
  // The merge is memoized per viewer (its memoized `srcs` array) while every source list is the
  // same array (stacksOfOwner lists are replaced whenever a stack is added or removed).
  let mc = alliedMerge.get(srcs);
  let fresh = !mc;
  if (mc) for (let i = 0, k = 0; i < srcs.length; i++) {
    if (srcs[i] === viewer) continue;
    if (mc.lists[k++] !== stacksOfOwner(state, srcs[i])) {
      fresh = true;
      break;
    }
  }
  if (fresh) {
    const lists: (readonly Stack[])[] = [];
    for (const src of srcs) if (src !== viewer) lists.push(stacksOfOwner(state, src));
    mc = { lists, list: lists.length === 1 ? lists[0] : mergeById(lists) };
    alliedMerge.set(srcs, mc);
  }
  const m = S(state).map;
  for (const s of mc!.list) {
    if (state.stacks[s.id] !== s || s.aboard) continue;
    let cid = ids.get(s.id);
    if (!cid) {
      cid = contactId(state, viewer, s.id);
      ids.set(s.id, cid);
    }
    let lon: number, lat: number;
    if (s.pos.kind === 'node') {
      lon = m.lon[s.pos.node];
      lat = m.lat[s.pos.node];
    } else {
      const ll = stackLL(state, s);
      lon = ll[0];
      lat = ll[1];
    }
    visit(s, cid, [round4(lon), round4(lat)], unitDomain(state, s, 0));
  }
}
const alliedMerge = new WeakMap<readonly CountryId[], { lists: (readonly Stack[])[]; list: readonly Stack[] }>();
/** Merge lists that are each sorted by `cmpId` into one sorted list (numeric ids computed once). */
function mergeById(lists: (readonly Stack[])[]): Stack[] {
  const pos = lists.map(() => 0);
  const heads = lists.map((l) => (l.length ? idNum(l[0].id) : Infinity));
  const out: Stack[] = [];
  for (;;) {
    let best = -1;
    for (let k = 0; k < lists.length; k++) {
      if (heads[k] === Infinity) continue;
      if (best < 0 || heads[k] < heads[best] || (heads[k] === heads[best] && cmpId(lists[k][pos[k]], lists[best][pos[best]]) < 0)) best = k;
    }
    if (best < 0) return out;
    const l = lists[best];
    out.push(l[pos[best]]);
    const p = ++pos[best];
    heads[best] = p < l.length ? idNum(l[p].id) : Infinity;
  }
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

/**
 * Effective sensor radii of one stack (km): sight incl. the terrain sight modifier at its node and
 * the members' unit levels (best living member), radar incl. the owner's radar_range_mult — the
 * same values the visibility model uses. Stacks aboard a carrier/transport do not sense (0, 0).
 */
export function stackSensorRadii(state: GameState, s: Stack): { sightKm: number; radarKm: number } {
  if (s.aboard) return { sightKm: 0, radarKm: 0 };
  const pr = profileOf(state, s);
  const rm = state.countries[s.owner]?.modifiers['radar_range_mult'];
  return { sightKm: pr.sight, radarKm: rm !== undefined && pr.radar > 0 ? pr.radar * rm : pr.radar };
}

const nodeCellCache = new WeakMap<object, Map<number, NodeId[]>>();
function nodesByCell(state: GameState): Map<number, NodeId[]> {
  const mm = S(state).map;
  let m = nodeCellCache.get(mm);
  if (!m) {
    m = new Map();
    for (let n = 0; n < mm.lon.length; n++) {
      const k = vbin(mm.lon[n], mm.lat[n]);
      const l = m.get(k);
      if (l) l.push(n);
      else m.set(k, [n]);
    }
    nodeCellCache.set(mm, m);
  }
  return m;
}
/**
 * Node ids the viewer currently observes (sorted): every node owned by one of its vision sources
 * (territory sight) and every node inside the sight-or-radar disc of a source's sensor — its stacks
 * (not aboard; radii from stackSensorRadii, at the stack's current position) and its cities
 * (CITY_SIGHT_KM + city radar). A pure function of the viewer's own/allied assets: foreign or
 * hidden stacks never influence it. Coverage is live (current tick); contacts are refreshed every
 * VISIBILITY_INTERVAL_MIN, so a target inside coverage appears at the next refresh. Memoized per step.
 */
export function observedNodes(state: GameState, viewer: CountryId): NodeId[] {
  return derived(state, `@obsNodes:${viewer}`, () => {
    const mm = S(state).map;
    const cells = nodesByCell(state);
    const srcs = visionSources(state, viewer);
    const srcSet = new Set(srcs);
    const seen = new Uint8Array(mm.lon.length);
    const disc = (lon: number, lat: number, r: number) => {
      if (!(r > 0)) return;
      for (const k of visCover(lon, lat, r)) {
        const l = cells.get(k);
        if (!l) continue;
        for (const n of l) if (!seen[n] && distKm(lon, lat, mm.lon[n], mm.lat[n]) <= r) seen[n] = 1;
      }
    };
    for (const p of state.provinces) if (p && p.owner && srcSet.has(p.owner)) seen[p.node] = 1;
    for (const s of stacksReadonly(state)) {
      if (!srcSet.has(s.owner) || s.aboard) continue;
      const { sightKm, radarKm } = stackSensorRadii(state, s);
      const ll = stackLL(state, s);
      disc(ll[0], ll[1], Math.max(sightKm, radarKm));
    }
    for (const k of sortedCityKeys(state)) {
      const o = state.provinces[state.cities[k].node]?.owner;
      if (!o || !srcSet.has(o)) continue;
      const sen = citySensorFor(state, k);
      if (sen) disc(sen.ll[0], sen.ll[1], Math.max(sen.sight, sen.radar));
    }
    const out: NodeId[] = [];
    for (let n = 0; n < seen.length; n++) if (seen[n]) out.push(n);
    return out;
  });
}
