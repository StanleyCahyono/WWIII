/**
 * UI-model helpers for the human seat (and debugging). All are viewer-scoped: they only expose
 * what `viewer` may know (own private data; public data for others).
 */
import type { CountryId, NodeId, Resource } from '../data-types';
import type { GameState, LedgerCategory } from '../state';
import { S } from '../scenario/registry';
import { RESOURCES } from '../data-types';
import { allRates, cityOutput, provinceOutput, resourceSummary, shortageBreakdown } from '../systems/economy';
import { ledgerSum } from '../systems/ledger';
import { techStatus } from '../systems/research';
import { forceSummary } from '../systems/readiness';
import { capitalsHeld, countryScores, nodeVP, rankEntries, scoreEntries, thresholdFor } from '../systems/score';
import { bookView } from '../systems/market';
import { getCountryView, journalFor } from './country-view';
import { dayOf, formatGameTime } from '../time';
import { addInto, zero, type ResM } from '../fixed';
import { SCORING } from '../rules';
import { moraleTarget } from '../systems/government';

export function ledgerModel(state: GameState, c: CountryId) {
  const cs = state.countries[c];
  return {
    initial: { ...cs.ledger.initial },
    totals: JSON.parse(JSON.stringify(cs.ledger.totals)) as Partial<Record<LedgerCategory, ResM>>,
    days: JSON.parse(JSON.stringify(cs.ledger.days)),
    sum: ledgerSum(cs),
    stock: { ...cs.stock },
    escrow: { ...cs.escrow },
    unpaid: { ...cs.ledger.unpaid },
    reconciled: RESOURCES.every((r) => cs.ledger.initial[r] + ledgerSum(cs)[r] === cs.stock[r]),
  };
}

export function forecastModel(state: GameState, c: CountryId) {
  return { resources: resourceSummary(state, c), shortageBreakdown: (r: Resource) => shortageBreakdown(state, c, r) };
}

export function scoreBreakdown(state: GameState, viewer: CountryId) {
  const sc = S(state).scenario;
  const scores = countryScores(state);
  const territories = state.provinces
    .filter((p) => p && p.owner === viewer)
    .map((p) => {
      const node = p!.node;
      const ck = S(state).map.cityByNode.get(node);
      return { node, name: sc.map.nodes[node].name, city: ck ? state.cities[ck]?.name ?? null : null, vp: nodeVP(sc, node) };
    })
    .sort((a, b) => b.vp - a.vp || a.node - b.node);
  const entries = rankEntries(scoreEntries(state));
  const day = dayOf(state.clock.tick);
  return {
    weights: { provinceCenter: SCORING.provinceCenter, cityTier: 'tier + 1 (2..6)', capital: SCORING.capitalBonus },
    denominator: state.score.denominator,
    thresholds: { solo: thresholdFor(state.score.denominator, 1), 2: thresholdFor(state.score.denominator, 2), 3: thresholdFor(state.score.denominator, 3), 4: thresholdFor(state.score.denominator, 4), 5: thresholdFor(state.score.denominator, 5) },
    mine: scores[viewer] ?? 0,
    myEntry: entries.find((e) => e.members.includes(viewer)) ?? null,
    standings: entries,
    capitals: capitalsHeld(state),
    territories,
    nextSettlementTick: day * 1440 - 360,
    nextSettlementLabel: formatGameTime(day * 1440 - 360, state.meta.startDate),
    history: state.score.history.map((h) => ({ day: h.day, mine: h.scores[viewer] ?? 0, leader: h.entries[0]?.id ?? null })),
    result: state.score.result,
  };
}

export function researchTree(state: GameState, c: CountryId) {
  const st = S(state);
  return [...st.cat.techs.values()]
    .sort((a, b) => (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : a.tier - b.tier || (a.id < b.id ? -1 : 1)))
    .map((t) => ({ id: t.id, name: t.name, branch: t.branch, tier: t.tier, ...techStatus(state, c, t.id), lineage: state.countries[c].techs[t.id]?.lineage ?? null, unlocks: t.effects }));
}

