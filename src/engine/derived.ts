/**
 * Per-state memo of derived (recomputable) data, e.g. economy rates, public view slices, force
 * summaries. Never serialized. Invalidated at every simulation step boundary and (by key class,
 * see `invalidateDerived`) after every successful command, so cached values always reflect the
 * current state.
 */
import type { GameState } from './state';

const caches = new WeakMap<GameState, Map<string, unknown>>();

export function derived<T>(state: GameState, key: string, compute: () => T): T {
  let m = caches.get(state);
  if (!m) {
    m = new Map();
    caches.set(state, m);
  }
  if (m.has(key)) return m.get(key) as T;
  const v = compute();
  m.set(key, v);
  return v;
}

/** The memoized value of `key` if present (never computes). */
export function peekDerived<T>(state: GameState, key: string): T | undefined {
  return caches.get(state)?.get(key) as T | undefined;
}

/**
 * Key classes (by prefix):
 *  - `~…` step-scoped: only the simulation step can change their inputs (economy rates, public
 *    ownership slice, territory index); never cleared by commands.
 *  - `@…` forces-scoped: depend on stacks (set, rosters, positions, orders, air state) — force
 *    summaries, lift, observed nodes, stacks-by-owner. Cleared by commands that may touch forces.
 *  - anything else: cleared after every successful command.
 *
 * Scopes: 'all' (step boundaries, structural edits) clears everything; 'command' keeps `~` keys;
 * 'national' (commands that provably never touch stacks, territory, relations or coalition
 * membership — see FORCE_NEUTRAL in commands/index.ts) keeps `~` and `@` keys.
 */
export function invalidateDerived(state: GameState, scope: 'all' | 'command' | 'national' = 'all'): void {
  if (scope === 'all') {
    caches.delete(state);
    return;
  }
  const m = caches.get(state);
  if (!m) return;
  for (const k of [...m.keys()]) {
    const c = k.charCodeAt(0);
    if (c === 126 /* ~ */ || (scope === 'national' && c === 64) /* @ */) continue;
    m.delete(k);
  }
}

const versioned = new WeakMap<GameState, Map<string, { key: string; deps: readonly object[]; v: unknown }>>();
/**
 * Memo that survives step boundaries and commands (never cleared by `invalidateDerived`): valid
 * while `key` — built from SAVED version counters (`state.ids.ownv`, `econv`, …) — and the identity
 * of the `deps` objects are unchanged. Only for values that are pure functions of data covered by
 * those counters (see the cache-invalidation contract in docs/ENGINE.md). `stillValid` is an
 * optional cheap check for inputs no counter covers.
 */
export function memoByVersion<T>(state: GameState, name: string, key: string, deps: readonly object[], compute: () => T, stillValid?: (v: T) => boolean): T {
  let m = versioned.get(state);
  if (!m) {
    m = new Map();
    versioned.set(state, m);
  }
  const e = m.get(name);
  if (e && e.key === key && e.deps.length === deps.length && e.deps.every((d, i) => d === deps[i]) && (!stillValid || stillValid(e.v as T))) return e.v as T;
  const v = compute();
  m.set(name, { key, deps, v });
  return v;
}
