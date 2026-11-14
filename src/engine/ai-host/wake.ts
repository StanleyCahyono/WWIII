/**
 * AI wake-ups: tags appended to an AI seat's saved schedule (`state.ai.schedule[c].wake`), which
 * makes the scheduler serve that seat at the next AI phase. Pure state edit (saved, deterministic).
 * Kept dependency-free so systems (e.g. diplomacy messages) can wake seats without import cycles.
 */
import type { CountryId } from '../data-types';
import type { GameState } from '../state';

export const MAX_WAKES = 20;

export function wakeAi(state: GameState, c: CountryId, tag: string): void {
  const sch = state.ai.schedule[c];
  if (!sch || state.countries[c]?.controller !== 'ai') return;
  if (!sch.wake.includes(tag)) sch.wake.push(tag);
  if (sch.wake.length > MAX_WAKES) sch.wake.splice(0, sch.wake.length - MAX_WAKES);
}

/** Message intents that ask the recipient to act (answered within the hour, not at the next review). */
export const WAKING_INTENTS: ReadonlySet<string> = new Set(['coordinate', 'request_operation']);
