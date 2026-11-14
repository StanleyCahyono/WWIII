/**
 * AIR-MOBILE LIFT (helicopters). Rotary-wing units with `UnitType.airmobileCapacity` carry light
 * infantry between land nodes in one direct flight; infantry types with their own capacity
 * (organic helicopter lift, e.g. air-assault infantry) lift themselves.
 *
 * Order (`airmobile` command, same validator for human and AI):
 *  - the formation is a ground stack standing at a land node (not mid-edge, not aboard);
 *  - every non-helicopter unit is a PASSENGER and must be light infantry (family infantry with
 *    target class unarmored) or an officer; self-lifting infantry needs no seat;
 *  - passengers ≤ Σ airmobileCapacity of living helicopters (attack helicopters fly along as escort);
 *  - every flying unit (helicopters + self-lifters) must be past its turnaround (`cooldownUntil`);
 *  - the destination is a land node inside the campaign, AIRMOBILE.minKm ≤ distance ≤ range
 *    (min operationalRangeKm of the flying units, default AIRMOBILE.defaultRangeKm, × the owner's
 *    air_operational_range_mult); landing in a country at peace without passage is an ACT OF WAR
 *    (confirmActOfWar; war is declared on landing, as for ground entry);
 *  - fuel: flying units × ceil(km / 100) × AIRMOBILE.fuelPer100Km, charged at launch (ledger
 *    category `operations`).
 * Flight: the stack takes an `air` position (from → to, depart → arrive) with a MoveOrder carrying
 * `airmobile`; arrive = launch + loadMin + km / min(maxSpeedKmh, slowest helicopter). While airborne
 * it cannot fight at a node, capture, split, merge, stop or be re-ordered.
 * Landing (step 2b, after air operations and before movement/capture):
 *  1. legality is re-checked: a destination now owned by a country at peace without passage that
 *     was not confirmed ⇒ the lift turns back to its origin (event; no fuel refund);
 *  2. INTERCEPTION: risk p = Σ over hostile (at war) air-defence units whose position lies within
 *     max(unit range, adCoverKm) of the straight flight path (riskPerAdLevel × level × hp fraction)
 *     + hostile fighters on patrol whose patrol circle touches the path (riskPerFighter each)
 *     + an opposed landing (hostile combat-capable ground forces at the destination), capped at
 *     riskCap. One seeded draw (stream "airmobile", key `<stack>:<launchedAt>`) decides; an
 *     intercepted lift loses a seeded fraction [damageMin, damageMax] of every unit's max HP
 *     (units at 0 HP are lost; an emptied formation is destroyed). Events to the owner and to the
 *     defending owners ("hostile helicopters engaged" — the attacker is a known enemy at war).
 *  3. the formation lands: node position, land mode, order cleared, stationary from now, and every
 *     flying unit gets `cooldownUntil = now + turnaroundMin`. CAPTURE then follows the ordinary
 *     rule in the same step (capture-capable land unit, at war with the owner, no hostile stack).
 * The preview's risk is an ESTIMATE from the issuer's own identified contacts only (no hidden
 * information); the resolution uses the real positions.
 */
import type { CountryId, NodeId } from '../data-types';
import type { GameState, Stack, Unit } from '../state';
import { AIRMOBILE } from '../rules';
import { S } from '../scenario/registry';
import { streamRng } from '../rng';
import { distKm, nodeLL } from './mapindex';
import { atWar, cmpId, hasPassage, isRebel, ownerOf, stacksReadonly, ustats, utype } from './world';
import { emit, toAll } from './events';
import { charge } from './ledger';
import { zero, type ResM, geq, shortfall, fmtVec } from '../fixed';
import { cmod } from './modifiers';
import { combatUnits } from './combat';

export interface LiftInfo {
  /** Seats offered by helicopters. */
  lift: number;
  /** Units needing a seat. */
  passengers: number;
  /** Units that fly (helicopters + self-lifting infantry). */
  flyers: number;
  /** Units that cannot be air-lifted (names). */
  unsuitable: string[];
  rangeKm: number;
  speedKmh: number;
  /** Earliest tick every flying unit is ready again. */
  readyAt: number;
}

function isHeli(state: GameState, u: Unit): boolean {
  return utype(state, u.type).family === 'helicopter';
}
function selfLifting(state: GameState, u: Unit): boolean {
  const t = utype(state, u.type);
  return t.family !== 'helicopter' && (t.airmobileCapacity ?? 0) > 0;
}
function flies(state: GameState, u: Unit): boolean {
  return isHeli(state, u) || selfLifting(state, u);
}

