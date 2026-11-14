/** createCampaign: build a fresh GameState from a Scenario + seed + human seat. */
import type { CountryId, CountryProfile, Personality } from '../data-types';
import type { CityState, CountryState, Difficulty, GameState, ProvinceState } from '../state';
import { SCHEMA_VERSION } from '../state';
import { RULESET_VERSION, TRUST } from '../rules';
import { copy, toMilli, vecFromWhole, zero } from '../fixed';
import { streamRng } from '../rng';
import { registerScenario, getStatic } from './registry';
import type { Scenario } from './types';
import { grantTech } from '../systems/research';
import { newUnit, spawnStack } from '../systems/production';
import { computeDenominator } from '../systems/score';
import { initSchedule } from '../ai-host/scheduler';
import { updateVisibility } from '../systems/visibility';
import { dirKey, pairKey } from '../ids';
import { computeOpeningPower } from '../power';
import { moveClassOf } from '../systems/world';
import { defaultCityOutput } from './defaults';

export interface CreateOptions {
  seed: number;
  /** Human seat, or null to observe (all seats AI). */
  humanCountry: CountryId | null;
  difficulty?: Difficulty;
  scenario: Scenario;
}

function varyPersonality(p: Personality, seed: number, c: CountryId): Personality {
  const r = streamRng(seed, 'personality', c);
  const v = (x: number) => Math.max(0, Math.min(1, Math.round((x + 0.15 * (2 * r.next() - 1)) * 1000) / 1000));
  return { aggression: v(p.aggression), caution: v(p.caution), trade: v(p.trade), loyalty: v(p.loyalty), expansion: v(p.expansion), research: v(p.research) };
}

