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
import { cmpId, stackLL, ustats, utype, visionSources } from './world';
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

function buildSensors(state: GameState): Map<CountryId, Sensor[]> {
  const out = new Map<CountryId, Sensor[]>();
  const push = (c: CountryId, s: Sensor) => {
    const l = out.get(c) ?? [];
    l.push(s);
    out.set(c, l);
  };
  for (const s of Object.values(state.stacks).sort(cmpId)) {
    if (s.aboard) continue;
    let sight = 0, radar = 0, sens = 0, recon = false, asw = false;
    const det = new Set<Domain>();
    const ll = stackLL(state, s);
    const terr = s.pos.kind === 'node' ? S(state).map.terrain[s.pos.node] : null;
    for (const u of s.units) {
      if (u.hp <= 0) continue;
      const t = utype(state, u.type);
      const st = ustats(state, u);
      const sm = terr ? t.terrain[terr]?.sight ?? 1 : 1;
      sight = Math.max(sight, st.sightKm * sm);
      if (st.radarKm > radar) radar = st.radarKm;
      sens = Math.max(sens, st.radarSensitivity ?? (st.radarKm > 0 ? 1 : 0));
      for (const d of st.radarDetects ?? (st.radarKm > 0 ? ['air'] : [])) det.add(d as Domain);
      if (t.family === 'recon') recon = true;
      if ((st.attack.submarine ?? 0) > 0) asw = true;
    }
    push(s.owner, { owner: s.owner, ll, sight, radar, sens, detects: [...det], recon, asw, id: s.id });
  }
  const m = S(state).map;
  for (const k of Object.keys(state.cities).sort()) {
    const c = state.cities[k];
    const o = state.provinces[c.node]?.owner;
    if (!o) continue;
    const radar = sumEffect(state, c.buildings, 'radarKm');
    const sens = Math.max(radar > 0 ? 1 : 0, Math.floor(sumEffect(state, c.buildings, 'radarSensitivity', false)));
    push(o, { owner: o, ll: [m.lon[c.node], m.lat[c.node]], sight: CITY_SIGHT_KM, radar, sens, detects: radar > 0 ? ['air', 'sea', 'land'] : [], recon: false, asw: false, id: `city:${k}` });
  }
  return out;
}

export function computeDetections(state: GameState): Map<CountryId, Map<string, Det>> {
  const sensors = buildSensors(state);
  const stacks = Object.values(state.stacks).filter((s) => !s.aboard).sort(cmpId);
  const bins = new Map<string, { s: Stack; ll: [number, number] }[]>();
  for (const s of stacks) {
    const ll = stackLL(state, s);
    const k = binKey(ll[0], ll[1]);
    const l = bins.get(k) ?? [];
    l.push({ s, ll });
    bins.set(k, l);
  }
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
        for (const { s, ll } of l) {
          if (s.owner === c) continue;
          const d = distKm(sen.ll[0], sen.ll[1], ll[0], ll[1]);
          if (d > r) continue;
          const vis: number[] = [];
          const rad: number[] = [];
          let radDomain: Domain | 'land' = 'land';
          for (let i = 0; i < s.units.length; i++) {
            const u = s.units[i];
            const st = ustats(state, u);
            const dom = unitDomain(state, s, i);
            if (d <= sen.sight) {
              const subOk = dom !== 'subsurface' || sen.asw;
              const stealthOk = st.signature < 3 || d <= sen.sight * STEALTH_VISUAL_FRACTION;
              if (subOk && stealthOk) vis.push(i);
            }
            if (d <= sen.radar && sen.detects.includes(dom) && st.signature <= sen.sens) {
              rad.push(i);
              radDomain = dom;
            }
          }
          if (vis.length) {
            const inCity = s.pos.kind === 'node' && state.provinces[s.pos.node]?.owner === c && m.cityByNode.has(s.pos.node);
            const ident = sen.recon || d <= sen.sight * IDENTIFY_FRACTION || inCity;
            upd(s.id, ident ? 'identified' : 'unidentified', vis, unitDomain(state, s, vis[0]), sen.id);
          } else if (rad.length) upd(s.id, 'contact', [], radDomain, sen.id);
        }
      }
    }
    // territory sight: stacks standing on nodes this country owns
    for (const { s, node } of terrBy.get(c) ?? []) {
      const vis: number[] = [];
      for (let i = 0; i < s.units.length; i++) {
        const dom = unitDomain(state, s, i);
        if (dom === 'subsurface' || dom === 'air') continue;
        if (ustats(state, s.units[i]).signature >= 3) continue;
        vis.push(i);
      }
      if (vis.length) upd(s.id, m.cityByNode.has(node) ? 'identified' : 'unidentified', vis, unitDomain(state, s, vis[0]), `territory:${node}`);
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
  for (const s of Object.values(state.stacks).sort(cmpId)) {
    if (s.aboard) continue;
    const l = byOwner.get(s.owner) ?? [];
    l.push(s);
    byOwner.set(s.owner, l);
  }
  for (const viewer of state.countryOrder) {
    const table = (state.contacts[viewer] ??= {});
    const srcs = visionSources(state, viewer);
    const merged = new Map<string, Det>();
    for (const sc of srcs) {
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
    for (const sid of [...merged.keys()].sort()) {
      const det = merged.get(sid) as Det;
      const s = state.stacks[sid];
      const cid = contactId(state, viewer, sid);
      seen.add(cid);
      const ll = stackLL(state, s);
      const prev = table[cid];
      const idx = [...det.units].sort((a, b) => a - b);
      const c: Contact = {
        id: cid,
        stack: sid,
        level: det.level,
        domain: det.domain,
        lonlat: [round4(ll[0]), round4(ll[1])],
        node: s.pos.kind === 'node' ? s.pos.node : null,
        observedAt: t,
        firstSeenAt: prev?.firstSeenAt ?? t,
        owner: det.level === 'contact' ? null : s.owner,
        count: det.level === 'contact' ? null : idx.length,
        units: det.level === 'identified' ? idx.map((i) => ({ type: s.units[i].type, hpPct: Math.round((s.units[i].hp / s.units[i].maxHp) * 100) })) : null,
        sources: [...det.src].sort(),
      };
      table[cid] = c;
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