/** Lift arithmetic of a formation (pure). */
export function liftInfo(state: GameState, s: Stack): LiftInfo {
  let lift = 0, passengers = 0, flyers = 0, readyAt = 0;
  let range = Infinity;
  let speed: number = AIRMOBILE.maxSpeedKmh;
  const unsuitable: string[] = [];
  for (const u of s.units) {
    if (u.hp <= 0) continue;
    const t = utype(state, u.type);
    if (isHeli(state, u)) {
      lift += t.airmobileCapacity ?? 0;
      speed = Math.min(speed, ustats(state, u).speedKmh);
    } else if (!selfLifting(state, u)) {
      passengers++;
      const light = (t.family === 'infantry' && t.targetClass === 'unarmored') || t.family === 'officer';
      if (!light && !unsuitable.includes(t.name)) unsuitable.push(t.name);
    }
    if (flies(state, u)) {
      flyers++;
      range = Math.min(range, ustats(state, u).operationalRangeKm ?? AIRMOBILE.defaultRangeKm);
      readyAt = Math.max(readyAt, u.cooldownUntil ?? 0);
    }
  }
  if (!Number.isFinite(range)) range = 0;
  return { lift, passengers, flyers, unsuitable, rangeKm: range * cmod(state, s.owner, 'air_operational_range_mult'), speedKmh: Math.max(1, speed), readyAt };
}

/** Can this formation fly an air-mobile hop at all (ignoring destination, range and turnaround)? */
export function canAirLift(state: GameState, s: Stack): boolean {
  if (s.moveClass !== 'ground') return false;
  const li = liftInfo(state, s);
  return li.flyers > 0 && !li.unsuitable.length && li.passengers <= li.lift;
}

/** Great-circle-ish distance (km) from point p to the straight segment a→b (local equirectangular). */
export function distToPathKm(p: [number, number], a: [number, number], b: [number, number]): number {
  const lat0 = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const kx = 111.32 * Math.cos(lat0), ky = 110.57;
  let dlon = b[0] - a[0];
  if (dlon > 180) dlon -= 360;
  if (dlon < -180) dlon += 360;
  let plon = p[0] - a[0];
  if (plon > 180) plon -= 360;
  if (plon < -180) plon += 360;
  const bx = dlon * kx, by = (b[1] - a[1]) * ky, px = plon * kx, py = (p[1] - a[1]) * ky;
  const L = bx * bx + by * by;
  const t = L > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0;
  const q: [number, number] = [a[0] + dlon * t, a[1] + (b[1] - a[1]) * t];
  return distKm(p[0], p[1], q[0], q[1]);
}

export interface AirmobilePreview {
  from: NodeId;
  dest: NodeId;
  km: number;
  rangeKm: number;
  lift: number;
  passengers: number;
  flyers: number;
  arriveAt: number;
  flightMin: number;
  fuel: ResM;
  actOfWar: CountryId[];
  /** Estimated interception chance from the issuer's own observations (0..1). */
  riskEstimate: number;
  riskNote: string;
}

export type AirmobileVerdict = { ok: true; preview: AirmobilePreview } | { ok: false; code: string; reason: string; details?: unknown };

function confirmed(c: CountryId[] | boolean | undefined, need: CountryId[]): boolean {
  if (!need.length || c === true) return true;
  return Array.isArray(c) && need.every((x) => c.includes(x));
}

