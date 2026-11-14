/**
 * Missile programs, production inventory and launch resolution.
 *
 * Maturity sequence: prototype (blueprint researched) → qualified (qualification researched) →
 * in_production (a batch job is running) → ready (inventory > 0) → expended (all produced items
 * used, nothing in production). Research NEVER creates inventory; only completed production jobs.
 *
 * Launch: a uniquely identified sim event. On commit: validate inventory, launch facility/unit,
 * range and target sector; debit exactly one ready item; schedule arrival at
 * launchedAt + round(baseMin + km / kmPerMin). On arrival it resolves exactly once:
 *   draw #1 (stream "missile:<launchId>") picks the exclusive pre-defence outcome
 *   (arrived_effect | arrived_limited | intercepted | failed) from the catalog probabilities;
 *   if arrived_*, draw #2 converts it to `intercepted` with p = min(cap, interceptBase × rating),
 *   rating = target air/missile-defence rating in [0,1]. Speed class confers no bonus.
 * Knowledge is separate from the outcome: the attacker learns the outcome only if it observes the
 * target sector, otherwise "effect_unconfirmed"; the target learns arrivals/interceptions but not
 * a failure that never reached it.
 */
import type { CountryId, MissileOutcome, MissileType, NodeId } from '../data-types';
import type { GameState, MissileLaunch } from '../state';
import { AD_BUILDING_RATING, AD_COVER_KM, AD_RATING_PER_UNIT_LEVEL, MISSILE_INTERCEPT_CAP } from '../rules';
import { S } from '../scenario/registry';
import { streamRng } from '../rng';
import { nextId } from '../ids';
import { schedule } from './queue';
import { distKm } from './mapindex';
import { atWar, cmpId, sameCoalition, stackLL, utype } from './world';
import { emit, toAll } from './events';
import { sumEffect } from './economy';
import { allocateDamage } from './combat';
import { observesNode } from './visibility';
import type { Verdict } from './production';

export const OUTCOME_ORDER: MissileOutcome[] = ['arrived_effect', 'arrived_limited', 'intercepted', 'failed'];

export function flightMinutes(mt: MissileType, km: number): number {
  return Math.max(1, Math.round(mt.flight.baseMin + km / mt.flight.kmPerMin));
}

/** Pure resolver (used by the sim and the statistical test). */
export function resolveMissileOutcome(seed: number, launchId: string, mt: Pick<MissileType, 'outcomes' | 'interceptBase'>, defenseRating: number): { outcome: MissileOutcome; draws: { outcome: number; defense: number | null } } {
  const r = streamRng(seed, 'missile', launchId);
  const d1 = r.next();
  let acc = 0;
  let pre: MissileOutcome = 'failed';
  for (const o of OUTCOME_ORDER) {
    acc += mt.outcomes[o] ?? 0;
    if (d1 < acc) { pre = o; break; }
  }
  if (pre === 'arrived_effect' || pre === 'arrived_limited') {
    const d2 = r.next();
    const p = Math.min(MISSILE_INTERCEPT_CAP, Math.max(0, mt.interceptBase * defenseRating));
    if (d2 < p) return { outcome: 'intercepted', draws: { outcome: d1, defense: d2 } };
    return { outcome: pre, draws: { outcome: d1, defense: d2 } };
  }
  return { outcome: pre, draws: { outcome: d1, defense: null } };
}

export function defenseRating(state: GameState, attacker: CountryId, target: NodeId): number {
  const m = S(state).map;
  const owner = state.provinces[target]?.owner ?? null;
  let r = 0;
  for (const s of Object.values(state.stacks).sort(cmpId)) {
    if (s.owner === attacker || s.aboard) continue;
    if (!(s.owner === owner || atWar(state, s.owner, attacker) || (owner && sameCoalition(state, s.owner, owner)))) continue;
    const ll = stackLL(state, s);
    if (distKm(ll[0], ll[1], m.lon[target], m.lat[target]) > AD_COVER_KM) continue;
    for (const u of s.units) if (utype(state, u.type).family === 'air_defense') r += u.level * AD_RATING_PER_UNIT_LEVEL * (u.hp / u.maxHp);
  }
  const ck = m.cityByNode.get(target);
  const blds = [...(state.provinces[target]?.buildings ?? []), ...(ck ? state.cities[ck]?.buildings ?? [] : [])];
  for (const b of blds) {
    const t = S(state).cat.buildings.get(b.type);
    if (t?.levels.some((l) => (l.effects.radarKm ?? 0) > 0)) r += AD_BUILDING_RATING * b.level * (b.condition / 100);
  }
  return Math.max(0, Math.min(1, Math.round(r * 1000) / 1000));
}

