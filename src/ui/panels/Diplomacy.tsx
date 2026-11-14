import React, { useMemo, useState } from 'react';
import { useFrame, ActionButton, Modal, FlagChip } from '../components/common';
import { Icon } from '../icons';
import { StatTile, SectionHead, Expander } from './panelKit';
import { getHost } from '../sim/host';
import { ui } from '../state/ui';
import { countryName, RESOURCE_LABEL, MAP, placeName } from '../data/static';
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

/** Terms of one side of an offer, including territory clauses (peace settlements). */
export function offerSide(o: Offer, side: 'give' | 'receive'): string {
  const parts = [...o[side].map(termText), ...(o.territory?.[side] ?? []).map((n) => `cession of ${placeName(n)}`)];
  return parts.length ? parts.join(', ') : 'nothing';
}
/** Mirrors engine `rules.PEACE.maxRounds` (the frame omits rules; the validator enforces the limit). */
function maxRounds(_frame: Frame): number {
  return 4;
}

let lastSel: string | null = null;

const STATUS_ICON: Record<string, string> = { war: 'sword', peace: 'shield', right_of_way: 'move', shared_intel: 'intel' };
const STATUS_TONE: Record<string, string> = { war: 'bad', peace: '', right_of_way: 'accent', shared_intel: 'ok' };

/** A diplomatic status with its glyph (meaning carried by icon + words, not colour). */
function StatusChip({ s, compact }: { s: string; compact?: boolean }) {
  return (
    <span className={`p-dstat ${STATUS_TONE[s] ?? ''}`} title={statusLabel(s)}>
      <Icon name={STATUS_ICON[s] ?? 'diplomacy'} size={14} />
      {compact ? <span className="sr-only">{statusLabel(s)}</span> : statusLabel(s)}
    </span>
  );
}

