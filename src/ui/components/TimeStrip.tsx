import React, { useMemo } from 'react';
import { useStore } from '../state/store';
import { ui } from '../state/ui';
import { useFrame } from './common';
import { nextEvents } from './TopBar';
import { NODES } from '../data/static';
import { duration, gameTime } from '../format';

export function TimeStrip() {
  const frame = useFrame()!;
  const open = useStore(ui, (s) => s.timeStripOpen);
  const preview = useStore(ui, (s) => s.previewMarker);
  const items = useMemo(() => nextEvents(frame), [frame]);
  const pick = (e: (typeof items)[number]) => {
    // selecting previews position without advancing time
    if (e.node !== null) ui.patch({ previewMarker: { lonlat: NODES[e.node].center, label: `${e.label} · ${gameTime(e.at)}` } });
    else ui.patch({ previewMarker: null });
  };
  return (
    <section className="timestrip" aria-label="Timeline (upcoming completions and dated reports)" data-testid="timestrip">
      <div className="tbar">
        <button type="button" className="btn small" aria-expanded={open} onClick={() => ui.patch({ timeStripOpen: !open })}>
          {open ? '▾ Timeline' : '▸ Timeline'}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>Now {gameTime(frame.view.tick)}</span>
        {items.slice(0, 8).map((e, i) => (
          <button key={i} type="button" className={`titem${e.observed ? ' obs' : ''}`} onClick={() => pick(e)} title={`${e.label} — ${gameTime(e.at)} (${e.observed ? 'dated report' : 'expected completion'})`}>
            <span className="muted">+{duration(e.at - frame.view.tick)}</span> {e.label.length > 34 ? e.label.slice(0, 33) + '…' : e.label}
          </button>
        ))}
        {preview && (
          <button type="button" className="btn small" onClick={() => ui.patch({ previewMarker: null })}>
            Clear preview
          </button>
        )}
      </div>
      {open && (
        <div className="tlist">
          {items.length === 0 ? (
            <div className="muted">Nothing scheduled.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>In</th>
                  <th>What</th>
                  <th>Status / source</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e, i) => (
                  <tr key={i} onClick={() => pick(e)} style={{ cursor: 'pointer' }}>
                    <td>{gameTime(e.at)}</td>
                    <td>{duration(e.at - frame.view.tick)}</td>
                    <td>
                      <button type="button" className="btn ghost small" style={{ padding: 0 }} onClick={() => pick(e)}>
                        {e.label}
                      </button>
                    </td>
                    <td className="muted">{e.observed ? 'Dated report (observed)' : e.kind === 'arrival' ? 'Expected arrival (recomputed each step)' : 'Expected completion'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
