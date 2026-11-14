/**
 * Strategic memory with decay, persisted through ctx.memory/setMemory (JSON saved by the engine).
 * Grievances (hostile acts) and favours (kept agreements) decay daily; lists are bounded.
 */
import type { PlannerContext } from '../engine/ai-host/types';
import type { CountryView } from '../engine/view/country-view';
import type { AiMemory } from './types';

export const GRIEVANCE_DECAY_PER_DAY = 0.9;
export const FAVOUR_DECAY_PER_DAY = 0.95;
const MAX_DECISIONS = 12;
const MAX_HANDLED = 24;
const MAX_INTEL = 6;

export function freshMemory(ctx: PlannerContext): AiMemory {
  return {
    v: 1,
    jitter: Math.round((ctx.rng.next() * 2 - 1) * 1000) / 1000,
    geography: null,
    lastStrategic: -1e9,
    plan: { researchFocus: [], shortages: [], garrison: 1, stance: 'consolidate', hypersonic: false },
    objective: null,
    grievance: {},
    favour: {},
    cooldown: {},
    decisions: [],
    intel: [],
    procurement: null,
    soughtDiplomacy: 0,
    journalCursor: 0,
    counters: {},
    idleEconomic: 0,
    tasks: {},
    handledMessages: [],
    warStartedAt: {},
    capitalsLost: 0,
  };
}

export function loadMemory(ctx: PlannerContext): AiMemory {
  const m = ctx.memory as AiMemory | null;
  if (!m || typeof m !== 'object' || m.v !== 1) return freshMemory(ctx);
  // forward-compatible defaults
  const f = freshMemory(ctx);
  for (const k of Object.keys(f) as (keyof AiMemory)[]) if ((m as unknown as Record<string, unknown>)[k] === undefined) (m as unknown as Record<string, unknown>)[k] = f[k];
  return m;
}

/** Apply daily decay to grievance/favour maps and prune bounded lists. */
export function decayMemory(mem: AiMemory, view: CountryView, days: number): void {
  if (days <= 0) return;
  const g = Math.pow(GRIEVANCE_DECAY_PER_DAY, days);
  const f = Math.pow(FAVOUR_DECAY_PER_DAY, days);
  for (const k of Object.keys(mem.grievance)) {
    mem.grievance[k] = Math.round(mem.grievance[k] * g * 100) / 100;
    if (Math.abs(mem.grievance[k]) < 0.5) delete mem.grievance[k];
  }
  for (const k of Object.keys(mem.favour)) {
    mem.favour[k] = Math.round(mem.favour[k] * f * 100) / 100;
    if (Math.abs(mem.favour[k]) < 0.5) delete mem.favour[k];
  }
  pruneMemory(mem, view);
}

export function pruneMemory(mem: AiMemory, view: CountryView): void {
  const now = view.tick;
  for (const k of Object.keys(mem.cooldown)) if (mem.cooldown[k] <= now) delete mem.cooldown[k];
  if (mem.decisions.length > MAX_DECISIONS) mem.decisions.splice(0, mem.decisions.length - MAX_DECISIONS);
  if (mem.handledMessages.length > MAX_HANDLED) mem.handledMessages.splice(0, mem.handledMessages.length - MAX_HANDLED);
  mem.intel = mem.intel.filter((i) => now - i.at < 3 * 1440).slice(-MAX_INTEL);
  const alive = new Set(view.stacks.map((s) => s.id));
  for (const k of Object.keys(mem.tasks)) if (!alive.has(k) || mem.tasks[k].until <= now) delete mem.tasks[k];
  for (const k of Object.keys(mem.warStartedAt)) if (!view.relations.find((r) => r.country === k)?.war) delete mem.warStartedAt[k];
}

export function bump(map: Record<string, number>, k: string, d: number, cap = 100): void {
  map[k] = Math.max(-cap, Math.min(cap, Math.round(((map[k] ?? 0) + d) * 100) / 100));
}
