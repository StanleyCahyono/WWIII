import { describe, expect, it } from 'vitest';
import { advance, BasicController, cloneState, stateHash, stepOnce, serialize, deserialize } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { DAY_MIN } from '../../src/engine/rules';

const host = { fallback: BasicController };

describe('determinism', () => {
  it('advancing one day as 1×1440, 96×15 and 1440×1 yields identical state hashes', () => {
    const a = newMiniGame({ seed: 7, human: null });
    const b = cloneState(a);
    const c = cloneState(a);
    advance(a, DAY_MIN, host);
    for (let i = 0; i < 96; i++) advance(b, 15, host);
    for (let i = 0; i < 1440; i++) advance(c, 1, host);
    expect(a.clock.tick).toBe(DAY_MIN);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).toBe(stateHash(c));
  });

  it('odd chunk sizes and stepOnce agree over three days with AI activity', () => {
    const a = newMiniGame({ seed: 11, human: null });
    const b = cloneState(a);
    advance(a, 3 * DAY_MIN, host);
    let left = 3 * DAY_MIN;
    const chunks = [7, 13, 61, 240, 1, 999];
    let i = 0;
    while (left > 0) {
      const m = Math.min(left, chunks[i++ % chunks.length]);
      advance(b, m, host);
      left -= m;
    }
    expect(stateHash(a)).toBe(stateHash(b));
    const c = newMiniGame({ seed: 11, human: null });
    for (let k = 0; k < (3 * DAY_MIN) / 15; k++) stepOnce(c, host);
    expect(stateHash(c)).toBe(stateHash(a));
  });

  it('same seed reproduces, different seed diverges', () => {
    const a = newMiniGame({ seed: 5, human: null });
    const b = newMiniGame({ seed: 5, human: null });
    const c = newMiniGame({ seed: 6, human: null });
    advance(a, 2 * DAY_MIN, host);
    advance(b, 2 * DAY_MIN, host);
    advance(c, 2 * DAY_MIN, host);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).not.toBe(stateHash(c));
  });

  it('save/reload mid-run continues identically to an uninterrupted run', () => {
    const a = newMiniGame({ seed: 9, human: null });
    advance(a, DAY_MIN + 37, host);
    const b = deserialize(serialize(a));
    advance(a, 2 * DAY_MIN, host);
    advance(b, 2 * DAY_MIN, host);
    expect(stateHash(b)).toBe(stateHash(a));
  });
});
