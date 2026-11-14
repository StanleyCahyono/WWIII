/** Stable string IDs from per-kind counters stored in state.ids. */
import type { GameState } from './state';

export const ID_PREFIX = {
  unit: 'u',
  stack: 's',
  engagement: 'g',
  offer: 'of',
  coalition: 'co',
  event: 'e',
  report: 'r',
  market: 'm',
  fill: 'f',
  launch: 'l',
  agent: 'a',
  message: 'msg',
  article: 'n',
  job: 'j',
  sched: 'q',
} as const;
export type IdKind = keyof typeof ID_PREFIX;

export function nextId(state: GameState, kind: IdKind): string {
  const n = (state.ids[kind] ?? 0) + 1;
  state.ids[kind] = n;
  return `${ID_PREFIX[kind]}${n}`;
}
export function nextSeq(state: GameState, kind: IdKind): number {
  const n = (state.ids[kind] ?? 0) + 1;
  state.ids[kind] = n;
  return n;
}
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
export function dirKey(from: string, to: string): string {
  return `${from}>${to}`;
}
