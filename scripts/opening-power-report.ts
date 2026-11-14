/**
 * Opening power report — `npm run report:power` (owner: profiles agent).
 *
 * Builds the actual World 120 opening save through the engine (createCampaign, fixed seed,
 * observer seat), reads the engine's persisted `computeOpeningPower` result and writes:
 *   docs/reports/opening-power.md   machine-generated ranking of all 120 seats
 *   docs/reports/opening-power.json the same data
 *
 * The authoritative numbers are the ENGINE's (src/engine/power.ts). This script also contains an
 * independent AGGREGATION cross-check (clearly labelled below) that re-derives normalization,
 * weights, rescale and rank from the engine's raw values.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildWorld120Scenario,
  computeOpeningPower,
  createCampaign,
  getScenarioById,
  allRates,
  liftBreakdown,
  rules,
  type GameState,
  type OpeningPowerDims,
  type OpeningPowerResult,
} from '../src/engine/index';
import type { CountryId, CountryProfile } from '../src/engine/data-types';
import { loadMapData } from '../src/data/map-index';
import { CATALOG } from '../src/data/catalog/index';
import { MANIFEST } from '../src/data/countries';
import { PROFILES, profileById } from '../src/data/profiles/index';

export const REPORT_SEED = 120;
export const REFERENCE = 'USA';
const DIMS: (keyof OpeningPowerDims)[] = ['industrial', 'formations', 'research', 'mobility', 'resilience'];

type CatalogInput = Parameters<typeof buildWorld120Scenario>[0]['catalog'];

/** Build the World 120 opening save (observer: all 120 seats AI) from the given profiles. */
export function buildOpeningState(profiles: CountryProfile[] = PROFILES, seed = REPORT_SEED, catalog: CatalogInput = CATALOG as unknown as CatalogInput): GameState {
  const scenario = buildWorld120Scenario({ map: loadMapData(), catalog, manifest: MANIFEST, profiles });
  return createCampaign({ seed, humanCountry: null, scenario });
}

/** The engine's persisted opening power (computed at creation, before treaties/events). */
export function engineOpeningPower(state: GameState): OpeningPowerResult {
  return state.openingPower ?? computeOpeningPower(state);
}

