/**
 * Real World 120 smoke tests (A02 + 119-bot activity). One shared observer campaign (no human
 * seat, zero human orders) is simulated once with the utility planner and inspected by several
 * checks. Skips when the real map/catalog/profiles are unavailable.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { advance } from '../../src/engine';
import type { GameState } from '../../src/engine';
import { aiPerf } from '../../src/ai';
import { newReal, realWorld, recording, type Recorded } from './helpers';

const DAYS = Number(process.env.AI_SMOKE_DAYS ?? 20);
let s: GameState | null = null;
let log: Recorded[] = [];
let msPerDay = 0;
let plannerMsPerDay = 0;

beforeAll(async () => {
  const sc = await realWorld();
  if (!sc) return;
  s = newReal(sc, 2026, null);
  const rec = recording();
  log = rec.log;
  const p0 = aiPerf.ms;
  const t0 = performance.now();
  for (let d = 0; d < DAYS && !s.score.result; d++) advance(s, 1440, { fallback: rec.ctl });
  msPerDay = (performance.now() - t0) / DAYS;
  plannerMsPerDay = (aiPerf.ms - p0) / DAYS;
  // eslint-disable-next-line no-console
  console.log(`[ai-smoke] ${DAYS} days, ${s.countryOrder.length} seats: ${msPerDay.toFixed(0)} ms/day total, planner ${plannerMsPerDay.toFixed(0)} ms/day, commands ${log.length}`);
}, 1_800_000);

const count = (st: GameState, kinds: string[]) => st.events.filter((e) => kinds.includes(e.kind)).length;

describe('A02 smoke: real World 120, zero human orders', () => {
  it('several bots mobilize, invest, negotiate, fight and change control', () => {
    if (!s) return;
    const st = s;
    const bots = st.countryOrder;
    const by = (type: string) => bots.filter((c) => (st.countries[c].stats.accepted[type] ?? 0) > 0).length;
    const tally = {
      mobilize: by('mobilize'),
      build: by('build'),
      research: by('startResearch'),
      negotiate: by('proposeOffer') + by('respondOffer'),
      wars: count(st, ['war_declared']),
      battles: count(st, ['battle_report']),
      control: count(st, ['city_captured', 'province_captured', 'uprising_success']),
      agreements: count(st, ['offer_accepted', 'agreement_effective']),
    };
    // eslint-disable-next-line no-console
    console.log('[ai-smoke] tally', JSON.stringify(tally), 'result', st.score.result ? `${st.score.result.reason} ${st.score.result.winner.id} day ${st.score.result.day}` : 'running');
    expect(tally.mobilize).toBeGreaterThan(20);
    expect(tally.build).toBeGreaterThan(20);
    expect(tally.research).toBeGreaterThan(20);
    expect(tally.negotiate).toBeGreaterThan(20);
    expect(tally.agreements).toBeGreaterThan(0);
    expect(tally.wars).toBeGreaterThan(0);
    expect(tally.battles).toBeGreaterThan(0);
    expect(tally.control).toBeGreaterThan(0);
    expect(st.countries[st.countryOrder[0]].stats).toBeTruthy();
    expect(st.meta.humanCountry).toBeNull();
  });

  it('activity: every bot (including distant states) issues useful decisions; no starvation', () => {
    if (!s) return;
    const st = s;
    const k = Math.max(3, Math.floor(DAYS / 2));
    const low = st.countryOrder.filter((c) => st.countries[c].alive && Object.values(st.countries[c].stats.accepted).reduce((a, b) => a + b, 0) < k);
    expect(low).toEqual([]);
    const types = st.countryOrder.map((c) => Object.keys(st.countries[c].stats.accepted).length);
    expect(Math.min(...types)).toBeGreaterThanOrEqual(3);
    // scheduler served everyone
    for (const c of st.countryOrder) if (st.countries[c].alive) expect(st.ai.schedule[c]?.runs ?? 0).toBeGreaterThan(DAYS * 4);
  });

  it('all bot commands pass the shared validator (invalid = 0) and there are no repeated no-op orders', () => {
    if (!s) return;
    const st = s;
    const rejected: Record<string, Record<string, number>> = {};
    for (const c of st.countryOrder) if (Object.keys(st.countries[c].stats.rejected).length) rejected[c] = st.countries[c].stats.rejected;
    expect(rejected).toEqual({});
    const noops = log.filter((x) => x.cmd.type === 'move' && x.priorDest === (x.cmd as { dest: number }).dest);
    expect(noops.length).toBe(0);
  });

  it('small states sought access/coalition/trade before any war they declared', () => {
    if (!s) return;
    const byCountry = new Map<string, Recorded[]>();
    for (const x of log) (byCountry.get(x.country) ?? byCountry.set(x.country, []).get(x.country)!).push(x);
    const op = s.openingPower!;
    const n = op.rank.length;
    for (const [c, list] of byCountry) {
      const w = list.findIndex((x) => x.cmd.type === 'declareWar');
      if (w < 0) continue;
      const small = op.rank.indexOf(c) >= n * 0.6;
      if (!small) continue;
      const seek = list.findIndex((x) => x.cmd.type === 'applyCoalition' || (x.cmd.type === 'proposeOffer' && x.cmd.give.concat(x.cmd.receive).some((t) => t.kind !== 'peace')));
      expect(seek, `${c} sought diplomacy first`).toBeGreaterThanOrEqual(0);
      expect(seek).toBeLessThan(w);
    }
  });
});
