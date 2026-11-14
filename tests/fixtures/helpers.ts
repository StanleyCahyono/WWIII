/** Test-only helpers for manipulating fixture states. */
import type { GameState, Stack } from '../../src/engine/state';
import { newUnit, spawnStack } from '../../src/engine/systems/production';
import { declareWarInternal, setGrant } from '../../src/engine/systems/diplomacy';
import { RESOURCES, type Resource } from '../../src/engine/data-types';
import { ledgerSum } from '../../src/engine/systems/ledger';
import { submitCommand } from '../../src/engine/commands/index';
import type { Command } from '../../src/engine/commands/types';
import { updateVisibility } from '../../src/engine/systems/visibility';

export function place(state: GameState, owner: string, node: number, types: string[], name?: string, readiness = 100): Stack {
  const units = types.map((t) => newUnit(state, t, state.countries[owner].unitLevels[t] ?? 1, readiness));
  const s = spawnStack(state, owner, node, units, name);
  s.stationarySince = state.clock.tick;
  return s;
}

/** Remove every stack (clean battlefield for focused tests). */
export function clearStacks(state: GameState, owner?: string): void {
  for (const id of Object.keys(state.stacks)) if (!owner || state.stacks[id].owner === owner) delete state.stacks[id];
}

export function war(state: GameState, a: string, b: string): void {
  declareWarInternal(state, a, b, 'test');
}
export function grant(state: GameState, from: string, to: string, level: 'right_of_way' | 'shared_intel' | 'peace'): void {
  setGrant(state, from, to, level);
}

export function setStock(state: GameState, c: string, whole: Partial<Record<Resource, number>>): void {
  // adjust via ledger-neutral rebasing of `initial` so reconciliation stays valid
  const cs = state.countries[c];
  for (const r of RESOURCES) if (whole[r] !== undefined) {
    const target = Math.round((whole[r] as number) * 1000);
    const delta = target - cs.stock[r];
    cs.stock[r] = target;
    cs.ledger.initial[r] += delta;
  }
}

export function reconciled(state: GameState, c: string): boolean {
  const cs = state.countries[c];
  const sum = ledgerSum(cs);
  return RESOURCES.every((r) => cs.ledger.initial[r] + sum[r] === cs.stock[r]);
}

export function must(state: GameState, cmd: Command) {
  const r = submitCommand(state, cmd);
  if (!r.ok) throw new Error(`command ${cmd.type} failed: ${r.code} ${r.reason}`);
  return r;
}

export function refreshVision(state: GameState): void {
  updateVisibility(state);
}

export function stacksOf(state: GameState, owner: string): Stack[] {
  return Object.values(state.stacks).filter((s) => s.owner === owner).sort((a, b) => (a.id < b.id ? -1 : 1));
}
export function totalHp(stacks: Stack[]): number {
  return stacks.reduce((a, s) => a + s.units.reduce((b, u) => b + u.hp, 0), 0);
}