export function createCampaign(opts: CreateOptions): GameState {
  const sc = opts.scenario;
  registerScenario(sc);
  const st = getStatic(sc);
  const seed = opts.seed >>> 0;
  if (opts.humanCountry !== null && !sc.seats.includes(opts.humanCountry)) throw new Error(`"${opts.humanCountry}" is not a playable seat in ${sc.name}.`);
  const order = [...sc.seats].sort();
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    scenarioId: sc.id,
    scenarioVersion: sc.version,
    rulesetVersion: RULESET_VERSION,
    seed,
    meta: { saveRevision: 0, difficulty: opts.difficulty ?? 'normal', humanCountry: opts.humanCountry, startDate: sc.startDate, mode: sc.testOnly ? 'fixture' : 'world120', humanRun: opts.humanCountry ? 'active' : 'observer' },
    clock: { tick: 0, lastStep: 0 },
    rng: { seed, counter: 0 },
    ids: {},
    countryOrder: order,
    countries: {},
    provinces: [],
    cities: {},
    stacks: {},
    engagements: {},
    queue: [],
    relations: {},
    grants: {},
    trust: {},
    offers: {},
    coalitions: {},
    messages: {},
    market: { orders: {}, fills: [], seq: 0, lastPrice: {} },
    launches: {},
    blockades: {},
    contacts: {},
    reports: {},
    agents: {},
    events: [],
    articles: [],
    score: { denominator: 0, history: [], result: null, lastSettledDay: 0 },
    career: { xp: 0, entries: [] },
    ai: { memory: {}, schedule: {}, rr: 0, calls: 0, wakeCursor: 0 },
    openingPower: null,
    ui: { planning: [], prefs: {}, nextDrawingId: 1 },
  };
  const seats = new Set(order);
  // provinces
  const ruralByKey = new Map<string, { type: string; level: number }[]>();
  for (const c of order) for (const rb of sc.profiles[c]?.ruralBuildings ?? []) {
    const l = ruralByKey.get(rb.node) ?? [];
    l.push({ type: rb.type, level: rb.level });
    ruralByKey.set(rb.node, l);
  }
  for (const n of sc.map.nodes) {
    if (n.kind === 'sea') { state.provinces[n.id] = null; continue; }
    const playable = !n.outside && !!n.country && seats.has(n.country);
    const p: ProvinceState = {
      node: n.id,
      homeland: playable ? n.country : null,
      owner: playable ? n.country : null,
      control: playable ? 'country' : 'outside',
      status: 'homeland',
      population: n.population,
      morale: 70,
      buildings: (ruralByKey.get(n.key) ?? []).filter((b) => st.cat.buildings.has(b.type)).map((b) => ({ type: b.type, level: b.level, condition: 100 })),
      changedAt: 0,
    };
    state.provinces[n.id] = p;
  }
  // cities
  for (const cd of sc.map.cities) {
    if (!seats.has(cd.country)) continue;
    const prof = sc.profiles[cd.country]?.cities.find((x) => x.city === cd.key);
    const tier = prof?.tier ?? cd.tier;
    const c: CityState = {
      key: cd.key,
      node: cd.node,
      name: cd.name,
      tier,
      capital: cd.capital,
      port: cd.port,
      functions: prof?.functions ?? [],
      population: cd.population,
      populationStart: cd.population,
      recentLosses: 0,
      morale: 75,
      targetMorale: 75,
      moraleFactors: [],
      condition: 100,
      buildings: (prof?.buildings ?? []).filter((b) => st.cat.buildings.has(b.type)).map((b) => ({ type: b.type, level: b.level, condition: 100 })),
      baseOutput: prof ? vecFromWhole(prof.output) : vecFromWhole(defaultCityOutput(tier)),
      rally: null,
      shortage: false,
    };
    state.cities[cd.key] = c;
  }
  // countries
  for (const c of order) {
    const prof: CountryProfile = sc.profiles[c];
    if (!prof) throw new Error(`Scenario ${sc.id} has no profile for seat ${c}`);
    const mc = sc.map.countries.find((x) => x.id === c);
    const stock = vecFromWhole(prof.stockpile);
    const cs: CountryState = {
      id: c,
      name: prof.name,
      doctrine: prof.doctrine,
      controller: c === opts.humanCountry ? 'human' : 'ai',
      alive: true,
      capitalCity: mc?.capital ?? sc.map.cities.find((x) => x.country === c && x.capital)?.key ?? null,
      stock,
      escrow: zero(),
      ledger: { initial: copy(stock), totals: {}, days: [], unpaid: zero() },
      techs: {},
      research: [],
      unitLevels: {},
      missiles: {},
      jobs: [],
      lift: prof.lift,
      maintenanceSlots: prof.maintenanceSlots,
      personality: varyPersonality(prof.personality, seed, c),
      nonces: [],
      stats: { accepted: {}, rejected: {} },
      eliminatedAt: null,
      modifiers: {},
      shortages: [],
    };
    state.countries[c] = cs;
  }
  for (const c of order) {
    const prof = sc.profiles[c];
    for (const t of prof.techs) grantTech(state, c, t, 'common');
    for (const t of prof.licensed ?? []) grantTech(state, c, t, 'licensed');
    // units available from start
    for (const u of sc.catalog.units) if (!u.unlockTech) state.countries[c].unitLevels[u.id] ??= 1;
  }
  // forces
  for (const c of order) {
    const prof = sc.profiles[c];
    for (const f of prof.forces) {
      const ut = st.cat.units.get(f.unit);
      const city = state.cities[f.at] ?? null;
      if (!ut || !city || f.count <= 0) continue;
      let node = city.node;
      if (moveClassOf(ut) === 'naval' && !city.port) {
        // place in the adjacent sea zone (deterministic: lowest id)
        const adj = st.map.adj[node].map((ei) => (st.map.edges[ei].a === node ? st.map.edges[ei].b : st.map.edges[ei].a)).filter((x) => !st.map.isLand[x]).sort((a, b) => a - b);
        if (!adj.length) continue;
        node = adj[0];
      }
      const lvl = f.level ?? state.countries[c].unitLevels[f.unit] ?? 1;
      const units = Array.from({ length: f.count }, () => newUnit(state, f.unit, lvl, f.readiness ?? 100));
      spawnStack(state, c, node, units, f.designation);
    }
  }
  // relations are SPARSE: a missing pair is peace (version 0); initial trust (authored + seeded
  // variation) is derived lazily by systems/diplomacy.initialTrust and only stored once it changes
  for (const a of order) for (const rel of sc.profiles[a].relations ?? []) {
    if (!seats.has(rel.with) || rel.with === a) continue;
    if (rel.status === 'war') {
      const pr = (state.relations[pairKey(a, rel.with)] ??= { war: false, since: 0, version: 0, warDeclaredBy: null });
      pr.war = true;
      pr.warDeclaredBy = a;
      state.ids.relv = (state.ids.relv ?? 0) + 1;
    } else if (rel.status !== 'peace') {
      state.grants[dirKey(a, rel.with)] = { level: rel.status, since: 0 };
      state.ids.grv = (state.ids.grv ?? 0) + 1;
    }
  }
  state.score.denominator = computeDenominator(sc);
  for (const c of order) if (state.countries[c].controller === 'ai') state.ai.schedule[c] = initSchedule(c, 0);
  state.openingPower = computeOpeningPower(state);
  updateVisibility(state);
  void toMilli;
  return state;
}
