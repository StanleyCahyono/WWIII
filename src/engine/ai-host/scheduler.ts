/**
 * AI scheduler: staggered strategic / economic / diplomatic / operational reviews per country,
 * a global per-step invocation budget (AI_CALLS_PER_STEP) served round-robin (no starvation:
 * a country whose review is due but over budget is served first next step), a per-review
 * command budget by difficulty, and event wake-ups (war declared on it, territory lost, offer
 * received, coalition application). All AI countries take turns, including those far from the human.
 */
import type { CountryId } from '../data-types';
import type { AiSchedule, GameState, ReviewKind } from '../state';
import { AI_CALLS_PER_STEP, AI_COMMANDS_PER_REVIEW, AI_INTERVALS_MIN, STEP_MIN } from '../rules';
import { hash32, streamRng } from '../rng';
import type { CountryController, PlannerContext, SimHost } from './types';
import { getCountryView } from '../view/country-view';
import { submitCommand, previewCommand } from '../commands/index';
import { S } from '../scenario/registry';
import { planRoute } from '../systems/movement';
import { IdleController } from './controllers';
import type { Command } from '../commands/types';

const KINDS: ReviewKind[] = ['strategic', 'economic', 'diplomatic', 'operational'];

export function initSchedule(c: CountryId, now: number): AiSchedule {
  const h = hash32(c);
  const next = {} as Record<ReviewKind, number>;
  for (const k of KINDS) {
    const iv = AI_INTERVALS_MIN[k];
    const slots = Math.max(1, Math.floor(iv / STEP_MIN));
    next[k] = now + STEP_MIN * (1 + ((h >>> KINDS.indexOf(k) * 3) % slots));
  }
  return { next, wake: [], lastRunAt: null, runs: 0 };
}

let defaultHost: SimHost = {};
export function setDefaultHost(h: SimHost): void {
  defaultHost = h;
}
export function getDefaultHost(): SimHost {
  return defaultHost;
}

function controllerFor(host: SimHost, c: CountryId): CountryController {
  const reg = host.controllers;
  let ctl: CountryController | undefined;
  if (typeof reg === 'function') ctl = reg(c);
  else if (reg) ctl = reg[c];
  return ctl ?? host.fallback ?? IdleController;
}

/** Collect wake triggers from events emitted since index `from`. */
export function collectWakes(state: GameState, from: number): void {
  for (let i = from; i < state.events.length; i++) {
    const e = state.events[i];
    let tag: string | null = null;
    if (e.kind === 'war_declared') tag = 'war_declared';
    else if (e.kind === 'city_captured' || e.kind === 'province_captured' || e.kind === 'uprising_success') tag = 'territory_changed';
    else if (e.kind === 'offer_received') tag = 'offer';
    else if (e.kind === 'coalition_application') tag = 'coalition_application';
    else if (e.kind === 'offer_accepted' || e.kind === 'offer_declined') tag = 'offer_answered';
    if (!tag) continue;
    for (const c of Object.keys(e.private).sort()) {
      const sch = state.ai.schedule[c];
      if (!sch || state.countries[c]?.controller !== 'ai') continue;
      const w = `${tag}:${e.id}`;
      if (!sch.wake.includes(w)) sch.wake.push(w);
      if (sch.wake.length > 20) sch.wake.splice(0, sch.wake.length - 20);
    }
  }
}

export function runAi(state: GameState, host: SimHost): void {
  const t = state.clock.tick;
  const order = state.countryOrder;
  const n = order.length;
  if (!n) return;
  let calls = 0;
  let lastServed = -1;
  for (let k = 0; k < n && calls < AI_CALLS_PER_STEP; k++) {
    const idx = (state.ai.rr + k) % n;
    const c = order[idx];
    const cs = state.countries[c];
    if (cs.controller !== 'ai' || !cs.alive) continue;
    const sch = (state.ai.schedule[c] ??= initSchedule(c, t));
    const due = KINDS.filter((x) => sch.next[x] <= t);
    if (!due.length && !sch.wake.length) continue;
    const reviews = due.length ? due : (['operational'] as ReviewKind[]);
    const wake = sch.wake.splice(0);
    for (const x of due) sch.next[x] = t + AI_INTERVALS_MIN[x];
    sch.lastRunAt = t;
    sch.runs++;
    calls++;
    lastServed = idx;
    invoke(state, host, c, reviews, wake);
  }
  if (lastServed >= 0) state.ai.rr = (lastServed + 1) % n;
  state.ai.calls += calls;
}

function invoke(state: GameState, host: SimHost, c: CountryId, reviews: ReviewKind[], wake: string[]): void {
  const ctl = controllerFor(host, c);
  if (ctl === IdleController) return; // nothing to decide; skip building the view
  const st = S(state);
  const budget = AI_COMMANDS_PER_REVIEW[state.meta.difficulty] ?? 8;
  const ctx: PlannerContext = {
    now: state.clock.tick,
    reviews,
    wake,
    budget,
    difficulty: state.meta.difficulty,
    memory: state.ai.memory[c] ?? null,
    setMemory: (m) => {
      state.ai.memory[c] = m === undefined ? null : JSON.parse(JSON.stringify(m));
    },
    preview: (cmd: Command) => previewCommand(state, { ...cmd, country: c } as Command),
    map: st.scenario.map,
    catalog: st.scenario.catalog,
    route: (stackId, dest) => {
      const s = state.stacks[stackId];
      if (!s || s.owner !== c) return null;
      return planRoute(state, s, dest, []);
    },
    rng: streamRng(state.seed, 'ai', `${c}:${state.clock.tick}`),
  };
  let cmds: Command[] = [];
  try {
    cmds = ctl.decide(getCountryView(state, c, { journalLimit: 15 }), ctx) ?? [];
  } catch (e) {
    cmds = [];
    const cs = state.countries[c];
    cs.stats.rejected['controller_error'] = (cs.stats.rejected['controller_error'] ?? 0) + 1;
  }
  let used = 0;
  for (const cmd of cmds) {
    if (used >= budget) break;
    if (!cmd || cmd.country !== c) {
      const cs = state.countries[c];
      cs.stats.rejected['foreign_issuer'] = (cs.stats.rejected['foreign_issuer'] ?? 0) + 1;
      continue;
    }
    used++;
    submitCommand(state, cmd);
  }
}
