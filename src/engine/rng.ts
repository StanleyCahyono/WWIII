/**
 * Seeded, stateless-per-event random streams.
 *
 * Every random draw is derived from hash(seed, stream, key) → a small PRNG (sfc32). Adding an
 * unrelated event never perturbs another event's draws because keys are stable IDs, not a
 * shared sequence position. `state.rng.counter` exists for the rare "general" stream draws and
 * is saved with the state.
 */

export function hash32(str: string, h = 0x811c9dc5): number {
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix32(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return (a ^ (a >>> 16)) >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  chance(p: number): boolean;
}

export function sfc32(a: number, b: number, c: number, d: number): Rng {
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + (hi - lo) * next(),
    chance: (p) => next() < p,
  };
}

/** A deterministic stream for (seed, stream, key). */
export function streamRng(seed: number, stream: string, key: string | number): Rng {
  const s = hash32(`${stream}\u0000${key}`, mix32(seed >>> 0) || 0x9e3779b9);
  return sfc32(mix32(s ^ 0xa5a5a5a5), mix32(s + 0x6a09e667), mix32(s ^ 0x3c6ef372), mix32(seed ^ s));
}

/** Combine values into a 32-bit hash (stable). */
export function hashParts(...parts: (string | number)[]): number {
  return hash32(parts.join('\u0001'));
}

/** 64-bit-ish FNV over a string returned as 16 hex chars (two independent 32-bit lanes). */
export function hash64Hex(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (mix32(h2) >>> 0).toString(16).padStart(8, '0');
}
