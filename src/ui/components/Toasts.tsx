import React, { useEffect } from 'react';
import { useStore } from '../state/store';
import { ui, dismissToast, centerOn, select, openPanel } from '../state/ui';
import { humanizeIds } from '../eventText';
import { getHost } from '../sim/host';
import { NODES, cityByNode } from '../data/static';
import { Modal } from './common';
import { Icon } from '../icons';

function jump(node: number | null) {
  if (node === null || !NODES[node]) return;
  const c = cityByNode.get(node);
  centerOn(NODES[node].center[0], NODES[node].center[1], 30);
  if (c) select({ kind: 'city', key: c.key, node });
  else if (NODES[node].kind === 'land') select({ kind: 'province', node });
}

export function Toasts() {
  const toasts = useStore(ui, (s) => s.toasts);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => {
      const now = Date.now();
      for (const x of ui.get().toasts) if (now - x.at > (x.level === 'alert' ? 15000 : 7000)) dismissToast(x.id);
    }, 1000);
    return () => clearTimeout(t);
  }, [toasts]);
  return (
    <div className="toasts" role="log" aria-live="polite" aria-label="Notifications" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          <span className="toast-ico" aria-hidden>
            <Icon name={t.level === 'alert' ? 'alert' : t.level === 'success' ? 'check' : t.level === 'warn' ? 'sword' : 'bell'} size={16} />
          </span>
          <div className="grow">{t.text}</div>
          {t.action && (
            <button type="button" className="btn small" onClick={() => { openPanel(t.action!.panel); dismissToast(t.id); }}>
              {t.action.label}
            </button>
          )}
          {t.node !== null && (
            <button type="button" className="btn small" onClick={() => jump(t.node)} aria-label="Jump to location">
              Go
            </button>
          )}
          <button type="button" className="btn ghost small" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function InterruptDialog() {
  const host = getHost();
  const items = useStore(host.store, (s) => s.interrupts);
  if (!items.length) return null;
  const e = items[0];
  return (
    <Modal
      title="The clock was paused"
      onClose={() => host.dismissInterrupt(e.id)}
      footer={
        <>
          {e.node !== null && (
            <button type="button" className="btn" onClick={() => { jump(e.node); host.dismissInterrupt(e.id); }}>
              Go to location
            </button>
          )}
          <button type="button" className="btn" onClick={() => host.dismissInterrupt(e.id)}>
            Stay paused
          </button>
          <button type="button" className="btn primary" onClick={() => { host.dismissInterrupt(e.id); void host.setClock({ paused: false }); }}>
            Resume
          </button>
        </>
      }
    >
      <p role="alert" style={{ fontSize: 15 }}>{humanizeIds(e.text, host.store.get().frame?.view)}</p>
      <p className="muted">Interruptions can be changed in Settings. {items.length > 1 ? `${items.length - 1} more pending.` : ''}</p>
    </Modal>
  );
}
