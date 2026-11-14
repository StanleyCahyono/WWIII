import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { getHost } from '../sim/host';
import { useStore } from '../state/store';
import type { Frame, QueryName } from '../sim/protocol';
import { symbolSvg } from '../map/symbols';
import { countryName, unitById } from '../data/static';
import { buildSidc } from '../../data/catalog/sidc';
import { userMovedFocus } from '../state/ui';

export function useFrame(): Frame | null {
  return useStore(getHost().store, (s) => s.frame);
}

/** Re-runs a worker query when the game tick (or deps) change; throttled while the clock runs. */
export function useQuery<T>(name: QueryName | null, args: unknown[] = [], opts: { throttleMs?: number; enabled?: boolean } = {}): { data: T | null; error: string | null; refresh: () => void; loading: boolean } {
  const host = getHost();
  const tick = useStore(host.store, (s) => s.frame?.view.tick ?? -1);
  const rev = useStore(host.store, (s) => s.frame?.seq ?? 0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const last = useRef(0);
  const key = JSON.stringify([name, args]);
  const enabled = opts.enabled !== false && !!name;
  const throttle = opts.throttleMs ?? 700;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useCallback(() => {
    if (!enabled || !name) return;
    last.current = Date.now();
    setLoading(true);
    host
      .query<T>(name, ...args)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  useEffect(() => {
    run();
  }, [run, nonce]);
  useEffect(() => {
    if (!enabled) return;
    const since = Date.now() - last.current;
    if (since >= throttle) run();
    else {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(run, throttle - since);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, rev]);
  return { data, error, refresh: () => setNonce((n) => n + 1), loading };
}

export function Sym({ sidc, size = 22, label, mono }: { sidc: string; size?: number; label?: string; mono?: boolean }) {
  return <span className="sym" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: symbolSvg(sidc, size, mono ? '#d8dde3' : false) }} />;
}

/**
 * A unit that is ordered but not yet fielded (queued or in production), drawn with the APP-6
 * "planned" status (dashed frame) and named as planned — distinguishable without colour.
 */
export function PlannedUnitSym({ unit, size = 18 }: { unit: string; size?: number }) {
  const ut = unitById.get(unit);
  if (!ut?.symbol) return null;
  return <Sym sidc={buildSidc(ut.symbol, { affiliation: 'friend', status: 'planned' })} size={size} label={`Planned unit (not yet fielded): ${ut.name}`} />;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Original, simplified national badge derived from the country code (not a reproduction of any
 * real flag): one of five band layouts in two hues plus a light field, deterministic per code.
 */
export function badgeColors(id: string): { a: string; b: string; c: string; layout: number } {
  const h = hashId(id);
  const h1 = h % 360;
  const h2 = (h1 + 110 + ((h >>> 9) % 120)) % 360;
  const s1 = 38 + ((h >>> 5) % 20);
  const s2 = 34 + ((h >>> 13) % 22);
  return {
    a: `hsl(${h1} ${s1}% ${32 + ((h >>> 3) % 12)}%)`,
    b: `hsl(${h2} ${s2}% ${38 + ((h >>> 17) % 12)}%)`,
    c: (h >>> 21) % 3 === 0 ? 'hsl(45 30% 88%)' : 'hsl(210 20% 94%)',
    layout: (h >>> 24) % 5,
  };
}

export function NationBadge({ id, size = 36, title }: { id: string | null | undefined; size?: number; title?: string }) {
  const w = size;
  const hgt = Math.round(size * 0.68);
  if (!id) return <svg className="nation-badge" width={w} height={hgt} viewBox="0 0 30 20" aria-hidden><rect width="30" height="20" rx="3" fill="#555" /></svg>;
  const { a, b, c, layout } = badgeColors(id);
  const bands: React.ReactNode =
    layout === 0 ? (
      <>
        <rect width="10" height="20" fill={a} />
        <rect x="10" width="10" height="20" fill={c} />
        <rect x="20" width="10" height="20" fill={b} />
      </>
    ) : layout === 1 ? (
      <>
        <rect width="30" height="7" fill={a} />
        <rect y="7" width="30" height="6" fill={c} />
        <rect y="13" width="30" height="7" fill={b} />
      </>
    ) : layout === 2 ? (
      <>
        <rect width="30" height="20" fill={a} />
        <path d="M0 8h9V0h5v8h16v5H14v7H9v-7H0z" fill={c} />
        <path d="M0 9.4h10.4V0h2.2v9.4H30v2.2H12.6V20h-2.2v-8.4H0z" fill={b} />
      </>
    ) : layout === 3 ? (
      <>
        <rect width="30" height="20" fill={a} />
        <path d="M0 20 30 0v20z" fill={b} />
        <path d="M0 20 30 0v3L4.5 20z" fill={c} />
      </>
    ) : (
      <>
        <rect width="30" height="20" fill={b} />
        <rect width="30" height="10" fill={a} />
        <path d="M0 0l11 10L0 20z" fill={c} />
        <circle cx="4.2" cy="10" r="2" fill={a} />
      </>
    );
  return (
    <svg className="nation-badge" width={w} height={hgt} viewBox="0 0 30 20" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <clipPath id={`nb-${id}`}>
          <rect width="30" height="20" rx="3" />
        </clipPath>
      </defs>
      <g clipPath={`url(#nb-${id})`}>
        {bands}
        <rect width="30" height="10" fill="rgba(255,255,255,0.10)" />
      </g>
      <rect x="0.5" y="0.5" width="29" height="19" rx="2.6" fill="none" stroke="rgba(0,0,0,0.45)" />
    </svg>
  );
}

/** Compact badge + country code (lists, tables, chips). */
export function FlagChip({ id, size = 26 }: { id: string | null | undefined; size?: number }) {
  if (!id)
    return (
      <span className="chip-flag" style={{ width: size, height: Math.round(size * 0.68) }} aria-hidden>
        <NationBadge id={null} size={size} />
        <span className="code">—</span>
      </span>
    );
  return (
    <span className="chip-flag" style={{ width: size, height: Math.round(size * 0.68) }} aria-hidden title={countryName(id)}>
      <NationBadge id={id} size={size} />
      <span className="code">{id}</span>
    </span>
  );
}

/** A button that always explains why it is disabled. */
export function ActionButton({ disabledReason, children, className = 'btn', onClick, title, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { disabledReason?: string | null }) {
  const disabled = !!disabledReason;
  return (
    <span className="col" style={{ gap: 2, display: 'inline-flex' }}>
      <button
        type="button"
        className={className}
        aria-disabled={disabled || undefined}
        title={disabled ? disabledReason! : title}
        onClick={(e) => {
          if (disabled) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        {...rest}
      >
        {children}
      </button>
      {disabled && <span className="disabled-reason">{disabledReason}</span>}
    </span>
  );
}

let modalDepth = 0;
export function Modal({ title, onClose, children, footer, wide, labelledBy, initialFocus }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; labelledBy?: string; initialFocus?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useRef(`m${Math.random().toString(36).slice(2, 8)}`);
  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    modalDepth++;
    const el = ref.current;
    const target = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    target?.focus();
    return () => {
      modalDepth--;
      const o = opener.current;
      const before = document.activeElement;
      // restore focus to the opener unless the user already moved focus elsewhere
      if (o) setTimeout(() => { if (document.contains(o) && !userMovedFocus(before)) o.focus(); }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      const f = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!f || !f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id.current} ref={ref} onKeyDown={onKey}>
        <header>
          <h2 id={labelledBy ?? id.current} style={{ fontSize: 16 }}>
            {title}
          </h2>
          <button type="button" className="btn ghost icon close-x" aria-label="Close dialog" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
export function isModalOpen() {
  return modalDepth > 0;
}

/** Re-export of the shared icon set (src/ui/icons.tsx); kept here for existing imports. */
export { Icon } from '../icons';

export function useIsMobile(): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function Result({ res }: { res: { ok: boolean; reason?: string; code?: string } | null }) {
  if (!res) return null;
  return (
    <div role="status" className={res.ok ? 'ok' : 'bad'}>
      {res.ok ? 'Done.' : `${res.reason ?? 'Rejected.'}${res.code ? ` (${res.code})` : ''}`}
    </div>
  );
}

let nonceSeq = 0;
export function newNonce(): string {
  return `ui-${Date.now().toString(36)}-${(nonceSeq++).toString(36)}`;
}
