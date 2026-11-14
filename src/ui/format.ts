/** Formatting helpers (units always visible on time-sensitive numbers). */
import type { Resource } from '../engine/data-types';
import { RESOURCES } from '../engine/data-types';
import { RESOURCE_LABEL } from './data/static';

export const START_MINUTE = 360;

export function milli(v: number | undefined | null): number {
  return (v ?? 0) / 1000;
}

export function num(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Signed with explicit + / − (legible without color). */
export function signed(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 0.0005) return '±0';
  return `${v > 0 ? '+' : '−'}${num(Math.abs(v), digits)}`;
}

export function resM(v: Partial<Record<Resource, number>> | null | undefined, opts: { skipZero?: boolean } = {}): string {
  if (!v) return '—';
  const parts: string[] = [];
  for (const r of RESOURCES) {
    const x = milli(v[r]);
    if (opts.skipZero !== false && !x) continue;
    parts.push(`${num(x)} ${RESOURCE_LABEL[r].toLowerCase()}`);
  }
  return parts.length ? parts.join(', ') : 'nothing';
}

export function dayOf(tick: number): number {
  return Math.floor((tick + START_MINUTE) / 1440) + 1;
}
export function hourLabel(tick: number): string {
  const mod = (tick + START_MINUTE) % 1440;
  return `${String(Math.floor(mod / 60)).padStart(2, '0')}:${String(mod % 60).padStart(2, '0')}`;
}
export function gameTime(tick: number): string {
  return `Day ${dayOf(tick)} ${hourLabel(tick)} UTC`;
}
export function duration(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${mm ? `${mm} min` : ''}`.trim();
  return `${mm} min`;
}
export function ageLabel(min: number): string {
  if (min < 60) return `${Math.max(0, Math.round(min))} min ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}
export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}
export function wallTime(ms: number | null | undefined): string {
  if (!ms) return 'never';
  const d = new Date(ms);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function relWall(ms: number | null | undefined): string {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return wallTime(ms);
}
export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;
}
export function bytes(n: number): string {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}
