/**
 * Scheduled-event queue. Ordering within a step is (at, priority class, seq) — never array
 * iteration order of other structures. Documented classes (lower first within the same minute):
 */
import type { CountryId } from '../data-types';
import type { GameState, ScheduledEvent } from '../state';
import { nextSeq } from '../ids';

export const PRIORITY: Record<ScheduledEvent['kind'], number> = {
  offer_effect: 0,
  offer_expire: 1,
  coalition_depart: 2,
  research_done: 3,
  job_done: 4,
  missile_arrive: 5,
  agent_report: 6,
  report_expire: 7,
};

function cmp(a: ScheduledEvent, b: ScheduledEvent): number {
  return a.at - b.at || a.cls - b.cls || a.seq - b.seq;
}

export function schedule(state: GameState, at: number, kind: ScheduledEvent['kind'], ref: string, country: CountryId | null = null): ScheduledEvent {
  const ev: ScheduledEvent = { seq: nextSeq(state, 'sched'), at, cls: PRIORITY[kind], kind, ref, country };
  const q = state.queue;
  let lo = 0, hi = q.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(q[mid], ev) <= 0) lo = mid + 1;
    else hi = mid;
  }
  q.splice(lo, 0, ev);
  return ev;
}

/** Remove and return the next due event (at <= t), or null. */
export function popDue(state: GameState, t: number): ScheduledEvent | null {
  const q = state.queue;
  if (!q.length || q[0].at > t) return null;
  return q.shift() as ScheduledEvent;
}

export function unschedule(state: GameState, kind: ScheduledEvent['kind'], ref: string): void {
  state.queue = state.queue.filter((e) => !(e.kind === kind && e.ref === ref));
}
