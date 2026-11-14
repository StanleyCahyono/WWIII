/**
 * World 120 scoring. Province center = 1 VP; a city adds tier+1 (2..6); a capital adds 4 more.
 * Denominator = Σ VP over every playable land node, computed ONCE at creation.
 * Thresholds (rounded UP): solo 24 %, coalition 40/48/55/60 % for 2/3/4/5 members.
 * Settlement once per day change. A coalition (≥2 members) competes only as a bloc; a country
 * outside a bloc (or alone in one) competes solo. Victory when an entry meets its threshold at a
 * settlement; at the end of day 180 the highest fraction of its threshold wins. Ties: more held
 * capitals → greater current net industrial output → stable ID (lexicographically smallest
 * leading country id). The result is frozen; later settlements never award again.
 */
import type { CountryId, NodeId } from '../data-types';
import type { CampaignResult, GameState, ScoreEntry, ScoreSettlement } from '../state';
import { CAMPAIGN_DAYS, SCORING } from '../rules';
import { S } from '../scenario/registry';
import type { Scenario } from '../scenario/types';
import { getStatic } from '../scenario/registry';
import { allRates, industrialValue } from './economy';
import { emit, awardXp } from './events';
import { dayOf } from '../time';

const vpCache = new WeakMap<Scenario, Int32Array>();
/** VP of a node (memoized per scenario). */
export function nodeVP(scenario: Scenario, node: NodeId): number {
  let a = vpCache.get(scenario);
  if (!a) {
    a = new Int32Array(scenario.map.nodes.length);
    for (let i = 0; i < a.length; i++) a[i] = nodeVPRaw(scenario, i);
    vpCache.set(scenario, a);
  }
  return a[node] ?? 0;
}
function nodeVPRaw(scenario: Scenario, node: NodeId): number {
  const st = getStatic(scenario);
  const n = scenario.map.nodes[node];
  if (n.kind !== 'land' || n.outside || !n.country) return 0;
  let v = SCORING.provinceCenter;
  const ck = st.map.cityByNode.get(node);
  if (ck) {
    const c = scenario.map.cities.find((x) => x.key === ck);
    if (c) {
      const prof = scenario.profiles[c.country]?.cities.find((x) => x.city === ck);
      const tier = prof?.tier ?? c.tier;
      v += tier + SCORING.cityTierOffset;
      if (c.capital) v += SCORING.capitalBonus;
    }
  }
  return v;
}

export function computeDenominator(scenario: Scenario): number {
  let d = 0;
  for (const id of getStatic(scenario).map.playable) d += nodeVP(scenario, id);
  return d;
}

export function thresholdFor(denominator: number, members: number): number {
  const pct = members <= 1 ? SCORING.soloThreshold : SCORING.coalitionThreshold[Math.min(5, members)];
  return Math.ceil(denominator * pct - 1e-9);
}

export function countryScores(state: GameState): Record<CountryId, number> {
  const out: Record<CountryId, number> = {};
  for (const c of state.countryOrder) out[c] = 0;
  const sc = S(state).scenario;
  for (const p of state.provinces) {
    if (!p || !p.owner || p.control !== 'country') continue;
    out[p.owner] = (out[p.owner] ?? 0) + nodeVP(sc, p.node);
  }
  return out;
}

export function capitalsHeld(state: GameState): Record<CountryId, number> {
  const out: Record<CountryId, number> = {};
  for (const k of Object.keys(state.cities)) {
    const c = state.cities[k];
    if (!c.capital) continue;
    const o = state.provinces[c.node]?.owner;
    if (o) out[o] = (out[o] ?? 0) + 1;
  }
  return out;
}

export function scoreEntries(state: GameState): ScoreEntry[] {
  const scores = countryScores(state);
  const caps = capitalsHeld(state);
  const rates = allRates(state);
  const den = state.score.denominator;
  const entries: ScoreEntry[] = [];
  const inBloc = new Set<CountryId>();
  for (const id of Object.keys(state.coalitions).sort()) {
    const co = state.coalitions[id];
    if (co.dissolvedAt || co.members.length < 2) continue;
    const members = co.members.map((m) => m.country).filter((c) => state.countries[c]?.alive).sort();
    if (members.length < 2) continue;
    for (const m of members) inBloc.add(m);
    const score = members.reduce((a, m) => a + (scores[m] ?? 0), 0);
    const threshold = thresholdFor(den, members.length);
    entries.push({ id, kind: 'coalition', members, score, threshold, fraction: score / threshold, capitals: members.reduce((a, m) => a + (caps[m] ?? 0), 0), industry: members.reduce((a, m) => a + industrialValue(state, m, rates), 0) });
  }
  for (const c of state.countryOrder) {
    if (inBloc.has(c) || !state.countries[c].alive) continue;
    const threshold = thresholdFor(den, 1);
    entries.push({ id: c, kind: 'solo', members: [c], score: scores[c] ?? 0, threshold, fraction: (scores[c] ?? 0) / threshold, capitals: caps[c] ?? 0, industry: industrialValue(state, c, rates) });
  }
  return entries;
}

export function rankEntries(entries: ScoreEntry[]): ScoreEntry[] {
  const lead = (e: ScoreEntry) => [...e.members].sort()[0];
  return [...entries].sort((a, b) => b.fraction - a.fraction || b.capitals - a.capitals || b.industry - a.industry || (lead(a) < lead(b) ? -1 : lead(a) > lead(b) ? 1 : 0));
}

/** Day-change settlement. Returns the result if the campaign ended at this settlement. */
export function settle(state: GameState): CampaignResult | null {
  const day = dayOf(state.clock.tick) - 1; // the day that just ended
  if (state.score.result) return null; // frozen
  if (day <= state.score.lastSettledDay) return null; // once per day change
  state.score.lastSettledDay = day;
  const entries = rankEntries(scoreEntries(state));
  const settlement: ScoreSettlement = { day, at: state.clock.tick, scores: countryScores(state), entries };
  state.score.history.push(settlement);
  const winners = entries.filter((e) => e.score >= e.threshold);
  let result: CampaignResult | null = null;
  if (winners.length) result = { at: state.clock.tick, day, reason: 'threshold', winner: winners[0], standings: entries };
  else if (day >= CAMPAIGN_DAYS && entries.length) result = { at: state.clock.tick, day, reason: 'final_day', winner: entries[0], standings: entries };
  if (result) {
    state.score.result = result;
    const all = state.countryOrder;
    const w = result.winner;
    const ev = emit(state, {
      kind: 'campaign_end',
      category: 'system',
      public: { headline: `${w.kind === 'coalition' ? `Coalition ${state.coalitions[w.id]?.name ?? w.id}` : w.id} wins the World 120 campaign (${w.score}/${w.threshold} VP)`, countries: w.members },
      private: Object.fromEntries(all.map((c) => [c, { text: w.members.includes(c) ? 'Victory! Your side won the campaign.' : `Campaign over — winner: ${w.members.join(', ')}.`, data: { winner: w.id } }])),
      interrupt: state.meta.humanCountry ? [state.meta.humanCountry] : [],
    });
    for (const c of w.members) awardXp(state, c, ev.id, 'victory');
  }
  return result;
}
