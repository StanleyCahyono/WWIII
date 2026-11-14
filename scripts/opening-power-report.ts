/**
 * Opening power report — `npm run report:power` (owner: profiles agent).
 *
 * Builds the actual World 120 opening save through the engine (createCampaign, fixed seed,
 * observer seat), reads the engine's persisted `computeOpeningPower` result and writes:
 *   docs/reports/opening-power.md   machine-generated ranking of all 120 seats
 *   docs/reports/opening-power.json the same data
 *
 * The authoritative numbers are the ENGINE's (src/engine/power.ts). This script also contains an
 * independent CROSS-CHECK calculator (clearly labelled below) used only to (a) verify the engine
 * against its documented formula and (b) show how the index moves under the catalog's documented
 * multiplier semantics (building `productionMult` / `researchSpeedMult` as multipliers, i.e.
 * level-1 research lab = ×1.0) — see docs/PROFILES.md "Engine notes".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildWorld120Scenario,
  computeOpeningPower,
  createCampaign,
  getScenarioById,
  getStatic,
  rules,
  type GameState,
  type OpeningPowerDims,
  type OpeningPowerResult,
} from '../src/engine/index';
import type { CountryId, CountryProfile, ResVec } from '../src/engine/data-types';
import { RESOURCES } from '../src/engine/data-types';
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
// CROSS-CHECK CALCULATOR (not used by the game). Independent re-implementation of the formula
// documented in src/engine/power.ts, computed from the save + static data. `semantics`:
//   'engine'  — reproduces the engine's current reading of building effects
//               (city output × (1 + Σ productionMult); research speed 1 + Σ researchSpeedMult;
//               local industry adds deposit × productionMult);
//   'catalog' — the catalog's documented meaning (multipliers: 1 + Σ (mult − 1)).
// ─────────────────────────────────────────────────────────────────────────────────────────────
export type Semantics = 'engine' | 'catalog';
export interface CrossCheck {
  semantics: Semantics;
  raw: Record<CountryId, OpeningPowerDims>;
  normalization: OpeningPowerDims;
  composite: Record<CountryId, number>;
  rank: CountryId[];
}

export function crossCheck(state: GameState, semantics: Semantics): CrossCheck {
  const scenario = getScenarioById(state.scenarioId);
  if (!scenario) throw new Error('scenario not registered');
  const st = getStatic(scenario);
  const prices = st.cat.prices as Record<string, number>;
  const OP = rules.OPENING_POWER;
  const mf = (m: number) => rules.MORALE.moraleFloorFactor + ((1 - rules.MORALE.moraleFloorFactor) * Math.max(0, Math.min(100, m))) / 100;
  const lvl = (type: string, level: number) => {
    const bt = st.cat.buildings.get(type);
    if (!bt) return null;
    let best = bt.levels[0];
    for (const l of bt.levels) if (l.level <= level && l.level >= best.level) best = l;
    return best;
  };
  const mult = (v: number) => (semantics === 'engine' ? v : v - 1);
  const val = (v: Record<string, number>) => RESOURCES.reduce((a, r) => a + (v[r] ?? 0) * (prices[r] ?? 0), 0);
  const zero = () => Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<string, number>;
  const add = (a: Record<string, number>, b: ResVec | undefined, k = 1) => {
    if (b) for (const r of RESOURCES) a[r] += ((b[r] as number) ?? 0) * k;
  };
  const prod: Record<string, Record<string, number>> = {};
  const cons: Record<string, Record<string, number>> = {};
  const research: Record<string, { slots: number; speed: number }> = {};
  const maint: Record<string, number> = {};
  for (const c of state.countryOrder) {
    prod[c] = zero();
    cons[c] = zero();
    research[c] = { slots: 0, speed: 0 };
    maint[c] = 0;
  }
  for (const p of state.provinces) {
    if (!p || !p.owner || p.control !== 'country' || !prod[p.owner]) continue;
    const node = st.map.data.nodes[p.node];
    const o = zero();
    for (const b of p.buildings) {
      const d = lvl(b.type, b.level);
      const bt = st.cat.buildings.get(b.type);
      add(cons[p.owner], d?.upkeepPerDay);
      if (!d || !bt) continue;
      if (node.deposit || !bt.needsDeposit) add(o, d.effects.produces, b.condition / 100);
      if (node.deposit && bt.needsDeposit && d.effects.productionMult) o[node.deposit] += rules.RURAL_DEPOSIT_OUTPUT * mult(d.effects.productionMult) * (b.condition / 100);
    }
    if (node.deposit) o[node.deposit] += rules.RURAL_DEPOSIT_OUTPUT;
    o.manpower += p.population * rules.MANPOWER_PER_KPOP;
    add(prod[p.owner], o as ResVec, mf(p.morale) * rules.TERRITORY_FACTOR[p.status]);
  }
  for (const city of Object.values(state.cities)) {
    const p = state.provinces[city.node];
    if (!p || !p.owner || p.control !== 'country' || !prod[p.owner]) continue;
    const c = p.owner;
    let m = 1;
    const o = zero();
    for (const b of city.buildings) {
      const d = lvl(b.type, b.level);
      add(cons[c], d?.upkeepPerDay);
      if (!d) continue;
      if (d.effects.productionMult) m += mult(d.effects.productionMult) * (b.condition / 100);
      add(o, d.effects.produces, b.condition / 100);
      if (d.effects.manpowerPerDay) o.manpower += d.effects.manpowerPerDay * (b.condition / 100);
      if (p.status !== 'occupied') {
        research[c].slots += d.effects.researchSlots ?? 0;
        if (d.effects.researchSpeedMult) research[c].speed += mult(d.effects.researchSpeedMult) * (b.condition / 100);
      }
      maint[c] += d.effects.maintenanceSlots ?? 0;
    }
    for (const r of RESOURCES) o[r] += (city.baseOutput[r] / 1000) * m;
    o.manpower += city.population * rules.MANPOWER_PER_KPOP;
    o.money += city.population * rules.MONEY_PER_KPOP;
    add(prod[c], o as ResVec, mf(city.morale) * (0.25 + 0.75 * (city.condition / 100)) * rules.TERRITORY_FACTOR[p.status]);
  }
  const formations: Record<string, number> = {};
  for (const c of state.countryOrder) formations[c] = 0;
  for (const s of Object.values(state.stacks)) {
    if (!(s.owner in formations)) continue;
    for (const u of s.units) {
      const ut = st.cat.units.get(u.type);
      if (!ut) continue;
      add(cons[s.owner], ut.upkeepPerDay);
      const cm = ut.doctrine?.[state.countries[s.owner].doctrine]?.costMult ?? 1;
      formations[s.owner] += val(ut.cost as Record<string, number>) * cm * (u.readiness / 100) * (u.hp / u.maxHp);
    }
  }
  const raw: Record<CountryId, OpeningPowerDims> = {};
  for (const c of state.countryOrder) {
    const cs = state.countries[c];
    const net = zero();
    for (const r of RESOURCES) net[r] = prod[c][r] - cons[c][r];
    let techValue = 0;
    for (const t of Object.keys(cs.techs)) {
      const tn = st.cat.techs.get(t);
      if (tn) techValue += val(tn.cost as Record<string, number>);
    }
    const slots = rules.RESEARCH_BASE_SLOTS + Math.floor(research[c].slots);
    const speed = 1 + research[c].speed + (cs.modifiers['research_speed'] ?? 0);
    const maintCap = Math.floor(cs.maintenanceSlots + rules.BASE_MAINTENANCE_SLOTS + maint[c]);
    let cov = 0;
    for (const r of rules.ESSENTIAL) {
      const need = cons[c][r] * OP.resilienceDays;
      const have = cs.stock[r] / 1000 + Math.max(0, prod[c][r]) * OP.resilienceDays;
      cov += need <= 0 ? 1 : Math.min(OP.resilienceCap, have / need);
    }
    raw[c] = {
      industrial: Math.max(0, val(net)),
      formations: formations[c],
      research: techValue + slots * speed * OP.researchHorizonDays * OP.researchSlotValuePerDay,
      mobility: cs.lift * OP.liftValue + maintCap * OP.maintenanceSlotValue + Math.max(0, prod[c].manpower) * OP.mobilityHorizonDays * OP.replenishmentValuePerManpower,
      resilience: Math.min(OP.resilienceCap, cov / rules.ESSENTIAL.length),
    };
  }
  const pool = state.countryOrder.filter((c) => c !== REFERENCE);
  const normalization = {} as OpeningPowerDims;
  for (const d of DIMS) normalization[d] = Math.max(...pool.map((c) => raw[c][d]));
  const comp: Record<CountryId, number> = {};
  for (const c of state.countryOrder) comp[c] = DIMS.reduce((a, d) => a + OP.weights[d] * (raw[c][d] / normalization[d]), 0);
  const top = Math.max(...pool.map((c) => comp[c]));
  const composite: Record<CountryId, number> = {};
  for (const c of state.countryOrder) composite[c] = Math.round((comp[c] * 100 * 100) / top) / 100;
  const rank = [...state.countryOrder].sort((a, b) => composite[b] - composite[a] || (a < b ? -1 : 1));
  return { semantics, raw, normalization, composite, rank };
}

// ───────────────────────────── report rendering ─────────────────────────────

const f0 = (x: number) => Math.round(x).toLocaleString('en-US');
const f2 = (x: number) => x.toFixed(2);

export function renderReport(state: GameState, op: OpeningPowerResult, checks: CrossCheck[]): { md: string; json: unknown } {
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
    const holder = state.countryOrder.filter((c) => c !== REFERENCE).find((c) => op.raw[c][d] === op.normalization[d]);
    lines.push(`| ${d} | ${Math.round(op.weights[d] * 100)} % | ${desc[d]} | ${d === 'resilience' ? f2(op.normalization[d]) : f0(op.normalization[d])} | ${holder ?? '—'} |`);
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
  lines.push('## Cross-check (independent calculator, not used by the game)');
  lines.push('');
  for (const ch of checks) {
    const us = ch.composite[REFERENCE];
    const rival = ch.rank.find((c) => c !== REFERENCE) as string;
    const maxDiff = Math.max(...state.countryOrder.flatMap((c) => DIMS.map((d) => Math.abs(ch.raw[c][d] - op.raw[c][d]) / Math.max(1, Math.abs(op.raw[c][d])))));
    lines.push(`- **${ch.semantics === 'engine' ? 'Engine semantics' : 'Catalog multiplier semantics'}**: U.S. ${f2(us)}, nearest rival ${rival} ${f2(ch.composite[rival])} (lead ${f2(((us - ch.composite[rival]) / ch.composite[rival]) * 100)} %). Top 10: ${ch.rank.slice(0, 10).map((c) => `${c} ${f2(ch.composite[c])}`).join(', ')}.` + (ch.semantics === 'engine' ? ` Max relative deviation from the engine's raw values: ${(maxDiff * 100).toFixed(3)} %.` : ''));
  }
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
    crossChecks: checks.map((ch) => ({ semantics: ch.semantics, usComposite: ch.composite[REFERENCE], top10: ch.rank.slice(0, 10).map((c) => ({ id: c, composite: ch.composite[c] })) })),
  };
  return { md: lines.join('\n') + '\n', json };
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const state = buildOpeningState();
  const op = engineOpeningPower(state);
  const checks = [crossCheck(state, 'engine'), crossCheck(state, 'catalog')];
  const { md, json } = renderReport(state, op, checks);
  const out = resolve(root, 'docs/reports');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'opening-power.md'), md);
  writeFileSync(resolve(out, 'opening-power.json'), JSON.stringify(json, null, 2) + '\n');
  const s = summarize(op);
  console.log(`USA composite ${f2(s.composite)} · nearest rival ${s.nearestRival} ${f2(s.rivalComposite)} · lead ${f2(s.leadPct)} %`);
  for (const c of op.rank.slice(0, 12)) console.log(`  ${c.padEnd(4)} ${f2(op.composite[c]).padStart(7)}  ` + DIMS.map((d) => (d === 'resilience' ? f2(op.raw[c][d]) : f0(op.raw[c][d])).padStart(11)).join(''));
  for (const ch of checks) console.log(`cross-check (${ch.semantics}): USA ${f2(ch.composite[REFERENCE])}; top: ${ch.rank.slice(0, 6).map((c) => `${c} ${f2(ch.composite[c])}`).join(', ')}`);
  console.log('wrote docs/reports/opening-power.md and docs/reports/opening-power.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
