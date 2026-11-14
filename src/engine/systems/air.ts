/**
 * Air operations: home base (airstrip node or carrier), patrol (time on station within
 * endurance, radius), return, refuel interval, rebase (new home on arrival).
 *
 * Bases: any owned/coalition/passage-granting city (implicit airstrip, slots by tier) or a rural
 * node with an airSlots building; or a friendly carrier stack (unit type with `carries`).
 * A base is DISABLED when its city/airfield condition < BASE_DISABLED_CONDITION: aircraft on the
 * ground there are GROUNDED (cannot take off) but safe; airborne aircraft cannot land there.
 * A10 RULE: when the home base is destroyed/captured/access lost while airborne (or on landing),
 * the flight diverts to the nearest legal base within remaining range (event "aircraft
 * diverted"); if none exists the aircraft is LOST (event "aircraft lost"). Aircraft on the
 * ground at a captured base evacuate the same way immediately. Aircraft aboard a sunk carrier
 * are lost with it.
 */
import type { CountryId, NodeId } from '../data-types';
import type { AirState, GameState, Stack } from '../state';
import {
  BASE_DISABLED_CONDITION,
  CITY_AIR_SLOTS_BY_TIER,
  DEFAULT_ENDURANCE_MIN,
  DEFAULT_OPERATIONAL_RANGE_KM,
  DEFAULT_PATROL_RADIUS_KM,
  REFUEL_MIN,
} from '../rules';
import { S } from '../scenario/registry';
import { distKm, nodeLL } from './mapindex';
import { cmpId, isFriendlyTerritory, sameCoalition, stackLL, ustats, utype , sortedStacks } from './world';
import { emit, toAll } from './events';
import { sumEffect } from './economy';

export function airSpeed(state: GameState, s: Stack): number {
  return Math.min(...s.units.map((u) => ustats(state, u).speedKmh));
}
export function airEndurance(state: GameState, s: Stack): number {
  return Math.min(...s.units.map((u) => ustats(state, u).enduranceMin ?? DEFAULT_ENDURANCE_MIN));
}
export function airRange(state: GameState, s: Stack): number {
  return Math.min(...s.units.map((u) => ustats(state, u).operationalRangeKm ?? DEFAULT_OPERATIONAL_RANGE_KM));
}

export function isCarrier(state: GameState, s: Stack): boolean {
  return s.units.some((u) => u.hp > 0 && !!utype(state, u.type).carries);
}
export function carrierSlots(state: GameState, s: Stack): number {
  let n = 0;
  for (const u of s.units) if (u.hp > 0) n += utype(state, u.type).carries?.slots ?? 0;
  return n;
}

export function nodeAirSlots(state: GameState, node: NodeId): number {
  const m = S(state).map;
  const p = state.provinces[node];
  if (!p) return 0;
  let slots = sumEffect(state, p.buildings, 'airSlots', false);
  const ck = m.cityByNode.get(node);
  if (ck && state.cities[ck]) {
    const c = state.cities[ck];
    slots += CITY_AIR_SLOTS_BY_TIER[c.tier] ?? 0;
    slots += sumEffect(state, c.buildings, 'airSlots', false);
  }
  return Math.floor(slots);
}
export function baseCondition(state: GameState, node: NodeId): number {
  const m = S(state).map;
  const ck = m.cityByNode.get(node);
  if (ck && state.cities[ck]) return state.cities[ck].condition;
  const p = state.provinces[node];
  const af = p?.buildings.filter((b) => {
    const t = S(state).cat.buildings.get(b.type);
    return t?.levels.some((l) => (l.effects.airSlots ?? 0) > 0);
  });
  return af && af.length ? Math.max(...af.map((b) => b.condition)) : 0;
}

export interface BaseVerdict {
  ok: boolean;
  reason?: string;
  code?: string;
  disabled?: boolean;
}
export function checkBase(state: GameState, c: CountryId, base: { node: NodeId } | { stack: string }): BaseVerdict {
  if ('stack' in base) {
    const cs = state.stacks[base.stack];
    if (!cs) return { ok: false, code: 'base_lost', reason: 'Carrier no longer exists.' };
    if (cs.owner !== c && !sameCoalition(state, c, cs.owner)) return { ok: false, code: 'no_access', reason: 'Carrier is not friendly.' };
    if (!isCarrier(state, cs)) return { ok: false, code: 'missing_facility', reason: 'That formation cannot operate aircraft.' };
    return { ok: true };
  }
  const p = state.provinces[base.node];
  if (!p || p.control !== 'country') return { ok: false, code: 'missing_facility', reason: 'No airfield there.' };
  if (!isFriendlyTerritory(state, c, p.owner)) return { ok: false, code: 'no_access', reason: `No basing rights at ${S(state).map.data.nodes[base.node].name}.` };
  if (nodeAirSlots(state, base.node) <= 0) return { ok: false, code: 'missing_facility', reason: 'No airfield at that location.' };
  if (baseCondition(state, base.node) < BASE_DISABLED_CONDITION) return { ok: false, disabled: true, code: 'base_disabled', reason: 'Airfield is disabled (condition too low).' };
  return { ok: true };
}

