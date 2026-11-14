/**
 * Build / mobilization / annexation / missile production queues.
 *
 * PUBLISHED RULES
 *  - Resources are CHARGED IN FULL AT ENQUEUE (ledger: construction / recruitment / annex /
 *    missile_production). Nothing is charged later.
 *  - Cancellation refund: a queued (not started) job refunds 100 %; an active job refunds
 *    floor(cost × remaining fraction × ACTIVE_JOB_REFUND_FACTOR) per resource (ledger 'refund').
 *  - Overlap per city: one construction (incl. annexation) AND one mobilization run
 *    concurrently; further jobs wait FIFO. Rural provinces have one construction slot each.
 *    Missile batches use national missile slots (MISSILE_BASE_SLOTS + Σ missileSlots).
 *  - Occupied cities can build but cannot mobilize. Homeland and annexed cities can mobilize.
 *  - A captured location cancels the former owner's jobs there with the refund rule above.
 */
import type { BuildingType, CityKey, CountryId, NodeId, UnitType } from '../data-types';
import type { GameState, Job, Stack, Unit } from '../state';
import { ACTIVE_JOB_REFUND_FACTOR, CITY_QUEUE_MAX, DEFAULT_ENDURANCE_MIN, MISSILE_BASE_SLOTS } from '../rules';
import { S, unitStats } from '../scenario/registry';
import { copy, fmtVec, mul, type ResM, vecFromWhole, zero, addInto, shortfall } from '../fixed';
import { charge, credit } from './ledger';
import { nextId } from '../ids';
import { schedule, unschedule } from './queue';
import { awardXp, emit, toAll } from './events';
import { buildingLevelDef, sumEffect, bumpEconomy, multEffect } from './economy';
import { cmod } from './modifiers';
import { moveClassOf } from './world';

export interface Verdict {
  ok: boolean;
  code?: string;
  reason?: string;
}

export function locationKey(j: { city: CityKey | null; node: NodeId; slot: string }): string {
  return j.slot === 'missile' ? 'missile' : j.city ? `c:${j.city}:${j.slot}` : `n:${j.node}:${j.slot}`;
}

export function jobProgress(j: Job, tick: number): number {
  if (j.startedAt === null || j.endsAt === null) return 0;
  const d = j.endsAt - j.startedAt;
  return d <= 0 ? 1 : Math.max(0, Math.min(1, (tick - j.startedAt) / d));
}
export function jobRefund(j: Job, tick: number): ResM {
  if (j.startedAt === null) return copy(j.cost);
  const remaining = 1 - jobProgress(j, tick);
  return mul(j.cost, remaining * ACTIVE_JOB_REFUND_FACTOR);
}

export function missileSlots(state: GameState, c: CountryId): number {
  let s = 0;
  for (const k of Object.keys(state.cities)) {
    const city = state.cities[k];
    if (state.provinces[city.node]?.owner === c) s += sumEffect(state, city.buildings, 'missileSlots', false);
  }
  return MISSILE_BASE_SLOTS + Math.floor(s);
}

/** Estimated start tick for a new job at a location (after jobs already queued there). */
export function estimateStart(state: GameState, c: CountryId, key: string): number {
  let t = state.clock.tick;
  const jobs = state.countries[c].jobs.filter((j) => locationKey(j) === key);
  if (key === 'missile') {
    const slots = missileSlots(state, c);
    if (jobs.length < slots) return t;
    const ends = jobs.map((j) => j.endsAt ?? 0).sort((a, b) => a - b);
    return Math.max(t, ends[jobs.length - slots] ?? t);
  }
  for (const j of jobs) t = Math.max(t, (j.endsAt ?? t + j.durationMin));
  return t;
}

export function startJobs(state: GameState, c: CountryId): void {
  const cs = state.countries[c];
  const active = new Map<string, number>();
  for (const j of cs.jobs) if (j.startedAt !== null) active.set(locationKey(j), (active.get(locationKey(j)) ?? 0) + 1);
  let mslots = -1; // national missile slots, computed only when a queued missile job needs them
  for (const j of cs.jobs) {
    if (j.startedAt !== null) continue;
    const k = locationKey(j);
    const cap = k === 'missile' ? (mslots < 0 ? (mslots = missileSlots(state, c)) : mslots) : 1;
    if ((active.get(k) ?? 0) >= cap) continue;
    j.startedAt = state.clock.tick;
    j.endsAt = state.clock.tick + j.durationMin;
    active.set(k, (active.get(k) ?? 0) + 1);
    schedule(state, j.endsAt, 'job_done', j.id, c);
    if (j.kind === 'missile' && j.missile) {
      const inv = cs.missiles[j.missile];
      if (inv && inv.maturity === 'qualified') inv.maturity = 'in_production';
    }
  }
}

