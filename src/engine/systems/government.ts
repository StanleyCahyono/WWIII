/**
 * Capture, territory status, morale, population, revolts, elimination.
 *
 * CAPTURE: a province/city changes hands when a surviving capture-capable land unit of country X
 * stands at the control node, X is at war with the owner (or the node is rebel-held), and no
 * stack hostile to X remains at the node. Status becomes `homeland` if X is the original owner
 * (liberation) else `occupied`. Annexation is lost on any subsequent capture.
 * JOB RULE ON CAPTURE: every job of the former owner at that city/province is cancelled and
 * refunded to the former owner with the standard cancellation rule (queued 100 %, active by
 * remaining fraction × ACTIVE_JOB_REFUND_FACTOR). Rally points are cleared.
 * LOOT: the capturer receives 2 % × tier of the former owner's spendable money (ledger 'loot').
 */
import { invalidateDerived } from '../derived';
import type { CountryId, NodeId } from '../data-types';
import type { CityState, GameState, MoraleFactor, ProvinceState, Stack } from '../state';
import {
  CAPTURE_CONDITION_LOSS,
  MORALE,
  POP_DECLINE_PER_DAY,
  POP_GROWTH_PER_DAY,
  REBEL_STRENGTH_PER_TIER,
  REVOLT_BANDS,
} from '../rules';
import { S } from '../scenario/registry';
import { streamRng } from '../rng';
import { atWar, cmpId, enemyMap, hostileStacks, recordOwnerChange, stacksReadonly, ustats, utype } from './world';
import { awardXp, emit, toAll } from './events';
import { nodeDist, other } from './mapindex';
import { sumEffect, bumpEconomy } from './economy';
import { allocateDamage, combatUnits } from './combat';
import { credit, charge } from './ledger';
import { zero } from '../fixed';
import { cancelJobInternal } from './production';
import { dayOf } from '../time';

export function canCapture(state: GameState, s: Stack): boolean {
  if (s.moveClass !== 'ground' || s.pos.kind !== 'node' || s.aboard) return false;
  return s.units.some((u) => u.hp > 0 && utype(state, u.type).capture);
}

export interface GovHooks {
  onOwnerChanged: (state: GameState, node: NodeId, from: CountryId | null, to: CountryId | null) => void;
}

/** Capture pass (every step after movement and combat). */
export function captureStep(state: GameState, hooks: GovHooks): void {
  const m = S(state).map;
  // candidate nodes: a ground stack stands on a land node it does not own
  const cand = new Set<NodeId>();
  const all = stacksReadonly(state);
  for (const s of all) {
    if (s.pos.kind !== 'node' || s.aboard || s.moveClass !== 'ground') continue;
    const n = s.pos.node;
    if (!m.isLand[n]) continue;
    const p = state.provinces[n];
    // only nodes where this stack could be eligible to capture (rebel node, or owner at war)
    if (p && p.owner !== s.owner && p.control !== 'outside' && (p.control === 'rebel' || (p.owner !== null && atWar(state, s.owner, p.owner)))) cand.add(n);
  }
  if (!cand.size) return;
  const byNode = new Map<NodeId, Stack[]>();
  for (const s of all) {
    if (s.pos.kind !== 'node' || s.aboard || s.moveClass === 'air' || !cand.has(s.pos.node)) continue;
    const l = byNode.get(s.pos.node) ?? [];
    l.push(s);
    byNode.set(s.pos.node, l);
  }
  for (const node of [...byNode.keys()].sort((a, b) => a - b)) {
    const here = (byNode.get(node) as Stack[]).sort(cmpId);
    const p = state.provinces[node];
    if (!p || p.control === 'outside') continue;
    for (const s of here) {
      if (!canCapture(state, s)) continue;
      const X = s.owner;
      if (p.owner === X) break;
      const eligible = p.control === 'rebel' || (p.owner !== null && atWar(state, X, p.owner));
      if (!eligible) continue;
      if (here.some((o) => o.owner !== X && hostileStacks(state, s, o) && combatUnits(o).length > 0)) continue;
      transferNode(state, node, X, 'capture', hooks);
      break;
    }
  }
}