export function baseLL(state: GameState, base: { node: NodeId } | { stack: string }): [number, number] | null {
  if ('stack' in base) {
    const s = state.stacks[base.stack];
    return s ? stackLL(state, s) : null;
  }
  return nodeLL(S(state).map, base.node);
}

/** Nearest legal base within `km` of a position (nodes then carriers), deterministic. */
export function nearestBase(state: GameState, c: CountryId, ll: [number, number], km: number, exclude?: string): { node: NodeId } | { stack: string } | null {
  const m = S(state).map;
  let best: { node: NodeId } | { stack: string } | null = null;
  let bd = Infinity;
  for (const p of state.provinces) {
    if (!p || p.control !== 'country' || !isFriendlyTerritory(state, c, p.owner)) continue;
    if (exclude === `n${p.node}`) continue;
    const d = distKm(ll[0], ll[1], m.lon[p.node], m.lat[p.node]);
    if (d > km || d >= bd) continue;
    if (!checkBase(state, c, { node: p.node }).ok) continue;
    bd = d;
    best = { node: p.node };
  }
  for (const s of sortedStacks(state)) {
    if (s.moveClass !== 'naval' || exclude === s.id) continue;
    if (!checkBase(state, c, { stack: s.id }).ok) continue;
    const sl = stackLL(state, s);
    const d = distKm(ll[0], ll[1], sl[0], sl[1]);
    if (d <= km && d < bd) { bd = d; best = { stack: s.id }; }
  }
  return best;
}

function fly(state: GameState, s: Stack, to: [number, number], st: AirState): void {
  const from = stackLL(state, s);
  const d = distKm(from[0], from[1], to[0], to[1]);
  const mins = Math.max(1, Math.ceil((d / Math.max(1, airSpeed(state, s))) * 60));
  if (s.aboard) s.aboard = null;
  s.pos = { kind: 'air', from, to, depart: state.clock.tick, arrive: state.clock.tick + mins };
  if (s.air) s.air.state = st;
}

export function launchPatrol(state: GameState, s: Stack, center: [number, number], node: NodeId | null, radiusKm = DEFAULT_PATROL_RADIUS_KM): void {
  const air = s.air!;
  const from = stackLL(state, s);
  const d = distKm(from[0], from[1], center[0], center[1]);
  const sp = Math.max(1, airSpeed(state, s));
  const transit = Math.ceil((d / sp) * 60);
  air.airborneSince = state.clock.tick;
  air.patrol = { center, node, radiusKm, until: state.clock.tick + Math.max(transit, airEndurance(state, s) - transit) };
  air.dest = null;
  fly(state, s, center, 'outbound');
  s.order = null;
}

export function launchRebase(state: GameState, s: Stack, base: { node: NodeId } | { stack: string }): void {
  const air = s.air!;
  const ll = baseLL(state, base) as [number, number];
  air.airborneSince = state.clock.tick;
  air.patrol = null;
  air.dest = base;
  fly(state, s, ll, 'rebasing');
  s.order = null;
}

function land(state: GameState, s: Stack, base: { node: NodeId } | { stack: string }, newHome: boolean): void {
  const air = s.air!;
  if (newHome) air.home = base;
  air.state = 'refueling';
  air.refuelUntil = state.clock.tick + REFUEL_MIN;
  air.airborneSince = null;
  air.patrol = null;
  air.dest = null;
  if ('stack' in base) {
    const c = state.stacks[base.stack];
    s.aboard = base.stack;
    s.pos = c && c.pos.kind === 'node' ? { kind: 'node', node: c.pos.node } : { kind: 'node', node: c && c.pos.kind === 'edge' ? c.pos.from : 0 };
  } else {
    s.aboard = null;
    s.pos = { kind: 'node', node: base.node };
  }
  s.stationarySince = state.clock.tick;
}

function lose(state: GameState, s: Stack, why: string, onLost: (st: GameState, s: Stack) => void): void {
  emit(state, { kind: 'aircraft_lost', category: 'combat', private: toAll([s.owner], `Aircraft lost: ${s.name} (${s.units.length} aircraft) — ${why}.`, { stack: s.id, count: s.units.length }) });
  onLost(state, s);
}

