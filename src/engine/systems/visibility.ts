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
import { binKey, binsAround, distKm } from './mapindex';
import { hash32 } from '../rng';
import { cmpId, sortedStacks, stackLL, ustats, utype, visionSources } from './world';
import { sumEffect } from './economy';

const LEVEL_RANK: Record<ContactLevel, number> = { stale: 0, contact: 1, unidentified: 2, identified: 3 };

export function contactId(state: GameState, viewer: CountryId, stackId: string): string {
  return 'k' + hash32(`${viewer}\u0000${stackId}\u0000${state.seed}`).toString(36);
}

interface Det {
  level: ContactLevel;
  units: Set<number>; // indices of visually detected units
  domain: Domain | 'land';
  src: Set<string>;
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
const citySensorCache = new WeakMap<object, Map<string, Sensor>>();
const citySig = new WeakMap<Sensor, number>();
const cityKeysCache = new WeakMap<object, { n: number; keys: string[] }>();
function sortedCityKeys(state: GameState): string[] {
  const c = cityKeysCache.get(state.cities);
  if (c) return c.keys;
  const keys = Object.keys(state.cities).sort();
  cityKeysCache.set(state.cities, { n: keys.length, keys });
  return keys;
}

function buildSensors(state: GameState, targets: Target[]): Map<CountryId, Sensor[]> {
  const out = new Map<CountryId, Sensor[]>();
  const push = (c: CountryId, s: Sensor) => {
    const l = out.get(c);
    if (l) l.push(s);
    else out.set(c, [s]);
  };
  // co-located stacks of one owner form a single merged sensor (same recon/ASW class)
  const merged = new Map<string, Sensor>();
  for (const tg of targets) {
    const s = tg.s;
    const pr = tg.pr;
    const { sight, radar, sens, recon, asw } = pr;
    const det = pr.detects;
    if (sight <= 0 && radar <= 0) continue;
    const ll = tg.ll;
    const key = s.pos.kind === 'node' ? (pr.skey ??= `${s.owner}|${s.pos.node}|${recon ? 1 : 0}${asw ? 1 : 0}`) : `${s.owner}|${ll.join(',')}|${recon ? 1 : 0}${asw ? 1 : 0}`;
    const prev = merged.get(key);
    if (!prev) {
      const sen: Sensor = { key, owner: s.owner, ll, sight, radar, sens, detects: det, recon, asw, id: s.id };
      merged.set(key, sen);
      push(s.owner, sen);
    } else {
      if (sight > prev.sight) prev.sight = sight;
      if (radar > prev.radar) prev.radar = radar;
      if (sens > prev.sens) prev.sens = sens;
      if (det.length) prev.detects = [...new Set([...prev.detects, ...det])];
    }
  }
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
    let bsig = c.buildings.length;
    for (const b of c.buildings) bsig = bsig * 31 + b.level * 131 + b.condition * 7 + b.type.length;
    let sen = cs.get(k);
    if (sen && sen.owner === o && citySig.get(sen) === bsig) {
      push(o, sen);
      continue;
    }
    const radar = c.buildings.length ? sumEffect(state, c.buildings, 'radarKm') : 0;
    const sens = radar > 0 ? Math.max(1, Math.floor(sumEffect(state, c.buildings, 'radarSensitivity', false))) : 0;
    if (!sen || sen.owner !== o || sen.radar !== radar || sen.sens !== sens) {
      sen = { key: `city:${k}`, owner: o, ll: [m.lon[c.node], m.lat[c.node]], sight: CITY_SIGHT_KM, radar, sens, detects: radar > 0 ? CITY_RADAR_DOMAINS : NO_DOMAINS, recon: false, asw: false, id: `city:${k}` };
      cs.set(k, sen);
    }
    citySig.set(sen, bsig);
    push(o, sen);
  }
  return out;
}

