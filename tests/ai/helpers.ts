/** Test helpers for the AI planner (tests only — they may touch raw state; the planner never does). */
import { buildWorld120Scenario, createCampaign, getCountryView, previewCommand, submitCommand, planRoute } from '../../src/engine';
import type { Command, CountryController, GameState, PlannerContext, ReviewKind, Scenario } from '../../src/engine';
import { RULES } from '../../src/engine';
import { streamRng } from '../../src/engine/rng';
import { getScenarioById } from '../../src/engine';
import { UtilityController } from '../../src/ai';
import type { AiMemory } from '../../src/ai';
import { AI_COMMANDS_PER_REVIEW } from '../../src/engine/rules';

/**
 * Invoke the planner exactly like the engine scheduler does (filtered view + context), optionally
 * submitting the returned commands through the shared validator. Returns commands and results.
 */
export function decideOnce(state: GameState, c: string, reviews: ReviewKind[], opts: { wake?: string[]; submit?: boolean; controller?: CountryController } = {}) {
  const sc = getScenarioById(state.scenarioId) as Scenario;
  const ctx: PlannerContext = {
    now: state.clock.tick,
    reviews,
    wake: opts.wake ?? [],
    budget: AI_COMMANDS_PER_REVIEW[state.meta.difficulty] ?? 8,
    difficulty: state.meta.difficulty,
    memory: state.ai.memory[c] ?? null,
    setMemory: (m) => {
      state.ai.memory[c] = m === undefined ? null : JSON.parse(JSON.stringify(m));
    },
    preview: (cmd: Command) => previewCommand(state, { ...cmd, country: c } as Command),
    map: sc.map,
    catalog: sc.catalog,
    route: (stackId, dest) => {
      const s = state.stacks[stackId];
      if (!s || s.owner !== c) return null;
      return planRoute(state, s, dest, []);
    },
    rng: streamRng(state.seed, 'ai', `${c}:${state.clock.tick}`),
  };
  const ctl = opts.controller ?? UtilityController;
  const view = getCountryView(state, c, { journalLimit: 15, journalScan: 400, lite: ctl.liteView === true });
  const cmds = ctl.decide(view, ctx);
  const results = opts.submit === false ? [] : cmds.map((cmd) => submitCommand(state, cmd));
  return { cmds, results, view };
}

export function memoryOf(state: GameState, c: string): AiMemory {
  return state.ai.memory[c] as AiMemory;
}

export interface Recorded {
  tick: number;
  country: string;
  cmd: Command;
  /** The stack's order destination as the planner saw it (for repeated no-op detection). */
  priorDest?: number | null;
}

/** Wrap a controller and record every command it returns (with the view it saw). */
export function recording(inner: CountryController = UtilityController) {
  const log: Recorded[] = [];
  // forward the scheduler hooks (pre-check, lite planner view) so recorded runs cost what real ones do
  const ctl: CountryController = {
    ...(inner.wants ? { wants: (info: Parameters<NonNullable<CountryController['wants']>>[0]) => inner.wants!(info) } : {}),
    ...(inner.liteView ? { liteView: true } : {}),
    decide(view, ctx) {
      const out = inner.decide(view, ctx);
      for (const cmd of out) {
        let priorDest: number | null | undefined;
        if (cmd.type === 'move') {
          const s = view.stacks.find((x) => x.id === cmd.stack);
          priorDest = s?.order ? (s.order.kind === 'move' ? s.order.dest : s.order.targetNode) : null;
        }
        log.push({ tick: view.tick, country: view.viewer, cmd, priorDest });
      }
      return out;
    },
  };
  return { ctl, log };
}

let realScenario: Scenario | null | undefined;
/** The real World 120 scenario built with the engine's Node scenario builder (null if data missing). */
export async function realWorld(): Promise<Scenario | null> {
  if (realScenario !== undefined) return realScenario;
  try {
    const [{ loadMapData }, { CATALOG }, { MANIFEST }, { PROFILES }] = await Promise.all([
      import('../../src/data/map-index'),
      import('../../src/data/catalog/index'),
      import('../../src/data/countries'),
      import('../../src/data/profiles/index'),
    ]);
    realScenario = buildWorld120Scenario({ map: loadMapData(), catalog: CATALOG as never, manifest: MANIFEST, profiles: PROFILES });
  } catch {
    realScenario = null;
  }
  return realScenario;
}
export function newReal(sc: Scenario, seed = 1, human: string | null = null): GameState {
  return createCampaign({ seed, humanCountry: human, scenario: sc });
}

export const DAY = RULES.DAY_MIN;
