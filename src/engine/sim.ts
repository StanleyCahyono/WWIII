/**
 * Simulation loop. Fixed step STEP_MIN; results are identical however time is chunked:
 * `advance(state, m)` runs every step boundary in (tick, tick+m] and then sets tick = tick+m.
 *
 * STEP ORDER at boundary T (documented, deterministic):
 *  1. scheduled events with at ≤ T, ordered (at, priority class, seq); the clock reads `at`
 *     while each runs (exact minute timestamps)
 *  2. air operations (launch/arrival/endurance/diversion)
 *  3. ground & naval movement (route re-validation, acts of war on entry)
 *  4. on whole hours: attack-order refresh, combat round (node → ranged → air)
 *  5. capture
 *  6. on whole hours: economy accrual (production, upkeep, occupation)
 *  7. visibility
 *  8. at day change (00:00): government (morale/pop/revolts), readiness, trust decay,
 *     score settlement (victory), daily digest, pruning
 *  9. eliminations
 * 10. AI scheduler (controllers submit commands through submitCommand)
 */
import type { GameState } from './state';
import { STEP_MIN, VISIBILITY_INTERVAL_MIN } from './rules';
import { isDayChange, isHour, nextStepTick, dayOf } from './time';
import { popDue } from './systems/queue';
import { completeResearch } from './systems/research';
import { completeJob } from './systems/production';
import { resolveLaunch } from './systems/missiles';
import { applyOfferEffect, expireOffer, trustDecayDay } from './systems/diplomacy';
import { completeDeparture } from './systems/coalitions';
import { agentAct } from './systems/intel';
import { airStep } from './systems/air';
import { moveStep, planRoute, orderFromPlan } from './systems/movement';
import { combatRound } from './systems/combat';
import { captureStep, governmentDay } from './systems/government';
import { economyHour } from './systems/economy';
import { updateVisibility, canSee } from './systems/visibility';
import { readinessDay } from './systems/readiness';
import { settle } from './systems/score';
import { pruneMarket } from './systems/market';
import { combatHooks, destroyStack, diploHooks, govHooks, moveHooks, productionHooks, checkEliminations } from './systems/hooks';
import { collectWakes, getDefaultHost, runAi } from './ai-host/scheduler';
import type { SimHost } from './ai-host/types';
import { emit } from './systems/events';
import { cmpId, sortedStacks, stacksReadonly } from './systems/world';
import { invalidateViewCache } from './view/country-view';

function processScheduled(state: GameState, T: number): void {
  for (;;) {
    const ev = popDue(state, T);
    if (!ev) break;
    state.clock.tick = Math.max(ev.at, state.clock.lastStep);
    switch (ev.kind) {
      case 'research_done':
        if (ev.country) completeResearch(state, ev.country, ev.ref);
        break;
      case 'job_done':
        if (ev.country) completeJob(state, ev.ref, ev.country, productionHooks);
        break;
      case 'missile_arrive':
        resolveLaunch(state, ev.ref);
        break;
      case 'offer_expire':
        expireOffer(state, ev.ref);
        break;
      case 'offer_effect':
        applyOfferEffect(state, ev.ref, diploHooks);
        break;
      case 'coalition_depart':
        completeDeparture(state, ev.ref);
        break;
      case 'agent_report':
        agentAct(state, ev.ref);
        break;
      case 'report_expire':
        break;
    }
  }
  state.clock.tick = T;
}

/** Attack orders chase observed targets: replan hourly; drop when the target is lost. */
function refreshAttackOrders(state: GameState): void {
  for (const s of sortedStacks(state)) {
    const o = s.order;
    if (!o) continue;
    const targetId = o.kind === 'attack' ? o.targetStack : o.attack?.targetStack;
    if (!targetId) continue;
    const t = state.stacks[targetId];
    if (!t || !canSee(state, s.owner, targetId)) {
      if (o.kind === 'attack') s.order = null;
      else o.attack = undefined;
      emit(state, { kind: 'target_lost', category: 'combat', private: { [s.owner]: { text: `${s.name}: attack target lost from observation; order ended.` } } });
      continue;
    }
    if (o.kind === 'move' && s.pos.kind === 'node') {
      const tn = t.pos.kind === 'node' ? t.pos.node : t.pos.kind === 'edge' ? t.pos.to : null;
      if (tn !== null && tn !== o.dest) {
        const plan = planRoute(state, s, tn, [], { allowActOfWar: o.warConfirmed });
        if (plan.ok) {
          const no = orderFromPlan(state, s, plan, tn, [], o.warConfirmed);
          no.attack = o.attack;
          s.order = no;
        }
      }
    }
  }
}

