/**
 * ENGINE ADAPTER — the single file through which the UI's simulation worker touches the engine.
 * If the engine's public API changes, only this file (and the worker) should need edits.
 *
 * Runs inside the Web Worker (no DOM).
 */
import * as E from '../../engine/index';
import type { Command, CountryController, GameState, Scenario, SimHost } from '../../engine/index';
import { CATALOG, unitById, buildingById } from '../../data/catalog/index';
import type { CountryPreview, QueryName, ScenarioSummary } from './protocol';

export type { GameState, Scenario, Command };

let scenarioP: Promise<Scenario> | null = null;
export function loadScenario(): Promise<Scenario> {
  if (!scenarioP) scenarioP = E.loadWorld120();
  scenarioP.catch(() => (scenarioP = null));
  return scenarioP;
}

// ───────────────────────── AI controllers (src/ai when present) ─────────────────────────

let hostP: Promise<{ host: SimHost; source: string }> | null = null;
/**
 * Inject AI controllers. Looks for src/ai/index.ts and accepts any of these exports:
 *   createSimHost(): SimHost | createControllers(): ControllerRegistry | controllerFor(c) |
 *   CONTROLLER / UtilityController / default (a CountryController with decide()).
 * Falls back to the engine's BasicController.
 */
export function loadAiHost(): Promise<{ host: SimHost; source: string }> {
  if (hostP) return hostP;
  hostP = (async () => {
    const mods = import.meta.glob(['../../ai/index.ts']) as Record<string, () => Promise<Record<string, unknown>>>;
    const key = Object.keys(mods)[0];
    if (key) {
      try {
        const m = await mods[key]();
        if (typeof m.createSimHost === 'function') return { host: (m.createSimHost as () => SimHost)(), source: 'src/ai createSimHost' };
        if (typeof m.createControllers === 'function') return { host: { controllers: (m.createControllers as () => SimHost['controllers'])(), fallback: E.BasicController }, source: 'src/ai createControllers' };
        if (typeof m.controllerFor === 'function') return { host: { controllers: m.controllerFor as (c: string) => CountryController | undefined, fallback: E.BasicController }, source: 'src/ai controllerFor' };
        for (const k of ['CONTROLLER', 'UtilityController', 'PlannerController', 'default']) {
          const c = m[k] as CountryController | undefined;
          if (c && typeof c.decide === 'function') return { host: { fallback: c }, source: `src/ai ${k}` };
        }
      } catch (e) {
        console.warn('[sim] src/ai failed to load, using BasicController', e);
      }
    }
    return { host: { fallback: E.BasicController }, source: 'engine BasicController' };
  })();
  return hostP;
}

// ───────────────────────── campaign lifecycle ─────────────────────────

export function createCampaign(sc: Scenario, country: string, seed: number, difficulty: E.Difficulty): GameState {
  return E.createCampaign({ scenario: sc, seed, humanCountry: country, difficulty });
}

export const advance = E.advance;
export const advanceToNextEvent = E.advanceToNextEvent;
export const serialize = E.serialize;
export const deserialize = E.deserialize;
export const markSaved = E.markSaved;
export const stateHash = E.stateHash;
export const SAVE_FORMAT_VERSION = E.SCHEMA_VERSION;
export const SAVE_FORMAT = E.SAVE_FORMAT;
export const dayOf = E.dayOf;
export const formatGameTime = E.formatGameTime;

export function view(state: GameState, viewer: string) {
  const v = E.getCountryView(state, viewer, { journalLimit: 80 });
  const { rules: _rules, ...rest } = v;
  return rest;
}

export function submit(state: GameState, cmd: Command) {
  return E.submitCommand(state, cmd);
}
export function preview(state: GameState, cmd: Command) {
  return E.validateCommand(state, cmd);
}

export const ui = {
  addDrawing: E.addDrawing,
  renameDrawing: E.renameDrawing,
  setDrawingHidden: E.setDrawingHidden,
  deleteDrawing: E.deleteDrawing,
  setPref: E.setPref,
};

// ───────────────────────── country selection previews ─────────────────────────

