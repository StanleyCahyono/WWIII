import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { ui, centerOn, toast } from '../state/ui';
import { getHost } from '../sim/host';
import { useFrame, ActionButton, Modal } from './common';
import { gameTime } from '../format';
import { mapRef } from '../map/MapView';

const KINDS = [
  { id: 'route', label: 'Route draft', min: 2 },
  { id: 'phase_line', label: 'Phase line', min: 2 },
  { id: 'area', label: 'Area', min: 3 },
  { id: 'objective', label: 'Objective', min: 1 },
  { id: 'label', label: 'Label', min: 1 },
  { id: 'bookmark', label: 'Bookmark', min: 1 },
] as const;
type DrawKind = (typeof KINDS)[number]['id'];

async function finish() {
  const m = ui.get().mode;
  if (m.kind !== 'draw') return;
  const k = KINDS.find((x) => x.id === m.drawKind)!;
  if (m.points.length < k.min) {
    toast({ text: `${k.label} needs at least ${k.min} point(s).`, node: null, kind: 'planning', level: 'warn' });
    return;
  }
  const name = `${k.label} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  await getHost().ui({ kind: 'addDrawing', drawing: { kind: m.drawKind, name, points: m.points, expiresAt: null } });
  ui.patch({ mode: { kind: 'idle' } });
  toast({ text: `${k.label} saved to your private planning layer (no game orders were changed).`, node: null, kind: 'planning', level: 'success' });
}

export function DrawBanner() {
  const mode = useStore(ui, (s) => s.mode);
  useEffect(() => {
    const f = () => void finish();
    const c = () => ui.get().mode.kind === 'draw' && ui.patch({ mode: { kind: 'idle' } });
    window.addEventListener('wc-finish-draw', f);
    window.addEventListener('wc-cancel-mode', c);
    return () => {
      window.removeEventListener('wc-finish-draw', f);
      window.removeEventListener('wc-cancel-mode', c);
    };
  }, []);
  const k = mode.kind === 'draw' ? KINDS.find((x) => x.id === mode.drawKind)! : null;
  const single = k?.min === 1;
  const npts = mode.kind === 'draw' ? mode.points.length : 0;
  useEffect(() => {
    if (single && npts >= 1) void finish();
  }, [single, npts]);
  if (mode.kind !== 'draw' || !k) return null;
  return (
    <div className="mode-banner" role="dialog" aria-label="Drawing" data-testid="draw-banner">
      <strong>Drawing: {k.label}</strong>
      <span className="muted" style={{ fontSize: 12 }}>
        {single ? 'Click a point on the map.' : `Click points (${mode.points.length}). Enter or Finish to save.`} Private — never changes orders.
      </span>
      {!single && (
        <button type="button" className="btn small primary" onClick={() => void finish()} data-testid="finish-draw">
          Finish
        </button>
      )}
      <button type="button" className="btn small" onClick={() => ui.patch({ mode: { kind: 'idle' } })}>
        Cancel
      </button>
    </div>
  );
}

export function PlanningPanel() {
  const frame = useFrame()!;
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const host = getHost();
  const drawings = frame.drawings;
  const start = (k: DrawKind) => ui.patch({ mode: { kind: 'draw', drawKind: k, points: [] }, panel: null });
  const issue = (d: (typeof drawings)[number]) => {
    // "Issue order" from a route draft opens the normal validated command preview
    const sel = ui.get().selection;
    const stacks = sel?.kind === 'stack' ? [sel.id] : sel?.kind === 'multi' ? sel.ids.map((i) => i.slice(2)) : [];
    const r = mapRef.current;
    if (!r) return;
    const nodes = d.points.map((p) => r.nodeAt(p[0], p[1])).filter((n): n is number => n !== null);
    const dedup = nodes.filter((n, i) => i === 0 || n !== nodes[i - 1]);
    if (!dedup.length) return;
    const dest = dedup[dedup.length - 1];
    const waypoints = dedup.slice(1, -1);
    ui.patch({ panel: null, mode: { kind: 'move', stacks, waypoints, dest } });
  };
  const sel = useStore(ui, (s) => s.selection);
  const hasStack = sel?.kind === 'stack' || sel?.kind === 'multi';
  return (
    <div className="col" data-testid="planning-panel">
      <p className="dim" style={{ margin: 0 }}>Private drawings live in the save's UI section. Drawing, renaming, hiding or deleting never changes the simulation, its orders or its random state — even while paused.</p>
      <div className="row wrap">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="btn small" onClick={() => start(k.id)} data-testid={`draw-${k.id}`}>
            + {k.label}
          </button>
        ))}
      </div>
      {drawings.length === 0 ? (
        <div className="empty">No drawings yet.</div>
      ) : (
        <table className="data" data-testid="drawing-list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Author / created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {drawings.map((d) => (
              <tr key={d.id}>
                <td>
                  <button type="button" className="btn ghost small" onClick={() => d.points[0] && centerOn(d.points[0][0], d.points[0][1])}>
                    {d.name}
                  </button>
                  {d.hidden && <span className="tag">hidden</span>}
                </td>
                <td>{d.kind.replace('_', ' ')}</td>
                <td className="muted">
                  {d.author} · {gameTime(d.createdAt)}
                  {d.expiresAt ? ` · expires ${gameTime(d.expiresAt)}` : ''}
                </td>
                <td>
                  <div className="row wrap">
                    <button type="button" className="btn small" onClick={() => setRename({ id: d.id, name: d.name })}>
                      Rename
                    </button>
                    <button type="button" className="btn small" onClick={() => host.ui({ kind: 'hideDrawing', id: d.id, hidden: !d.hidden })}>
                      {d.hidden ? 'Show' : 'Hide'}
                    </button>
                    <button type="button" className="btn small danger" onClick={() => host.ui({ kind: 'deleteDrawing', id: d.id })}>
                      Delete
                    </button>
                    {d.kind === 'route' && (
                      <ActionButton className="btn small primary" disabledReason={hasStack ? null : 'Select a formation first, then issue the draft as an order.'} onClick={() => issue(d)}>
                        Issue order…
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rename && (
        <Modal
          title="Rename drawing"
          onClose={() => setRename(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRename(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={async () => { await host.ui({ kind: 'renameDrawing', id: rename.id, name: rename.name.slice(0, 80) }); setRename(null); }}>
                Save
              </button>
            </>
          }
        >
          <label className="field">
            Name
            <input type="text" value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} data-autofocus />
          </label>
        </Modal>
      )}
    </div>
  );
}
