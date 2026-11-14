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
    const key = `${s.owner}|${s.pos.kind === 'node' ? s.pos.node : ll.join(',')}|${recon ? 1 : 0}${asw ? 1 : 0}`;
    const prev = merged.get(key);
    if (!prev) {
      const sen: Sensor = { owner: s.owner, ll, sight, radar, sens, detects: det, recon, asw, id: s.id };
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
  for (const k of Object.keys(state.cities).sort()) {
    const c = state.cities[k];
    const o = state.provinces[c.node]?.owner;
    if (!o) continue;
    const radar = c.buildings.length ? sumEffect(state, c.buildings, 'radarKm') : 0;
    const sens = radar > 0 ? Math.max(1, Math.floor(sumEffect(state, c.buildings, 'radarSensitivity', false))) : 0;
    push(o, { owner: o, ll: [m.lon[c.node], m.lat[c.node]], sight: CITY_SIGHT_KM, radar, sens, detects: radar > 0 ? ['air', 'sea', 'land'] : [], recon: false, asw: false, id: `city:${k}` });
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

export function computeDetections(state: GameState): Map<CountryId, Map<string, Det>> {
  const stacks = sortedStacks(state).filter((s) => !s.aboard);
  const bins = new Map<number, Target[]>();
  const binOwners = new Map<number, Set<CountryId>>();
  const targets: Target[] = [];
  const targetOf = new Map<string, Target>();
  const mm = S(state).map;
  for (const s of stacks) {
    const pr = profileOf(state, s);
    const ll: [number, number] = s.pos.kind === 'node' ? (pr.ll ??= [mm.lon[s.pos.node], mm.lat[s.pos.node]]) : stackLL(state, s);
    const tg: Target = { s, ll, dom: pr.dom, sig: pr.sig, pr };
    targets.push(tg);
    targetOf.set(s.id, tg);
    const k = s.pos.kind === 'node' ? (pr.bin ??= binKey(ll[0], ll[1])) : binKey(ll[0], ll[1]);
    const l = bins.get(k);
    if (l) l.push(tg);
    else bins.set(k, [tg]);
    const os = binOwners.get(k);
    if (os) os.add(s.owner);
    else binOwners.set(k, new Set([s.owner]));
  }
  const sensors = buildSensors(state, targets);
  const m = S(state).map;
  const result = new Map<CountryId, Map<string, Det>>();
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
  for (const c of state.countryOrder) {
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
    for (const sen of sensors.get(c) ?? []) {
      const r = Math.max(sen.sight, sen.radar);
      if (r <= 0) continue;
      for (const k of binsAround(sen.ll[0], sen.ll[1], r)) {
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
            upd(s.id, ident ? 'identified' : 'unidentified', vis, tg.dom[vis[0]], sen.id);
          } else if (radHit) upd(s.id, 'contact', [], radDomain, sen.id);
        }
      }
    }
    // territory sight: stacks standing on nodes this country owns
    for (const { s, node } of terrBy.get(c) ?? []) {
      const tg = targetOf.get(s.id)!;
      const vis: number[] = [];
      for (let i = 0; i < tg.dom.length; i++) {
        const dom = tg.dom[i];
        if (dom === 'subsurface' || dom === 'air') continue;
        if (tg.sig[i] >= 3) continue;
        vis.push(i);
      }
      if (vis.length) upd(s.id, m.cityByNode.has(node) ? 'identified' : 'unidentified', vis, tg.dom[vis[0]], `territory:${node}`);
    }
    result.set(c, dets);
  }
  return result;
}

/** Recompute every viewer's contact table (each step). */
export function updateVisibility(state: GameState): void {
  const dets = computeDetections(state);
  const t = state.clock.tick;
  const byOwner = new Map<CountryId, Stack[]>();
  for (const s of sortedStacks(state)) {
    if (s.aboard) continue;
    const l = byOwner.get(s.owner) ?? [];
    l.push(s);
    byOwner.set(s.owner, l);
  }
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
    // allied (vision-source) stacks are fully known
    for (const sc of srcs) {
      if (sc === viewer) continue;
      for (const s of byOwner.get(sc) ?? []) {
        merged.set(s.id, { level: 'identified', units: new Set(s.units.map((_, i) => i)), domain: unitDomain(state, s, 0), src: new Set([`ally:${sc}`]) });
      }
    }
    const seen = new Set<string>();
    const ids = cidCache(state, viewer);
    for (const [sid, det] of merged) {
      const s = state.stacks[sid];
      if (!s || s.owner === viewer) continue;
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
      if (prev && prev.level === det.level && det.level === 'contact' && prev.domain === det.domain) {
        // in-place refresh of an unchanged radar contact
        prev.observedAt = t;
        prev.lonlat = [lon, lat];
        prev.node = node;
        prev.sources = det.src.size === 1 ? [...det.src] : [...det.src].sort();
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
  if (!c || c.level === 'stale' || !state.stacks[c.stack]) return null;
  return c.stack;
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
