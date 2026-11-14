import React, { useEffect, useRef, useState } from 'react';
import { ui } from '../state/ui';
import { listCampaigns, getSave, updateMeta, deleteCampaign, listCheckpoints, getCheckpoint, deleteCheckpoint, newId, type CampaignMeta, type CheckpointRow } from '../persist/db';
import { openCampaign } from '../session';
import { getHost } from '../sim/host';
import { relWall, bytes, wallTime } from '../format';
import { FlagChip, Modal } from '../components/common';

export function downloadText(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function LoadCampaign() {
  const [list, setList] = useState<CampaignMeta[] | null>(null);
  const [cps, setCps] = useState<Omit<CheckpointRow, 'json'>[]>([]);
  const [tab, setTab] = useState<'active' | 'archived' | 'recovery'>('active');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<CampaignMeta | null>(null);
  const [importing, setImporting] = useState<{ json: string; name: string; summary: { nationName: string; day: number; seed: number; difficulty: string } } | null>(null);
  const [lockPrompt, setLockPrompt] = useState<CampaignMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setList(await listCampaigns());
      setCps(await listCheckpoints());
    } catch (e) {
      setMsg({ ok: false, text: `Storage unavailable: ${(e as Error).message}` });
      setList([]);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const resume = async (m: CampaignMeta, o: { readOnly?: boolean; takeOver?: boolean } = {}) => {
    setMsg(null);
    const r = await openCampaign(m.id, o);
    if (!r.ok) {
      if ('locked' in r) setLockPrompt(m);
      else setMsg({ ok: false, text: `Could not open: ${r.error}` });
    }
  };
  const exportOne = async (m: CampaignMeta) => {
    const row = await getSave(m.id);
    if (!row) return setMsg({ ok: false, text: 'No save data found.' });
    downloadText(`world-command-${m.nation}-day${m.day}-${m.id}.json`, row.json);
    setMsg({ ok: true, text: `Exported ${m.nationName} (${bytes(row.json.length)}).` });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const json = await f.text();
      const s = await getHost().validateJson(json);
      setImporting({ json, name: f.name, summary: { nationName: s.nationName ?? s.nation, day: s.day, seed: s.seed, difficulty: s.difficulty } });
    } catch (e) {
      setMsg({ ok: false, text: `Import rejected — the file was not changed into a campaign and your existing saves are untouched. Reason: ${(e as Error).message}` });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const confirmImport = async () => {
    if (!importing) return;
    try {
      const id = newId('imp');
      await getHost().importJson(importing.json, id, `${importing.summary.nationName} (imported)`);
      setMsg({ ok: true, text: `Imported ${importing.summary.nationName}, day ${importing.summary.day}, seed ${importing.summary.seed}.` });
      setImporting(null);
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: `Import failed; nothing was replaced: ${(e as Error).message}` });
      setImporting(null);
    }
  };
  const restoreCheckpoint = async (id: string) => {
    const row = await getCheckpoint(id);
    if (!row) return;
    try {
      const s = await getHost().validateJson(row.json);
      await getHost().importJson(row.json, newId('rec'), `${s.nationName ?? s.nation} (recovered ${wallTime(row.at)})`);
      setMsg({ ok: true, text: 'Recovery copy restored as a new campaign.' });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: `Recovery copy is not valid: ${(e as Error).message}` });
    }
  };

  const shown = (list ?? []).filter((m) => (tab === 'archived' ? m.archived : !m.archived));
  return (
    <main className="page">
      <div className="page-inner">
        <header className="ph">
          <button type="button" className="btn ghost" onClick={() => ui.patch({ screen: 'title' })}>
            ← Back
          </button>
          <h1 style={{ fontSize: 20 }}>Load Campaign</h1>
          <div className="grow" />
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="import-file" onChange={(e) => onFile(e.target.files?.[0])} data-testid="import-input" />
          <label htmlFor="import-file" className="btn" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}>
            Import JSON…
          </label>
        </header>
        <div className="tabs" role="tablist">
          {(['active', 'archived', 'recovery'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'active' ? `Active (${(list ?? []).filter((m) => !m.archived).length})` : t === 'archived' ? `Archived (${(list ?? []).filter((m) => m.archived).length})` : `Recovery copies (${cps.length})`}
            </button>
          ))}
        </div>
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'ok' : 'bad'}>
            {msg.text}
          </p>
        )}
        {!list && <p className="muted">Loading…</p>}
        {tab !== 'recovery' && list && shown.length === 0 && <div className="empty">{tab === 'archived' ? 'No archived campaigns. Archiving hides a campaign from the active list without deleting it.' : 'No active campaigns yet. Start a New Campaign from the title screen.'}</div>}
        {tab !== 'recovery' && shown.length > 0 && (
          <table className="data" data-testid="campaign-list">
            <thead>
              <tr>
                <th>Nation</th>
                <th>Scenario</th>
                <th className="num">Day</th>
                <th>Difficulty</th>
                <th className="num">Score</th>
                <th>Last saved</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="row">
                      <FlagChip id={m.nation} /> <strong>{m.nationName}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {m.name} · seed {m.seed} · {bytes(m.bytes)} {m.completed ? '· completed' : ''}
                    </div>
                  </td>
                  <td>World 120</td>
                  <td className="num">{m.day}</td>
                  <td style={{ textTransform: 'capitalize' }}>{m.difficulty}</td>
                  <td className="num">
                    {m.score}/{m.target}
                  </td>
                  <td>{relWall(m.savedAt)}</td>
                  <td>
                    <div className="row wrap">
                      <button type="button" className="btn small primary" onClick={() => resume(m)} aria-label={`Resume ${m.nationName}`}>
                        {m.completed ? 'Review' : 'Resume'}
                      </button>
                      <button type="button" className="btn small" onClick={async () => { await updateMeta(m.id, { archived: !m.archived }); await refresh(); }}>
                        {m.archived ? 'Restore' : 'Archive'}
                      </button>
                      <button type="button" className="btn small" onClick={() => exportOne(m)}>
                        Export
                      </button>
                      <button type="button" className="btn small danger" onClick={() => setConfirmDel(m)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'recovery' && (
          <>
            <p className="dim">Recovery copies are written when a save fails, when another tab saved newer progress (revision conflict), or before risky operations. Restoring creates a new campaign; nothing is overwritten.</p>
            {cps.length === 0 ? (
              <div className="empty">No recovery copies.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cps.map((c) => (
                    <tr key={c.id}>
                      <td>{wallTime(c.at)}</td>
                      <td>{c.reason}</td>
                      <td>
                        <div className="row">
                          <button type="button" className="btn small" onClick={() => restoreCheckpoint(c.id)}>
                            Restore as new campaign
                          </button>
                          <button type="button" className="btn small danger" onClick={async () => { await deleteCheckpoint(c.id); await refresh(); }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      {confirmDel && (
        <Modal
          title="Delete campaign?"
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDel(null)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={async () => { await deleteCampaign(confirmDel.id); setConfirmDel(null); await refresh(); }}>
                Delete permanently
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{confirmDel.nationName}</strong> (day {confirmDel.day})? This cannot be undone. Export it first if you may want it later.
          </p>
        </Modal>
      )}
      {importing && (
        <Modal
          title="Import campaign"
          onClose={() => setImporting(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setImporting(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={confirmImport} data-testid="confirm-import">
                Import as new campaign
              </button>
            </>
          }
        >
          <p>The file passed validation (format, schema, references, finite numbers, ownership and queued work).</p>
          <dl className="kv">
            <dt>File</dt>
            <dd>{importing.name}</dd>
            <dt>Nation</dt>
            <dd>{importing.summary.nationName}</dd>
            <dt>Game day</dt>
            <dd>{importing.summary.day}</dd>
            <dt>Seed</dt>
            <dd>{importing.summary.seed}</dd>
            <dt>Difficulty</dt>
            <dd>{importing.summary.difficulty}</dd>
          </dl>
          <p className="dim">It will be stored as a new campaign. Existing saves are not modified.</p>
        </Modal>
      )}
      {lockPrompt && (
        <Modal
          title="Campaign open in another tab"
          onClose={() => setLockPrompt(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setLockPrompt(null)}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={() => { const m = lockPrompt; setLockPrompt(null); void resume(m, { readOnly: true }); }}>
                Open read-only
              </button>
              <button type="button" className="btn primary" onClick={() => { const m = lockPrompt; setLockPrompt(null); void resume(m, { takeOver: true }); }}>
                Take over
              </button>
            </>
          }
        >
          <p>This campaign is being written by another tab. Only one tab may save it.</p>
        </Modal>
      )}
    </main>
  );
}