export function enqueueJob(state: GameState, job: Omit<Job, 'id' | 'enqueuedAt' | 'startedAt' | 'endsAt'>): Job | null {
  const cat = job.kind === 'construct' ? 'construction' : job.kind === 'mobilize' ? 'recruitment' : job.kind === 'annex' ? 'annex' : 'missile_production';
  if (!charge(state, job.country, cat, job.cost)) return null;
  const j: Job = { ...job, id: nextId(state, 'job'), enqueuedAt: state.clock.tick, startedAt: null, endsAt: null };
  state.countries[job.country].jobs.push(j);
  startJobs(state, job.country);
  return j;
}

export function cancelJobInternal(state: GameState, c: CountryId, jobId: string, why: string): ResM | null {
  const cs = state.countries[c];
  const idx = cs.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  const j = cs.jobs[idx];
  const refund = jobRefund(j, state.clock.tick);
  cs.jobs.splice(idx, 1);
  unschedule(state, 'job_done', j.id);
  credit(state, c, 'refund', refund);
  emit(state, { kind: 'job_cancelled', category: 'economy', node: j.node, routine: true, private: toAll([c], `${describeJob(state, j)} cancelled (${why}); refunded ${fmtVec(refund)}.`, { job: j.id }) });
  startJobs(state, c);
  return refund;
}

export function describeJob(state: GameState, j: Job): string {
  const where = j.city ? state.cities[j.city]?.name ?? j.city : S(state).map.data.nodes[j.node]?.name;
  if (j.kind === 'construct') return `${S(state).cat.buildings.get(j.building as string)?.name ?? j.building} L${j.level} at ${where}`;
  if (j.kind === 'mobilize') return `Mobilizing ${S(state).cat.units.get(j.unit as string)?.name ?? j.unit} at ${where}`;
  if (j.kind === 'annex') return `Annexation of ${where}`;
  return `Missile batch ${S(state).cat.missiles.get(j.missile as string)?.name ?? j.missile} ×${j.batch}`;
}

// ───────────────────────────── eligibility ─────────────────────────────

export interface BuildCheck extends Verdict {
  level?: number;
  cost?: ResM;
  durationMin?: number;
  warning?: string;
  city?: CityKey | null;
  node?: NodeId;
}

export function checkBuild(state: GameState, c: CountryId, target: CityKey | NodeId, bt: BuildingType | undefined, pendingSameTarget = 0): BuildCheck {
  if (!bt) return { ok: false, code: 'unknown_building', reason: 'Unknown building type.' };
  const st = S(state);
  let node: NodeId;
  let cityKey: CityKey | null = null;
  if (typeof target === 'string') {
    const city = state.cities[target];
    if (!city) return { ok: false, code: 'unknown_city', reason: 'Unknown city.' };
    node = city.node;
    cityKey = target;
    if (bt.scope !== 'city') return { ok: false, code: 'wrong_scope', reason: `${bt.name} is a rural improvement, not a city building.`, city: cityKey, node };
  } else {
    node = target;
    if (bt.scope !== 'rural') return { ok: false, code: 'wrong_scope', reason: `${bt.name} must be built in a city.`, node };
  }
  const p = state.provinces[node];
  if (!p || p.control === 'outside') return { ok: false, code: 'invalid_target', reason: 'Not a playable province.', city: cityKey, node };
  if (p.owner !== c) return { ok: false, code: 'not_owner', reason: `You do not control ${cityKey ? state.cities[cityKey].name : st.map.data.nodes[node].name}.`, city: cityKey, node };
  if (bt.unlockTech && !state.countries[c].techs[bt.unlockTech]) return { ok: false, code: 'locked_tech', reason: `Requires research: ${st.cat.techs.get(bt.unlockTech)?.name ?? bt.unlockTech}.`, city: cityKey, node };
  if (bt.coastalOnly) {
    const okc = cityKey ? state.cities[cityKey].port || st.map.coastal[node] === 1 : st.map.coastal[node] === 1;
    if (!okc) return { ok: false, code: 'not_coastal', reason: `${bt.name} requires a coastal location.`, city: cityKey, node };
  }
  const list = cityKey ? state.cities[cityKey].buildings : p.buildings;
  const cur = list.find((b) => b.type === bt.id)?.level ?? 0;
  const level = cur + 1 + pendingSameTarget + state.countries[c].jobs.filter((j) => j.kind === 'construct' && j.building === bt.id && j.node === node).length;
  if (level > bt.maxLevel) return { ok: false, code: 'max_level', reason: `${bt.name} is already at (or queued to) its maximum level ${bt.maxLevel}.`, city: cityKey, node };
  const ldef = bt.levels.find((l) => l.level === level) ?? bt.levels[bt.levels.length - 1];
  const key = cityKey ? `c:${cityKey}:construct` : `n:${node}:construct`;
  const queued = state.countries[c].jobs.filter((j) => locationKey(j) === key).length + pendingSameTarget;
  if (queued >= CITY_QUEUE_MAX) return { ok: false, code: 'queue_full', reason: `Construction queue is full (${CITY_QUEUE_MAX}).`, city: cityKey, node };
  let warning: string | undefined;
  if (bt.needsDeposit && !st.map.data.nodes[node].deposit) warning = 'This province has no resource deposit: the improvement will produce nothing.';
  return { ok: true, level, cost: vecFromWhole(ldef.cost), durationMin: Math.max(1, Math.round(ldef.buildHours * 60)), warning, city: cityKey, node };
}

