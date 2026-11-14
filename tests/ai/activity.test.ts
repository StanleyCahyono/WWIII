import { describe, expect, it } from 'vitest';
import { advance } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { recording } from './helpers';

const USEFUL = (accepted: Record<string, number>) => Object.values(accepted).reduce((a, b) => a + b, 0);

describe('AI activity (SPEC: count useful decisions; no starvation; no repeated no-ops)', () => {
  it('mini world: every bot issues useful decisions of several types; zero invalid commands; no repeated no-op orders', () => {
    const s = newMiniGame({ human: 'ARD', seed: 17 });
    const { ctl, log } = recording();
    for (let d = 0; d < 8 && !s.score.result; d++) advance(s, 1440, { fallback: ctl });
    for (const c of s.countryOrder) {
      if (c === 'ARD') continue;
      const st = s.countries[c].stats;
      expect(USEFUL(st.accepted), `${c} useful decisions`).toBeGreaterThanOrEqual(6);
      expect(Object.keys(st.accepted).length, `${c} decision types`).toBeGreaterThanOrEqual(3);
      expect(USEFUL(st.rejected), `${c} invalid commands ${JSON.stringify(st.rejected)}`).toBe(0);
    }
    // repeated no-op: a move to the destination the stack is already heading to
    const noops = log.filter((x) => x.cmd.type === 'move' && x.priorDest === (x.cmd as { dest: number }).dest);
    expect(noops).toEqual([]);
    // identical command re-issued within one hour by the same country (spam)
    const seen = new Map<string, number>();
    let spam = 0;
    for (const x of log) {
      const k = `${x.country}:${JSON.stringify({ ...x.cmd, reason: undefined })}`;
      const prev = seen.get(k);
      if (prev !== undefined && x.tick - prev < 60 && x.cmd.type !== 'marketOrder') spam++;
      seen.set(k, x.tick);
    }
    expect(spam).toBe(0);
  });
});