export function countryPreviews(sc: Scenario): { summary: ScenarioSummary; previews: CountryPreview[] } {
  let power: GameState['openingPower'] = null;
  let previewError: string | null = null;
  let denominator: number | null = null;
  try {
    const probe = E.createCampaign({ scenario: sc, seed: 1, humanCountry: null, difficulty: 'normal' });
    power = probe.openingPower;
    denominator = probe.score.denominator;
  } catch (e) {
    previewError = (e as Error).message;
    try {
      denominator = E.computeDenominator(sc);
    } catch {
      /* ignore */
    }
  }
  const map = sc.map;
  const previews: CountryPreview[] = sc.seats.map((id) => {
    const p = sc.profiles[id];
    const mc = map.countries.find((c) => c.id === id);
    const cities = map.cities.filter((c) => c.country === id);
    const cap = cities.find((c) => c.key === mc?.capital) ?? cities.find((c) => c.capital) ?? null;
    const daily: Record<string, number> = {};
    for (const cp of p.cities) for (const [r, v] of Object.entries(cp.output)) daily[r] = (daily[r] ?? 0) + (v ?? 0);
    const forces = new Map<string, number>();
    for (const f of p.forces) forces.set(f.unit, (forces.get(f.unit) ?? 0) + f.count);
    return {
      id,
      name: p.name,
      region: p.region,
      capital: cap ? { key: cap.key, name: cap.name, lonlat: cap.lonlat } : null,
      cities: cities.map((c) => ({ key: c.key, name: c.name, tier: p.cities.find((x) => x.city === c.key)?.tier ?? c.tier, port: c.port, capital: c.capital })).sort((a, b) => Number(b.capital) - Number(a.capital) || b.tier - a.tier || (a.name < b.name ? -1 : 1)),
      provinces: mc?.provinces.length ?? 0,
      doctrine: p.doctrine,
      coastal: !!mc?.coastal,
      landlocked: !!mc?.landlocked,
      small: !!mc?.small,
      neighbours: mc?.landNeighbors ?? [],
      startDifficulty: p.startDifficulty,
      summary: p.summary,
      stockpile: { ...p.stockpile } as Record<string, number>,
      dailyOutput: daily,
      forces: [...forces.entries()].map(([unit, count]) => ({ unit, name: unitById.get(unit)?.name ?? unit, count })).sort((a, b) => b.count - a.count),
      formations: p.forces.length,
      tradeNeeds: p.tradeNeeds,
      openingDecisions: p.openingDecisions,
      power: power ? { composite: power.composite[id] ?? 0, rank: power.rank.indexOf(id) + 1, raw: { ...(power.raw[id] ?? {}) } as unknown as Record<string, number> } : null,
      synthesized: p.template === 'synthesized-default',
    };
  });
  return {
    summary: {
      id: sc.id,
      name: sc.name,
      version: sc.version,
      seats: sc.seats,
      notes: sc.notes ?? [],
      modes: E.listCampaignModes(),
      denominator,
      soloThreshold: denominator !== null ? E.thresholdFor(denominator, 1) : null,
      coalitionThresholds: denominator !== null ? { 2: E.thresholdFor(denominator, 2), 3: E.thresholdFor(denominator, 3), 4: E.thresholdFor(denominator, 4), 5: E.thresholdFor(denominator, 5) } : null,
      powerMeta: power ? { weights: { ...power.weights } as unknown as Record<string, number>, normalization: { ...power.normalization } as unknown as Record<string, number>, leader: power.leader, nearestRival: power.nearestRival, rescale: power.rescale } : null,
      previewError,
    },
    previews,
  };
}

// ───────────────────────── viewer-scoped queries ─────────────────────────

function nodeOfTarget(state: GameState, target: string | number): number {
  return typeof target === 'number' ? target : state.cities[target]?.node ?? -1;
}