function dailyDigest(state: GameState): void {
  const day = dayOf(state.clock.tick) - 1;
  const from = state.events.length - 1;
  const counts = new Map<string, Map<string, number>>();
  for (let i = from; i >= 0; i--) {
    const e = state.events[i];
    if (dayOf(e.at) < day) break;
    if (dayOf(e.at) !== day || !e.routine) continue;
    for (const c of Object.keys(e.private)) {
      const m = counts.get(c) ?? new Map<string, number>();
      m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
      counts.set(c, m);
    }
  }
  const priv: Record<string, { text: string; data?: Record<string, number> }> = {};
  for (const c of [...counts.keys()].sort()) {
    if (state.countries[c]?.controller !== 'human') continue;
    const m = counts.get(c)!;
    priv[c] = { text: `Daily digest for day ${day}: ${[...m.entries()].sort().map(([k, v]) => `${v}× ${k.replace(/_/g, ' ')}`).join(', ')}.`, data: Object.fromEntries(m) };
  }
  if (Object.keys(priv).length) emit(state, { kind: 'daily_digest', category: 'system', private: priv });
}

function prune(state: GameState): void {
  pruneMarket(state, 3 * 1440);
  // keep the event log bounded (oldest routine events first)
  const MAX = 60000;
  if (state.events.length > MAX) {
    const drop = state.events.length - MAX;
    state.events.splice(0, drop);
  }
  for (const id of Object.keys(state.offers)) {
    const o = state.offers[id];
    if (o.status !== 'pending' && o.resolvedAt !== null && state.clock.tick - o.resolvedAt > 7 * 1440 && (o.status !== 'accepted' || o.applied)) delete state.offers[id];
  }
  for (const id of Object.keys(state.launches)) {
    const l = state.launches[id];
    if (l.resolved && state.clock.tick - l.arriveAt > 30 * 1440) delete state.launches[id];
  }
}

/** Run exactly one simulation step at the next boundary. */
export function stepOnce(state: GameState, host?: SimHost): GameState {
  if (state.score.result) return state; // review mode — frozen
  const T = nextStepTick(state.clock.tick);
  runStep(state, T, host ?? getDefaultHost());
  return state;
}

export function runStep(state: GameState, T: number, host: SimHost): void {
  invalidateViewCache(state);
  processScheduled(state, T);
  state.clock.tick = T;
  invalidateViewCache(state);
  airStep(state, (st, s) => destroyStack(st, s, null));
  moveStep(state, stacksReadonly(state), moveHooks);
  if (isHour(T)) {
    refreshAttackOrders(state);
    combatRound(state, combatHooks);
  }
  captureStep(state, govHooks);
  invalidateViewCache(state);
  if (isHour(T)) economyHour(state);
  if (T % VISIBILITY_INTERVAL_MIN === 0) updateVisibility(state);
  if (isDayChange(T)) {
    governmentDay(state, govHooks);
    readinessDay(state);
    trustDecayDay(state);
    dailyDigest(state);
    settle(state);
    prune(state);
  }
  checkEliminations(state);
  state.clock.lastStep = T;
  invalidateViewCache(state);
  if (!state.score.result) {
    collectWakes(state);
    runAi(state, host);
  }
  invalidateViewCache(state);
}

/** Advance the clock by `minutes` (any chunking yields identical state). */
export function advance(state: GameState, minutes: number, host?: SimHost): GameState {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error('advance: minutes must be a non-negative integer');
  const h = host ?? getDefaultHost();
  const target = state.clock.tick + minutes;
  while (!state.score.result) {
    const T = nextStepTick(state.clock.tick);
    if (T > target) break;
    runStep(state, T, h);
  }
  if (!state.score.result) state.clock.tick = target;
  return state;
}

/** Advance until the next significant event for `country` (interrupt/private non-routine) or `maxMinutes`. */
export function advanceToNextEvent(state: GameState, country: string, maxMinutes = 1440, host?: SimHost): GameState {
  const start = state.events.length;
  const end = state.clock.tick + maxMinutes;
  while (state.clock.tick < end && !state.score.result) {
    const T = Math.min(end, nextStepTick(state.clock.tick));
    advance(state, T - state.clock.tick, host);
    for (let i = start; i < state.events.length; i++) {
      const e = state.events[i];
      if (e.private[country] && !e.routine) return state;
    }
  }
  return state;
}

export function isReviewMode(state: GameState): boolean {
  return !!state.score.result;
}
export { cmpId, STEP_MIN };