function divert(state: GameState, s: Stack, why: string, onLost: (st: GameState, s: Stack) => void): void {
  const air = s.air!;
  const ll = stackLL(state, s);
  const elapsed = air.airborneSince === null ? 0 : state.clock.tick - air.airborneSince;
  const remainMin = Math.max(0, airEndurance(state, s) - elapsed);
  const reach = Math.min(airRange(state, s), (airSpeed(state, s) * remainMin) / 60);
  const exclude = 'stack' in air.home ? air.home.stack : `n${air.home.node}`;
  const b = nearestBase(state, s.owner, ll, reach, exclude);
  if (!b) return lose(state, s, `${why}; no legal base within ${Math.round(reach)} km`, onLost);
  air.home = b;
  air.dest = b;
  air.patrol = null;
  if (air.airborneSince === null) air.airborneSince = state.clock.tick;
  const where = 'node' in b ? S(state).map.data.nodes[b.node].name : `carrier ${state.stacks[b.stack].name}`;
  emit(state, { kind: 'aircraft_diverted', category: 'combat', private: toAll([s.owner], `Aircraft diverted: ${s.name} — ${why}; new base ${where}.`, { stack: s.id }) });
  fly(state, s, baseLL(state, b) as [number, number], 'rebasing');
}

/** Per-step air update. */
export function airStep(state: GameState, onLost: (st: GameState, s: Stack) => void): void {
  const t = state.clock.tick;
  for (const s of sortedStacks(state)) {
    if (s.moveClass !== 'air' || !s.air || !state.stacks[s.id]) continue;
    const air = s.air;
    const airborne = air.state === 'outbound' || air.state === 'on_station' || air.state === 'returning' || air.state === 'rebasing';
    if (!airborne) {
      const hv = checkBase(state, s.owner, air.home);
      if (!hv.ok && !hv.disabled) {
        // base captured / access lost / carrier gone while on the ground → evacuate
        if ('stack' in air.home && !state.stacks[air.home.stack]) { lose(state, s, 'carrier lost', onLost); continue; }
        air.airborneSince = t;
        divert(state, s, `base ${hv.reason?.toLowerCase() ?? 'lost'}`, onLost);
        continue;
      }
      air.grounded = !!hv.disabled;
      if (air.state === 'refueling' && air.refuelUntil !== null && t >= air.refuelUntil) {
        air.state = 'landed';
        air.refuelUntil = null;
      }
      continue;
    }
    // airborne: home validity
    const target = air.dest ?? air.home;
    const tv = checkBase(state, s.owner, target);
    if (!tv.ok && (air.state === 'rebasing' || air.state === 'returning')) {
      divert(state, s, `destination ${tv.reason?.toLowerCase() ?? 'unavailable'}`, onLost);
      continue;
    }
    if (air.state !== 'rebasing') {
      const hv = checkBase(state, s.owner, air.home);
      if (!hv.ok) {
        divert(state, s, `home base ${hv.reason?.toLowerCase() ?? 'lost'}`, onLost);
        continue;
      }
    }
    const p = s.pos;
    if (p.kind !== 'air') continue;
    if (air.state === 'outbound' && t >= p.arrive) {
      air.state = 'on_station';
      s.pos = { kind: 'air', from: p.to, to: p.to, depart: t, arrive: t };
    }
    if (air.state === 'on_station' && air.patrol && t >= air.patrol.until) {
      fly(state, s, baseLL(state, air.home) as [number, number], 'returning');
      continue;
    }
    if ((air.state === 'returning' || air.state === 'rebasing') && t >= p.arrive) {
      const dest = air.state === 'rebasing' ? (air.dest ?? air.home) : air.home;
      const dv = checkBase(state, s.owner, dest);
      if (!dv.ok) {
        divert(state, s, `cannot land: ${dv.reason?.toLowerCase()}`, onLost);
        continue;
      }
      // carrier may have moved: chase if still far
      const bl = baseLL(state, dest) as [number, number];
      const cur = stackLL(state, s);
      if ('stack' in dest && distKm(cur[0], cur[1], bl[0], bl[1]) > 30) {
        fly(state, s, bl, air.state);
        continue;
      }
      land(state, s, dest, air.state === 'rebasing');
      if ('node' in dest) {
        emit(state, { kind: 'aircraft_landed', category: 'combat', routine: true, node: dest.node, private: toAll([s.owner], `${s.name} landed at ${S(state).map.data.nodes[dest.node].name}.`) });
      }
    }
  }
}

export function airborneCount(state: GameState, node: NodeId): number {
  let n = 0;
  for (const s of Object.values(state.stacks)) if (s.moveClass === 'air' && s.air && 'node' in s.air.home && s.air.home.node === node) n += s.units.length;
  return n;
}
