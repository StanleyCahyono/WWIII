import { describe, expect, it } from 'vitest';
import { computeOpeningPower, rawDimensions, OpeningPowerConfigError, createCampaign } from '../../src/engine';
import { newMiniGame, miniScenario } from '../fixtures/mini-world';
import { clearStacks } from '../fixtures/helpers';

describe('opening power index', () => {
  it('is persisted at creation with weights, raw dimensions, normalization constants and nearest rival', () => {
    const s = newMiniGame();
    const op = s.openingPower!;
    expect(op.weights).toEqual({ industrial: 0.25, formations: 0.25, research: 0.2, mobility: 0.2, resilience: 0.1 });
    expect(Object.keys(op.raw).sort()).toEqual(s.countryOrder);
    // no USA in the fixture → normalized against every country; the best composite is exactly 100
    expect(Math.max(...Object.values(op.composite))).toBeCloseTo(100, 6);
    expect(op.rank[0]).toBe(op.leader);
    expect(op.nearestRival).toBe(op.rank[1]);
  });

  it('reference country is normalized against the strongest OTHER country (can exceed 100)', () => {
    const s = newMiniGame();
    const op = computeOpeningPower(s, 'ARD');
    expect(op.referenceCountry).toBe('ARD');
    const others = s.countryOrder.filter((c) => c !== 'ARD');
    expect(Math.max(...others.map((c) => op.composite[c]))).toBeCloseTo(100, 6);
    expect(op.composite.ARD).toBeGreaterThan(100);
    for (const d of ['industrial', 'formations', 'research', 'mobility', 'resilience'] as const) expect(op.normalization[d]).toBe(Math.max(...others.map((c) => op.raw[c][d])));
  });

  it('removing a funded capability changes only the relevant raw score; no hidden multipliers', () => {
    const s = newMiniGame();
    const before = rawDimensions(s);
    for (const id of Object.keys(s.stacks)) if (s.stacks[id].owner === 'ARD' && s.stacks[id].units.some((u) => u.type === 'tank')) delete s.stacks[id];
    const after = rawDimensions(s);
    expect(after.ARD.formations).toBeLessThan(before.ARD.formations);
    expect(after.ARD.research).toBe(before.ARD.research);
    expect(after.ARD.mobility).toBe(before.ARD.mobility);
    expect(after.BOR).toEqual(before.BOR);
  });

  it('a zero normalization denominator is a configuration error', () => {
    const s = createCampaign({ seed: 1, humanCountry: null, scenario: miniScenario() });
    clearStacks(s);
    expect(() => computeOpeningPower(s)).toThrow(OpeningPowerConfigError);
  });
});
