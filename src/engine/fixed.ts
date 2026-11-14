/**
 * Fixed-point resource helpers. State stores every resource quantity as an integer number of
 * milli-units (×1000). Data files use whole units; convert with `toMilli` / `vecFromWhole`.
 */
import { RESOURCES, type Resource, type ResVec } from './data-types';

export const MILLI = 1000;
/** Full resource vector in milli-units (all seven keys present, integers). */
export type ResM = Record<Resource, number>;

export function toMilli(whole: number): number {
  return Math.round(whole * MILLI);
}
export function fromMilli(m: number): number {
  return m / MILLI;
}
export function zero(): ResM {
  return { supplies: 0, components: 0, electronics: 0, fuel: 0, rare: 0, manpower: 0, money: 0 };
}
export function vecFromWhole(v: ResVec | undefined | null): ResM {
  const out = zero();
  if (!v) return out;
  for (const r of RESOURCES) if (v[r]) out[r] = toMilli(v[r] as number);
  return out;
}
export function copy(v: ResM): ResM {
  return { ...v };
}
export function add(a: ResM, b: ResM): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = a[r] + b[r];
  return o;
}
export function addInto(a: ResM, b: ResM): void {
  for (const r of RESOURCES) a[r] += b[r];
}
export function subInto(a: ResM, b: ResM): void {
  for (const r of RESOURCES) a[r] -= b[r];
}
export function sub(a: ResM, b: ResM): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = a[r] - b[r];
  return o;
}
export function neg(a: ResM): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = -a[r];
  return o;
}
/** Multiply by a rational num/den, flooring toward zero for each component. */
export function scale(a: ResM, num: number, den = 1): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = Math.trunc((a[r] * num) / den);
  return o;
}
/** Multiply by a float factor, flooring toward zero (deterministic IEEE math). */
export function mul(a: ResM, f: number): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = Math.trunc(a[r] * f);
  return o;
}
export function geq(a: ResM, b: ResM): boolean {
  for (const r of RESOURCES) if (a[r] < b[r]) return false;
  return true;
}
export function isZero(a: ResM): boolean {
  for (const r of RESOURCES) if (a[r] !== 0) return false;
  return true;
}
/** Positive shortfall of `have` relative to `need`, in milli-units (only short keys). */
export function shortfall(have: ResM, need: ResM): Partial<ResM> {
  const o: Partial<ResM> = {};
  for (const r of RESOURCES) if (need[r] > have[r]) o[r] = need[r] - have[r];
  return o;
}
export function hasShortfall(have: ResM, need: ResM): boolean {
  return !geq(have, need);
}
/** Human-readable "12.5 money, 3 fuel" from a partial milli vector. */
export function fmtVec(v: Partial<ResM>): string {
  const parts: string[] = [];
  for (const r of RESOURCES) {
    const x = v[r];
    if (x) parts.push(`${fmtNum(x)} ${r}`);
  }
  return parts.join(', ') || 'nothing';
}
export function fmtNum(m: number): string {
  const w = m / MILLI;
  return Number.isInteger(w) ? String(w) : w.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
export function sumVecs(list: ResM[]): ResM {
  const o = zero();
  for (const v of list) addInto(o, v);
  return o;
}
export function isValidVec(v: unknown): v is ResM {
  if (!v || typeof v !== 'object') return false;
  for (const r of RESOURCES) {
    const x = (v as Record<string, unknown>)[r];
    if (typeof x !== 'number' || !Number.isFinite(x) || !Number.isInteger(x)) return false;
  }
  return true;
}
/** Value of a vector at reference prices (whole money). */
export function valueAt(v: ResM, prices: Partial<Record<Resource, number>>): number {
  let s = 0;
  for (const r of RESOURCES) s += (v[r] / MILLI) * (prices[r] ?? 0);
  return s;
}
