import React, { useEffect, useState } from 'react';
import { ui } from '../state/ui';
import { prefs, setPrefs, prefsPersist } from '../persist/prefs';
import { useStore } from '../state/store';
import { getHost } from '../sim/host';
import { requestPersistence, storageAvailable, listCheckpoints } from '../persist/db';
import { APP_VERSION } from '../data/static';
import { wallTime, bytes } from '../format';
import { getAssetValidationErrors, SYMBOL_CROSSWALK_VERSION, SYMBOL_EDITION } from '../../data/catalog/sidc';
import { RENDERER } from '../../data/catalog/symbol-render';
import { SPEED_BASE } from '../sim/protocol';

function BackHeader({ title }: { title: string }) {
  const inGame = !!getHost().store.get().frame;
  return (
    <header className="ph">
      <button type="button" className="btn ghost" onClick={() => ui.patch({ screen: inGame ? 'game' : 'title' })}>
        ← Back
      </button>
      <h1 style={{ fontSize: 20 }}>{title}</h1>
    </header>
  );
}

export function SettingsPanel() {
  const p = useStore(prefs);
  return (
    <div className="col" style={{ gap: 14 }}>
      <fieldset>
        <legend>Interruptions (pause the clock and alert)</legend>
        {(
          [
            ['war', 'War declared on me'],
            ['capital', 'My capital changes hands'],
            ['end', 'Campaign end / elimination'],
            ['other', 'Other urgent events'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={p.interrupts[k]} onChange={(e) => { const interrupts = { ...p.interrupts, [k]: e.target.checked }; setPrefs({ interrupts }); void getHost().setClock({ interrupts }).catch(() => {}); }} />
            {label}
          </label>
        ))}
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Routine completions are bundled into a daily digest and toasts that never stop the clock.</p>
      </fieldset>
      <fieldset>
        <legend>Display</legend>
        <label className="row" style={{ gap: 6 }}>
          Theme
          <select value={p.theme} onChange={(e) => setPrefs({ theme: e.target.value as 'dark' | 'light' })}>
            <option value="dark">Dark slate (default)</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={p.reducedMotion} onChange={(e) => setPrefs({ reducedMotion: e.target.checked })} />
          Reduced motion
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={p.monochromeSymbols} onChange={(e) => setPrefs({ monochromeSymbols: e.target.checked })} />
          Monochrome unit symbols (frame shapes carry affiliation)
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={p.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} />
          Sound cues (local, off by default)
        </label>
      </fieldset>
      <fieldset>
        <legend>Closed-app catch-up</legend>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={p.catchUp.enabled} onChange={(e) => setPrefs({ catchUp: { ...p.catchUp, enabled: e.target.checked } })} data-testid="catchup-toggle" />
          Catch up closed-app time when resuming (off by default)
        </label>
        <label className="row" style={{ gap: 6 }}>
          Maximum
          <input type="number" min={1} max={168} value={p.catchUp.maxHours} onChange={(e) => setPrefs({ catchUp: { ...p.catchUp, maxHours: Math.max(1, Math.min(168, Math.floor(Number(e.target.value) || 1))) } })} style={{ width: 80 }} />
          game hours
        </label>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          When enabled, resuming simulates real time away at 1× ({SPEED_BASE} game minute per real second), capped at the maximum, then pauses and shows a summary of the elapsed game time.
        </p>
      </fieldset>
      {!prefsPersist() && <p className="bad">Preferences cannot be stored in this browser (localStorage blocked); they reset on reload.</p>}
    </div>
  );
}

export function SettingsScreen() {
  return (
    <main className="page">
      <div className="page-inner" style={{ maxWidth: 720 }}>
        <BackHeader title="Settings" />
        <SettingsPanel />
      </div>
    </main>
  );
}

export function CreditsScreen() {
  const [lic, setLic] = useState<string | null>(null);
  useEffect(() => {
    fetch('./licenses/milsymbol-LICENSE.txt')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setLic)
      .catch(() => setLic(null));
  }, []);
  return (
    <main className="page">
      <div className="page-inner" style={{ maxWidth: 820 }}>
        <BackHeader title="Credits & licenses" />
        <section className="card">
          <h3>World Command: World 120</h3>
          <p className="dim">Original code, presentation, names and balance values. All unit names are fictional. Functional reference: the Conflict of Nations wiki (no text, art or icons reused). Runs entirely offline.</p>
        </section>
        <section className="card">
          <h3>Geography — Natural Earth (public domain)</h3>
          <p className="dim">Country boundaries derived from Natural Earth 1:50m Admin 0 vectors (public domain, naturalearthdata.com terms of use), packaged by world-atlas 2.0.2 (ISC). Province and sea-sector subdivisions are generated by this project. Boundary depiction is a game abstraction and implies no political position.</p>
        </section>
        <section className="card">
          <h3>Military symbols — milsymbol {RENDERER.version} ({RENDERER.license})</h3>
          <p className="dim">{SYMBOL_EDITION}. Crosswalk version {SYMBOL_CROSSWALK_VERSION}. PLANOPS Maps was used as a visual vocabulary reference only.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 260, overflow: 'auto', background: 'var(--bg-2)', padding: 10, borderRadius: 6 }} data-testid="milsymbol-license">
            {lic ?? `MIT License — Copyright (c) Måns Beckman (spatialillusions). Full text bundled at licenses/milsymbol-LICENSE.txt.`}
          </pre>
        </section>
        <section className="card">
          <h3>Software</h3>
          <p className="dim">React 18 (MIT), Vite (MIT), TypeScript (Apache-2.0). Fonts: your system's sans-serif face; no remote fonts are loaded.</p>
        </section>
      </div>
    </main>
  );
}

