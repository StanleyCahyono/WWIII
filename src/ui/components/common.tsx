import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { getHost } from '../sim/host';
import { useStore } from '../state/store';
import type { Frame, QueryName } from '../sim/protocol';
import { symbolSvg } from '../map/symbols';
import { countryName, unitById } from '../data/static';
import { buildSidc } from '../../data/catalog/sidc';
import { userMovedFocus } from '../state/ui';
import { FLAGS, type Emblem, type FlagSpec } from '../data/flags';

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

function starPoints(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(' ');
}

function emblem(e: Emblem, i: number): React.ReactNode {
  switch (e.s) {
    case 'disc':
      return <circle key={i} cx={e.x} cy={e.y} r={e.r} fill={e.c} />;
    case 'ring':
      return <circle key={i} cx={e.x} cy={e.y} r={e.r} fill="none" stroke={e.c} strokeWidth={e.r * 0.3} />;
    case 'star':
      return <polygon key={i} points={starPoints(e.x, e.y, e.r)} fill={e.c} />;
    case 'crescent':
      return (
        <g key={i}>
          <circle cx={e.x} cy={e.y} r={e.r} fill={e.c} />
          <circle cx={e.x + e.r * 0.36} cy={e.y} r={e.r * 0.8} fill={e.k} />
        </g>
      );
    case 'rect':
      return <rect key={i} x={e.x} y={e.y} width={e.w} height={e.h} fill={e.c} />;
    case 'poly':
      return <polygon key={i} points={e.p} fill={e.c} />;
    case 'diamond':
      return <polygon key={i} points={`${e.x - e.r},${e.y} ${e.x},${e.y - e.r * 0.66} ${e.x + e.r},${e.y} ${e.x},${e.y + e.r * 0.66}`} fill={e.c} />;
    case 'grid': {
      const dots: React.ReactNode[] = [];
      for (let cx = 0; cx < e.n; cx++)
        for (let cy = 0; cy < e.m; cy++) dots.push(<circle key={`${cx}-${cy}`} cx={e.x + (e.n === 1 ? e.w / 2 : (cx * e.w) / (e.n - 1))} cy={e.y + (e.m === 1 ? e.h / 2 : (cy * e.h) / (e.m - 1))} r={0.55} fill={e.c} />);
      return <g key={i}>{dots}</g>;
    }
    case 'uj':
      return (
        <svg key={i} x={e.x} y={e.y} width={e.w} height={e.h} viewBox="0 0 60 30" preserveAspectRatio="none">
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#c8102e" strokeWidth="2" />
          <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
        </svg>
      );
  }
}

function bands(c: string[], w: number[] | undefined, horizontal: boolean): React.ReactNode[] {
  const ws = w ?? c.map(() => 1);
  const total = ws.reduce((a, b) => a + b, 0);
  const len = horizontal ? 20 : 30;
  let at = 0;
  return c.map((col, i) => {
    const size = (ws[i] / total) * len;
    const r = horizontal ? <rect key={i} x="0" y={at} width="30" height={size + 0.05} fill={col} /> : <rect key={i} x={at} y="0" width={size + 0.05} height="20" fill={col} />;
    at += size;
    return r;
  });
}

function flagBody(f: FlagSpec): React.ReactNode {
  switch (f.k) {
    case 'h':
      return bands(f.c, f.w, true);
    case 'v':
      return bands(f.c, f.w, false);
    case 'cross':
      return (
        <>
          <rect width="30" height="20" fill={f.bg} />
          <rect x="8" width="4" height="20" fill={f.fg} />
          <rect y="8" width="30" height="4" fill={f.fg} />
          {f.inner && (
            <>
              <rect x="9" width="2" height="20" fill={f.inner} />
              <rect y="9" width="30" height="2" fill={f.inner} />
            </>
          )}
        </>
      );
    case 'plus':
      return (
        <>
          <rect width="30" height="20" fill={f.bg} />
          <rect x="13.2" y="4" width="3.6" height="12" fill={f.fg} />
          <rect x="9" y="8.2" width="12" height="3.6" fill={f.fg} />
        </>
      );
    case 'tri': {
      const tw = f.tw ?? 12;
      return (
        <>
          {bands(f.c, f.w, true)}
          <polygon points={`0,0 ${tw},10 0,20`} fill={f.t} />
          {f.t2 && <polygon points={`0,${2.6} ${tw * 0.72},10 0,${17.4}`} fill={f.t2} />}
        </>
      );
    }
    case 'quad':
      return (
        <>
          <rect width="15" height="10" fill={f.c[0]} />
          <rect x="15" width="15" height="10" fill={f.c[1]} />
          <rect y="10" width="15" height="10" fill={f.c[2]} />
          <rect x="15" y="10" width="15" height="10" fill={f.c[3]} />
          {f.fg && (
            <>
              <rect x="13" width="4" height="20" fill={f.fg} />
              <rect y="8" width="30" height="4" fill={f.fg} />
            </>
          )}
        </>
      );
    case 'diag':
      return f.rev ? (
        <>
          <polygon points="0,0 30,0 30,20" fill={f.a} />
          <polygon points="0,0 30,20 0,20" fill={f.b} />
        </>
      ) : (
        <>
          <polygon points="0,0 30,0 0,20" fill={f.a} />
          <polygon points="30,0 30,20 0,20" fill={f.b} />
          {f.edge && <path d="M0,20 L30,0" stroke={f.edge} strokeWidth="7.5" />}
          {f.band !== 'none' && <path d="M0,20 L30,0" stroke={f.band} strokeWidth="5" />}
        </>
      );
  }
}

/**
 * Simplified national flag (real colours and layout from data/flags.ts) on a 3:2 chip; a coded
 * neutral chip when a code has no entry. Decorative unless `title` is given.
 */
export function Flag({ id, size = 36, title }: { id: string | null | undefined; size?: number; title?: string }) {
  const w = size;
  const hgt = Math.round(size * 0.667);
  const spec = id ? FLAGS[id] : undefined;
  const clip = `fl-${id ?? 'none'}`;
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg className="nation-badge" width={w} height={hgt} viewBox="0 0 30 20" {...a11y}>
      <defs>
        <clipPath id={clip}>
          <rect width="30" height="20" rx="2.4" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {spec ? (
          <>
            {flagBody(spec)}
            {spec.e?.map(emblem)}
          </>
        ) : (
          <>
            <rect width="30" height="20" fill="#3a4652" />
            {id && (
              <text x="15" y="13.6" textAnchor="middle" fontSize="9" fontWeight="800" fill="#e8edf1" fontFamily="system-ui, sans-serif">
                {id}
              </text>
            )}
          </>
        )}
        <rect width="30" height="6" fill="rgba(255,255,255,0.05)" />
      </g>
      <rect x="0.4" y="0.4" width="29.2" height="19.2" rx="2.2" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
    </svg>
  );
}

/** Kept name: the nation badge is the simplified national flag. */
export function NationBadge(props: { id: string | null | undefined; size?: number; title?: string }) {
  return <Flag {...props} />;
}

/** Compact flag chip (lists, tables, chips); the country code stays in the text for search/tests. */
export function FlagChip({ id, size = 26 }: { id: string | null | undefined; size?: number }) {
  return (
    <span className="chip-flag" style={{ width: size, height: Math.round(size * 0.667) }} aria-hidden title={id ? countryName(id) : undefined}>
      <Flag id={id} size={size} />
      <span className="code">{id ?? '—'}</span>
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