export function transferNode(state: GameState, node: NodeId, to: CountryId | null, cause: 'capture' | 'rebellion' | 'treaty', hooks: GovHooks): void {
  const p = state.provinces[node] as ProvinceState;
  const from = p.owner;
  const m = S(state).map;
  const nodeName = m.data.nodes[node].name;
  p.owner = to;
  p.control = to ? 'country' : 'rebel';
  p.status = to && p.homeland === to ? 'homeland' : 'occupied';
  p.changedAt = state.clock.tick;
  bumpEconomy(state, node);
  recordOwnerChange(state, node, from, to);
  state.ids.ownv = (state.ids.ownv ?? 0) + 1;
  invalidateDerived(state);
  for (const b of p.buildings) b.condition = Math.max(0, b.condition - CAPTURE_CONDITION_LOSS);
  const ck = m.cityByNode.get(node);
  const city = ck ? state.cities[ck] : undefined;
  // cancel jobs of the former owner at this location (documented refund rule)
  if (from) {
    const fc = state.countries[from];
    for (const j of [...fc.jobs]) if (j.node === node || (ck && j.city === ck)) cancelJobInternal(state, from, j.id, 'location lost');
  }
  let lootText = '';
  if (city) {
    city.rally = null;
    city.morale = Math.min(city.morale, to && p.homeland === to ? 60 : 35);
    for (const b of city.buildings) b.condition = Math.max(0, b.condition - CAPTURE_CONDITION_LOSS);
    if (from && to && cause === 'capture') {
      const loot = zero();
      loot.money = Math.trunc((state.countries[from].stock.money * 0.02 * city.tier));
      if (loot.money > 0 && charge(state, from, 'loot', loot)) {
        credit(state, to, 'loot', loot);
        lootText = ` Loot transferred: ${(loot.money / 1000).toFixed(0)} money.`;
      }
    }
  }
  const what = city ? `${city.name}${city.capital ? ' (capital)' : ''}` : nodeName;
  const interrupt: CountryId[] = [];
  if (city?.capital) for (const c of [from, to, p.homeland]) if (c && c === state.meta.humanCountry) interrupt.push(c);
  const textFrom = cause === 'rebellion' ? `${what} fell to rebels.` : `${what} was captured by ${to}.`;
  const textTo = p.status === 'homeland' ? `${what} liberated.${lootText}` : `${what} occupied.${lootText}`;
  const ev = emit(state, {
    kind: cause === 'rebellion' ? 'uprising_success' : city ? 'city_captured' : 'province_captured',
    category: 'government',
    node,
    public: city || cause === 'rebellion' ? { headline: cause === 'rebellion' ? `Uprising: rebels seize ${what}` : `${to} takes ${what} from ${from ?? 'rebels'}`, countries: [from, to].filter((x): x is string => !!x) } : null,
    private: { ...toAll([from], textFrom, { node, city: ck ?? null, from, to, cause }), ...toAll([to], textTo, { node, city: ck ?? null, from, to, cause }) },
    interrupt,
  });
  if (to && cause === 'capture') awardXp(state, to, ev.id, 'capture');
  hooks.onOwnerChanged(state, node, from, to);
}

// ───────────────────────────── morale / population ─────────────────────────────

function capitalNodeOf(state: GameState, c: CountryId): NodeId | null {
  const cs = state.countries[c];
  if (cs?.capitalCity) {
    const city = state.cities[cs.capitalCity];
    if (city && state.provinces[city.node]?.owner === c) return city.node;
  }
  return null;
}

export function moraleTarget(state: GameState, p: ProvinceState, city: CityState | null): { target: number; factors: MoraleFactor[] } {
  const owner = p.owner;
  const f: MoraleFactor[] = [];
  if (!owner) return { target: 20, factors: [{ key: 'rebel', label: 'Rebel control', value: -55 }] };
  f.push({ key: 'base', label: 'Base morale', value: MORALE.baseHomeland });
  if (p.status === 'occupied') f.push({ key: 'occupied', label: 'Under occupation', value: MORALE.occupiedPenalty });
  if (p.status === 'annexed') f.push({ key: 'annexed', label: 'Recently annexed', value: MORALE.annexedPenalty });
  const enemies = enemyMap(state).get(owner)?.size ?? 0;
  if (enemies) f.push({ key: 'war', label: `At war with ${enemies} countr${enemies === 1 ? 'y' : 'ies'}`, value: Math.max(MORALE.warPenaltyCap, enemies * MORALE.warPenaltyPerEnemy) });
  if (city?.shortage) f.push({ key: 'shortage', label: 'Supply shortages', value: MORALE.shortagePenalty });
  const m = S(state).map;
  const cap = capitalNodeOf(state, owner);
  if (cap === null) f.push({ key: 'distance', label: 'No capital held', value: MORALE.distanceCap });
  else if (cap !== p.node) {
    const d = nodeDist(m, cap, p.node);
    const v = Math.max(MORALE.distanceCap, Math.round((d / 1000) * MORALE.distancePer1000Km));
    if (v) f.push({ key: 'distance', label: `Distance to capital (${Math.round(d)} km)`, value: v });
  } else f.push({ key: 'capital', label: 'Seat of government', value: MORALE.capitalBonus });
  let hostileN = 0;
  for (const ei of m.adj[p.node]) {
    const nb = other(m.edges[ei], p.node);
    const o = state.provinces[nb]?.owner;
    if (o && atWar(state, owner, o)) hostileN++;
  }
  if (hostileN) f.push({ key: 'neighbors', label: 'Hostile neighbouring territory', value: Math.max(MORALE.hostileNeighborCap, hostileN * MORALE.hostileNeighborEach) });
  if (city && city.recentLosses > 0 && city.population > 0) {
    const pct = (city.recentLosses / (city.population + city.recentLosses)) * 100;
    const v = Math.max(MORALE.populationLossCap, Math.round(pct * MORALE.populationLossPer1Pct));
    if (v) f.push({ key: 'losses', label: 'Recent population losses', value: v });
  }
  const b = sumEffect(state, city ? [...city.buildings, ...p.buildings] : p.buildings, 'moraleDelta');
  if (b) f.push({ key: 'buildings', label: 'Facilities (hospital etc.)', value: Math.round(b) });
  const target = Math.max(0, Math.min(100, f.reduce((a, x) => a + x.value, 0)));
  return { target, factors: f };
}