/** Full validation of an air-mobile hop (shared by the command and the AI preview). */
export function checkAirmobile(state: GameState, s: Stack, dest: NodeId, confirm: CountryId[] | boolean | undefined): AirmobileVerdict {
  const m = S(state).map;
  if (s.moveClass !== 'ground') return { ok: false, code: 'invalid_domain', reason: 'Only ground formations with helicopter lift fly air-mobile hops (aircraft use Patrol or Rebase).' };
  if (s.aboard) return { ok: false, code: 'invalid_domain', reason: 'Formation is aboard a carrier.' };
  if (s.pos.kind === 'air') return { ok: false, code: 'busy', reason: 'Formation is already in an air-mobile flight.' };
  if (s.pos.kind !== 'node') return { ok: false, code: 'busy', reason: 'Formation must be stationary at a province to load helicopters.' };
  const from = s.pos.node;
  if (!m.isLand[from]) return { ok: false, code: 'invalid_domain', reason: 'Helicopters load in a land province, not at sea.' };
  if (!Number.isInteger(dest) || dest < 0 || dest >= m.n) return { ok: false, code: 'unknown_target', reason: 'Unknown destination.' };
  if (!m.isLand[dest]) return { ok: false, code: 'invalid_domain', reason: 'An air-mobile landing needs a land province.' };
  if (m.outside[dest]) return { ok: false, code: 'outside_campaign', reason: 'Destination is outside the campaign.' };
  const li = liftInfo(state, s);
  if (!li.flyers || (li.lift === 0 && li.passengers > 0)) return { ok: false, code: 'missing_facility', reason: 'No air-mobile lift in this formation: it needs a utility helicopter (or air-assault infantry with organic lift).' };
  if (li.unsuitable.length) return { ok: false, code: 'invalid_domain', reason: `${li.unsuitable.join(', ')} cannot be air-lifted — only light infantry and officers ride helicopters; split them off first.` };
  if (li.passengers > li.lift) return { ok: false, code: 'insufficient_lift', reason: `Helicopters seat ${li.lift} infantry unit(s); ${li.passengers} need a seat. Split off ${li.passengers - li.lift} or add lift.` };
  if (li.readyAt > state.clock.tick) return { ok: false, code: 'refueling', reason: `Helicopters are refuelling after their last hop until ${li.readyAt} (tick).` };
  const a = nodeLL(m, from), b = nodeLL(m, dest);
  const km = distKm(a[0], a[1], b[0], b[1]);
  if (dest === from || km < AIRMOBILE.minKm) return { ok: false, code: 'invalid_argument', reason: `Destination is only ${Math.round(km)} km away — move by land.` };
  if (km > li.rangeKm) return { ok: false, code: 'insufficient_range', reason: `Destination is ${Math.round(km)} km away; helicopter range is ${Math.round(li.rangeKm)} km.` };
  const owner = isRebel(state, dest) ? null : ownerOf(state, dest);
  const aow: CountryId[] = owner && !hasPassage(state, s.owner, owner) ? [owner] : [];
  if (aow.length && !confirmed(confirm, aow)) return { ok: false, code: 'act_of_war', reason: `Landing in ${owner} territory without passage rights is an act of war. Confirm to declare war on landing.`, details: { actOfWar: aow } };
  const fuel = zero();
  fuel.fuel = li.flyers * Math.ceil(km / 100) * AIRMOBILE.fuelPer100Km * 1000;
  const stock = state.countries[s.owner].stock;
  if (!geq(stock, fuel)) return { ok: false, code: 'insufficient_resources', reason: `Insufficient fuel for the hop — short by ${fmtVec(shortfall(stock, fuel))}.` };
  const flightMin = AIRMOBILE.loadMin + Math.max(1, Math.ceil((km / li.speedKmh) * 60));
  const est = estimateRisk(state, s.owner, from, dest, aow);
  return { ok: true, preview: { from, dest, km, rangeKm: li.rangeKm, lift: li.lift, passengers: li.passengers, flyers: li.flyers, arriveAt: state.clock.tick + flightMin, flightMin, fuel, actOfWar: aow, riskEstimate: est.p, riskNote: est.note } };
}

function hostileTo(state: GameState, me: CountryId, other: CountryId, extraEnemies: CountryId[]): boolean {
  return other !== me && (atWar(state, me, other) || extraEnemies.includes(other));
}

/** Interception estimate from the issuer's own contact table (identified contacts only). */
function estimateRisk(state: GameState, c: CountryId, from: NodeId, dest: NodeId, aow: CountryId[]): { p: number; note: string } {
  const m = S(state).map;
  const a = nodeLL(m, from), b = nodeLL(m, dest);
  const table = state.contacts[c] ?? {};
  let p = 0, ad = 0, ftr = 0, opposed = false;
  for (const id of Object.keys(table).sort()) {
    const ct = table[id];
    if (ct.level === 'stale' || !ct.owner || !hostileTo(state, c, ct.owner, aow)) continue;
    if (ct.node === dest && ct.level !== 'contact') opposed = true;
    if (ct.level !== 'identified' || !ct.units) continue;
    const d = distToPathKm(ct.lonlat, a, b);
    for (const u of ct.units) {
      const t = S(state).cat.units.get(u.type);
      if (!t) continue;
      if (t.family === 'air_defense') {
        const r = Math.max(t.levels[0]?.rangeKm ?? 0, AIRMOBILE.adCoverKm);
        if (d <= r) { p += AIRMOBILE.riskPerAdLevel * (u.hpPct / 100); ad++; }
      } else if (t.family === 'fighter' && (t.levels[0]?.attack.helicopter ?? 0) > 0 && d <= 150) {
        p += AIRMOBILE.riskPerFighter;
        ftr++;
      }
    }
  }
  if (opposed) p += AIRMOBILE.riskOpposedLanding;
  p = Math.min(AIRMOBILE.riskCap, Math.round(p * 1000) / 1000);
  const parts: string[] = [];
  if (ad) parts.push(`${ad} observed air-defence unit(s) near the path`);
  if (ftr) parts.push(`${ftr} observed fighter(s) near the path`);
  if (opposed) parts.push('hostile forces observed at the landing zone');
  const note = parts.length ? `${parts.join('; ')}. Unobserved defences can raise the risk.` : 'No hostile air defence observed along the path; unobserved defences can still intercept.';
  return { p, note };
}