interface Target {
  s: Stack;
  ll: [number, number];
  dom: Domain[];
  sig: number[];
  pr: StackProfile;
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
  binLists: Map<number, unknown[]>;
  binVer: Map<number, number>;
  verSeq: number;
  sensors: Map<string, SensorCacheEntry>;
  countryDets: Map<CountryId, Map<string, Det>>;
  countrySnap: Map<CountryId, { sensors: Sensor[]; terr: unknown[]; bins: Set<number> }>;
  binToCountries: Map<number, Set<CountryId>>;
  ownv: number;
}
const visCaches = new WeakMap<GameState, VisCache>();
let incrementalEnabled = true;
/** Test hook: disable the incremental cache (every run becomes a full recompute). */
export function setIncrementalVisibility(on: boolean): void {
  incrementalEnabled = on;
}
function sameSensor(a: Sensor | undefined, b: Sensor): boolean {
  if (!a) return false;
  if (a.id !== b.id || a.ll[0] !== b.ll[0] || a.ll[1] !== b.ll[1] || a.sight !== b.sight || a.radar !== b.radar || a.sens !== b.sens || a.recon !== b.recon || a.asw !== b.asw) return false;
  if (a.detects !== b.detects) {
    if (a.detects.length !== b.detects.length) return false;
    for (let i = 0; i < a.detects.length; i++) if (a.detects[i] !== b.detects[i]) return false;
  }
  return true;
}

function detectFrom(state: GameState, c: CountryId, sen: Sensor, bins: Map<number, Target[]>, binOwners: Map<number, Set<CountryId>>, keys: number[]): Hit[] {
  const r = Math.max(sen.sight, sen.radar);
  const m = S(state).map;
  const hits: Hit[] = [];
  for (const k of keys) {
    const l = bins.get(k);
    if (!l) continue;
    const os = binOwners.get(k)!;
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
      for (let i = 0; i < tg.dom.length; i++) {
        const dom = tg.dom[i];
        const sg = tg.sig[i];
        if (d <= sen.sight && (dom !== 'subsurface' || sen.asw) && (sg < 3 || d <= sen.sight * STEALTH_VISUAL_FRACTION)) vis.push(i);
        if (d <= sen.radar && sg <= sen.sens && sen.detects.includes(dom)) {
          radHit = true;
          radDomain = dom;
        }
      }
      if (vis.length) {
        const inCity = s.pos.kind === 'node' && state.provinces[s.pos.node]?.owner === c && m.cityByNode.has(s.pos.node);
        const ident = sen.recon || d <= sen.sight * IDENTIFY_FRACTION || inCity;
        hits.push({ sid: s.id, level: ident ? 'identified' : 'unidentified', units: vis, domain: tg.dom[vis[0]] });
      } else if (radHit) hits.push({ sid: s.id, level: 'contact', units: [], domain: radDomain });
    }
  }
  return hits;
}

/**
 * Detections per country. INCREMENTAL: each spatial bin carries a version that changes only when
 * its content changes (a stack enters/leaves, a stack's position/roster/air state changes, or a
 * stack is in motion). A sensor's hit list is reused when the sensor is unchanged, every bin in its
 * radius kept its version, and territorial ownership did not change. Results are identical to a
 * full recompute (tested on random ticks).
 */
