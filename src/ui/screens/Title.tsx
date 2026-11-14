import React, { useEffect, useState } from 'react';
import { ui } from '../state/ui';
import { listCampaigns, getSave, requestPersistence, storageAvailable, type CampaignMeta } from '../persist/db';
import { prefs } from '../persist/prefs';
import { openCampaign } from '../session';
import { relWall } from '../format';
import { FlagChip, Modal } from '../components/common';

export function TitleScreen() {
  const [cont, setCont] = useState<CampaignMeta | null>(null);
  const [count, setCount] = useState(0);
  const [storage, setStorage] = useState<{ ok: boolean; persisted: boolean | null; note: string | null }>({ ok: true, persisted: null, note: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockPrompt, setLockPrompt] = useState<CampaignMeta | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!storageAvailable()) {
        setStorage({ ok: false, persisted: false, note: 'This browser context has no IndexedDB (private window or storage blocked). You can play, but campaigns cannot be saved; use Export to keep a copy.' });
        return;
      }
      try {
        const list = await listCampaigns();
        if (!alive) return;
        setCount(list.length);
        const active = list.filter((c) => !c.archived);
        const last = prefs.get().lastCampaign;
        const pick = active.find((c) => c.id === last) ?? active[0] ?? null;
        if (pick) {
          const row = await getSave(pick.id);
          if (row && row.json.length > 0) setCont(pick);
        }
        const p = await requestPersistence();
        if (!alive) return;
        setStorage({ ok: true, persisted: p.persisted, note: p.persisted === false ? 'The browser has not granted persistent storage, so it may evict saves under storage pressure. Export important campaigns (Load Campaign → Export).' : null });
      } catch (e) {
        setStorage({ ok: false, persisted: false, note: `Saved campaigns are unavailable: ${(e as Error).message}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const doContinue = async (m: CampaignMeta, o: { readOnly?: boolean; takeOver?: boolean } = {}) => {
    setBusy(true);
    setError(null);
    const r = await openCampaign(m.id, o);
    setBusy(false);
    if (!r.ok) {
      if ('locked' in r) setLockPrompt(m);
      else setError(r.error);
    }
  };

  return (
    <main className="title-screen">
      <div className="title-inner">
        <section className="brand">
          <h1>World Command</h1>
          <div className="sub">World 120 — a private, offline grand strategy campaign. One human seat, 119 computer countries.</div>
          <nav className="menu" aria-label="Main menu">
            {cont && (
              <button type="button" className="btn primary" onClick={() => doContinue(cont)} disabled={busy} data-testid="continue">
                Continue — {cont.nationName}, day {cont.day}
              </button>
            )}
            <button type="button" className={`btn${cont ? '' : ' primary'}`} onClick={() => ui.patch({ screen: 'new' })} data-testid="new-campaign">
              New Campaign
            </button>
            <button type="button" className="btn" onClick={() => ui.patch({ screen: 'load' })} data-testid="load-campaign">
              Load Campaign{count ? ` (${count})` : ''}
            </button>
            <button type="button" className="btn" onClick={() => ui.patch({ screen: 'settings' })}>
              Settings
            </button>
            <div className="row">
              <button type="button" className="btn ghost small" onClick={() => ui.patch({ screen: 'credits' })}>
                Credits & licenses
              </button>
              <button type="button" className="btn ghost small" onClick={() => ui.patch({ screen: 'diagnostics' })}>
                Diagnostics
              </button>
            </div>
          </nav>
          {busy && <p role="status" className="muted">Opening campaign…</p>}
          {error && <p role="alert" className="bad">{error}</p>}
        </section>
        <section className="col" aria-label="Campaign status">
          {cont ? (
            <div className="card continue-card" data-testid="continue-card">
              <h4>Continue</h4>
              <div className="row" style={{ marginTop: 6 }}>
                <FlagChip id={cont.nation} />
                <strong style={{ fontSize: 18 }}>{cont.nationName}</strong>
              </div>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>Game day</dt>
                <dd data-testid="continue-day">Day {cont.day} · {cont.time.slice(11)} UTC</dd>
                <dt>Difficulty</dt>
                <dd style={{ textTransform: 'capitalize' }}>{cont.difficulty}</dd>
                <dt>Score</dt>
                <dd>
                  {cont.score} / {cont.target} VP
                </dd>
                <dt>Last saved</dt>
                <dd>{relWall(cont.savedAt)}</dd>
                <dt>Seed</dt>
                <dd>{cont.seed}</dd>
                {cont.completed && (
                  <>
                    <dt>Status</dt>
                    <dd>Completed — review mode</dd>
                  </>
                )}
              </dl>
            </div>
          ) : (
            <div className="card">
              <h4>No campaign yet</h4>
              <p className="dim">Start a New Campaign and choose one of 120 countries. Indonesia is a good first pick: distributed ports, an inter-island transport problem and a clear opening.</p>
            </div>
          )}
          {storage.note && (
            <div className="card" role="note">
              <h4>Storage</h4>
              <p className={storage.ok ? 'warn' : 'bad'} style={{ margin: '6px 0 0' }}>{storage.note}</p>
            </div>
          )}
          <div className="card">
            <h4>How time works</h4>
            <p className="dim" style={{ margin: '6px 0 0' }}>The campaign starts paused at 06:00 UTC on day 1 and stays paused while you read. Nothing happens while the app is closed unless you enable the catch-up setting.</p>
          </div>
        </section>
      </div>
      {lockPrompt && (
        <Modal
          title="Campaign open in another tab"
          onClose={() => setLockPrompt(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setLockPrompt(null)}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={() => { const m = lockPrompt; setLockPrompt(null); void doContinue(m, { readOnly: true }); }}>
                Open read-only
              </button>
              <button type="button" className="btn primary" onClick={() => { const m = lockPrompt; setLockPrompt(null); void doContinue(m, { takeOver: true }); }}>
                Take over writing here
              </button>
            </>
          }
        >
          <p>
            <strong>{lockPrompt.nationName}</strong> is already open for writing in another tab or window. Only one tab may save a campaign, so newer progress is never silently overwritten.
          </p>
          <p className="dim">Taking over asks the other tab to save and switch to read-only.</p>
        </Modal>
      )}
    </main>
  );
}