/** Launch (apply of the validated command). */
export function launchAirmobile(state: GameState, s: Stack, p: AirmobilePreview): void {
  const m = S(state).map;
  charge(state, s.owner, 'operations', p.fuel);
  const t = state.clock.tick;
  s.order = { kind: 'move', route: [], dest: p.dest, waypoints: [], warConfirmed: [...p.actOfWar].sort(), issuedAt: t, airmobile: { from: p.from, launchedAt: t, arriveAt: p.arriveAt, km: Math.round(p.km) } };
  s.pos = { kind: 'air', from: nodeLL(m, p.from), to: nodeLL(m, p.dest), depart: t, arrive: p.arriveAt };
  s.mode = 'air';
  s.delayUntil = null;
  s.engagement = null;
  s.refit = false;
  s.stationarySince = t;
  emit(state, { kind: 'airmobile_launched', category: 'combat', node: p.from, routine: true, private: toAll([s.owner], `${s.name} lifts off for ${m.data.nodes[p.dest].name} (${Math.round(p.km)} km, lands at tick ${p.arriveAt}).`, { stack: s.id, dest: p.dest, arriveAt: p.arriveAt }) });
}

export interface AirmobileHooks {
  declareWar: (state: GameState, by: CountryId, target: CountryId, reason: string) => void;
  destroy: (state: GameState, s: Stack, by: CountryId | null) => void;
}

/** True interception risk at landing time and the countries whose defences took part. */
export function interceptionRisk(state: GameState, s: Stack, from: NodeId, dest: NodeId): { p: number; defenders: CountryId[] } {
  const m = S(state).map;
  const a = nodeLL(m, from), b = nodeLL(m, dest);
  let p = 0;
  const defenders = new Set<CountryId>();
  for (const o of stacksReadonly(state)) {
    if (o.owner === s.owner || o.aboard || state.stacks[o.id] !== o || !atWar(state, s.owner, o.owner)) continue;
    if (o.moveClass === 'air') {
      if (!o.air || o.air.state !== 'on_station' || !o.air.patrol) continue;
      const d = distToPathKm(o.air.patrol.center, a, b);
      if (d > o.air.patrol.radiusKm) continue;
      for (const u of o.units) if (u.hp > 0 && (ustats(state, u).attack.helicopter ?? 0) > 0) { p += AIRMOBILE.riskPerFighter; defenders.add(o.owner); }
      continue;
    }
    if (o.pos.kind === 'air') continue; // another lift in flight
    const ll: [number, number] = o.pos.kind === 'node' ? nodeLL(m, o.pos.node) : (() => { const q = o.pos; const f = q.length > 0 ? q.progress / q.length : 0; const x = nodeLL(m, q.from), y = nodeLL(m, q.to); return [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f] as [number, number]; })();
    const d = distToPathKm(ll, a, b);
    if (d > 400) continue;
    for (const u of o.units) {
      if (u.hp <= 0 || utype(state, u.type).family !== 'air_defense') continue;
      if (d <= Math.max(ustats(state, u).rangeKm, AIRMOBILE.adCoverKm)) {
        p += AIRMOBILE.riskPerAdLevel * u.level * (u.hp / u.maxHp);
        defenders.add(o.owner);
      }
    }
    if (o.pos.kind === 'node' && o.pos.node === dest && combatUnits(o).length > 0) {
      p += AIRMOBILE.riskOpposedLanding;
      defenders.add(o.owner);
    }
  }
  return { p: Math.min(AIRMOBILE.riskCap, Math.round(p * 1000) / 1000), defenders: [...defenders].sort() };
}

