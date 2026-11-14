import { describe, expect, it } from 'vitest';
import { advance, BasicController, IdleController, createCampaign, listCampaignModes, serialize, deserialize, submitCommand } from '../../src/engine';
import { newMiniGame, miniScenario } from '../fixtures/mini-world';
import type { CountryController, PlannerContext } from '../../src/engine/ai-host/types';
import { must } from '../fixtures/helpers';

describe('AI host', () => {
  it('A02: a campaign with zero human orders reaches a documented terminal condition (BasicController bots)', () => {
    const s = newMiniGame({ human: 'ESK', seed: 12 });
    let days = 0;
    while (!s.score.result && days < 90) {
      advance(s, 1440, { fallback: BasicController });
      days++;
    }
    const res = s.score.result!;
    expect(res).toBeTruthy();
    expect(['threshold', 'final_day']).toContain(res.reason);
    const kinds = new Set(s.events.map((e) => e.kind));
    for (const k of ['war_declared', 'job_completed', 'research_concluded', 'offer_accepted']) expect(kinds.has(k)).toBe(true);
    expect(kinds.has('city_captured') || kinds.has('province_captured')).toBe(true);
    // several bots mobilized, invested and negotiated
    const active = s.countryOrder.filter((c) => c !== 'ESK' && (s.countries[c].stats.accepted.mobilize ?? 0) > 0 && (s.countries[c].stats.accepted.build ?? 0) > 0);
    expect(active.length).toBeGreaterThanOrEqual(3);
    expect(s.countries.ESK.stats.accepted).toEqual({}); // the human issued nothing
  });

  it('controllers see only their CountryView, get scheduled reviews, wake on offers, and keep memory in the save', () => {
    const s = newMiniGame({ human: 'ARD' });
    const log: { c: string; reviews: string[]; wake: string[] }[] = [];
    const ctl: CountryController = {
      decide(view, ctx: PlannerContext) {
        expect((view as unknown as Record<string, unknown>).stacks).toBeDefined();
        expect((view as unknown as Record<string, unknown>).countries).toBeUndefined();
        log.push({ c: view.viewer, reviews: ctx.reviews, wake: ctx.wake });
        const mem = (ctx.memory as { n: number } | null) ?? { n: 0 };
        ctx.setMemory({ n: mem.n + 1 });
        return [];
      },
    };
    advance(s, 30, { fallback: ctl });
    must(s, { type: 'proposeOffer', country: 'ARD', to: 'DUN', give: [{ kind: 'status', level: 'right_of_way' }], receive: [] });
    advance(s, 15, { fallback: ctl });
    const dun = log.filter((x) => x.c === 'DUN');
    expect(dun.some((x) => x.wake.some((w) => w.startsWith('offer:')))).toBe(true);
    advance(s, 24 * 60, { fallback: ctl });
    const kinds = new Set(log.filter((x) => x.c === 'BOR').flatMap((x) => x.reviews));
    expect([...kinds].sort()).toEqual(['diplomatic', 'economic', 'operational', 'strategic']);
    expect(log.some((x) => x.c === 'ARD')).toBe(false); // human seat never driven
    const saved = deserialize(serialize(s));
    expect((saved.ai.memory.BOR as { n: number }).n).toBeGreaterThan(5);
  });

  it('a throwing controller cannot break the simulation', () => {
    const s = newMiniGame({ human: null });
    const bad: CountryController = { decide: () => { throw new Error('boom'); } };
    advance(s, 6 * 60, { fallback: bad });
    expect(s.clock.tick).toBe(360);
    expect(Object.values(s.countries).some((c) => (c.stats.rejected.controller_error ?? 0) > 0)).toBe(true);
  });

  it('W01/W02 (fixture): unique capitals, one human, N−1 AI, a legal opening action each, a single campaign mode', () => {
    for (const human of ['ARD', 'DUN', null] as const) {
      const s = createCampaign({ seed: 1, humanCountry: human, scenario: miniScenario() });
      const caps = Object.values(s.cities).filter((c) => c.capital);
      expect(new Set(caps.map((c) => s.provinces[c.node]!.owner)).size).toBe(6);
      const humans = s.countryOrder.filter((c) => s.countries[c].controller === 'human');
      expect(humans.length).toBe(human ? 1 : 0);
      expect(s.meta.humanRun).toBe(human ? 'active' : 'observer');
      for (const c of s.countryOrder) {
        const r = submitCommand(s, { type: 'startResearch', country: c, tech: 'ind_automation' });
        expect(r.ok).toBe(true);
      }
    }
    expect(listCampaignModes().length).toBe(1);
    expect(() => createCampaign({ seed: 1, humanCountry: 'XXX', scenario: miniScenario() })).toThrow(/not a playable seat/);
    expect(IdleController.decide({} as never, {} as never)).toEqual([]);
  });
});
