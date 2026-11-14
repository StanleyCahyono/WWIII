/**
 * Per-state memo of derived (recomputable) data, e.g. economy rates, public view slices, force
 * summaries. Never serialized. Invalidated at every simulation step boundary and after every
 * successful command, so cached values always reflect the current state.
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

/**
 * Full invalidation (step boundaries, ownership/relation changes) clears everything.
 * `scope: 'command'` keeps step-scoped keys (prefixed '~', e.g. economy rates and public
 * ownership slices) that ordinary commands cannot change.
 */
export function invalidateDerived(state: GameState, scope: 'all' | 'command' = 'all'): void {
  if (scope === 'all') {
    caches.delete(state);
    return;
  }
  const m = caches.get(state);
  if (!m) return;
  for (const k of [...m.keys()]) if (!k.startsWith('~')) m.delete(k);
}