/** Trust runs from −100 (hostile) to +100 (trusting); a centred bar shows the sign without colour. */
function TrustMeter({ v }: { v: number }) {
  const t = Math.max(-100, Math.min(100, Math.round(v)));
  const tone = t >= 20 ? 'pos' : t <= -20 ? 'neg' : 'mid';
  return (
    <span className="p-trust" title={`Trust ${t > 0 ? '+' : ''}${t} on a −100…+100 scale (their view of you)`}>
      <span className={`p-fbar ${tone}`} role="img" aria-label={`Trust ${t} of ±100`}>
        <span className={t >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.abs(t) / 2}%` }} />
      </span>
      <span className="num">{t > 0 ? '+' : t < 0 ? '−' : ''}{Math.abs(t)}</span>
    </span>
  );
}

export function DiplomacyPanel({ arg }: { arg: { country?: string } | null }) {
  const frame = useFrame()!;
  const [sel, setSel] = useState<string | null>(arg?.country ?? lastSel);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'neighbours' | 'war' | 'pending' | 'agreements'>('all');
  const v = frame.view;
  const nb = useMemo(() => neighbourSet(frame), [frame]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return v.relations.filter((r) => {
      if (s && !r.name.toLowerCase().includes(s) && !r.country.toLowerCase().includes(s)) return false;
      if (filter === 'war') return r.war;
      if (filter === 'pending') return r.pendingOffers.length > 0;
      if (filter === 'agreements') return r.myStatusToThem !== 'peace' || r.theirStatusToMe !== 'peace' || r.sameCoalition;
      if (filter === 'neighbours') return nb.has(r.country);
      return true;
    }).sort((a, b) => Number(b.pendingOffers.length > 0) - Number(a.pendingOffers.length > 0) || a.name.localeCompare(b.name));
  }, [v.relations, q, filter, nb]);
  const chosen = v.relations.find((r) => r.country === sel) ?? null;
  const counts = {
    war: v.relations.filter((r) => r.war).length,
    pending: v.relations.filter((r) => r.pendingOffers.length > 0).length,
    agreements: v.relations.filter((r) => r.myStatusToThem !== 'peace' || r.theirStatusToMe !== 'peace' || r.sameCoalition).length,
  };
  return (
    <div className="p-root p-diplo" data-testid="diplomacy-panel">
      <div className="p-diplo-list">
        <div className="p-tiles p-tiles-sm">
          <StatTile icon={<Icon name="sword" size={20} />} label="At war" value={counts.war} tone={counts.war ? 'bad' : undefined} />
          <StatTile icon={<Icon name="bell" size={20} />} label="Pending offers" value={counts.pending} tone={counts.pending ? 'warn' : undefined} />
          <StatTile icon={<Icon name="diplomacy" size={20} />} label="Agreements" value={counts.agreements} tone="ok" />
        </div>
        <div className="p-toolbar">
          <label className="sr-only" htmlFor="dip-q">Search countries</label>
          <span className="p-search">
            <Icon name="search" size={15} />
            <input id="dip-q" type="search" placeholder="Search nations…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <div className="region-filters p-chips" role="group" aria-label="Filter">
            {(['all', 'neighbours', 'war', 'pending', 'agreements'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {cap(f)}
              </button>
            ))}
          </div>
        </div>
        <ul className="p-nations" data-testid="nation-list" aria-label="Nations">
          {rows.length === 0 && <li className="empty">No nation matches.</li>}
          {rows.map((r) => (
            <li key={r.country}>
              <button type="button" className="p-nation" aria-current={sel === r.country ? 'true' : undefined} onClick={() => { setSel(r.country); lastSel = r.country; }} data-testid={`nation-${r.country}`}>
                <FlagChip id={r.country} />
                <span className="p-nation-name">
                  <strong>{r.name}</strong>
                  <span className="p-sub">
                    {r.controller === 'ai' ? 'Computer' : 'You'}
                    {!r.alive && <span className="p-pill">eliminated</span>}
                    {r.sameCoalition && <span className="p-pill accent">coalition</span>}
                    {nb.has(r.country) && <span>neighbour</span>}
                  </span>
                </span>
                <span className="p-nation-rel" aria-label={`You grant ${statusLabel(r.myStatusToThem)}; they grant ${statusLabel(r.theirStatusToMe)}`}>
                  <StatusChip s={r.myStatusToThem} compact />
                  <span className="muted" aria-hidden="true">⇄</span>
                  <StatusChip s={r.theirStatusToMe} compact />
                </span>
                <TrustMeter v={r.trust} />
                {r.pendingOffers.length > 0 ? <span className="p-badge solid" title={`${r.pendingOffers.length} pending offer(s)`}>{r.pendingOffers.length}</span> : <span className="p-badge-gap" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="p-diplo-detail">
        {chosen ? <CountryDetail key={chosen.country} r={chosen} frame={frame} /> : (
          <div className="p-card p-empty-card">
            <Icon name="diplomacy" size={40} />
            <p>Select a nation to see relations in both directions, pending offers and your private thread.</p>
          </div>
        )}
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
  const thread = v.messages[v.threadKeys[r.country] ?? ''] ?? [];
  const offers = v.offers.filter((o) => o.from === r.country || o.to === r.country).sort((a, b) => b.createdAt - a.createdAt);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const gone = !r.alive;
  const threadRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);
  return (
    <div className="col p-root" data-testid="country-detail">
      <div className={`p-dhead${r.war ? ' war' : ''}`}>
        <span className="p-bigflag"><FlagChip id={r.country} /></span>
        <div style={{ minWidth: 0 }}>
          <h3>{r.name}</h3>
          <div className="p-sub">
            <span>{r.controller === 'ai' ? 'Computer-controlled' : 'Human'}</span>
            <span className={`p-pill raw ${r.war ? 'bad' : 'ok'}`}>{r.war ? 'At war' : 'Not at war'}</span>
            {r.coalition && <span className="p-pill accent">{v.coalitions.find((c) => c.id === r.coalition)?.name ?? r.coalition}</span>}
          </div>
        </div>
      </div>
      {gone && <div className="p-card warn" role="status">This country has been eliminated; offers and messages are closed.</div>}
      <div className="p-relgrid">
        <div className="p-relcard">
          <span className="p-kicker">You grant {r.name}</span>
          <StatusChip s={r.myStatusToThem} />
        </div>
        <div className="p-relarrow" aria-hidden="true">⇄</div>
        <div className="p-relcard">
          <span className="p-kicker">{r.name} grants you</span>
          <StatusChip s={r.theirStatusToMe} />
        </div>
        <div className="p-relcard">
          <span className="p-kicker">Trust (their view of you)</span>
          <TrustMeter v={r.trust} />
        </div>
      </div>
      <div className="p-actions">
        <ActionButton className="btn primary p-start" disabledReason={ro ? 'Read-only campaign' : gone ? 'Country eliminated.' : null} onClick={() => setCompose(true)} data-testid="propose-offer">
          <Icon name="diplomacy" size={16} /> Send request / offer…
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
          <Icon name="sword" size={16} /> Declare war…
        </ActionButton>
      </div>
      <Expander summary="What these relations mean">
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Right of way lets the other side's formations cross your territory (it does not make them friendly). Shared intel shares your observations and reports. Each direction is granted separately.</p>
      </Expander>
      <SectionHead icon={<Icon name="bell" size={18} />} title={`Offers (${offers.length})`} level={4} />
      {offers.length === 0 ? <div className="empty">No offers with {r.name}.</div> : offers.map((o) => <OfferCard key={o.id} o={o} frame={frame} />)}
      <SectionHead icon={<Icon name="journal" size={18} />} title="Private thread" level={4} />
      <div className="p-thread" data-testid="thread" ref={threadRef}>
        {thread.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No messages yet.</p>
        ) : (
          thread.map((m) => (
            <div key={m.id} className={`p-msg${m.from === v.viewer ? ' mine' : ''}`}>
              <div className="p-msg-meta">
                {countryName(m.from)} → {m.to ? countryName(m.to) : 'thread'} · {gameTime(m.at)}
              </div>
              <div>{m.text}</div>
              {m.reason && <div className="muted" style={{ fontSize: 12 }}>Reason: {m.reason}</div>}
            </div>
          ))
        )}
      </div>
      <div className="row p-compose">
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
  const [counter, setCounter] = useState(false);
  const fromRow = v.relations.find((r) => r.country === o.from);
  const respond = async (accept: boolean) => {
    if (busy) return; // double-click safe (plus nonce idempotency in the engine)
    setBusy(true);
    await exec({ type: 'respondOffer', offer: o.id, accept }, accept ? 'Offer accepted.' : 'Offer declined.');
    setBusy(false);
  };
  return (
    <div className={`p-card p-offer ${o.status}${recipient && o.status === 'pending' ? ' incoming' : ''}`} data-testid={`offer-${o.id}`}>
      <div className="row wrap">
        <span className="p-offer-dir" aria-hidden="true"><Icon name={mine ? 'chevron-right' : 'chevron-left'} size={16} /></span>
        <strong>{mine ? `To ${countryName(o.to)}` : `From ${countryName(o.from)}`}</strong>
        <span className={`p-pill raw ${o.status === 'accepted' ? 'ok' : o.status === 'pending' ? 'accent' : o.status === 'declined' ? 'bad' : ''}`}>{o.status}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          sent {gameTime(o.createdAt)} · {o.status === 'pending' ? `expires ${gameTime(o.expiresAt)} (${duration(o.expiresAt - v.tick)})` : o.resolvedAt ? `resolved ${gameTime(o.resolvedAt)}` : ''}
        </span>
      </div>
      <div className="p-terms">
        <div className="p-term">
          <span className="p-kicker">{countryName(o.from)} gives</span>
          <span>{offerSide(o, 'give')}</span>
        </div>
        <span className="p-relarrow" aria-hidden="true">⇄</span>
        <div className="p-term">
          <span className="p-kicker">and asks</span>
          <span>{offerSide(o, 'receive')}</span>
        </div>
      </div>
      {(o.round ?? 1) > 1 && <div className="muted" style={{ fontSize: 12 }} data-testid={`offer-round-${o.id}`}>Counter-offer, round {o.round} of {maxRounds(frame)}</div>}
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
          <ActionButton className="btn small" disabledReason={ro ? 'Read-only campaign' : (o.round ?? 1) >= maxRounds(frame) ? `Final round (${maxRounds(frame)}): accept or decline.` : !fromRow ? 'Unknown sender.' : null} onClick={() => setCounter(true)} data-testid={`counter-${o.id}`}>
            Counter…
          </ActionButton>
        </div>
      )}
      {counter && fromRow && <OfferComposer to={fromRow} counter={o} onClose={() => setCounter(false)} />}
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

function OfferComposer({ to, onClose, counter }: { to: DiplomacyRow; onClose: () => void; counter?: Offer }) {
  const frame = useFrame()!;
  const v = frame.view;
  // a counter-offer starts from the received terms seen from our side (their give = our receive)
  const [give, setGive] = useState<OfferTerm[]>(counter ? counter.receive : []);
  const [receive, setReceive] = useState<OfferTerm[]>(counter ? counter.give : to.war ? [] : [{ kind: 'status', level: 'right_of_way' }]);
  const [terr, setTerr] = useState<{ give: number[]; receive: number[] }>({ give: counter?.territory?.receive ?? [], receive: counter?.territory?.give ?? [] });
  const [terrPick, setTerrPick] = useState<{ side: 'give' | 'receive'; node: string }>({ side: 'receive', node: '' });
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
  const hasTerr = terr.give.length + terr.receive.length > 0;
  const cmd = { type: 'proposeOffer' as const, to: to.country, give, receive, expiresInMin: hours * 60, text: text.trim() || undefined, ...(hasTerr ? { territory: terr } : {}), ...(counter ? { counterTo: counter.id } : {}) };
  // provinces each side could cede (current owners, never a capital — the engine re-checks)
  const capitals = new Set(v.publicCities.filter((c) => c.capital).map((c) => c.node));
  const holder = terrPick.side === 'give' ? v.viewer : to.country;
  const cedable = to.war ? v.owners.map((o, n) => (o === holder && !capitals.has(n) && !terr.give.includes(n) && !terr.receive.includes(n) ? n : -1)).filter((n) => n >= 0).sort((a, b) => placeName(a).localeCompare(placeName(b))) : [];
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
      title={counter ? `Counter-offer to ${to.name} (round ${(counter.round ?? 1) + 1} of ${maxRounds(frame)})` : `Offer to ${to.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <ActionButton className="btn primary" disabledReason={check && !check.ok ? check.reason ?? 'Invalid offer.' : null} onClick={async () => { const r = await exec(cmd, counter ? `Counter-offer sent to ${to.name}.` : `Offer sent to ${to.name}. They will answer in your thread.`); if (r.ok) onClose(); }} data-testid="send-offer">
            {counter ? 'Send counter-offer' : 'Send request'}
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
      {to.war && (
        <fieldset data-testid="territory-clauses">
          <legend>Territory (peace settlements only)</legend>
          {(['give', 'receive'] as const).map((side) =>
            terr[side].map((n) => (
              <div key={`${side}-${n}`} className="row">
                {side === 'give' ? `You cede ${placeName(n)}` : `${to.name} cedes ${placeName(n)}`}
                <button type="button" className="btn small" onClick={() => setTerr((t) => ({ ...t, [side]: t[side].filter((x) => x !== n) }))}>
                  Remove
                </button>
              </div>
            )),
          )}
          <div className="row wrap">
            <select value={terrPick.side} onChange={(e) => setTerrPick({ side: e.target.value as 'give' | 'receive', node: '' })} aria-label="Who cedes">
              <option value="receive">{to.name} cedes</option>
              <option value="give">I cede</option>
            </select>
            <select value={terrPick.node} onChange={(e) => setTerrPick({ ...terrPick, node: e.target.value })} aria-label="Province" data-testid="territory-node" style={{ maxWidth: 240 }}>
              <option value="">Province…</option>
              {cedable.map((n) => (
                <option key={n} value={n}>
                  {placeName(n)}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" disabled={terrPick.node === ''} onClick={() => { const n = Number(terrPick.node); setTerr((t) => ({ ...t, [terrPick.side]: [...t[terrPick.side], n] })); setTerrPick({ ...terrPick, node: '' }); }} data-testid="territory-add">
              Add clause
            </button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Ceded provinces change hands at the agreement's effective time, after peace, as annexed territory (homeland if it returns to its original owner). Capitals cannot be ceded.</p>
        </fieldset>
      )}
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
    <div className="col p-root" data-testid="coalition-panel">
      <div className={`p-advisor${myCo ? ' member' : ''}`}>
        <span className="p-advisor-ico" aria-hidden="true">{myCo ? <span className="p-emblem">{v.coalitions.find((c) => c.id === myCo)?.emblem}</span> : <Icon name="coalition" size={26} />}</span>
        <div className="grow">
          <strong>{myCo ? `You are a member of ${v.coalitions.find((c) => c.id === myCo)?.name}.` : 'You are not in a coalition.'}</strong>
          <div className="muted p-small">Members share transit rights and compete for victory together; up to 5 nations per coalition.</div>
        </div>
        <ActionButton className="btn" disabledReason={ro ? 'Read-only campaign' : myCo ? 'Leave your coalition before founding another.' : null} onClick={() => setCreate(true)}>
          Create coalition…
        </ActionButton>
      </div>
      {active.length === 0 ? (
        <div className="empty">No coalitions yet. Computer countries form them over time; you can found one.</div>
      ) : (
        <table className="data p-cotable">
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
                  <span className="p-emblem sm" aria-hidden>{c.emblem}</span> <strong>{c.name}</strong>{c.id === myCo ? <span className="p-pill accent raw" style={{ marginLeft: 6 }}>yours</span> : null}
                </td>
                <td>{countryName(c.leader)}</td>
                <td className="num"><span className="p-slotsdots" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < c.members.length ? 'on' : ''} />)}</span> {c.members.length}/5</td>
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
        <div className="p-card">
          <div className="row" style={{ gap: 12 }}>
            <span className="p-emblem lg" aria-hidden="true">{chosen.emblem}</span>
            <div>
              <h3>{chosen.name}</h3>
              <p className="dim" style={{ margin: 0 }}>{chosen.description || 'No description.'}</p>
            </div>
          </div>
          <dl className="p-kvtiles">
            <div><dt>Leader</dt><dd>{countryName(chosen.leader)}</dd></div>
            <div><dt>Total score</dt><dd>{chosen.score} VP</dd></div>
            <div><dt>Required ({Math.max(2, chosen.members.length)} members)</dt><dd>{v.scores.coalitionThresholds[Math.max(2, Math.min(5, chosen.members.length))]} VP</dd></div>
            <div><dt>Remaining slots</dt><dd>{5 - chosen.members.length}</dd></div>
            <div><dt>Admission</dt><dd>{chosen.members.length >= 5 ? 'Full' : 'Open to applications (leader decides)'}</dd></div>
            <div><dt>Founded</dt><dd>{gameTime(chosen.createdAt)}</dd></div>
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
        <div className="p-card">
          <h4>Coalition thread (current members only)</h4>
          <div className="p-thread">
            {thread.length === 0 ? <p className="muted" style={{ margin: 0 }}>No posts.</p> : thread.map((m) => (
              <div key={m.id} className={`p-msg${m.from === v.viewer ? ' mine' : ''}`}>
                <div className="p-msg-meta">{countryName(m.from)} · {gameTime(m.at)}</div>
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
                <label key={e} className={`row p-emblem-pick${form.emblem === e ? ' on' : ''}`} style={{ gap: 4 }}>
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
