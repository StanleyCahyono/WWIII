/**
 * ONE typed GameEvent store. Journal (private, per country), newspaper (public, per day) and
 * the human career ledger are projections/consumers of these events.
 */
import type { CountryId, NodeId } from '../data-types';
import type { EventCategory, GameEvent, GameState } from '../state';
import { nextId } from '../ids';
import { CAREER_XP } from '../rules';

export interface EmitSpec {
  kind: string;
  category: EventCategory;
  node?: NodeId | null;
  public?: { headline: string; countries: CountryId[] } | null;
  private?: Record<CountryId, { text: string; data?: Record<string, string | number | boolean | null> }>;
  interrupt?: CountryId[];
  routine?: boolean;
}

export function emit(state: GameState, spec: EmitSpec): GameEvent {
  const ev: GameEvent = {
    id: nextId(state, 'event'),
    at: state.clock.tick,
    kind: spec.kind,
    category: spec.category,
    node: spec.node ?? null,
    public: spec.public ?? null,
    private: spec.private ?? {},
    interrupt: spec.interrupt ?? [],
    routine: spec.routine ?? false,
  };
  state.events.push(ev);
  return ev;
}

/** Same private text to several recipients. */
export function toAll(countries: (CountryId | null | undefined)[], text: string, data?: Record<string, string | number | boolean | null>) {
  const out: Record<CountryId, { text: string; data?: Record<string, string | number | boolean | null> }> = {};
  for (const c of countries) if (c) out[c] = data ? { text, data } : { text };
  return out;
}

/** Award human career XP once per event (replaying a save never re-awards: keyed by event id). */
export function awardXp(state: GameState, country: CountryId, eventId: string, kind: keyof typeof CAREER_XP): void {
  if (state.meta.humanCountry !== country) return;
  if (state.career.entries.some((e) => e.event === eventId && e.kind === kind)) return;
  const xp = CAREER_XP[kind];
  state.career.entries.push({ event: eventId, kind, xp, at: state.clock.tick });
  state.career.xp += xp;
}