export interface LaunchCheck extends Verdict {
  fromNode?: NodeId;
  km?: number;
  arriveAt?: number;
  targetOwner?: CountryId | null;
  actOfWar?: CountryId | null;
  possibleOutcomes?: MissileOutcome[];
  headlineChance?: number;
}

export function checkLaunch(state: GameState, c: CountryId, missile: string, from: { node: NodeId } | { stack: string }, target: NodeId, confirm: boolean | CountryId[] | undefined): LaunchCheck {
  const st = S(state);
  const mt = st.cat.missiles.get(missile);
  if (!mt) return { ok: false, code: 'unknown_missile', reason: 'Unknown missile type.' };
  const inv = state.countries[c].missiles[missile];
  if (!inv || inv.ready < 1) return { ok: false, code: 'insufficient_stock', reason: `No ready ${mt.name} in inventory (ready: ${inv?.ready ?? 0}; maturity: ${inv?.maturity ?? 'not researched'}).` };
  let fromNode: NodeId;
  let fromLL: [number, number];
  if ('node' in from) {
    const p = state.provinces[from.node];
    if (!p || p.owner !== c) return { ok: false, code: 'not_owner', reason: 'You do not control that launch site.' };
    const ck = st.map.cityByNode.get(from.node);
    const slots = sumEffect(state, [...p.buildings, ...(ck ? state.cities[ck]?.buildings ?? [] : [])], 'missileSlots', false);
    if (!mt.launchFrom.includes('missile_complex') || slots <= 0) return { ok: false, code: 'missing_facility', reason: 'No missile launch complex at that site for this missile.' };
    fromNode = from.node;
    fromLL = [st.map.lon[fromNode], st.map.lat[fromNode]];
  } else {
    const s = state.stacks[from.stack];
    if (!s || s.owner !== c) return { ok: false, code: 'not_owner', reason: 'Not your formation.' };
    const okFam = s.units.some((u) => (mt.launchFrom as string[]).includes(utype(state, u.type).family));
    if (!okFam) return { ok: false, code: 'invalid_platform', reason: `${s.name} has no platform able to launch ${mt.name}.` };
    if (s.pos.kind === 'air' && !(mt.launchFrom as string[]).includes('heavy')) return { ok: false, code: 'invalid_platform', reason: 'Platform is airborne.' };
    fromNode = s.pos.kind === 'node' ? s.pos.node : s.pos.kind === 'edge' ? s.pos.from : 0;
    fromLL = stackLL(state, s);
  }
  if (target < 0 || target >= st.map.n) return { ok: false, code: 'invalid_target', reason: 'Unknown target sector.' };
  if (st.map.isLand[target] && st.map.outside[target]) return { ok: false, code: 'invalid_target', reason: 'Target is outside the campaign.' };
  const km = distKm(fromLL[0], fromLL[1], st.map.lon[target], st.map.lat[target]);
  if (km > mt.rangeKm) return { ok: false, code: 'insufficient_range', reason: `Target is ${Math.round(km)} km away; ${mt.name} range is ${mt.rangeKm} km.` };
  const owner = state.provinces[target]?.owner ?? null;
  if (owner === c) return { ok: false, code: 'invalid_target', reason: 'Cannot target your own territory.' };
  if (owner && sameCoalition(state, c, owner)) return { ok: false, code: 'invalid_target', reason: 'Cannot target a coalition member.' };
  let actOfWar: CountryId | null = null;
  if (owner && !atWar(state, c, owner)) {
    const confirmed = confirm === true || (Array.isArray(confirm) && confirm.includes(owner));
    if (!confirmed) return { ok: false, code: 'act_of_war', reason: `Striking ${owner} territory is an act of war — confirm to declare war.`, targetOwner: owner, actOfWar: owner };
    actOfWar = owner;
  }
  const headline = mt.outcomes.arrived_effect + mt.outcomes.arrived_limited;
  return { ok: true, fromNode, km, arriveAt: state.clock.tick + flightMinutes(mt, km), targetOwner: owner, actOfWar, possibleOutcomes: [...OUTCOME_ORDER], headlineChance: headline };
}