export function unitAvailable(state: GameState, c: CountryId, t: UnitType): Verdict {
  const cs = state.countries[c];
  const doc = t.doctrine?.[cs.doctrine];
  if (doc && doc.available === false) return { ok: false, code: 'doctrine', reason: `${t.name} is not available to ${cs.doctrine} doctrine.` };
  if (t.unlockTech && !cs.techs[t.unlockTech]) return { ok: false, code: 'locked_tech', reason: `Requires research: ${S(state).cat.techs.get(t.unlockTech)?.name ?? t.unlockTech}.` };
  return { ok: true };
}

export function unitCost(state: GameState, c: CountryId, t: UnitType): ResM {
  const m = t.doctrine?.[state.countries[c].doctrine]?.costMult ?? 1;
  const v = mul(vecFromWhole(t.cost), m);
  const em = cmod(state, c, 'unit_electronics_cost_mult');
  if (em !== 1) v.electronics = Math.trunc(v.electronics * em);
  return v;
}

export function checkMobilize(state: GameState, c: CountryId, cityKey: CityKey, t: UnitType | undefined, pendingHere = 0): BuildCheck {
  if (!t) return { ok: false, code: 'unknown_unit', reason: 'Unknown unit type.' };
  const city = state.cities[cityKey];
  if (!city) return { ok: false, code: 'unknown_city', reason: 'Unknown city.' };
  const p = state.provinces[city.node];
  if (!p || p.owner !== c) return { ok: false, code: 'not_owner', reason: `You do not control ${city.name}.`, city: cityKey, node: city.node };
  if (p.status === 'occupied') return { ok: false, code: 'city_occupied', reason: `${city.name} is occupied — cannot mobilize. Annex it first.`, city: cityKey, node: city.node };
  if (t.family === 'deployable' && !t.cost) return { ok: false, code: 'not_buildable', reason: 'Not mobilizable.' };
  const av = unitAvailable(state, c, t);
  if (!av.ok) return { ...av, city: cityKey, node: city.node };
  for (const req of t.requires) {
    const lvl = city.buildings.find((b) => b.type === req.building)?.level ?? 0;
    if (lvl < req.level) return { ok: false, code: 'missing_facility', reason: `${city.name} needs ${S(state).cat.buildings.get(req.building)?.name ?? req.building} level ${req.level}.`, city: cityKey, node: city.node };
  }
  if (moveClassOf(t) === 'naval' && !city.port) return { ok: false, code: 'unsuitable_port', reason: `${city.name} has no port for ships.`, city: cityKey, node: city.node };
  const key = `c:${cityKey}:mobilize`;
  const queued = state.countries[c].jobs.filter((j) => locationKey(j) === key).length + pendingHere;
  if (queued >= CITY_QUEUE_MAX) return { ok: false, code: 'queue_full', reason: `Mobilization queue is full (${CITY_QUEUE_MAX}).`, city: cityKey, node: city.node };
  const speed = multEffect(state, city.buildings, 'recruitSpeedMult');
  return { ok: true, cost: unitCost(state, c, t), durationMin: Math.max(1, Math.round((t.buildHours * 60) / speed)), city: cityKey, node: city.node };
}

// ───────────────────────────── completion ─────────────────────────────

