/**
 * World Command AI — local rules/utility planner (no LLM, no network, deterministic).
 *
 * Contract: implements the engine's `CountryController` (src/engine/ai-host/types.ts). The
 * controller receives ONLY the filtered CountryView and the PlannerContext (preview/route are
 * engine-filtered), never raw GameState. All randomness comes from ctx.rng; persistent strategy
 * lives in ctx.memory (JSON saved by the engine). See docs/AI.md.
 *
 * Injection (src/ui/sim/engine-adapter.ts looks for these exports):
 *   createSimHost()          → { fallback: UtilityController }   (preferred)
 *   createAiControllers(d?)  → registry function (country → controller), optional difficulty override
 *   UtilityController / CONTROLLER / default
 */
import type { CountryId } from '../engine/data-types';
import type { Command } from '../engine/commands/types';
import type { CountryController, PlannerContext, SimHost } from '../engine/ai-host/types';
import type { CountryView } from '../engine/view/country-view';
import { Turn, previewStats } from './turn';
import { analyse } from './analysis';
import { loadMemory, pruneMemory } from './memory';
import { ingestJournal, retargetTrigger, strategicPass } from './strategic';
import { economicReview } from './economic';
import { diplomaticReplies, diplomaticReview } from './diplomacy';
import { operationalReview, stagingOnly } from './operational';
import { DIFFICULTY, type AiDifficulty } from './types';

export { getDecisionLog, allDecisionLogs, clearDecisionLogs, setDecisionLogging, LOG_CAPACITY } from './log';
export { evaluateOffer } from './diplomacy';
export { DIFFICULTY } from './types';
export type { AiMemory, AiDifficulty, DecisionEntry, DifficultyProfile } from './types';

const DAY = 1440;
const OPERATIONAL_MIN = 120;

/** Cumulative wall-clock cost of the planner itself (developer metric; never read by decisions). */
export const aiPerf = { calls: 0, ms: 0, previewMs: 0, previews: 0, quiet: 0 };
const nowMs: () => number = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => 0;

/**
 * Cheap pre-check: an operational-only call with no wake, no war, no pending offer/request and
 * no hostile presence has nothing to decide (peace-time staging runs on economic reviews).
 */
function quiet(view: CountryView, ctx: PlannerContext): boolean {
  if (ctx.wake.length || ctx.reviews.length !== 1 || ctx.reviews[0] !== 'operational') return false;
  const mem = ctx.memory as { decisions?: { offer: string }[]; handledMessages?: string[]; lastStrategic?: number } | null;
  if (!mem || mem.lastStrategic === undefined || mem.lastStrategic < 0) return false;
  for (const r of view.relations) if (r.war) return false;
  for (const o of view.offers) if (o.status === 'pending' && o.to === view.viewer && !mem.decisions?.some((d) => d.offer === o.id)) return false;
  for (const k in view.messages) {
    const l = view.messages[k];
    const m = l[l.length - 1];
    if (m && m.from !== view.viewer && (m.intent === 'coordinate' || m.intent === 'request_operation') && !mem.handledMessages?.includes(m.id)) return false;
  }
  if (view.rebelNodes.length) for (const n of view.rebelNodes) if (view.provinces.some((p) => p.node === n)) return false;
  return true;
}