export function computeDetections(state: GameState, opts: { full?: boolean } = {}): Map<CountryId, Map<string, Det>> {
  const stacks = sortedStacks(state).filter((s) => !s.aboard);
  const bins = new Map<number, Target[]>();
  const binOwners = new Map<number, Set<CountryId>>();
  const targets: Target[] = [];
  const targetOf = new Map<string, Target>();
  const mm = S(state).map;
  const moving = new Set<number>();
  for (const s of stacks) {
    const pr = profileOf(state, s);
    const ll: [number, number] = s.pos.kind === 'node' ? (pr.ll ??= [mm.lon[s.pos.node], mm.lat[s.pos.node]]) : stackLL(state, s);
    const tg: Target = { s, ll, dom: pr.dom, sig: pr.sig, pr };
    targets.push(tg);
    targetOf.set(s.id, tg);
    const k = s.pos.kind === 'node' ? (pr.bin ??= binKey(ll[0], ll[1])) : binKey(ll[0], ll[1]);
    if (s.pos.kind !== 'node') moving.add(k);
    const l = bins.get(k);
    if (l) l.push(tg);
    else bins.set(k, [tg]);
    const os = binOwners.get(k);
    if (os) os.add(s.owner);
    else binOwners.set(k, new Set([s.owner]));
  }
  const useCache = incrementalEnabled && !opts.full;
  let vc = visCaches.get(state);
  if (!vc || !useCache) {
    vc = { binLists: new Map(), binVer: new Map(), verSeq: 0, sensors: new Map(), countryDets: new Map(), countrySnap: new Map(), binToCountries: new Map(), ownv: -1 };
    if (useCache) visCaches.set(state, vc);
  }
  // bin versions → set of bins that changed since the previous run
  const changed = new Set<number>();
  const seenBins = new Set<number>();
  for (const [k, l] of bins) {
    seenBins.add(k);
    const sig: unknown[] = [];
    for (const tg of l) sig.push(tg.s, tg.pr);
    const prev = vc.binLists.get(k);
    let same = !moving.has(k) && !!prev && prev.length === sig.length;
    if (same) for (let i = 0; i < sig.length; i++) if (prev![i] !== sig[i]) { same = false; break; }
    if (!same) {
      vc.binLists.set(k, sig);
      vc.binVer.set(k, ++vc.verSeq);
      changed.add(k);
    }
  }
  for (const k of [...vc.binLists.keys()]) if (!seenBins.has(k)) {
    vc.binLists.delete(k);
    vc.binVer.set(k, ++vc.verSeq);
    changed.add(k);
  }
  const ownv = state.ids.ownv ?? 0;
  const ownChanged = vc.ownv !== ownv;
  vc.ownv = ownv;
  const sensors = buildSensors(state, targets);
  const terrBy = new Map<CountryId, { s: Stack; node: NodeId }[]>();
  for (const s of stacks) {
    const node: NodeId | null = s.pos.kind === 'node' ? s.pos.node : s.pos.kind === 'edge' ? s.pos.to : null;
    if (node === null) continue;
    const o = state.provinces[node]?.owner;
    if (!o || o === s.owner) continue;
    const l = terrBy.get(o) ?? [];
    l.push({ s, node });
    terrBy.set(o, l);
  }
  // countries that must be recomputed
  const dirty = new Set<CountryId>();
  for (const k of changed) for (const c of vc.binToCountries.get(k) ?? []) dirty.add(c);
  const result = new Map<CountryId, Map<string, Det>>();
  for (const c of state.countryOrder) {
    const sens = sensors.get(c) ?? [];
    const terr = terrBy.get(c) ?? [];
    const snap = vc.countrySnap.get(c);
    let isDirty = ownChanged || dirty.has(c) || !snap || !vc.countryDets.has(c);
    if (!isDirty) {
      if (snap!.sensors.length !== sens.length) isDirty = true;
      else for (let i = 0; i < sens.length; i++) if (!sameSensor(snap!.sensors[i], sens[i])) { isDirty = true; break; }
    }
    const terrSig: unknown[] = [];
    for (const x of terr) terrSig.push(x.s, profileOf(state, x.s), x.node);
    if (!isDirty) {
      const t0 = snap!.terr;
      if (t0.length !== terrSig.length) isDirty = true;
      else for (let i = 0; i < t0.length; i++) if (t0[i] !== terrSig[i]) { isDirty = true; break; }
    }
    if (!isDirty) {
      result.set(c, vc.countryDets.get(c)!);
      continue;
    }
    const dets = new Map<string, Det>();
    const upd = (sid: string, level: ContactLevel, unitIdx: number[], domain: Domain | 'land', src: string) => {
      let d = dets.get(sid);
      if (!d) {
        d = { level, units: new Set(), domain, src: new Set() };
        dets.set(sid, d);
      }
      if (LEVEL_RANK[level] > LEVEL_RANK[d.level]) d.level = level;
      if (level !== 'contact') for (const i of unitIdx) d.units.add(i);
      if (d.level === 'contact') d.domain = domain;
      d.src.add(src);
    };
    const binsOfC = new Set<number>();
    for (const sen of sens) {
      const r = Math.max(sen.sight, sen.radar);
      if (r <= 0) continue;
      const keys = binsAround(sen.ll[0], sen.ll[1], r);
      for (const k of keys) binsOfC.add(k);
      const entry = vc.sensors.get(sen.key);
      let valid = !ownChanged && !!entry && sameSensor(entry.snap, sen);
      if (valid) for (const k of keys) if (changed.has(k)) { valid = false; break; }
      let hits: Hit[];
      if (valid) hits = entry!.hits;
      else {
        hits = detectFrom(state, c, sen, bins, binOwners, keys);
        vc.sensors.set(sen.key, { snap: sen, hits });
      }
      for (const h of hits) upd(h.sid, h.level, h.units, h.domain, sen.id);
    }
    // territory sight: stacks standing on nodes this country owns
    for (const { s, node } of terr) {
      const tg = targetOf.get(s.id)!;
      const vis: number[] = [];
      for (let i = 0; i < tg.dom.length; i++) {
        const dom = tg.dom[i];
        if (dom === 'subsurface' || dom === 'air') continue;
        if (tg.sig[i] >= 3) continue;
        vis.push(i);
      }
      if (vis.length) upd(s.id, mm.cityByNode.has(node) ? 'identified' : 'unidentified', vis, tg.dom[vis[0]], `territory:${node}`);
    }
    // re-index bins → countries
    if (snap) for (const k of snap.bins) vc.binToCountries.get(k)?.delete(c);
    for (const k of binsOfC) (vc.binToCountries.get(k) ?? vc.binToCountries.set(k, new Set()).get(k)!).add(c);
    vc.countrySnap.set(c, { sensors: sens, terr: terrSig, bins: binsOfC });
    vc.countryDets.set(c, dets);
    result.set(c, dets);
  }
  if (vc.sensors.size > 4 * (targets.length + 2000)) {
    const live = new Set<string>();
    for (const l of sensors.values()) for (const x of l) live.add(x.key);
    for (const k of [...vc.sensors.keys()]) if (!live.has(k)) vc.sensors.delete(k);
  }
  return result;
}