export function newUnit(state: GameState, typeId: string, level: number, readiness = 100): Unit {
  const t = S(state).cat.units.get(typeId) as UnitType;
  const st = unitStats(t, level);
  const hp = Math.round(st.hp * 100);
  const u: Unit = { id: nextId(state, 'unit'), type: typeId, level: st.level, hp, maxHp: hp, readiness, kills: 0 };
  if (t.deployable) u.uses = t.deployable.uses;
  return u;
}

export function spawnStack(state: GameState, owner: CountryId, node: NodeId, units: Unit[], name?: string): Stack {
  const t = S(state).cat.units.get(units[0].type) as UnitType;
  const cls = moveClassOf(t);
  const id = nextId(state, 'stack');
  const s: Stack = {
    id,
    owner,
    name: name ?? `${t.name} ${id.slice(1)}`,
    units,
    pos: { kind: 'node', node },
    moveClass: cls,
    mode: cls === 'naval' ? 'naval' : cls === 'air' ? 'air' : S(state).map.isLand[node] ? 'land' : 'embarked',
    order: null,
    firePolicy: 'engage',
    stationarySince: state.clock.tick,
    delayUntil: null,
    air: cls === 'air' ? { home: { node }, state: 'landed', airborneSince: null, refuelUntil: null, patrol: null, dest: null, grounded: false } : null,
    aboard: null,
    refit: false,
    supply: 'supplied',
    engagement: null,
    createdAt: state.clock.tick,
    lastCombatAt: null,
  };
  state.stacks[id] = s;
  return s;
}

export interface ProductionHooks {
  onUnitSpawned: (state: GameState, s: Stack, rally: NodeId | null) => void;
  onMissileReady: (state: GameState, c: CountryId, missile: string) => void;
}

export function completeJob(state: GameState, jobId: string, c: CountryId, hooks: ProductionHooks): void {
  const cs = state.countries[c];
  const idx = cs.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return; // already cancelled/completed — never completes twice
  const j = cs.jobs[idx];
  if (j.endsAt === null || j.endsAt > state.clock.tick) return;
  cs.jobs.splice(idx, 1);
  bumpEconomy(state, j.node);
  const st = S(state);
  let text = '';
  if (j.kind === 'construct') {
    const list = j.city ? state.cities[j.city].buildings : (state.provinces[j.node]?.buildings ?? []);
    const b = list.find((x) => x.type === j.building);
    if (b) { b.level = Math.max(b.level, j.level ?? b.level + 1); b.condition = 100; }
    else list.push({ type: j.building as string, level: j.level ?? 1, condition: 100 });
    text = `${describeJob(state, j)} completed.`;
  } else if (j.kind === 'mobilize') {
    const lvl = cs.unitLevels[j.unit as string] ?? 1;
    const s = spawnStack(state, c, j.node, [newUnit(state, j.unit as string, lvl)]);
    const rally = j.city ? state.cities[j.city]?.rally ?? null : null;
    hooks.onUnitSpawned(state, s, rally);
    text = `${st.cat.units.get(j.unit as string)?.name} mobilized at ${j.city ? state.cities[j.city].name : st.map.data.nodes[j.node].name}.`;
  } else if (j.kind === 'annex') {
    const p = state.provinces[j.node];
    if (p && p.owner === c && p.status === 'occupied') {
      p.status = 'annexed';
      text = `${j.city ? state.cities[j.city].name : 'Province'} annexed — mobilization enabled, output 50 %.`;
    } else text = 'Annexation lapsed (location no longer occupied by you).';
  } else if (j.kind === 'missile') {
    const inv = cs.missiles[j.missile as string];
    const mt = st.cat.missiles.get(j.missile as string);
    if (inv && mt) {
      const add = Math.min(j.batch ?? mt.batchSize, Math.max(0, mt.inventoryCeiling - inv.ready));
      inv.ready += add;
      inv.produced += add;
      const stillProducing = cs.jobs.some((x) => x.kind === 'missile' && x.missile === j.missile && x.startedAt !== null);
      inv.maturity = inv.ready > 0 ? 'ready' : stillProducing ? 'in_production' : 'qualified';
      hooks.onMissileReady(state, c, j.missile as string);
      text = `${mt.name}: production batch complete (+${add}, ready ${inv.ready}).`;
    }
  }
  const ev = emit(state, { kind: 'job_completed', category: 'economy', node: j.node, routine: true, private: toAll([c], text, { job: j.id, kind: j.kind }) });
  awardXp(state, c, ev.id, 'jobCompleted');
  startJobs(state, c);
}

export function totalCost(list: ResM[]): ResM {
  const o = zero();
  for (const v of list) addInto(o, v);
  return o;
}
export { shortfall, buildingLevelDef, DEFAULT_ENDURANCE_MIN };
