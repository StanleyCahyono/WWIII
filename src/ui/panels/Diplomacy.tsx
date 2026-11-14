import React, { useMemo, useState } from 'react';
import { useFrame, ActionButton, Modal, FlagChip } from '../components/common';
import { getHost } from '../sim/host';
import { ui } from '../state/ui';
import { countryName, RESOURCE_LABEL, MAP } from '../data/static';
import { gameTime, duration, cap, num, wallTime } from '../format';
import { exec } from '../sim/exec';
import { RESOURCES } from '../../engine/data-types';
import type { Offer, OfferTerm, DiplomacyRow } from '../../engine/index';
import type { Frame } from '../sim/protocol';

function statusLabel(s: string) {
  return s === 'war' ? 'War' : s === 'peace' ? 'Peace' : s === 'right_of_way' ? 'Right of way' : s === 'shared_intel' ? 'Shared intel' : s;
}
export function termText(t: OfferTerm): string {
  if (t.kind === 'status') return statusLabel(t.level);
  if (t.kind === 'peace') return 'Peace treaty';
  if (t.kind === 'coalition_invite') return 'Coalition membership';
  return `${num(t.amount / 1000)} ${RESOURCE_LABEL[t.resource].toLowerCase()}`;
}
function threadKey(a: string, b: string) {
  return `dm:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

let lastSel: string | null = null;

export function DiplomacyPanel({ arg }: { arg: { country?: string } | null }) {
  const frame = useFrame()!;
  const [sel, setSel] = useState<string | null>(arg?.country ?? lastSel);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'neighbours' | 'war' | 'pending' | 'agreements'>('all');
  const v = frame.view;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return v.relations.filter((r) => {
      if (s && !r.name.toLowerCase().includes(s) && !r.country.toLowerCase().includes(s)) return false;
      if (filter === 'war') return r.war;
      if (filter === 'pending') return r.pendingOffers.length > 0;
      if (filter === 'agreements') return r.myStatusToThem !== 'peace' || r.theirStatusToMe !== 'peace' || r.sameCoalition;
      if (filter === 'neighbours') return neighbourSet(frame).has(r.country);
      return true;
    }).sort((a, b) => Number(b.pendingOffers.length > 0) - Number(a.pendingOffers.length > 0) || a.name.localeCompare(b.name));
  }, [v.relations, q, filter, frame]);
  const chosen = v.relations.find((r) => r.country === sel) ?? null;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }} data-testid="diplomacy-panel">
      <div className="col" style={{ flex: '1 1 420px', minWidth: 0 }}>
        <div className="row wrap">
          <label className="sr-only" htmlFor="dip-q">Search countries</label>
          <input id="dip-q" type="search" placeholder="Search nations…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="region-filters" role="group" aria-label="Filter">
            {(['all', 'neighbours', 'war', 'pending', 'agreements'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {cap(f)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}>
          <table className="data" data-testid="nation-list">
            <thead>
              <tr>
                <th>Nation</th>
                <th>Controller</th>
                <th>You grant →</th>
                <th>← They grant</th>
                <th className="num">Trust</th>
                <th className="num">Offers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.country} className={sel === r.country ? 'sel' : ''}>
                  <td>
                    <button type="button" className="btn ghost small" style={{ padding: 0, minHeight: 0, gap: 6 }} onClick={() => { setSel(r.country); lastSel = r.country; }} data-testid={`nation-${r.country}`}>
                      <FlagChip id={r.country} /> {r.name}
                    </button>
                    {!r.alive && <span className="tag">eliminated</span>}
                    {r.sameCoalition && <span className="tag accent">coalition</span>}
                  </td>
                  <td>{r.controller === 'ai' ? 'Computer' : 'You'}</td>
                  <td className={r.war ? 'bad' : ''}>{statusLabel(r.myStatusToThem)}</td>
                  <td className={r.war ? 'bad' : ''}>{statusLabel(r.theirStatusToMe)}</td>
                  <td className="num">{Math.round(r.trust)}</td>
                  <td className="num">{r.pendingOffers.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="col" style={{ flex: '1 1 380px', minWidth: 0 }}>
        {chosen ? <CountryDetail r={chosen} frame={frame} /> : <div className="empty">Select a nation to see relations in both directions, pending offers and your private thread.</div>}
      </div>
    </div>
  );
}

function neighbourSet(frame: Frame): Set<string> {
  const s = new Set<string>();
  const owners = frame.view.owners;
  for (const p of frame.view.provinces)
    for (const nb of MAP.adjacency[p.node] ?? []) {
      if (nb.kind !== 'land' && nb.kind !== 'strait') continue;
      const o = owners[nb.node];
      if (o && o !== frame.view.viewer) s.add(o);
    }
  return s;
}

function CountryDetail({ r, frame }: { r: DiplomacyRow; frame: Frame }) {
  const v = frame.view;
  const [compose, setCompose] = useState(false);
  const [war, setWar] = useState<{ effects: string[] } | null>(null);
  const [msg, setMsg] = useState('');
  const thread = v.messages[threadKey(v.viewer, r.country)] ?? [];
  const offers = v.offers.filter((o) => o.from === r.country || o.to === r.country).sort((a, b) => b.createdAt - a.createdAt);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const gone = !r.alive;
  return (
    <div className="col" data-testid="country-detail">
      <div className="row">
        <FlagChip id={r.country} />
        <h3>{r.name}</h3>
        <span className="muted">{r.controller === 'ai' ? 'Computer-controlled' : 'Human'}</span>
      </div>
      {gone && <div className="card warn" role="status">This country has been eliminated; offers and messages are closed.</div>}
      <dl className="kv card">
        <dt>You grant {r.name}</dt>
        <dd>{statusLabel(r.myStatusToThem)}</dd>
        <dt>{r.name} grants you</dt>
        <dd>{statusLabel(r.theirStatusToMe)}</dd>
        <dt>State</dt>
        <dd className={r.war ? 'bad' : ''}>{r.war ? 'At war' : 'Not at war'}</dd>
        <dt>Trust (their view of you)</dt>
        <dd>{Math.round(r.trust)}</dd>
        <dt>Coalition</dt>
        <dd>{r.coalition ? v.coalitions.find((c) => c.id === r.coalition)?.name ?? r.coalition : 'None'}</dd>
      </dl>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Right of way lets the other side's formations cross your territory (it does not make them friendly). Shared intel shares your observations and reports. Each direction is granted separately.</p>
      <div className="row wrap">
        <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : gone ? 'Country eliminated.' : null} onClick={() => setCompose(true)} data-testid="propose-offer">
          Send request / offer…
        </ActionButton>
        {(r.myStatusToThem === 'right_of_way' || r.myStatusToThem === 'shared_intel') && (
          <ActionButton className="btn" disabledReason={ro ? 'Read-only campaign' : null} onClick={() => exec({ type: 'revokeGrant', to: r.country, level: r.myStatusToThem === 'shared_intel' ? 'right_of_way' : 'peace' }, 'Grant reduced.')}>
            Revoke {statusLabel(r.myStatusToThem)}
          </ActionButton>
        )}
        <ActionButton
          className="btn danger"
          disabledReason={ro ? 'Read-only campaign' : gone ? 'Country eliminated.' : r.war ? 'Already at war.' : r.sameCoalition ? 'Coalition partner — leave the coalition first.' : null}
          onClick={async () => {
            const p = await getHost().preview<{ effects: string[] }>({ type: 'declareWar', target: r.country });
            setWar({ effects: p.ok ? p.preview.effects : [p.reason] });
          }}
        >
          Declare war…
        </ActionButton>
      </div>
      <h4>Offers</h4>
      {offers.length === 0 ? <div className="empty">No offers with {r.name}.</div> : offers.map((o) => <OfferCard key={o.id} o={o} frame={frame} />)}
      <h4>Private thread</h4>
      <div className="card" style={{ maxHeight: 260, overflow: 'auto' }} data-testid="thread">
        {thread.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No messages yet.</p>
        ) : (
          thread.map((m) => (
            <div key={m.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {countryName(m.from)} → {m.to ? countryName(m.to) : 'thread'} · {gameTime(m.at)}
              </div>
              <div>{m.text}</div>
              {m.reason && <div className="muted" style={{ fontSize: 12 }}>Reason: {m.reason}</div>}
            </div>
          ))
        )}
      </div>
      <div className="row">
        <label className="sr-only" htmlFor="dm-text">Message to {r.name}</label>
        <input id="dm-text" type="text" className="grow" placeholder={`Message ${r.name} (kept in this save)`} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} />
        <ActionButton className="btn" disabledReason={ro ? 'Read-only campaign' : gone ? 'Country eliminated.' : !msg.trim() ? 'Type a message first.' : null} onClick={async () => { const res = await exec({ type: 'sendMessage', to: r.country, text: msg.trim() }); if (res.ok) setMsg(''); }}>
          Send
        </ActionButton>
      </div>
      {compose && <OfferComposer to={r} onClose={() => setCompose(false)} />}
      {war && (
        <Modal
          title={`Declare war on ${r.name}?`}
          onClose={() => setWar(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setWar(null)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={async () => { await exec({ type: 'declareWar', target: r.country }, `War declared on ${r.name}.`); setWar(null); }}>
                Declare war
              </button>
            </>
          }
        >
          <p>A declaration takes effect immediately — unlike a request, which waits for {r.name}'s answer.</p>
          <ul>
            {war.effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

export function OfferCard({ o, frame }: { o: Offer; frame: Frame }) {
  const v = frame.view;
  const [busy, setBusy] = useState(false);
  const mine = o.from === v.viewer;
  const recipient = o.to === v.viewer;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const respond = async (accept: boolean) => {
    if (busy) return; // double-click safe (plus nonce idempotency in the engine)
    setBusy(true);
    await exec({ type: 'respondOffer', offer: o.id, accept }, accept ? 'Offer accepted.' : 'Offer declined.');
    setBusy(false);
  };
  return (
    <div className="card" data-testid={`offer-${o.id}`}>
      <div className="row wrap">
        <strong>{mine ? `To ${countryName(o.to)}` : `From ${countryName(o.from)}`}</strong>
        <span className={`tag${o.status === 'accepted' ? ' ok' : o.status === 'pending' ? ' accent' : ''}`}>{o.status}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          sent {gameTime(o.createdAt)} · {o.status === 'pending' ? `expires ${gameTime(o.expiresAt)} (${duration(o.expiresAt - v.tick)})` : o.resolvedAt ? `resolved ${gameTime(o.resolvedAt)}` : ''}
        </span>
      </div>
      <div style={{ fontSize: 13 }}>
        {countryName(o.from)} gives: {o.give.length ? o.give.map(termText).join(', ') : 'nothing'} · asks: {o.receive.length ? o.receive.map(termText).join(', ') : 'nothing'}
      </div>
      {o.effectiveAt && <div className="muted" style={{ fontSize: 12 }}>Effective {gameTime(o.effectiveAt)}{o.applied ? ' (applied)' : ''}</div>}
      {o.responseReason && <div className="dim" style={{ fontSize: 12.5 }}>Reply: {o.responseReason}</div>}
      {o.status === 'pending' && recipient && (
        <div className="row">
          <ActionButton className="btn small primary" disabledReason={ro ? 'Read-only campaign' : busy ? 'Submitting…' : null} onClick={() => respond(true)}>
            Accept
          </ActionButton>
          <ActionButton className="btn small" disabledReason={ro ? 'Read-only campaign' : busy ? 'Submitting…' : null} onClick={() => respond(false)}>
            Decline
          </ActionButton>
        </div>
      )}
      {o.status === 'pending' && mine && (
        <div className="row">
          <span className="muted" style={{ fontSize: 12 }}>Awaiting their answer — only the recipient can accept.</span>
          <ActionButton className="btn small" disabledReason={ro ? 'Read-only campaign' : null} onClick={() => exec({ type: 'withdrawOffer', offer: o.id }, 'Offer withdrawn.')}>
            Withdraw
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function OfferComposer({ to, onClose }: { to: DiplomacyRow; onClose: () => void }) {
  const frame = useFrame()!;
  const v = frame.view;
  const [give, setGive] = useState<OfferTerm[]>([]);
  const [receive, setReceive] = useState<OfferTerm[]>(to.war ? [] : [{ kind: 'status', level: 'right_of_way' }]);
  const [hours, setHours] = useState(24);
  const [text, setText] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; reason?: string } | null>(null);
  const myCo = v.myCoalition ? v.coalitions.find((c) => c.id === v.myCoalition) : null;
  const options: { label: string; term: OfferTerm; side: 'give' | 'receive' | 'both' }[] = [
    ...(to.war ? [{ label: 'Peace treaty', term: { kind: 'peace' } as OfferTerm, side: 'both' as const }] : []),
    ...(!to.war ? [
      { label: 'Right of way', term: { kind: 'status', level: 'right_of_way' } as OfferTerm, side: 'both' as const },
      { label: 'Shared intel', term: { kind: 'status', level: 'shared_intel' } as OfferTerm, side: 'both' as const },
    ] : []),
    ...(myCo && !to.coalition ? [{ label: `Membership in ${myCo.name}`, term: { kind: 'coalition_invite', coalition: myCo.id } as OfferTerm, side: 'give' as const }] : []),
  ];
  const [resAmt, setResAmt] = useState<{ r: string; amt: string; side: 'give' | 'receive' }>({ r: 'money', amt: '500', side: 'give' });
  const has = (list: OfferTerm[], t: OfferTerm) => list.some((x) => JSON.stringify(x) === JSON.stringify(t));
  const toggle = (side: 'give' | 'receive', t: OfferTerm) => (side === 'give' ? setGive : setReceive)((l) => (has(l, t) ? l.filter((x) => JSON.stringify(x) !== JSON.stringify(t)) : [...l, t]));
  const cmd = { type: 'proposeOffer' as const, to: to.country, give, receive, expiresInMin: hours * 60, text: text.trim() || undefined };
  React.useEffect(() => {
    let alive = true;
    void getHost().preview(cmd).then((r) => alive && setCheck(r.ok ? { ok: true } : { ok: false, reason: r.reason }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cmd)]);
  return (
    <Modal
      title={`Offer to ${to.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <ActionButton className="btn primary" disabledReason={check && !check.ok ? check.reason ?? 'Invalid offer.' : null} onClick={async () => { const r = await exec(cmd, `Offer sent to ${to.name}. They will answer in your thread.`); if (r.ok) onClose(); }} data-testid="send-offer">
            Send request
          </ActionButton>
        </>
      }
    >
      <p className="dim" style={{ margin: 0 }}>A request only takes effect if {to.name} accepts. Terms are recorded exactly; the computer evaluates them from its memory of your dealings, its position and competing commitments.</p>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        {(['give', 'receive'] as const).map((side) => (
          <fieldset key={side} style={{ flex: '1 1 240px' }}>
            <legend>{side === 'give' ? `You give ${to.name}` : `You ask from ${to.name}`}</legend>
            {options.filter((o) => o.side === 'both' || o.side === side).map((o) => (
              <label key={o.label} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={has(side === 'give' ? give : receive, o.term)} onChange={() => toggle(side, o.term)} data-testid={`term-${side}-${o.label.replace(/\s+/g, '-').toLowerCase()}`} />
                {o.label}
              </label>
            ))}
            {(side === 'give' ? give : receive).filter((t) => t.kind === 'resource').map((t, i) => (
              <div key={i} className="row">
                {termText(t)}
                <button type="button" className="btn small" onClick={() => toggle(side, t)}>
                  Remove
                </button>
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="row wrap">
        <span>Add resources:</span>
        <select value={resAmt.side} onChange={(e) => setResAmt({ ...resAmt, side: e.target.value as 'give' | 'receive' })} aria-label="Direction">
          <option value="give">I give</option>
          <option value="receive">I ask</option>
        </select>
        <input type="number" min={1} value={resAmt.amt} onChange={(e) => setResAmt({ ...resAmt, amt: e.target.value })} style={{ width: 100 }} aria-label="Amount" />
        <select value={resAmt.r} onChange={(e) => setResAmt({ ...resAmt, r: e.target.value })} aria-label="Resource">
          {RESOURCES.map((r) => (
            <option key={r} value={r}>
              {RESOURCE_LABEL[r]}
            </option>
          ))}
        </select>
        <button type="button" className="btn small" onClick={() => { const amt = Math.floor(Number(resAmt.amt)); if (amt > 0) toggle(resAmt.side, { kind: 'resource', resource: resAmt.r as never, amount: amt * 1000 }); }}>
          Add
        </button>
      </div>
      <label className="row" style={{ gap: 6 }}>
        Expires in
        <input type="number" min={1} max={336} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(336, Math.floor(Number(e.target.value) || 1))))} style={{ width: 80 }} />
        game hours
      </label>
      <label className="field">
        Note (plain text, optional)
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
      </label>
      {check && !check.ok && <p className="bad" role="alert">{check.reason}</p>}
    </Modal>
  );
}

export function CoalitionPanel() {
  const frame = useFrame()!;
  const v = frame.view;
  const [create, setCreate] = useState(false);
  const [sel, setSel] = useState<string | null>(v.myCoalition);
  const [leave, setLeave] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', description: '', emblem: '★' });
  const [msg, setMsg] = useState('');
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const active = v.coalitions.filter((c) => !c.dissolvedAt);
  const chosen = v.coalitions.find((c) => c.id === sel) ?? null;
  const myCo = v.myCoalition;
  const thread = myCo ? v.messages[`co:${myCo}`] ?? [] : [];
  return (
    <div className="col" data-testid="coalition-panel">
      <div className="row wrap">
        <span>{myCo ? `You are a member of ${v.coalitions.find((c) => c.id === myCo)?.name}.` : 'You are not in a coalition.'}</span>
        <div className="grow" />
        <ActionButton className="btn" disabledReason={ro ? 'Read-only campaign' : myCo ? 'Leave your coalition before founding another.' : null} onClick={() => setCreate(true)}>
          Create coalition…
        </ActionButton>
      </div>
      {active.length === 0 ? (
        <div className="empty">No coalitions yet. Computer countries form them over time; you can found one.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Coalition</th>
              <th>Leader</th>
              <th className="num">Members</th>
              <th className="num">VP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((c) => (
              <tr key={c.id} className={sel === c.id ? 'sel' : ''}>
                <td>
                  <span aria-hidden>{c.emblem}</span> {c.name}
                </td>
                <td>{countryName(c.leader)}</td>
                <td className="num">{c.members.length}/5</td>
                <td className="num">{c.score}</td>
                <td>
                  <button type="button" className="btn small" onClick={() => setSel(c.id)}>
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {chosen && (
        <div className="card col">
          <h3>
            {chosen.emblem} {chosen.name}
          </h3>
          <p className="dim" style={{ margin: 0 }}>{chosen.description || 'No description.'}</p>
          <dl className="kv">
            <dt>Leader</dt>
            <dd>{countryName(chosen.leader)}</dd>
            <dt>Total score</dt>
            <dd>{chosen.score} VP</dd>
            <dt>Required ({Math.max(2, chosen.members.length)} members)</dt>
            <dd>{v.scores.coalitionThresholds[Math.max(2, Math.min(5, chosen.members.length))]} VP</dd>
            <dt>Remaining slots</dt>
            <dd>{5 - chosen.members.length}</dd>
            <dt>Admission</dt>
            <dd>{chosen.members.length >= 5 ? 'Full' : 'Open to applications (leader decides)'}</dd>
            <dt>Founded</dt>
            <dd>{gameTime(chosen.createdAt)}</dd>
          </dl>
          <table className="data">
            <thead>
              <tr>
                <th>Member</th>
                <th className="num">Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {chosen.members.map((m) => {
                const dep = chosen.departures.find((d) => d.country === m);
                return (
                  <tr key={m}>
                    <td>{countryName(m)}{m === v.viewer ? ' (you)' : ''}</td>
                    <td className="num">{v.scores.byCountry[m] ?? 0}</td>
                    <td>{dep ? `Leaving at ${gameTime(dep.effectiveAt)} (${duration(dep.effectiveAt - v.tick)}); transit still shared until then` : 'Member'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {chosen.applications && chosen.applications.length > 0 && (
            <>
              <h4>Applications (you lead)</h4>
              {chosen.applications.map((a) => (
                <div key={a.country} className="row">
                  {countryName(a.country)} · {gameTime(a.at)}
                  <button type="button" className="btn small primary" onClick={() => exec({ type: 'respondApplication', coalition: chosen.id, applicant: a.country, accept: true }, 'Admitted.')}>
                    Admit
                  </button>
                  <button type="button" className="btn small" onClick={() => exec({ type: 'respondApplication', coalition: chosen.id, applicant: a.country, accept: false }, 'Declined.')}>
                    Decline
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="row">
            {myCo === chosen.id ? (
              <ActionButton
                className="btn danger"
                disabledReason={ro ? 'Read-only campaign' : chosen.departures.some((d) => d.country === v.viewer) ? 'Departure already announced.' : null}
                onClick={async () => {
                  const p = await getHost().preview<{ effectiveAt: number }>({ type: 'leaveCoalition' });
                  setLeave(p.ok ? p.preview.effectiveAt : -1);
                }}
              >
                Leave coalition…
              </ActionButton>
            ) : (
              <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : myCo ? 'You are already in a coalition.' : chosen.members.length >= 5 ? 'Coalition is full.' : null} onClick={() => exec({ type: 'applyCoalition', coalition: chosen.id }, `Applied to ${chosen.name}. The leader decides.`)}>
                Apply to join
              </ActionButton>
            )}
          </div>
        </div>
      )}
      {myCo && (
        <div className="card col">
          <h4>Coalition thread (current members only)</h4>
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {thread.length === 0 ? <p className="muted">No posts.</p> : thread.map((m) => (
              <div key={m.id} style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
                <span className="muted" style={{ fontSize: 11.5 }}>{countryName(m.from)} · {gameTime(m.at)}</span>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
          <div className="row">
            <input type="text" className="grow" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Post to coalition" aria-label="Coalition message" maxLength={500} />
            <ActionButton className="btn" disabledReason={!msg.trim() ? 'Type a message first.' : ro ? 'Read-only campaign' : null} onClick={async () => { const r = await exec({ type: 'sendMessage', to: 'coalition', text: msg.trim() }); if (r.ok) setMsg(''); }}>
              Post
            </ActionButton>
          </div>
        </div>
      )}
      {create && (
        <Modal
          title="Create a coalition"
          onClose={() => setCreate(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCreate(false)}>
                Cancel
              </button>
              <ActionButton className="btn primary" disabledReason={!form.name.trim() ? 'Enter a name.' : null} onClick={async () => { const r = await exec({ type: 'createCoalition', name: form.name.trim(), description: form.description.trim(), emblem: form.emblem }, 'Coalition founded.'); if (r.ok) setCreate(false); }}>
                Create
              </ActionButton>
            </>
          }
        >
          <label className="field">
            Name
            <input type="text" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} data-autofocus />
          </label>
          <label className="field">
            Description
            <textarea value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <fieldset>
            <legend>Emblem</legend>
            <div className="row wrap">
              {['★', '◆', '▲', '●', '✚', '⬢', '☰', '⚓'].map((e) => (
                <label key={e} className="row" style={{ gap: 4 }}>
                  <input type="radio" checked={form.emblem === e} onChange={() => setForm({ ...form, emblem: e })} />
                  <span style={{ fontSize: 18 }}>{e}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Modal>
      )}
      {leave !== null && (
        <Modal
          title="Leave coalition?"
          onClose={() => setLeave(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setLeave(null)}>
                Stay
              </button>
              <button type="button" className="btn danger" onClick={async () => { await exec({ type: 'leaveCoalition' }, 'Departure announced.'); setLeave(null); }}>
                Announce departure
              </button>
            </>
          }
        >
          <p>{leave > 0 ? `Your departure takes effect at ${gameTime(leave)} (24 h notice). Until then transit is still shared and you count toward the bloc.` : 'Cannot leave right now.'}</p>
        </Modal>
      )}
      <p className="muted" style={{ fontSize: 12 }}>Last updated {wallTime(Date.now())}</p>
    </div>
  );
}