function plan(view: CountryView, ctx: PlannerContext): Command[] {
  if (!view.self.alive || view.finished || view.isHuman) return [];
  if (quiet(view, ctx)) {
    aiPerf.quiet++;
    return [];
  }
  const mem = loadMemory(ctx);
  const t = new Turn(view, ctx, mem);
  const a = analyse(t);
  ingestJournal(t, a);
  const reviews = new Set(ctx.reviews);
  const m = mem;
  const wakeOnly = ctx.wake.length > 0 && reviews.size === 1 && reviews.has('operational') && m.lastOperational !== undefined && t.now - m.lastOperational < OPERATIONAL_MIN - 15;
  const urgent = ctx.wake.some((w) => w.startsWith('war_declared') || w.startsWith('territory_changed'));

  // 1. replies (offers, applications, operation requests) on every call
  diplomaticReplies(t, a);

  // 2. strategic pass: low frequency, or on a meaningful trigger
  const strategicEvery = t.diff.strategicEveryDays * DAY;
  const trigger = retargetTrigger(t, a);
  const strategicDue = mem.lastStrategic < 0 || (reviews.has('strategic') && t.now - mem.lastStrategic >= strategicEvery - 60) || (t.diff.reactToWakes && urgent) || (trigger !== null && trigger !== 'no objective' && t.now - mem.lastStrategic >= 6 * 60);
  if (strategicDue) strategicPass(t, a);

  // 3. operational replan (scheduled, or wake-triggered on normal/hard)
  if (reviews.has('operational') && (!wakeOnly || t.diff.reactToWakes)) {
    operationalReview(t, a);
    m.lastOperational = t.now;
  }
  // 4. economic review
  if (reviews.has('economic')) economicReview(t, a);
  // peace-time staging toward the objective rides on the economic review (no extra wake-ups)
  if (reviews.has('economic') && !reviews.has('operational') && !a.enemies.length) stagingOnly(t, a);
  // 5. diplomatic proposals (staggered)
  if (reviews.has('diplomatic')) diplomaticReview(t, a);

  pruneMemory(mem, view);
  mem.quietOk = !a.enemies.length && !view.rebelNodes.some((n) => view.owners[n] === view.viewer || a.myNodes.includes(n)) && !Object.values(view.messages).some((l) => l.some((m) => m.from !== view.viewer && (m.intent === 'coordinate' || m.intent === 'request_operation') && !mem.handledMessages.includes(m.id)));
  ctx.setMemory(mem);
  return t.out;
}

/**
 * Pre-check for the scheduler (proposed engine hook, see docs/AI.md "Engine requests" #1): returns
 * false when the call cannot produce a decision — an operational-only review without wake triggers
 * while the last full review recorded a quiet situation (no war, no rebel province, no unhandled
 * request). Pure function of the call info and the SAVED memory ⇒ deterministic across reloads.
 */
export function wantsCall(info: { reviews: readonly string[]; wake: readonly string[]; memory: unknown }): boolean {
  if (info.wake.length || info.reviews.length !== 1 || info.reviews[0] !== 'operational') return true;
  const m = info.memory as { quietOk?: boolean; lastStrategic?: number } | null;
  return !(m && m.quietOk === true && typeof m.lastStrategic === 'number' && m.lastStrategic >= 0);
}

/** The utility planner. One stateless instance serves every country (state lives in ctx.memory). */
export const UtilityController: CountryController & { wants: typeof wantsCall } = {
  wants: wantsCall,
  decide(view: CountryView, ctx: PlannerContext): Command[] {
    const t0 = nowMs();
    try {
      return plan(view, ctx);
    } finally {
      aiPerf.calls++;
      aiPerf.ms += nowMs() - t0;
      aiPerf.previewMs = previewStats.ms;
      aiPerf.previews = previewStats.n;
    }
  },
};
export const CONTROLLER = UtilityController;
export default UtilityController;

/** A controller pinned to a difficulty (planning effort only), regardless of the campaign setting. */
export function controllerWithDifficulty(d: AiDifficulty): CountryController {
  return {
    decide(view, ctx) {
      return UtilityController.decide(view, { ...ctx, difficulty: d });
    },
  };
}

/** Registry for the engine host: every AI seat gets the utility planner. */
export function createAiControllers(difficulty?: AiDifficulty): (country: CountryId) => CountryController {
  const ctl = difficulty ? controllerWithDifficulty(difficulty) : UtilityController;
  return () => ctl;
}
export function createControllers(): (country: CountryId) => CountryController {
  return createAiControllers();
}
/** Preferred injection point for the sim worker. */
export function createSimHost(difficulty?: AiDifficulty): SimHost {
  return { fallback: difficulty ? controllerWithDifficulty(difficulty) : UtilityController };
}
export const DIFFICULTIES = Object.keys(DIFFICULTY) as AiDifficulty[];