export interface CityRow {
  key: string;
  name: string;
  node: NodeId;
  status: string;
  tier: number;
  vp: number;
  population: number;
  morale: number;
  targetMorale: number;
  netValue: number;
  output: ResM;
  buildings: number;
  jobs: number;
  canMobilize: boolean;
  revoltRisk: boolean;
}
export function cityList(state: GameState, c: CountryId): CityRow[] {
  const sc = S(state).scenario;
  const prices = S(state).cat.prices;
  return Object.values(state.cities)
    .filter((ci) => state.provinces[ci.node]?.owner === c)
    .map((ci) => {
      const p = state.provinces[ci.node]!;
      const out = cityOutput(state, ci);
      let v = 0;
      for (const r of RESOURCES) v += (out[r] / 1000) * (prices[r] ?? 0);
      return { key: ci.key, name: ci.name, node: ci.node, status: p.status, tier: ci.tier, vp: nodeVP(sc, ci.node), population: ci.population, morale: ci.morale, targetMorale: moraleTarget(state, p, ci).target, netValue: Math.round(v), output: out, buildings: ci.buildings.length, jobs: state.countries[c].jobs.filter((j) => j.city === ci.key).length, canMobilize: p.status !== 'occupied', revoltRisk: ci.morale < 33 };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function provinceInspector(state: GameState, viewer: CountryId, node: NodeId) {
  const sc = S(state).scenario;
  const n = sc.map.nodes[node];
  const p = state.provinces[node];
  const ck = S(state).map.cityByNode.get(node);
  const city = ck ? state.cities[ck] : null;
  const own = p?.owner === viewer;
  const base = { node, name: n.name, kind: n.kind, terrain: n.terrain, coastal: n.coastal, deposit: n.deposit, owner: p?.owner ?? null, homeland: p?.homeland ?? null, control: p?.control ?? 'sea', status: p?.status ?? null, vp: nodeVP(sc, node), outside: !!n.outside, territory: n.territory ?? null, city: city ? { key: city.key, name: city.name, tier: city.tier, capital: city.capital, port: city.port } : null };
  if (!own || !p) return { ...base, private: null };
  const mt = moraleTarget(state, p, city);
  return { ...base, private: { morale: city ? city.morale : p.morale, targetMorale: mt.target, factors: mt.factors, population: city ? city.population : p.population, buildings: city ? city.buildings : p.buildings, output: city ? cityOutput(state, city) : provinceOutput(state, p), condition: city?.condition ?? null, rally: city?.rally ?? null, jobs: state.countries[viewer].jobs.filter((j) => j.node === node) } };
}

export function diplomacyRows(state: GameState, viewer: CountryId) {
  return getCountryView(state, viewer).relations;
}

export function coalitionList(state: GameState, viewer: CountryId) {
  return getCountryView(state, viewer).coalitions;
}

export function marketView(state: GameState, viewer: CountryId, r: Resource) {
  return { book: bookView(state, r), mine: Object.values(state.market.orders).filter((o) => o.country === viewer && o.resource === r), fills: state.market.fills.filter((f) => f.resource === r && (f.buyer === viewer || f.seller === viewer)) };
}

export function journal(state: GameState, viewer: CountryId, opts: { limit?: number; category?: string } = {}) {
  const all = journalFor(state, viewer, opts.limit ?? 200, state.events.length);
  return opts.category ? all.filter((e) => e.category === opts.category) : all;
}

/** Public newspaper for one game day (never future days). Public events + human/AI articles + nation index. */
export function newspaper(state: GameState, day: number) {
  const today = dayOf(state.clock.tick);
  if (day > today || day < 1) return null;
  const items = state.events.filter((e) => e.public && dayOf(e.at) === day).map((e) => ({ id: e.id, at: e.at, headline: e.public!.headline, countries: e.public!.countries, node: e.node }));
  const articles = state.articles.filter((a) => a.day === day).map((a) => ({ id: a.id, at: a.at, headline: a.headline, body: a.body, author: a.anonymous ? null : a.author }));
  const settle = state.score.history.find((h) => h.day === day) ?? state.score.history[state.score.history.length - 1];
  const scores = settle ? settle.scores : countryScores(state);
  const index = Object.keys(scores).sort((a, b) => scores[b] - scores[a] || (a < b ? -1 : 1)).map((c, i) => ({ rank: i + 1, country: c, vp: scores[c] }));
  return { day, items, articles, index };
}

export function inbox(state: GameState, viewer: CountryId) {
  const v = getCountryView(state, viewer);
  return { offers: v.offers.filter((o) => o.to === viewer && o.status === 'pending'), sent: v.offers.filter((o) => o.from === viewer), threads: v.messages };
}

export function forceModel(state: GameState, c: CountryId) {
  return forceSummary(state, c);
}

export function nationalTotals(state: GameState, c: CountryId) {
  const r = allRates(state)[c];
  const v = zero();
  addInto(v, r.net);
  return r;
}