/** Landing of air-mobile lifts due at this step (step 2b). */
export function airmobileStep(state: GameState, hooks: AirmobileHooks): void {
  const t = state.clock.tick;
  const m = S(state).map;
  for (const s of stacksReadonly(state)) {
    if (s.moveClass === 'air' || s.pos.kind !== 'air' || state.stacks[s.id] !== s) continue;
    const o = s.order;
    if (!o || o.kind !== 'move' || !o.airmobile) {
      // defensive: an airborne ground stack without a lift order lands where it is headed
      const p = s.pos;
      if (t >= p.arrive) settle(state, s, nearestLand(state, p.to));
      continue;
    }
    if (t < s.pos.arrive) continue;
    const dest = o.dest;
    const destName = m.data.nodes[dest].name;
    const owner = isRebel(state, dest) ? null : ownerOf(state, dest);
    if (owner && owner !== s.owner && !hasPassage(state, s.owner, owner)) {
      if (o.warConfirmed.includes(owner)) hooks.declareWar(state, s.owner, owner, `Air assault landing at ${destName} by ${s.name}`);
      else if (dest !== o.airmobile.from) {
        // landing became illegal in flight: turn back to the origin
        const back = Math.max(1, s.pos.arrive - s.pos.depart);
        const from = o.airmobile.from;
        s.order = { ...o, dest: from, warConfirmed: [], airmobile: { ...o.airmobile, from: dest, arriveAt: t + back } };
        s.pos = { kind: 'air', from: nodeLL(m, dest), to: nodeLL(m, from), depart: t, arrive: t + back };
        emit(state, { kind: 'airmobile_aborted', category: 'combat', node: dest, private: toAll([s.owner], `${s.name}: landing at ${destName} is no longer legal (no passage from ${owner}); returning to ${m.data.nodes[from].name}.`, { stack: s.id }) });
        continue;
      }
    }
    const risk = interceptionRisk(state, s, o.airmobile.from, dest);
    let lostText = '';
    if (risk.p > 0) {
      const r = streamRng(state.seed, 'airmobile', `${s.id}:${o.airmobile.launchedAt}`);
      const d1 = r.next();
      if (d1 < risk.p) {
        const frac = AIRMOBILE.damageMin + (AIRMOBILE.damageMax - AIRMOBILE.damageMin) * r.next();
        const before = s.units.length;
        for (const u of s.units) u.hp = Math.max(0, u.hp - Math.round(u.maxHp * frac));
        s.units = s.units.filter((u) => u.hp > 0);
        const lost = before - s.units.length;
        lostText = ` Intercepted by air defence en route: every unit took ${Math.round(frac * 100)} % damage${lost ? `, ${lost} unit(s) lost` : ''}.`;
        emit(state, { kind: 'airmobile_intercepted', category: 'combat', node: dest, private: { ...toAll([s.owner], `${s.name}: air-mobile lift to ${destName} intercepted (chance was ${Math.round(risk.p * 100)} %); ${lost} unit(s) lost.`, { stack: s.id, lost, risk: risk.p }), ...toAll(risk.defenders, `Air defence engaged hostile helicopters heading for ${destName}; ${lost} enemy unit(s) shot down.`, { lost }) } });
        if (!s.units.length) {
          hooks.destroy(state, s, risk.defenders[0] ?? null);
          continue;
        }
      }
    }
    settle(state, s, dest);
    for (const u of s.units) if (flies(state, u)) u.cooldownUntil = t + AIRMOBILE.turnaroundMin;
    emit(state, { kind: 'airmobile_landed', category: 'combat', node: dest, routine: !lostText, private: toAll([s.owner], `${s.name} landed at ${destName}.${lostText}`, { stack: s.id, node: dest }) });
  }
}

function settle(state: GameState, s: Stack, node: NodeId): void {
  s.pos = { kind: 'node', node };
  s.mode = 'land';
  s.order = null;
  s.delayUntil = null;
  s.stationarySince = state.clock.tick;
}

function nearestLand(state: GameState, ll: [number, number]): NodeId {
  const m = S(state).map;
  let best = 0, bd = Infinity;
  for (let n = 0; n < m.n; n++) {
    if (!m.isLand[n] || m.outside[n]) continue;
    const d = distKm(ll[0], ll[1], m.lon[n], m.lat[n]);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** Sorted ids of formations currently in an air-mobile flight (diagnostics/tests). */
export function airborneLifts(state: GameState): string[] {
  return Object.values(state.stacks).filter((s) => s.moveClass !== 'air' && s.pos.kind === 'air').sort(cmpId).map((s) => s.id);
}
