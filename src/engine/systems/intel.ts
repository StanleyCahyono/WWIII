/**
 * Intelligence: purchased reports and agents.
 *  - A report is a FROZEN, time-stamped snapshot pinned to observed coordinates with an expiry.
 *    Moving the real stack never moves the report; expired reports remain as dated history.
 *  - Agents (information / sabotage / corruption) act every AGENT_REPORT_INTERVAL_MIN with a seeded
 *    success draw (stream "agent:<id>:<n>"). Failure = agent captured (target informed).
 */
import type { CityKey, CountryId, NodeId } from '../data-types';
import type { GameState, IntelReport } from '../state';
import { AGENT_REPORT_INTERVAL_MIN, AGENT_SUCCESS, CORRUPTION_DRAIN_MONEY, INTEL_REPORT_TTL_MIN, SABOTAGE_CONDITION_DAMAGE } from '../rules';
import { S } from '../scenario/registry';
import { nextId } from '../ids';
import { distKm } from './mapindex';
import { cmpId, stackLL , sortedStacks } from './world';
import { streamRng, hash32 } from '../rng';
import { schedule } from './queue';
import { emit, toAll } from './events';
import { chargePartial } from './ledger';
import { bumpEconomy } from './economy';
import { toMilli, zero } from '../fixed';

export function snapshotReport(state: GameState, country: CountryId, node: NodeId, source: IntelReport['source'], confidence = 1): IntelReport {
  const m = S(state).map;
  const t = state.clock.tick;
  const stacks: IntelReport['stacks'] = [];
  for (const s of sortedStacks(state)) {
    if (s.owner === country || s.aboard) continue;
    const ll = stackLL(state, s);
    const atNode = s.pos.kind === 'node' && s.pos.node === node;
    if (!atNode && distKm(ll[0], ll[1], m.lon[node], m.lat[node]) > 60) continue;
    const counts = new Map<string, number>();
    for (const u of s.units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    stacks.push({
      ref: 'x' + hash32(`${country}:${s.id}:${t}`).toString(36),
      owner: s.owner,
      lonlat: [Math.round(ll[0] * 10000) / 10000, Math.round(ll[1] * 10000) / 10000],
      node: s.pos.kind === 'node' ? s.pos.node : null,
      units: [...counts.entries()].sort().map(([type, count]) => ({ type, count })),
      destination: s.order && s.order.kind === 'move' ? s.order.dest : null,
    });
  }
  const ck = m.cityByNode.get(node);
  const city = ck ? state.cities[ck] : null;
  const r: IntelReport = {
    id: nextId(state, 'report'),
    country,
    source,
    createdAt: t,
    observedAt: t,
    expiresAt: t + INTEL_REPORT_TTL_MIN,
    targetNode: node,
    stacks,
    city: city && state.provinces[node]?.owner !== country ? { key: city.key, morale: city.morale, buildings: city.buildings.map((b) => ({ ...b })), condition: city.condition } : null,
    confidence,
  };
  state.reports[r.id] = r;
  return r;
}

export function assignAgentInternal(state: GameState, country: CountryId, city: CityKey, mission: 'information' | 'sabotage' | 'corruption'): string {
  const id = nextId(state, 'agent');
  const at = state.clock.tick + AGENT_REPORT_INTERVAL_MIN;
  state.agents[id] = { id, country, targetCity: city, mission, assignedAt: state.clock.tick, nextReportAt: at, reports: 0, active: true };
  schedule(state, at, 'agent_report', id, country);
  return id;
}

export function agentAct(state: GameState, id: string): void {
  const a = state.agents[id];
  if (!a || !a.active) return;
  const city = state.cities[a.targetCity];
  const owner = city ? state.provinces[city.node]?.owner ?? null : null;
  if (!city || !owner || owner === a.country) {
    a.active = false;
    emit(state, { kind: 'agent_recalled', category: 'intel', private: toAll([a.country], `Agent ${a.id} recalled: target no longer foreign-held.`) });
    return;
  }
  a.reports++;
  const r = streamRng(state.seed, 'agent', `${id}:${a.reports}`);
  const ok = r.chance(AGENT_SUCCESS[a.mission]);
  if (!ok) {
    a.active = false;
    emit(state, { kind: 'agent_captured', category: 'intel', node: city.node, private: { ...toAll([a.country], `Agent ${a.id} was captured in ${city.name}.`), ...toAll([owner], `A foreign agent (${a.country}) was captured in ${city.name}.`) } });
    return;
  }
  if (a.mission === 'information') {
    const rep = snapshotReport(state, a.country, city.node, 'agent', 0.9);
    emit(state, { kind: 'intel_report', category: 'intel', node: city.node, private: toAll([a.country], `Agent report from ${city.name} (${rep.stacks.length} formation(s) observed).`, { report: rep.id }) });
  } else if (a.mission === 'sabotage') {
    bumpEconomy(state);
    const b = [...city.buildings].sort((x, y) => (x.type < y.type ? -1 : 1))[0];
    if (b) b.condition = Math.max(0, b.condition - SABOTAGE_CONDITION_DAMAGE);
    else city.condition = Math.max(0, city.condition - SABOTAGE_CONDITION_DAMAGE);
    emit(state, { kind: 'sabotage', category: 'intel', node: city.node, private: { ...toAll([a.country], `Sabotage succeeded in ${city.name}.`), ...toAll([owner], `Sabotage damaged facilities in ${city.name}.`) } });
  } else {
    const v = zero();
    v.money = toMilli(CORRUPTION_DRAIN_MONEY);
    chargePartial(state, owner, 'corruption', v);
    emit(state, { kind: 'corruption', category: 'intel', node: city.node, private: { ...toAll([a.country], `Corruption operation drained funds in ${city.name}.`), ...toAll([owner], `Corruption losses reported in ${city.name}.`) } });
  }
  a.nextReportAt = state.clock.tick + AGENT_REPORT_INTERVAL_MIN;
  schedule(state, a.nextReportAt, 'agent_report', id, a.country);
}
