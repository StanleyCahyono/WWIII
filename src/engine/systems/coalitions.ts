/**
 * Coalitions: name, description, emblem, leader, members (max COALITION_MAX_MEMBERS), applications,
 * timed departure notice (COALITION_DEPARTURE_NOTICE_MIN; still a member until effectiveAt),
 * historical membership. Members share transit and vision; they cannot be at war with each other.
 * A bot remains an independent controller inside the human's coalition.
 */
import { invalidateDerived } from '../derived';
import type { CountryId } from '../data-types';
import type { Coalition, GameState } from '../state';
import { COALITION_DEPARTURE_NOTICE_MIN, COALITION_MAX_MEMBERS } from '../rules';
import { nextId } from '../ids';
import { schedule } from './queue';
import { emit, toAll } from './events';
import { atWar, coalitionOf } from './world';
import { postMessage } from './diplomacy';

export function createCoalitionInternal(state: GameState, leader: CountryId, name: string, description: string, emblem: string): Coalition {
  const id = nextId(state, 'coalition');
  const now = state.clock.tick;
  const co: Coalition = {
    id,
    name: name.slice(0, 60),
    description: description.slice(0, 400),
    emblem: emblem.slice(0, 40),
    leader,
    members: [{ country: leader, joinedAt: now }],
    applications: [],
    departures: [],
    history: [{ country: leader, joinedAt: now, leftAt: null, reason: 'founder' }],
    createdAt: now,
    dissolvedAt: null,
  };
  state.coalitions[id] = co;
  invalidateDerived(state, 'command');
  state.ids.cov = (state.ids.cov ?? 0) + 1;
  emit(state, { kind: 'coalition_created', category: 'diplomacy', public: { headline: `${leader} founds the coalition "${co.name}"`, countries: [leader] }, private: toAll([leader], `Coalition "${co.name}" created.`, { coalition: id }) });
  return co;
}

export function canJoin(state: GameState, co: Coalition, c: CountryId): string | null {
  if (co.dissolvedAt) return 'Coalition has been dissolved.';
  if (coalitionOf(state, c)) return `${c} is already in a coalition.`;
  if (co.members.length >= COALITION_MAX_MEMBERS) return `Coalition is full (${COALITION_MAX_MEMBERS} members).`;
  for (const m of co.members) if (atWar(state, m.country, c)) return `${c} is at war with member ${m.country}.`;
  return null;
}

export function joinCoalitionInternal(state: GameState, coalitionId: string, c: CountryId, reason: string): boolean {
  const co = state.coalitions[coalitionId];
  if (!co || canJoin(state, co, c)) return false;
  co.members.push({ country: c, joinedAt: state.clock.tick });
  invalidateDerived(state, 'command');
  state.ids.cov = (state.ids.cov ?? 0) + 1;
  co.history.push({ country: c, joinedAt: state.clock.tick, leftAt: null, reason });
  co.applications = co.applications.filter((a) => a.country !== c);
  postMessage(state, c, `co:${co.id}`, null, `${c} joined the coalition.`, 'join', reason);
  emit(state, { kind: 'coalition_joined', category: 'diplomacy', public: { headline: `${c} joins the coalition "${co.name}"`, countries: co.members.map((m) => m.country) }, private: toAll(co.members.map((m) => m.country), `${c} joined "${co.name}" (${reason}).`, { coalition: co.id }) });
  return true;
}

export function announceDeparture(state: GameState, coalitionId: string, c: CountryId): number {
  const co = state.coalitions[coalitionId];
  const at = state.clock.tick + COALITION_DEPARTURE_NOTICE_MIN;
  co.departures.push({ country: c, announcedAt: state.clock.tick, effectiveAt: at });
  schedule(state, at, 'coalition_depart', `${coalitionId}:${c}`, c);
  emit(state, { kind: 'coalition_departure_announced', category: 'diplomacy', private: toAll(co.members.map((m) => m.country), `${c} announced its departure from "${co.name}" (effective at tick ${at}).`, { coalition: co.id, effectiveAt: at }) });
  return at;
}

export function completeDeparture(state: GameState, ref: string): void {
  const [coalitionId, c] = ref.split(':');
  const co = state.coalitions[coalitionId];
  if (!co) return;
  const dep = co.departures.find((d) => d.country === c);
  if (!dep) return;
  co.departures = co.departures.filter((d) => d.country !== c);
  removeMember(state, co, c, 'departure');
}

export function removeMember(state: GameState, co: Coalition, c: CountryId, reason: string): void {
  if (!co.members.some((m) => m.country === c)) return;
  const before = co.members.map((m) => m.country);
  co.members = co.members.filter((m) => m.country !== c);
  invalidateDerived(state, 'command');
  state.ids.cov = (state.ids.cov ?? 0) + 1;
  const h = [...co.history].reverse().find((x) => x.country === c && x.leftAt === null);
  if (h) h.leftAt = state.clock.tick;
  if (co.leader === c && co.members.length) co.leader = [...co.members].sort((a, b) => a.joinedAt - b.joinedAt || (a.country < b.country ? -1 : 1))[0].country;
  if (!co.members.length) co.dissolvedAt = state.clock.tick;
  emit(state, { kind: 'coalition_left', category: 'diplomacy', public: { headline: `${c} leaves the coalition "${co.name}"`, countries: before }, private: toAll(before, `${c} left "${co.name}" (${reason}).${co.dissolvedAt ? ' The coalition dissolved.' : ''}`, { coalition: co.id }) });
}