export function DiagnosticsScreen() {
  const host = getHost();
  const hs = useStore(host.store);
  const [storage, setStorage] = useState<{ persisted: boolean | null; usage?: number; quota?: number } | null>(null);
  const [cpCount, setCpCount] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void requestPersistence().then((r) => setStorage({ persisted: r.persisted, usage: r.estimate?.usage, quota: r.estimate?.quota }));
    void listCheckpoints().then((l) => setCpCount(l.length)).catch(() => {});
  }, []);
  const f = hs.frame;
  const errs = (window as unknown as { __wcErrors?: string[] }).__wcErrors ?? [];
  const report = [
    `World Command ${APP_VERSION}`,
    `User agent: ${navigator.userAgent}`,
    `Save format version: ${f?.meta.formatVersion ?? '1'} (world-command-save)`,
    `Scenario version: ${f?.meta.scenarioVersion ?? 'n/a'}`,
    `Campaign: ${f?.meta.campaignName ?? 'none open'} (${f?.meta.campaignId ?? '-'}) seed ${f?.meta.seed ?? '-'} rev ${f?.meta.saveRevision ?? '-'}`,
    `Last successful save: ${hs.lastGoodSave ? `${wallTime(hs.lastGoodSave.at)} (${bytes(hs.lastGoodSave.bytes)}, ${hs.lastGoodSave.ms.toFixed(0)} ms, ${hs.lastGoodSave.reason})` : 'none this session'}`,
    `Last save result: ${hs.lastSave ? (hs.lastSave.ok ? 'ok' : `FAILED: ${hs.lastSave.error}`) : 'n/a'}`,
    `IndexedDB: ${storageAvailable() ? 'available' : 'UNAVAILABLE'}; persistent: ${storage?.persisted ?? 'unknown'}; usage ${storage?.usage ? bytes(storage.usage) : '?'} of ${storage?.quota ? bytes(storage.quota) : '?'}`,
    `Recovery copies: ${cpCount}`,
    `Symbol asset errors: ${getAssetValidationErrors().length ? getAssetValidationErrors().map((e) => `${e.key}: ${e.reason}`).join('; ') : 'none'}`,
    `Worker logs: ${hs.logs.map((l) => `[${l.level}] ${l.message}`).join(' | ') || 'none'}`,
    `Host error: ${hs.error ?? 'none'}`,
    `UI errors: ${errs.length ? errs.join('\n') : 'none'}`,
  ].join('\n');
  return (
    <main className="page">
      <div className="page-inner" style={{ maxWidth: 820 }}>
        <BackHeader title="Diagnostics" />
        <dl className="kv card">
          <dt>Application version</dt>
          <dd data-testid="app-version">{APP_VERSION}</dd>
          <dt>Save format version</dt>
          <dd>{f?.meta.formatVersion ?? 1}</dd>
          <dt>Last successful save</dt>
          <dd>{hs.lastGoodSave ? wallTime(hs.lastGoodSave.at) : 'none this session'}</dd>
          <dt>Storage</dt>
          <dd>{storageAvailable() ? (storage?.persisted ? 'Persistent' : 'Best-effort (may be evicted)') : 'Unavailable'}</dd>
          <dt>Online service status</dt>
          <dd>Not applicable — fully local, no server</dd>
        </dl>
        <label className="field">
          Error report (copy and keep with your exported save)
          <textarea readOnly rows={14} value={report} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </label>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(report);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            Copy report
          </button>
          {copied && <span className="ok" role="status">Copied.</span>}
        </div>
      </div>
    </main>
  );
}
