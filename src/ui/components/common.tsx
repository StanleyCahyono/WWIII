import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { getHost } from '../sim/host';
import { useStore } from '../state/store';
import type { Frame, QueryName } from '../sim/protocol';
import { symbolSvg } from '../map/symbols';
import { countryName } from '../data/static';
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

function flagColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 38%)`;
}
export function FlagChip({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="chip-flag" style={{ background: '#555' }} aria-hidden>—</span>;
  return (
    <span className="chip-flag" style={{ background: flagColor(id) }} aria-hidden title={countryName(id)}>
      {id}
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

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
    forces: <path d="M4 7h16v10H4zM4 7l16 10M20 7L4 17" />,
    economy: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    research: <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" />,
    diplomacy: <path d="M3 12l4-4 5 3 5-3 4 4-9 7zM7 8V5M17 8V5" />,
    intel: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />,
    journal: <path d="M5 3h12l2 2v16H5zM8 8h8M8 12h8M8 16h5" />,
    cities: <path d="M3 21V9l5-3v15M8 21V4l7 3v14M15 21V11l6 2v8M2 21h20" />,
    coalition: <path d="M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 2-5 4-5s6 2 6 5" />,
    news: <path d="M4 5h13v14H6a2 2 0 01-2-2zM17 8h3v9a2 2 0 01-2 2M7 9h7M7 12h7M7 15h4" />,
    events: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 100 8 4 4 0 000-8z" />,
    market: <path d="M3 10l2-6h14l2 6M4 10v10h16V10M3 10h18M9 20v-6h6v6" />,
    score: <path d="M6 4h12v4a6 6 0 01-12 0zM12 14v4M8 21h8M6 6H3a3 3 0 003 4M18 6h3a3 3 0 01-3 4" />,
    help: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" />,
    planning: <path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" />,
    layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
    home: <path d="M3 11l9-8 9 8v10H3zM9 21v-6h6v6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    target: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 100 6 3 3 0 000-6z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="M7 4l13 8-13 8z" />,
    step: <path d="M5 4l10 8-10 8zM18 4v16" />,
    skip: <path d="M3 4l8 8-8 8zM12 4l8 8-8 8z" />,
    save: <path d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7" />,
    roster: <path d="M4 6h16M4 12h16M4 18h10" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    search: <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5" />,
    legend: <path d="M4 5h4v4H4zM4 15h4v4H4zM11 7h9M11 17h9" />,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
    'exit-fullscreen': <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
  };
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name] ?? p.help}
    </svg>
  );
}

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