export interface PowerSummary {
  reference: CountryId;
  composite: number;
  nearestRival: CountryId;
  rivalComposite: number;
  leadPct: number;
  rank: CountryId[];
}
export function summarize(op: OpeningPowerResult, reference = REFERENCE): PowerSummary {
  const rivals = op.rank.filter((c) => c !== reference);
  const rival = rivals[0];
  const composite = op.composite[reference];
  const rc = op.composite[rival];
  return { reference, composite, nearestRival: rival, rivalComposite: rc, leadPct: Math.round(((composite - rc) / rc) * 10000) / 100, rank: op.rank };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// AGGREGATION CROSS-CHECK (not used by the game). Re-derives normalization constants, weighted
// composites, the rescale and the ranking independently from the engine's five RAW values.
// The raw values themselves are taken from the engine only: since the engine applies national
// tech modifiers (output, electronics, research speed, unit electronics cost, fuel upkeep) and
// derived lift in many places, an independent raw re-implementation would drift (see PROFILES.md).
// ─────────────────────────────────────────────────────────────────────────────────────────────
export interface CrossCheck {
  normalization: OpeningPowerDims;
  composite: Record<CountryId, number>;
  rank: CountryId[];
  maxCompositeDiff: number;
}

export function crossCheck(state: GameState, op: OpeningPowerResult): CrossCheck {
  const W = rules.OPENING_POWER.weights;
  const pool = state.countryOrder.filter((c) => c !== REFERENCE);
  const normalization = {} as OpeningPowerDims;
  for (const d of DIMS) normalization[d] = Math.max(...pool.map((c) => op.raw[c][d]));
  const comp: Record<CountryId, number> = {};
  for (const c of state.countryOrder) comp[c] = DIMS.reduce((a, d) => a + W[d] * (op.raw[c][d] / normalization[d]), 0);
  const top = Math.max(...pool.map((c) => comp[c]));
  const composite: Record<CountryId, number> = {};
  for (const c of state.countryOrder) composite[c] = Math.round((comp[c] * 100 * 100) / top) / 100;
  const rank = [...state.countryOrder].sort((a, b) => composite[b] - composite[a] || (a < b ? -1 : 1));
  const maxCompositeDiff = Math.max(...state.countryOrder.map((c) => Math.abs(composite[c] - op.composite[c])));
  return { normalization, composite, rank, maxCompositeDiff };
}

/** U.S. mobility inputs as the engine sees them (lift breakdown, maintenance, manpower). */
export function usMobility(state: GameState): { lift: ReturnType<typeof liftBreakdown>; manpowerPerDay: number } {
  return { lift: liftBreakdown(state, REFERENCE), manpowerPerDay: Math.round(allRates(state)[REFERENCE].production.manpower / 1000) };
}

// ───────────────────────────── report rendering ─────────────────────────────

const f0 = (x: number) => Math.round(x).toLocaleString('en-US');
const f2 = (x: number) => x.toFixed(2);

export function renderReport(state: GameState, op: OpeningPowerResult, check: CrossCheck): { md: string; json: unknown } {
  const s = summarize(op);
  const names = new Map(MANIFEST.map((m) => [m.id, m.name]));
  const lines: string[] = [];
  lines.push('# Opening power — World 120');
  lines.push('');
  lines.push('_Machine-generated by `npm run report:power` (scripts/opening-power-report.ts). Do not edit by hand._');
  lines.push('');
  lines.push(`Source: the actual opening save built by \`createCampaign\` (seed ${state.seed}, observer seat, scenario \`${state.scenarioVersion}\`, ruleset ${state.rulesetVersion}). Values are the engine's persisted \`openingPower\` (src/engine/power.ts), computed at creation before treaties or random events.`);
  lines.push('');
  lines.push('## Result');
  lines.push('');
  lines.push(`- **United States composite: ${f2(s.composite)}** (target 118, acceptance band 115–121).`);
  lines.push(`- Nearest rival: **${names.get(s.nearestRival)} (${s.nearestRival}) ${f2(s.rivalComposite)}** — U.S. lead **${f2(s.leadPct)} %** (required 15–21 %).`);
  lines.push(`- Leader: ${op.leader}. Rescale factor (100 ÷ highest non-U.S. weighted sum): ${op.rescale.toFixed(4)}.`);
  lines.push('');
  lines.push('## Method and constants');
  lines.push('');
  lines.push('| Dimension | Weight | Raw value from the opening save | Normalization constant (highest non-U.S. raw) | Holder |');
  lines.push('| --- | ---: | --- | ---: | --- |');
  const desc: Record<string, string> = {
    industrial: "one day's net production (production − ordinary upkeep) at reference prices, clamped ≥ 0",
    formations: 'Σ unit replacement value (catalog cost × doctrine cost factor × reference prices) × readiness × health',
    research: `Σ reference value of completed techs + research slots × speed × ${op.constants.researchHorizonDays} days × ${op.constants.researchSlotValuePerDay}`,
    mobility: `lift × ${op.constants.liftValue} + maintenance capacity × ${op.constants.maintenanceSlotValue} + manpower/day × ${op.constants.mobilityHorizonDays} days × ${op.constants.replenishmentValuePerManpower}`,
    resilience: `mean coverage of essential inputs (supplies, fuel, components) over ${op.constants.resilienceDays} days, capped at ${op.constants.resilienceCap}`,
  };
  for (const d of DIMS) {
    const holders = state.countryOrder.filter((c) => c !== REFERENCE && op.raw[c][d] === op.normalization[d]);
    const holder = holders.length > 3 ? `${holders.length} seats tied at the cap` : holders.join(', ') || '—';
    lines.push(`| ${d} | ${Math.round(op.weights[d] * 100)} % | ${desc[d]} | ${d === 'resilience' ? f2(op.normalization[d]) : f0(op.normalization[d])} | ${holder} |`);
  }
  lines.push('');
  lines.push('Reference basket (money per unit): ' + CATALOG.resources.map((r) => `${r.id} ${r.referencePrice}`).join(', ') + '.');
  lines.push('');
  lines.push('Engine constants: ' + Object.entries(op.constants).map(([k, v]) => `${k} = ${v}`).join(', ') + '.');
  lines.push('');
  lines.push('## Ranking (all 120 seats)');
  lines.push('');
  lines.push('| # | Seat | Country | Composite | Industrial | Formations | Research | Mobility | Resilience | Template | Difficulty |');
  lines.push('| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  op.rank.forEach((c, i) => {
    const r = op.raw[c];
    const p = profileById.get(c);
    lines.push(`| ${i + 1} | ${c} | ${names.get(c) ?? c} | ${f2(op.composite[c])} | ${f0(r.industrial)} | ${f0(r.formations)} | ${f0(r.research)} | ${f0(r.mobility)} | ${f2(r.resilience)} | ${p?.template ?? 'synthesized'} | ${p?.startDifficulty ?? '—'} |`);
  });
  lines.push('');
  lines.push('## Cross-check (independent aggregation, not used by the game)');
  lines.push('');
  const rival = check.rank.find((c) => c !== REFERENCE) as string;
  lines.push(`Normalization, weights, rescale and ranking re-derived from the engine's raw values: U.S. ${f2(check.composite[REFERENCE])}, nearest rival ${rival} ${f2(check.composite[rival])}; maximum composite difference from the engine across all 120 seats: ${check.maxCompositeDiff.toFixed(2)}. Raw values are the engine's own (no second raw implementation is kept — see docs/PROFILES.md).`);
  lines.push('');
  const lb = liftBreakdown(state, REFERENCE);
  lines.push(`U.S. effective lift ${lb.total} = profile/tech ${lb.base} + buildings ${lb.buildings} + fielded airlift units ${lb.units}.`);
  lines.push('');
  const json = {
    generatedBy: 'scripts/opening-power-report.ts',
    seed: state.seed,
    scenarioVersion: state.scenarioVersion,
    rulesetVersion: state.rulesetVersion,
    reference: REFERENCE,
    summary: s,
    weights: op.weights,
    constants: op.constants,
    normalization: op.normalization,
    rescale: op.rescale,
    referenceBasket: Object.fromEntries(CATALOG.resources.map((r) => [r.id, r.referencePrice])),
    countries: op.rank.map((c, i) => ({ rank: i + 1, id: c, name: names.get(c), composite: op.composite[c], raw: op.raw[c], template: profileById.get(c)?.template ?? null })),
    crossCheck: { usComposite: check.composite[REFERENCE], maxCompositeDiff: check.maxCompositeDiff },
    usLift: lb,
  };
  return { md: lines.join('\n') + '\n', json };
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const state = buildOpeningState();
  const op = engineOpeningPower(state);
  const check = crossCheck(state, op);
  const { md, json } = renderReport(state, op, check);
  const out = resolve(root, 'docs/reports');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'opening-power.md'), md);
  writeFileSync(resolve(out, 'opening-power.json'), JSON.stringify(json, null, 2) + '\n');
  const s = summarize(op);
  console.log(`USA composite ${f2(s.composite)} · nearest rival ${s.nearestRival} ${f2(s.rivalComposite)} · lead ${f2(s.leadPct)} %`);
  for (const c of op.rank.slice(0, 12)) console.log(`  ${c.padEnd(4)} ${f2(op.composite[c]).padStart(7)}  ` + DIMS.map((d) => (d === 'resilience' ? f2(op.raw[c][d]) : f0(op.raw[c][d])).padStart(11)).join(''));
  console.log(`aggregation cross-check: USA ${f2(check.composite[REFERENCE])}, max composite diff ${check.maxCompositeDiff.toFixed(2)}`);
  console.log('wrote docs/reports/opening-power.md and docs/reports/opening-power.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
