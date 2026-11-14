/**
 * Developer-only decision log: a bounded ring buffer per country, kept in module memory (never in
 * the save, never in the live campaign UI). Decisions never read from it, so it cannot affect
 * determinism. The bot's own reply reasons are stored separately in its persisted memory.
 */
import type { CountryId } from '../engine/data-types';
import type { DecisionEntry } from './types';

export const LOG_CAPACITY = 64;
const logs = new Map<CountryId, DecisionEntry[]>();
let enabled = true;

export function logDecision(c: CountryId, e: DecisionEntry): void {
  if (!enabled) return;
  const l = logs.get(c) ?? logs.set(c, []).get(c)!;
  l.push(e);
  if (l.length > LOG_CAPACITY) l.splice(0, l.length - LOG_CAPACITY);
}

/** Developer test view: the last decisions of one country (oldest first). */
export function getDecisionLog(c: CountryId): readonly DecisionEntry[] {
  return logs.get(c) ?? [];
}
export function allDecisionLogs(): ReadonlyMap<CountryId, readonly DecisionEntry[]> {
  return logs;
}
export function clearDecisionLogs(): void {
  logs.clear();
}
export function setDecisionLogging(on: boolean): void {
  enabled = on;
}