function approach(cur: number, target: number, step: number): number {
  if (cur < target) return Math.min(target, cur + step);
  if (cur > target) return Math.max(target, cur - step);
  return cur;
}

/** Day-change government update: morale, population, revolts. */
export function governmentDay(state: GameState, hooks: GovHooks): void {
  const m = S(state).map;
  for (const p of state.provinces) {
    if (!p || p.control === 'outside') continue;
    const ck = m.cityByNode.get(p.node);
    const city = ck ? state.cities[ck] : null;
    const { target, factors } = moraleTarget(state, p, city);
    // announce only locations whose output inputs (morale, population) actually change
    const pm0 = p.morale, cm0 = city ? city.morale : 0, cp0 = city ? city.population : 0;
    if (city) {
      city.targetMorale = target;
      city.moraleFactors = factors;
      city.morale = approach(city.morale, target, MORALE.dailyStep);
      p.morale = city.morale;
      if (city.morale >= 50) city.population = round3(city.population * (1 + POP_GROWTH_PER_DAY));
      else if (city.morale < 25) city.population = round3(city.population * (1 - POP_DECLINE_PER_DAY));
      city.recentLosses = round3(city.recentLosses * 0.5);
      city.shortage = false;
    } else {
      p.morale = approach(p.morale, target, MORALE.dailyStep);
    }
    if (p.morale !== pm0 || (city && (city.morale !== cm0 || city.population !== cp0))) bumpEconomy(state, p.node);
  }
  revoltChecks(state, hooks);
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function revoltProbability(morale: number): number {
  for (const b of REVOLT_BANDS) if (morale < b.below) return b.p;
  return 0;
}

export function revoltChecks(state: GameState, hooks: GovHooks): void {
  const day = dayOf(state.clock.tick);
  for (const k of Object.keys(state.cities).sort()) {
    const city = state.cities[k];
    const p = state.provinces[city.node];
    if (!p || !p.owner || p.control !== 'country') continue;
    const prob = revoltProbability(city.morale);
    if (prob <= 0) continue;
    const r = streamRng(state.seed, 'revolt', `${k}:${day}`);
    if (!r.chance(prob)) continue;
    resolveUprising(state, k, hooks);
  }
}

/** Resolve an uprising exactly once: undefended → rebel control; garrisoned → fight. */
export function resolveUprising(state: GameState, cityKey: string, hooks: GovHooks): 'rebels_took_control' | 'suppressed' | 'garrison_defeated' {
  const city = state.cities[cityKey];
  const p = state.provinces[city.node] as ProvinceState;
  const owner = p.owner as CountryId;
  const garrison = Object.values(state.stacks)
    .filter((s) => s.owner === owner && s.pos.kind === 'node' && s.pos.node === city.node && s.moveClass === 'ground' && !s.aboard && combatUnits(s).length > 0)
    .sort(cmpId);
  if (!garrison.length) {
    transferNode(state, city.node, null, 'rebellion', hooks);
    return 'rebels_took_control';
  }
  const r = streamRng(state.seed, 'uprising', `${cityKey}:${state.clock.tick}`);
  const rebel = REBEL_STRENGTH_PER_TIER * city.tier * (1 + Math.max(0, 33 - city.morale) / 33) * (0.8 + 0.4 * r.next());
  let defense = 0;
  for (const s of garrison) for (const u of combatUnits(s)) defense += (ustats(state, u).defense.unarmored ?? 0) * (u.hp / u.maxHp);
  // garrison takes rebel damage on its front units; rebels are suppressed if garrison survives
  for (const s of garrison) {
    allocateDamage(state, s.units, { unarmored: Math.round((rebel * 100) / garrison.length), armored: Math.round((rebel * 50) / garrison.length) });
    s.units = s.units.filter((u) => u.hp > 0);
    if (!s.units.length) delete state.stacks[s.id];
  }
  const survived = garrison.some((s) => state.stacks[s.id]);
  if (!survived || defense < rebel * 0.25) {
    for (const s of garrison) if (state.stacks[s.id]) delete state.stacks[s.id];
    transferNode(state, city.node, null, 'rebellion', hooks);
    return 'garrison_defeated';
  }
  city.morale = Math.min(100, city.morale + 5);
  bumpEconomy(state, city.node);
  emit(state, { kind: 'uprising_suppressed', category: 'government', node: city.node, private: toAll([owner], `Uprising in ${city.name} suppressed by the garrison.`, { city: cityKey }), public: { headline: `Unrest in ${city.name} put down`, countries: [owner] } });
  return 'suppressed';
}
