import type { GameState, Stack } from '../state';
import type { Validation, Command } from './types';
import { fmtVec, type ResM } from '../fixed';

export interface Handler<C extends Command = Command, P = unknown> {
  validate(state: GameState, cmd: C): Validation<P>;
  apply(state: GameState, cmd: C, preview: P): unknown;
}

export function fail(code: string, reason: string, details?: unknown): { ok: false; code: string; reason: string; details?: unknown } {
  return { ok: false, code, reason, details };
}
export function ok<P>(preview: P, warnings?: string[]): { ok: true; preview: P; warnings?: string[] } {
  return warnings && warnings.length ? { ok: true, preview, warnings } : { ok: true, preview };
}

export function ownStack(state: GameState, country: string, id: string): Stack | { ok: false; code: string; reason: string } {
  const s = state.stacks[id];
  if (!s) return fail('unknown_stack', 'That formation no longer exists.');
  if (s.owner !== country) return fail('not_owner', 'You do not command that formation.');
  return s;
}
export function isFail(x: unknown): x is { ok: false; code: string; reason: string } {
  return !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;
}
export function shortReason(short: Partial<ResM>): string {
  return `Insufficient resources — short by ${fmtVec(short)}.`;
}
