import React, { useState } from 'react';
import { useFrame, useQuery, ActionButton } from '../components/common';
import { useStore } from '../state/store';
import { ui, centerOn, select } from '../state/ui';
import { NODES, cityByNode, countryName, placeName } from '../data/static';
import { gameTime, dayOf, hourLabel, relWall, cap } from '../format';
import { exec } from '../sim/exec';
import { readableEventText } from '../eventText';
import { Icon } from '../icons';
import { IconTabs } from './panelKit';

const CAT_ICON: Record<string, string> = { '': 'journal', economy: 'economy', research: 'research', diplomacy: 'diplomacy', combat: 'sword', intel: 'intel', government: 'flag', system: 'settings' };

interface J { id: string; at: number; kind: string; category: string; node: number | null; text: string; data?: Record<string, unknown>; interrupt: boolean; routine: boolean }

function goto(node: number | null) {
  if (node === null || !NODES[node]) return;
  const n = NODES[node];
  centerOn(n.center[0], n.center[1], 30);
  const c = cityByNode.get(node);
  if (c) select({ kind: 'city', key: c.key, node });
  else if (n.kind === 'land') select({ kind: 'province', node });
  ui.patch({ panel: null });
}

export function JournalPanel() {
  const frame = useFrame();
  const [cat, setCat] = useState('');
  const [tab, setTab] = useState<'journal' | 'notifications'>('journal');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery<J[]>('journal', [500, cat]);
  const history = useStore(ui, (s) => s.toastHistory);
  const groups = new Map<number, J[]>();
  // never show rows of the previous filter while the new query is in flight
  const rows = (q.data ?? []).filter((e) => !cat || e.category === cat);
  for (const e of [...rows].sort((a, b) => b.at - a.at)) {
    const d = dayOf(e.at);
    (groups.get(d) ?? groups.set(d, []).get(d)!).push(e);
  }
  const detail = useQuery<{ id: string; at: number; kind: string; category: string; node: number | null; text: string; data: Record<string, unknown> | null } | null>('eventDetail', [open], { enabled: !!open });
  return (
    <div className="col p-root" data-testid="journal-panel">
      <IconTabs
        compact
        label="Journal views"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'journal', label: 'Private journal', icon: <Icon name="journal" size={16} /> },
          { key: 'notifications', label: `Notification history (${history.length})`, icon: <Icon name="bell" size={16} /> },
        ]}
      />
      {tab === 'journal' && (
        <>
          <div className="region-filters p-chips" role="group" aria-label="Category filter">
            {['', 'economy', 'research', 'diplomacy', 'combat', 'intel', 'government', 'system'].map((c) => (
              <button key={c || 'all'} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} data-testid={`journal-filter-${c || 'all'}`}>
                <Icon name={CAT_ICON[c] ?? 'journal'} size={14} />
                {c ? cap(c) : 'All'}
              </button>
            ))}
          </div>
          {!q.data && <p className="muted">Loading…</p>}
          {q.data && rows.length === 0 && <div className="empty">No events{cat ? ` in ${cat}` : ''} yet.</div>}
          {[...groups.entries()].map(([d, list]) => (
            <section key={d} aria-label={`Day ${d}`} className="p-jday">
              <h4 className="p-jday-h"><span>Day {d}</span></h4>
              <ul className="p-jlist">
                {list.map((e) => (
                  <li key={e.id} className={`p-jrow cat-${e.category}`}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <span className="p-jtime">{hourLabel(e.at)}</span>
                      <span className="p-jcat" aria-hidden="true"><Icon name={CAT_ICON[e.category] ?? 'journal'} size={16} /></span>
                      <span className="tag">{e.category}</span>
                      <button type="button" className="btn ghost small grow" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', minHeight: 0 }} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {readableEventText(e, frame)}
                      </button>
                      {e.node !== null && (
                        <button type="button" className="btn small" onClick={() => goto(e.node)} aria-label={`Go to ${placeName(e.node)}`}>
                          Go
                        </button>
                      )}
                    </div>
                    {open === e.id && (
                      <div className="card p-jdetail">
                        <dl className="kv">
                          <dt>Recorded</dt>
                          <dd>{gameTime(e.at)}</dd>
                          <dt>Place</dt>
                          <dd>{e.node !== null ? placeName(e.node) : '—'}</dd>
                          <dt>Kind</dt>
                          <dd>{e.kind.replace(/_/g, ' ')}</dd>
                          {Object.entries(detail.data?.data ?? e.data ?? {}).map(([k, v]) => (
                            <React.Fragment key={k}>
                              <dt>{cap(k)}</dt>
                              <dd>{String(v)}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                        <p className="muted" style={{ margin: 0, fontSize: 12 }}>This record keeps its place, time and outcome even after the units involved are gone.</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {tab === 'notifications' &&
        (history.length === 0 ? (
          <div className="empty">No notifications this session.</div>
        ) : (
          <ul className="p-jlist">
            {history.map((t) => (
              <li key={t.id + t.at} className="row p-jrow">
                <span className="p-jtime" style={{ minWidth: 80 }}>{relWall(t.at)}</span>
                <span className="grow">{t.text}</span>
                {t.node !== null && (
                  <button type="button" className="btn small" onClick={() => goto(t.node)}>
                    Go
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

interface Paper { day: number; items: { id: string; at: number; headline: string; countries: string[]; node: number | null }[]; articles: { id: string; at: number; headline: string; body: string; author: string | null }[]; index: { rank: number; country: string; vp: number }[] }

export function NewsPanel() {
  const frame = useFrame()!;
  const today = frame.view.day;
  const [day, setDay] = useState(today);
  const q = useQuery<Paper | null>('newspaper', [day]);
  const [compose, setCompose] = useState({ headline: '', body: '', anonymous: false });
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  return (
    <div className="p-root p-news" data-testid="news-panel">
      <div className="col p-paper" style={{ minWidth: 0 }}>
        <div className="row p-masthead">
          <button type="button" className="btn small" onClick={() => setDay((d) => Math.max(1, d - 1))} disabled={day <= 1} aria-label="Previous edition">
            ← Previous
          </button>
          <h3 style={{ flex: 1, textAlign: 'center' }}>
            <span className="p-mast-title">The World 120 Dispatch</span> — Day {day}
          </h3>
          <button type="button" className="btn small" onClick={() => setDay((d) => Math.min(today, d + 1))} disabled={day >= today} aria-label="Next edition" title={day >= today ? 'Future editions do not exist yet.' : undefined}>
            Next →
          </button>
        </div>
        {!q.data ? (
          <p className="muted">{q.loading ? 'Loading…' : 'No edition for this day.'}</p>
        ) : (
          <>
            {q.data.items.length === 0 && q.data.articles.length === 0 && <div className="empty">A quiet day: no public events reported.</div>}
            {q.data.articles.map((a) => (
              <article key={a.id} className="card p-article">
                <h4 style={{ textTransform: 'none', fontSize: 17, color: 'var(--text)', letterSpacing: 0 }}>{a.headline}</h4>
                <div className="muted" style={{ fontSize: 12 }}>
                  {a.author ? `By ${countryName(a.author)}` : 'Anonymous statement'} · {gameTime(a.at)}
                </div>
                <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{a.body}</p>
              </article>
            ))}
            <ul className="p-dispatches">
              {q.data.items.map((it) => (
                <li key={it.id}>
                  <span className="muted" style={{ fontSize: 11.5 }}>{hourLabel(it.at)} · {it.countries.map(countryName).join(', ')}</span>
                  <div className="p-dispatch-h">{it.headline}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="col" style={{ minWidth: 0 }}>
        <div className="card p-index">
          <h4><Icon name="score" size={15} /> Nation index</h4>
          <table className="data">
            <tbody>
              {(q.data?.index ?? []).slice(0, 20).map((r) => (
                <tr key={r.country} className={r.country === frame.view.viewer ? 'sel' : ''}>
                  <td className="num">{r.rank}</td>
                  <td>{countryName(r.country)}</td>
                  <td className="num">{r.vp} VP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="p-card" onSubmit={(e) => e.preventDefault()} aria-label="Publish a statement">
          <h4>Publish a statement</h4>
          <label className="field">
            Headline
            <input type="text" maxLength={120} value={compose.headline} onChange={(e) => setCompose({ ...compose, headline: e.target.value })} />
          </label>
          <label className="field">
            Body (plain text)
            <textarea maxLength={2000} value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={compose.anonymous} onChange={(e) => setCompose({ ...compose, anonymous: e.target.checked })} /> Publish anonymously
          </label>
          <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : !compose.headline.trim() ? 'Headline required.' : !compose.body.trim() ? 'Body required.' : null} onClick={async () => { const r = await exec({ type: 'publishArticle', headline: compose.headline.trim(), body: compose.body.trim(), anonymous: compose.anonymous }, 'Published in today’s edition.'); if (r.ok) { setCompose({ headline: '', body: '', anonymous: false }); setDay(today); } }}>
            Publish
          </ActionButton>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Visible only inside this save. Stored and shown as plain text.</p>
        </form>
      </div>
    </div>
  );
}
