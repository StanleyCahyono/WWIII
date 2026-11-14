import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { advance, cloneState, deserialize, getCountryView, serialize, stateHash } from '../../src/engine';
import type { CountryController } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { place, refreshVision } from '../fixtures/helpers';
import { UtilityController, createAiControllers, createSimHost, getDecisionLog, clearDecisionLogs, wantsCall } from '../../src/ai';
import { decideOnce, recording } from './helpers';

const AI_DIR = join(__dirname, '../../src/ai');

describe('AI contract: filtered input only', () => {
  it('the planner source never imports raw state, scheduler internals or engine systems', () => {
    for (const f of readdirSync(AI_DIR).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(AI_DIR, f), 'utf8');
      const imports = [...src.matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));
      for (const i of imports) {
        if (!i.from.startsWith('../engine')) continue;
        // only type imports from the engine, plus the static data contract constants
        if (!i.typeOnly) expect(i.from, `${f} imports runtime engine module ${i.from}`).toBe('../engine/data-types');
        expect(i.from).not.toMatch(/systems\/|scheduler|sim$|commands\/index/);
      }
      expect(src).not.toMatch(/import[^;]*\bGameState\b/);
      expect(src).not.toMatch(/:\s*GameState\b/);
    }
  });

  it('decide() receives only (CountryView, PlannerContext) — no omniscient state keys reach the planner', () => {
    const s = newMiniGame({ human: null });
    const seen: string[][] = [];
    const spy: CountryController = {
      decide(view, ctx) {
        seen.push(Object.keys(view).sort());
        expect(Object.keys(ctx).sort()).toEqual(['budget', 'catalog', 'difficulty', 'map', 'memory', 'now', 'preview', 'reviews', 'rng', 'route', 'setMemory', 'wake']);
        const v = view as unknown as Record<string, unknown>;
        for (const k of ['countries', 'engagements', 'queue', 'trust', 'grants', 'events', 'seed', 'rng', 'ai']) expect(v[k]).toBeUndefined();
        // foreign stacks appear only as contacts; own stacks only in `stacks`
        expect(view.stacks.every((x) => x.owner === view.viewer)).toBe(true);
        expect(view.cities.every((c) => view.owners[c.node] === view.viewer)).toBe(true);
        return UtilityController.decide(view, ctx);
      },
    };
    advance(s, 6 * 60, { fallback: spy });
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen.map((k) => k.join(','))).size).toBe(1);
  });

  it('cross-system check 6: an unobserved stack of B (position/type) cannot change A\'s decisions', () => {
    const base = newMiniGame({ human: null, seed: 5 });
    advance(base, 2 * 1440, { fallback: UtilityController });
    // CEL places a hidden submarine group far from ARD's sensors in one copy only
    const a = cloneState(base);
    const b = cloneState(base);
    place(b, 'CEL', 36, ['sub', 'sub'], 'Hidden Group');
    refreshVision(a);
    refreshVision(b);
    const va = getCountryView(a, 'ARD', { journalLimit: 15, journalScan: 400 });
    const vb = getCountryView(b, 'ARD', { journalLimit: 15, journalScan: 400 });
    expect(JSON.stringify(vb.contacts)).toEqual(JSON.stringify(va.contacts));
    // move an existing (unobserved) CEL stack and change its unit type in the second copy too
    const celStack = Object.values(b.stacks).find((x) => x.owner === 'CEL' && x.moveClass === 'ground');
    if (celStack) celStack.units[0].type = 'tank';
    refreshVision(b);
    for (const reviews of [['strategic', 'economic', 'diplomatic', 'operational'], ['operational']] as const) {
      const ra = decideOnce(a, 'ARD', [...reviews], { submit: false });
      const rb = decideOnce(b, 'ARD', [...reviews], { submit: false });
      expect(rb.cmds).toEqual(ra.cmds);
      expect(b.ai.memory.ARD).toEqual(a.ai.memory.ARD);
    }
  });
});

describe('AI host integration', () => {
  it('exports what the sim worker injects (createSimHost / registry / controller)', () => {
    expect(typeof createSimHost().fallback?.decide).toBe('function');
    expect(createAiControllers('hard')('USA')).toBeTruthy();
    expect(typeof UtilityController.decide).toBe('function');
  });

  it('determinism: same seed ⇒ identical state; memory persists through save/reload mid-campaign', () => {
    const run = () => {
      const s = newMiniGame({ human: 'ARD', seed: 9 });
      advance(s, 3 * 1440, { fallback: UtilityController });
      return s;
    };
    const s1 = run();
    const s2 = run();
    expect(stateHash(s1)).toBe(stateHash(s2));
    const r = deserialize(serialize(s1));
    advance(s1, 2 * 1440, { fallback: UtilityController });
    advance(r, 2 * 1440, { fallback: UtilityController });
    expect(stateHash(r)).toBe(stateHash(s1));
    expect((s1.ai.memory.BOR as { v: number }).v).toBe(1);
  });

  it('decision log is a bounded developer-only ring buffer and never enters the save', () => {
    clearDecisionLogs();
    const s = newMiniGame({ human: null, seed: 3 });
    const { ctl } = recording();
    advance(s, 4 * 1440, { fallback: ctl });
    const log = getDecisionLog('BOR');
    expect(log.length).toBeGreaterThan(0);
    expect(log.length).toBeLessThanOrEqual(64);
    expect(serialize(s)).not.toContain('"layer"');
  });

  it('wants(): declines only calls that would be no-ops (proposed scheduler pre-check is outcome-equivalent)', () => {
    const s = newMiniGame({ human: null, seed: 11 });
    advance(s, 2 * 1440, { fallback: UtilityController });
    let checked = 0;
    for (const c of s.countryOrder) {
      const mem = s.ai.memory[c];
      expect(wantsCall({ reviews: ['economic'], wake: [], memory: mem })).toBe(true);
      expect(wantsCall({ reviews: ['operational'], wake: ['offer:e1'], memory: mem })).toBe(true);
      if (wantsCall({ reviews: ['operational'], wake: [], memory: mem })) continue;
      checked++;
      const before = JSON.stringify(s.ai.memory[c]);
      const { cmds } = decideOnce(s, c, ['operational'], { submit: false });
      expect(cmds).toEqual([]);
      expect(JSON.stringify(s.ai.memory[c])).toBe(before);
    }
    expect(checked).toBeGreaterThan(0);
    expect(wantsCall({ reviews: ['operational'], wake: [], memory: null })).toBe(true);
  });
});