export function launchInternal(state: GameState, c: CountryId, missile: string, chk: LaunchCheck, fromStack: string | null, target: NodeId): MissileLaunch {
  const inv = state.countries[c].missiles[missile];
  inv.ready -= 1;
  inv.launched += 1;
  if (inv.ready === 0) {
    const producing = state.countries[c].jobs.some((j) => j.kind === 'missile' && j.missile === missile);
    inv.maturity = producing ? 'in_production' : 'expended';
  }
  const l: MissileLaunch = {
    id: nextId(state, 'launch'),
    country: c,
    missile,
    fromNode: chk.fromNode as NodeId,
    fromStack,
    target,
    targetOwner: chk.targetOwner ?? null,
    launchedAt: state.clock.tick,
    arriveAt: chk.arriveAt as number,
    resolved: false,
    outcome: null,
    draws: null,
    defenseRating: null,
    knowledge: { [c]: 'in_flight' },
  };
  state.launches[l.id] = l;
  schedule(state, l.arriveAt, 'missile_arrive', l.id, c);
  const mt = S(state).cat.missiles.get(missile) as MissileType;
  emit(state, { kind: 'missile_launched', category: 'combat', node: target, private: toAll([c], `${mt.name} launched (${l.id}) at ${S(state).map.data.nodes[target].name}; arrival at tick ${l.arriveAt}. Ready remaining: ${inv.ready}.`, { launch: l.id }) });
  return l;
}

export function resolveLaunch(state: GameState, id: string): void {
  const l = state.launches[id];
  if (!l || l.resolved) return; // exactly once
  const st = S(state);
  const mt = st.cat.missiles.get(l.missile) as MissileType;
  const rating = defenseRating(state, l.country, l.target);
  const { outcome, draws } = resolveMissileOutcome(state.seed, l.id, mt, rating);
  l.resolved = true;
  l.outcome = outcome;
  l.draws = draws;
  l.defenseRating = rating;
  const inv = state.countries[l.country].missiles[l.missile];
  if (inv) inv.expended += 1;
  const where = st.map.data.nodes[l.target].name;
  const ck = st.map.cityByNode.get(l.target);
  const city = ck ? state.cities[ck] : null;
  if (outcome === 'arrived_effect' || outcome === 'arrived_limited') {
    const f = outcome === 'arrived_effect' ? 1 : 0.5;
    if (city) {
      city.condition = Math.max(0, Math.round(city.condition - mt.effect.conditionDelta * f));
      for (const b of city.buildings) b.condition = Math.max(0, Math.round(b.condition - mt.effect.buildingDamage * f));
      city.morale = Math.max(0, Math.min(100, Math.round(city.morale + mt.effect.moraleDelta * f)));
      const loss = Math.round(city.population * 0.002 * f * 1000) / 1000;
      city.population = Math.max(0, Math.round((city.population - loss) * 1000) / 1000);
      city.recentLosses = Math.round((city.recentLosses + loss) * 1000) / 1000;
    }
    const p = state.provinces[l.target];
    if (p) for (const b of p.buildings) b.condition = Math.max(0, Math.round(b.condition - mt.effect.buildingDamage * f));
    for (const s of Object.values(state.stacks).sort(cmpId)) {
      if (s.pos.kind !== 'node' || s.pos.node !== l.target || s.owner === l.country || s.aboard) continue;
      const dmg = Math.round(mt.effect.unitDamage * f * 100);
      allocateDamage(state, s.units, { unarmored: dmg, armored: dmg, ship: dmg, building: dmg, airplane: dmg, helicopter: dmg });
      s.units = s.units.filter((u) => u.hp > 0);
      if (!s.units.length) delete state.stacks[s.id];
    }
  }
  const sees = observesNode(state, l.country, l.target);
  l.knowledge[l.country] = sees ? outcome : 'effect_unconfirmed';
  if (l.targetOwner && outcome !== 'failed') l.knowledge[l.targetOwner] = outcome;
  const label: Record<MissileOutcome, string> = { arrived_effect: 'arrived with effect', arrived_limited: 'arrived with limited effect', intercepted: 'was intercepted', failed: 'failed' };
  const priv: Record<string, { text: string; data?: Record<string, string | number | boolean | null> }> = {};
  priv[l.country] = sees ? { text: `${mt.name} ${l.id} ${label[outcome]} at ${where}.`, data: { launch: l.id, outcome } } : { text: `${mt.name} ${l.id} at ${where}: effect unconfirmed (no observation of the target sector).`, data: { launch: l.id, outcome: 'effect_unconfirmed' } };
  if (l.targetOwner && outcome !== 'failed') priv[l.targetOwner] = { text: `Incoming ${mt.family} strike at ${where} ${label[outcome]}.`, data: { outcome } };
  emit(state, { kind: 'missile_resolved', category: 'combat', node: l.target, private: priv, public: outcome !== 'failed' && l.targetOwner ? { headline: outcome === 'intercepted' ? `Missile intercepted over ${where}` : `Missile strike reported at ${where}`, countries: [l.targetOwner] } : null });
}

