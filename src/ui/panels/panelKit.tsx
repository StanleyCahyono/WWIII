/**
 * Shared building blocks for the redesigned panels: cost chips with resource icons, durations,
 * stat tiles, progress bars, icon tab bars (roving focus) and expanders. Pure presentation —
 * every action is still wired by the caller through the validated command path.
 */
import React, { useRef } from 'react';
import { Icon, RESOURCE_ICON } from '../icons';
import { RESOURCE_LABEL, resourceById } from '../data/static';
import { RESOURCES, type Resource } from '../../engine/data-types';
import { milli, num, duration } from '../format';
import './panels.css';

/** One resource amount with its icon. `amount` is in whole units. */
export function ResChip({ r, amount, sign, short, unit }: { r: Resource; amount: number; sign?: boolean; short?: boolean; unit?: string }) {
  const txt = `${sign && amount > 0 ? '+' : sign && amount < 0 ? '−' : ''}${num(Math.abs(amount))}`;
  return (
    <span className={`p-res${short ? ' short' : ''}`} title={`${RESOURCE_LABEL[r]}${short ? ' — not enough in stock' : ''}`}>
      <Icon name={RESOURCE_ICON[r]} size={15} />
      <span className="sr-only">{RESOURCE_LABEL[r]} </span>
      <span className="p-res-n">{txt}</span>
      {unit && <span className="p-res-u">{unit}</span>}
      {short && <span className="p-res-x" aria-label="not enough">!</span>}
    </span>
  );
}

/**
 * A cost vector as icon chips. `cost` is fixed-point (milli) unless `whole` is set.
 * With `stock` (milli), chips the nation cannot currently pay are marked "!".
 */
export function Cost({ cost, whole, stock, sign, max, unit, empty = '—' }: { cost: Partial<Record<string, number>> | null | undefined; whole?: boolean; stock?: Partial<Record<string, number>>; sign?: boolean; max?: number; unit?: string; empty?: string }) {
  if (!cost) return <span className="muted">{empty}</span>;
  const items = RESOURCES.map((r) => ({ r, v: whole ? cost[r] ?? 0 : milli(cost[r]) })).filter((x) => x.v);
  if (!items.length) return <span className="muted">{empty}</span>;
  const shown = max ? [...items].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, max) : items;
  return (
    <span className="p-cost">
      {shown.map(({ r, v }) => (
        <ResChip key={r} r={r} amount={v} sign={sign} unit={unit} short={!!stock && v * 1000 > (stock[r] ?? 0)} />
      ))}
      {max && items.length > shown.length && <span className="muted p-more">+{items.length - shown.length}</span>}
    </span>
  );
}

export function Duration({ min, prefix }: { min: number | null | undefined; prefix?: string }) {
  return (
    <span className="p-dur">
      <Icon name="clock" size={14} />
      {prefix}
      {duration(min)}
    </span>
  );
}

export function Progress({ value, label, tone }: { value: number; label?: string; tone?: 'ok' | 'warn' | 'bad' | 'accent' }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <span className={`p-prog${tone ? ' ' + tone : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={label}>
      <span style={{ width: `${pct * 100}%` }} />
    </span>
  );
}

export function StatTile({ icon, label, value, sub, tone, children }: { icon?: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'accent'; children?: React.ReactNode }) {
  return (
    <div className={`p-tile${tone ? ' ' + tone : ''}`}>
      {icon && <span className="p-tile-ico">{icon}</span>}
      <div className="p-tile-body">
        <h4>{label}</h4>
        <div className="p-tile-v">{value}</div>
        {sub && <div className="p-tile-sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

/** A secondary-detail expander (native details/summary: keyboard and screen-reader friendly). */
export function Expander({ summary, children, open, className, testid }: { summary: React.ReactNode; children: React.ReactNode; open?: boolean; className?: string; testid?: string }) {
  return (
    <details className={`p-exp${className ? ' ' + className : ''}`} open={open} data-testid={testid}>
      <summary>
        <Icon name="chevron-right" size={14} className="p-exp-chev" />
        {summary}
      </summary>
      <div className="p-exp-body">{children}</div>
    </details>
  );
}

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon?: React.ReactNode;
  testid?: string;
  badge?: React.ReactNode;
  title?: string;
  dim?: boolean;
}

/** Icon tab bar with roving focus (one Tab stop; ←/→/Home/End move between tabs). */
export function IconTabs<K extends string>({ tabs, value, onChange, label, compact, className }: { tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; label: string; compact?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === value);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(tabs[j].key);
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus());
  };
  return (
    <div className={`p-tabs${compact ? ' compact' : ''}${className ? ' ' + className : ''}`} role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} tabIndex={value === t.key ? 0 : -1} onClick={() => onChange(t.key)} data-testid={t.testid} title={t.title ?? t.label} className={t.dim ? 'dim' : undefined}>
          {t.icon && <span className="p-tab-ico">{t.icon}</span>}
          <span className="p-tab-l">{t.label}</span>
          {t.badge !== undefined && t.badge !== null && t.badge !== 0 && t.badge !== '' && <span className="p-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Section heading with an optional icon and right-aligned actions. */
export function SectionHead({ icon, title, children, level = 3 }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; level?: 3 | 4 }) {
  const H = level === 3 ? 'h3' : 'h4';
  return (
    <div className="p-sect-head">
      {icon && <span className="p-sect-ico">{icon}</span>}
      <H>{title}</H>
      <div className="grow" />
      {children}
    </div>
  );
}

/** Top resource outputs of a vector (milli per day), most valuable (reference price) first. */
export function topOutputs(out: Partial<Record<string, number>> | null | undefined, n = 4): { r: Resource; v: number }[] {
  if (!out) return [];
  const worth = (r: Resource, v: number) => v * (resourceById.get(r)?.referencePrice ?? 1);
  return RESOURCES.map((r) => ({ r, v: milli(out[r]) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => worth(b.r, b.v) - worth(a.r, a.v))
    .slice(0, n);
}