export function query(state: GameState, viewer: string, name: QueryName, args: unknown[] = []): unknown {
  switch (name) {
    case 'cityList':
      return E.cityList(state, viewer);
    case 'provinceInspector':
      return E.provinceInspector(state, viewer, args[0] as number);
    case 'publicProvince': {
      const r = E.provinceInspector(state, viewer, args[0] as number) as Record<string, unknown>;
      return { ...r, private: r.owner === viewer ? r.private : null };
    }
    case 'researchTree':
      return E.researchTree(state, viewer);
    case 'researchRefund':
      return E.researchRefund(state, viewer, args[0] as string);
    case 'scoreBreakdown':
      return E.scoreBreakdown(state, viewer);
    case 'ledgerModel':
      return E.ledgerModel(state, viewer);
    case 'shortageBreakdown':
      return E.shortageBreakdown(state, viewer, args[0] as E.Resource);
    case 'newspaper':
      return E.newspaper(state, args[0] as number);
    case 'journal':
      return E.journal(state, viewer, { limit: (args[0] as number) ?? 500, category: (args[1] as string) || undefined });
    case 'marketView':
      return E.marketView(state, viewer, args[0] as E.Resource);
    case 'forceModel':
      return E.forceModel(state, viewer);
    case 'planRoute': {
      const s = state.stacks[args[0] as string];
      if (!s || s.owner !== viewer) return null;
      return E.planRoute(state, s, args[1] as number, (args[2] as number[]) ?? [], { allowActOfWar: true });
    }
    case 'cityDetail': {
      const key = args[0] as string;
      const city = state.cities[key];
      if (!city) return null;
      const p = state.provinces[city.node];
      if (!p || p.owner !== viewer) return null;
      return { city: JSON.parse(JSON.stringify(city)), inspector: E.provinceInspector(state, viewer, city.node), status: p.status, homeland: p.homeland };
    }
    case 'buildOptions': {
      const target = args[0] as string | number;
      const node = nodeOfTarget(state, target);
      const scope = typeof target === 'number' ? 'rural' : 'city';
      return CATALOG.buildings
        .filter((b) => b.scope === scope)
        .map((b) => {
          const v = E.validateCommand(state, { type: 'build', country: viewer, building: b.id, targets: [target] });
          const pv = (v.ok ? v.preview : (v as { details?: unknown }).details) as { rows?: { ok: boolean; reason?: string; cost?: Record<string, number>; level?: number; startTick?: number; durationMin?: number; queuePosition?: number; warning?: string }[] } | undefined;
          const row = pv?.rows?.[0];
          return { id: b.id, name: b.name, ok: v.ok, reason: v.ok ? null : row?.reason ?? (v as { reason: string }).reason, level: row?.level ?? null, cost: row?.cost ?? null, startTick: row?.startTick ?? null, durationMin: row?.durationMin ?? null, queuePosition: row?.queuePosition ?? null, warning: row?.warning ?? null, node };
        });
    }
    case 'unitOptions': {
      const city = args[0] as string;
      return CATALOG.units.map((u) => {
        const v = E.validateCommand(state, { type: 'mobilize', country: viewer, unit: u.id, cities: [city] });
        const pv = (v.ok ? v.preview : (v as { details?: unknown }).details) as { rows?: { ok: boolean; reason?: string; cost?: Record<string, number>; startTick?: number; durationMin?: number; queuePosition?: number }[] } | undefined;
        const row = pv?.rows?.[0];
        return { id: u.id, name: u.name, family: u.family, ok: v.ok, reason: v.ok ? null : row?.reason ?? (v as { reason: string }).reason, cost: row?.cost ?? null, startTick: row?.startTick ?? null, durationMin: row?.durationMin ?? null, queuePosition: row?.queuePosition ?? null };
      });
    }
    case 'eventDetail': {
      const id = args[0] as string;
      const e = state.events.find((x) => x.id === id);
      if (!e || !e.private[viewer]) return null;
      return { id: e.id, at: e.at, kind: e.kind, category: e.category, node: e.node, text: e.private[viewer].text, data: e.private[viewer].data ?? null };
    }
    case 'hashInfo':
      return { hash: E.stateHash(state), rng: { ...state.rng }, tick: state.clock.tick };
    case 'rules':
      return E.RULES;
    case 'profile': {
      const p = E.scenarioOf(state).profiles[viewer];
      if (!p) return null;
      return { id: p.id, name: p.name, doctrine: p.doctrine, summary: p.summary, startDifficulty: p.startDifficulty, tradeNeeds: p.tradeNeeds, openingDecisions: p.openingDecisions, template: p.template };
    }
    default:
      throw new Error(`Unknown query ${name}`);
  }
}

export function buildingName(id: string): string {
  return buildingById.get(id)?.name ?? id;
}
