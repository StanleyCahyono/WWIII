import { describe, expect, it } from 'vitest';
import { advance, submitCommand, serialize, deserialize, stateHash, scoreBreakdown, newspaper } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { clearStacks, place, war, must } from '../fixtures/helpers';
import { rankEntries, thresholdFor } from '../../src/engine/systems/score';
import { FINAL_TICK } from '../../src/engine/time';
import type { ScoreEntry } from '../../src/engine/state';

describe('scoring & victory (A11)', () => {
  it('denominator computed once; thresholds rounded up; weights visible', () => {
    const s = newMiniGame();
    expect(s.score.denominator).toBe(96);
    expect(thresholdFor(96, 1)).toBe(24); // 23.04 → 24
    expect(thresholdFor(96, 2)).toBe(39); // 38.4 → 39
    expect(thresholdFor(96, 5)).toBe(58); // 57.6 → 58
    const b = scoreBreakdown(s, 'ARD');
    expect(b.mine).toBe(19);
    expect(b.weights.capital).toBe(4);
    expect(b.territories.reduce((a, t) => a + t.vp, 0)).toBe(19);
  });

  it('solo victory crossing the threshold just before day change is recorded once; reload never re-awards (review mode)', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    war(s, 'ARD', 'DUN');
    advance(s, 1065 - 15); // 23:30
    place(s, 'ARD', N.dunCapital, ['inf']);
    advance(s, 15); // capture at 23:45
    expect(s.provinces[N.dunCapital]!.owner).toBe('ARD');
    expect(s.score.result).toBeNull();
    advance(s, 60);
    const res = s.score.result!;
    expect(res).toBeTruthy();
    expect(res.reason).toBe('threshold');
    expect(res.winner.id).toBe('ARD');
    expect(res.day).toBe(1);
    expect(res.at).toBe(1080);
    expect(s.clock.tick).toBe(1080); // frozen at settlement
    const xp = s.career.xp;
    const loaded = deserialize(serialize(s));
    advance(loaded, 5 * 1440);
    expect(loaded.clock.tick).toBe(1080);
    expect(loaded.events.filter((e) => e.kind === 'campaign_end').length).toBe(1);
    expect(loaded.career.xp).toBe(xp);
    expect(stateHash(loaded)).toBe(stateHash(s));
    const r = submitCommand(loaded, { type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('game_over');
    expect(newspaper(loaded, 2)!.items.some((i) => /wins the World 120 campaign/.test(i.headline))).toBe(true);
  });

  it('a threshold crossed and lost before the day change does not win', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    war(s, 'ARD', 'DUN');
    advance(s, 600);
    const a = place(s, 'ARD', N.dunCapital, ['inf']);
    advance(s, 15);
    expect(s.provinces[N.dunCapital]!.owner).toBe('ARD');
    delete s.stacks[a.id];
    place(s, 'DUN', N.dunCapital, ['inf']);
    advance(s, 15);
    expect(s.provinces[N.dunCapital]!.owner).toBe('DUN');
    advance(s, 600);
    expect(s.score.result).toBeNull();
    expect(s.score.history.length).toBe(1);
  });

  it('coalition victory at 40 % for two members, settled as a bloc', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    must(s, { type: 'createCoalition', country: 'ARD', name: 'Bloc' });
    const co = Object.values(s.coalitions)[0];
    must(s, { type: 'applyCoalition', country: 'DUN', coalition: co.id });
    must(s, { type: 'respondApplication', country: 'ARD', coalition: co.id, applicant: 'DUN', accept: true });
    war(s, 'DUN', 'BOR');
    advance(s, 1000);
    place(s, 'DUN', N.borCapital, ['inf']);
    advance(s, 15);
    expect(s.score.result).toBeNull();
    advance(s, 120);
    const res = s.score.result!;
    expect(res.winner.kind).toBe('coalition');
    expect(res.winner.members).toEqual(['ARD', 'DUN']);
    expect(res.winner.threshold).toBe(39);
    expect(res.winner.score).toBeGreaterThanOrEqual(39);
    // members don't also appear as solo entries
    expect(res.standings.filter((e) => e.members.includes('ARD')).length).toBe(1);
    const again = deserialize(serialize(s));
    advance(again, 3 * 1440);
    expect(again.events.filter((e) => e.kind === 'campaign_end').length).toBe(1);
  });

  it('final settlement at the end of day 180 picks the highest fraction', () => {
    const s = newMiniGame({ human: null });
    clearStacks(s);
    s.clock.tick = FINAL_TICK - 15;
    s.clock.lastStep = FINAL_TICK - 15;
    s.score.lastSettledDay = 179;
    advance(s, 30);
    const res = s.score.result!;
    expect(res.reason).toBe('final_day');
    expect(res.day).toBe(180);
    expect(['ARD', 'BOR']).toContain(res.winner.id); // tied at 19 VP → capitals → industry
  });

  it('tie-break order: fraction → capitals → industrial output → stable id', () => {
    const e = (id: string, fraction: number, capitals: number, industry: number): ScoreEntry => ({ id, kind: 'solo', members: [id], score: 0, threshold: 1, fraction, capitals, industry });
    expect(rankEntries([e('B', 0.5, 1, 10), e('A', 0.5, 1, 10)])[0].id).toBe('A');
    expect(rankEntries([e('A', 0.5, 1, 10), e('B', 0.5, 1, 11)])[0].id).toBe('B');
    expect(rankEntries([e('A', 0.5, 1, 99), e('B', 0.5, 2, 1)])[0].id).toBe('B');
    expect(rankEntries([e('A', 0.5, 9, 99), e('B', 0.6, 0, 0)])[0].id).toBe('B');
  });

  it('score history is recorded per day', () => {
    const s = newMiniGame({ human: null });
    advance(s, 3 * 1440);
    expect(s.score.history.map((h) => h.day)).toEqual([1, 2, 3]);
  });
});
