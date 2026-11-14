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
// Hot vector primitives are written out per resource (monomorphic property access; same results
// as a loop over RESOURCES — the resource set is fixed by the data contract).
export function add(a: ResM, b: ResM): ResM {
  return { supplies: a.supplies + b.supplies, components: a.components + b.components, electronics: a.electronics + b.electronics, fuel: a.fuel + b.fuel, rare: a.rare + b.rare, manpower: a.manpower + b.manpower, money: a.money + b.money };
}
export function addInto(a: ResM, b: ResM): void {
  a.supplies += b.supplies;
  a.components += b.components;
  a.electronics += b.electronics;
  a.fuel += b.fuel;
  a.rare += b.rare;
  a.manpower += b.manpower;
  a.money += b.money;
}
export function subInto(a: ResM, b: ResM): void {
  a.supplies -= b.supplies;
  a.components -= b.components;
  a.electronics -= b.electronics;
  a.fuel -= b.fuel;
  a.rare -= b.rare;
  a.manpower -= b.manpower;
  a.money -= b.money;
}
export function sub(a: ResM, b: ResM): ResM {
  return { supplies: a.supplies - b.supplies, components: a.components - b.components, electronics: a.electronics - b.electronics, fuel: a.fuel - b.fuel, rare: a.rare - b.rare, manpower: a.manpower - b.manpower, money: a.money - b.money };
}
export function neg(a: ResM): ResM {
  return { supplies: -a.supplies, components: -a.components, electronics: -a.electronics, fuel: -a.fuel, rare: -a.rare, manpower: -a.manpower, money: -a.money };
}
/** Multiply by a rational num/den, flooring toward zero for each component. */
export function scale(a: ResM, num: number, den = 1): ResM {
  const o = zero();
  for (const r of RESOURCES) o[r] = Math.trunc((a[r] * num) / den);
  return o;
}
/** Multiply by a float factor, flooring toward zero (deterministic IEEE math). */
export function mul(a: ResM, f: number): ResM {
  return { supplies: Math.trunc(a.supplies * f), components: Math.trunc(a.components * f), electronics: Math.trunc(a.electronics * f), fuel: Math.trunc(a.fuel * f), rare: Math.trunc(a.rare * f), manpower: Math.trunc(a.manpower * f), money: Math.trunc(a.money * f) };
}
export function geq(a: ResM, b: ResM): boolean {
  return !(a.supplies < b.supplies) && !(a.components < b.components) && !(a.electronics < b.electronics) && !(a.fuel < b.fuel) && !(a.rare < b.rare) && !(a.manpower < b.manpower) && !(a.money < b.money);
}
export function isZero(a: ResM): boolean {
  return a.supplies === 0 && a.components === 0 && a.electronics === 0 && a.fuel === 0 && a.rare === 0 && a.manpower === 0 && a.money === 0;
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
