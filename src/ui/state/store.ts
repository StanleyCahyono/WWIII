/** Minimal external store + React hook (no dependencies). */
import { useSyncExternalStore, useRef } from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  patch(p: Partial<T>): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      subs.forEach((f) => f());
    },
    patch(p) {
      this.set({ ...value, ...p });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T, S = T>(store: Store<T>, select?: (v: T) => S, eq: (a: S, b: S) => boolean = Object.is): S {
  const last = useRef<{ v: S } | null>(null);
  return useSyncExternalStore(
    store.subscribe,
    () => {
      const s = select ? select(store.get()) : (store.get() as unknown as S);
      if (last.current && eq(last.current.v, s)) return last.current.v;
      last.current = { v: s };
      return s;
    },
    () => (select ? select(store.get()) : (store.get() as unknown as S)),
  );
}

export function shallowEq<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