/** Recompute every viewer's contact table (each step). */
export function updateVisibility(state: GameState): void {
  const dets = computeDetections(state);
  const t = state.clock.tick;
  for (const viewer of state.countryOrder) {
    const table = (state.contacts[viewer] ??= {});
    const srcs = visionSources(state, viewer);
    let merged = new Map<string, Det>();
    if (srcs.length === 1) {
      const d = dets.get(srcs[0]);
      if (d) merged = d;
    } else for (const sc of srcs) {
      const d = dets.get(sc);
      if (!d) continue;
      for (const [sid, det] of d) {
        const st = state.stacks[sid];
        if (!st || st.owner === viewer) continue;
        let x = merged.get(sid);
        if (!x) {
          x = { level: det.level, units: new Set(det.units), domain: det.domain, src: new Set(det.src) };
          merged.set(sid, x);
        } else {
          if (LEVEL_RANK[det.level] > LEVEL_RANK[x.level]) { x.level = det.level; x.domain = det.domain; }
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
      if (prev && prev.level === det.level && prev.domain === det.domain && prev.stack === sid) {
        // in-place refresh (no new object unless a visible field changed)
        prev.observedAt = t;
        if (prev.lonlat[0] !== lon || prev.lonlat[1] !== lat) prev.lonlat = [lon, lat];
        prev.node = node;
        if (det.level !== 'contact') {
          prev.owner = s.owner;
          prev.count = idx.length;
        }
        if (det.level === 'identified') {
          const u = prev.units;
          let same = !!u && u.length === idx.length;
          if (same) for (let i = 0; i < idx.length; i++) {
            const x = s.units[idx[i]];
            if (u![i].type !== x.type || u![i].hpPct !== Math.round((x.hp / x.maxHp) * 100)) { same = false; break; }
          }
          if (!same) prev.units = idx.map((i) => ({ type: s.units[i].type, hpPct: Math.round((s.units[i].hp / s.units[i].maxHp) * 100) }));
        }
        const srcList = det.src.size === 1 ? [...det.src] : [...det.src].sort();
        if (srcList.length !== prev.sources.length || srcList.some((x, i) => x !== prev.sources[i])) prev.sources = srcList;
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
        owner: det.level === 'contact' ? null : s.owner,
        count: det.level === 'contact' ? null : idx.length,
        units: det.level === 'identified' ? idx.map((i) => ({ type: s.units[i].type, hpPct: Math.round((s.units[i].hp / s.units[i].maxHp) * 100) })) : null,
        sources: det.src.size === 1 ? [...det.src] : [...det.src].sort(),
      };
    }
    for (const cid of Object.keys(table)) {
      if (seen.has(cid)) continue;
      const c = table[cid];
      if (c.level !== 'stale') {
        c.level = 'stale';
        c.sources = [];
      }
      if (t - c.observedAt > STALE_KEEP_MIN) delete table[cid];
    }
  }
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
