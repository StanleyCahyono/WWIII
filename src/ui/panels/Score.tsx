import React from 'react';
import { useFrame, useQuery, FlagChip } from '../components/common';
import { ui, centerOn, select, closePanel } from '../state/ui';
import { NODES, cityByNode, countryName } from '../data/static';
import { gameTime, cap } from '../format';
import { leaveToTitle } from '../session';

interface Entry { id: string; kind: string; members: string[]; score: number; threshold: number; fraction: number; capitals: number; industry: number }
interface Breakdown {
  weights: { provinceCenter: number; cityTier: string; capital: number };
  denominator: number;
  thresholds: Record<string, number>;
  mine: number;
  myEntry: Entry | null;
  standings: Entry[];
  capitals: Record<string, number>;
  territories: { node: number; name: string; city: string | null; vp: number }[];
  nextSettlementTick: number;
  nextSettlementLabel: string;
  history: { day: number; mine: number; leader: string | null }[];
  result: { at: number; day: number; reason: string; winner: Entry; standings: Entry[] } | null;
}

function entryName(e: Entry, frame: ReturnType<typeof useFrame>) {
  if (e.kind === 'coalition') return frame?.view.coalitions.find((c) => c.id === e.id)?.name ?? `Coalition ${e.id}`;
  return countryName(e.id);
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="muted">History starts after the first day change.</span>;
  const w = 320, h = 70, mx = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / mx) * (h - 6) - 3}`).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label={`Score history: ${data.join(', ')}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

export function ScorePanel() {
  const frame = useFrame()!;
  const q = useQuery<Breakdown>('scoreBreakdown');
  const b = q.data;
  if (!b) return <p className="muted">Loading…</p>;
  const target = b.myEntry?.threshold ?? b.thresholds.solo;
  return (
    <div className="col" data-testid="score-panel">
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="card">
          <h4>Your score</h4>
          <div style={{ fontSize: 22 }}>
            {b.myEntry?.score ?? b.mine} / {target} VP
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{b.myEntry?.kind === 'coalition' ? 'Competing as a coalition' : 'Competing solo'} · {Math.round((b.myEntry?.fraction ?? 0) * 100)}% of threshold</div>
        </div>
        <div className="card">
          <h4>Next settlement</h4>
          <div>{gameTime(b.nextSettlementTick)}</div>
          <div className="muted" style={{ fontSize: 12 }}>One settlement at each day change; day 180 decides by highest fraction</div>
        </div>
        <div className="card">
          <h4>Rule</h4>
          <div style={{ fontSize: 12.5 }}>
            Province centre {b.weights.provinceCenter} · city {b.weights.cityTier} · capital +{b.weights.capital}. Denominator {b.denominator}. Solo {b.thresholds.solo}; coalition 2: {b.thresholds['2']}, 3: {b.thresholds['3']}, 4: {b.thresholds['4']}, 5: {b.thresholds['5']}.
          </div>
        </div>
      </div>
      <div className="card">
        <h4>Score history</h4>
        <Spark data={b.history.map((h) => h.mine)} />
      </div>
      <h3>Standings</h3>
      <table className="data" data-testid="standings">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Contender</th>
            <th className="num">Score</th>
            <th className="num">Threshold</th>
            <th className="num">Fraction</th>
            <th className="num">Capitals</th>
          </tr>
        </thead>
        <tbody>
          {b.standings.slice(0, 25).map((e, i) => (
            <tr key={e.id} className={e.members.includes(frame.view.viewer) ? 'sel' : ''}>
              <td className="num">{i + 1}</td>
              <td>
                {e.kind === 'coalition' ? '◆ ' : ''}
                {entryName(e, frame)}
                {e.kind === 'coalition' && <div className="muted" style={{ fontSize: 11.5 }}>{e.members.map(countryName).join(', ')}</div>}
              </td>
              <td className="num">{e.score}</td>
              <td className="num">{e.threshold}</td>
              <td className="num">{Math.round(e.fraction * 100)}%</td>
              <td className="num">{e.capitals}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Your territories ({b.territories.length})</h3>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>City score is fixed by the city's initial tier; its population (economic, mutable) changes with morale and war but never changes VP.</p>
      <table className="data">
        <thead>
          <tr>
            <th>Province</th>
            <th>City</th>
            <th className="num">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {b.territories.slice(0, 200).map((t) => (
            <tr key={t.node}>
              <td>
                <button type="button" className="btn ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => { const n = NODES[t.node]; centerOn(n.center[0], n.center[1], 30); const c = cityByNode.get(t.node); if (c) select({ kind: 'city', key: c.key, node: t.node }); else select({ kind: 'province', node: t.node }); closePanel(); }}>
                  {t.name}
                </button>
              </td>
              <td>{t.city ?? '—'}</td>
              <td className="num">{t.vp} VP</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EndPanel() {
  const frame = useFrame()!;
  const q = useQuery<Breakdown>('scoreBreakdown');
  const jr = useQuery<{ id: string; category: string; kind: string }[]>('journal', [2000, '']);
  const v = frame.view;
  const res = v.result;
  const eliminated = !v.self.alive;
  if (!res && !eliminated) return <p className="muted">The campaign is still running. Results appear here after the final settlement.</p>;
  const won = res ? res.winner.members.includes(v.viewer) : false;
  const losses = (jr.data ?? []).filter((e) => e.kind === 'units_lost' || e.kind === 'stack_destroyed' || e.kind === 'aircraft_lost').length;
  const captures = (jr.data ?? []).filter((e) => e.kind.includes('captured')).length;
  return (
    <div className="col" data-testid="end-panel">
      {res ? (
        <div className="card" style={{ borderColor: won ? 'var(--ok)' : 'var(--line-2)' }}>
          <h3>{won ? 'Victory' : 'Campaign concluded'}</h3>
          <p>
            Winner: <strong>{res.winner.kind === 'coalition' ? `${entryName(res.winner as Entry, frame)} (coalition)` : countryName(res.winner.id)}</strong> with {res.winner.score} of {res.winner.threshold} VP ({res.reason === 'threshold' ? 'threshold reached' : 'highest fraction at day 180'}) — settled {gameTime(res.at)}, day {res.day}.
          </p>
          {res.winner.kind === 'coalition' && (
            <table className="data">
              <thead>
                <tr>
                  <th>Member</th>
                  <th className="num">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {res.winner.members.map((m) => (
                  <tr key={m}>
                    <td>
                      <FlagChip id={m} /> {countryName(m)}
                    </td>
                    <td className="num">{v.scores.byCountry[m] ?? 0} VP</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">Results are frozen. Reloading this save opens review mode and never awards victory twice.</p>
        </div>
      ) : (
        <div className="card">
          <h3>Defeat</h3>
          <p>{v.self.name} has lost all territory and has no eligible recovery force. Your run is concluded; the 119 computer countries continue.</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => closePanel()}>
              Keep observing
            </button>
            <button type="button" className="btn" onClick={() => void leaveToTitle()}>
              Return to campaigns
            </button>
          </div>
        </div>
      )}
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="card">
          <h4>Your final score</h4>
          <div style={{ fontSize: 20 }}>{v.scores.byCountry[v.viewer] ?? 0} VP</div>
        </div>
        <div className="card">
          <h4>Research</h4>
          <div style={{ fontSize: 20 }}>{v.self.techs.length} technologies</div>
        </div>
        <div className="card">
          <h4>Losses</h4>
          <div style={{ fontSize: 20 }}>{losses} loss events</div>
        </div>
        <div className="card">
          <h4>Territory changes</h4>
          <div style={{ fontSize: 20 }}>{captures} capture events</div>
        </div>
      </div>
      <div className="card">
        <h4>Score history</h4>
        <Spark data={(q.data?.history ?? []).map((h) => h.mine)} />
      </div>
      {res && (
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Contender</th>
              <th className="num">Score</th>
              <th className="num">Fraction</th>
            </tr>
          </thead>
          <tbody>
            {res.standings.slice(0, 15).map((e, i) => (
              <tr key={e.id}>
                <td className="num">{i + 1}</td>
                <td>{entryName(e as Entry, frame)}</td>
                <td className="num">{e.score}</td>
                <td className="num">{Math.round(e.fraction * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CampaignPanel() {
  const frame = useFrame()!;
  const v = frame.view;
  const m = frame.meta;
  return (
    <div className="col" data-testid="campaign-panel">
      <dl className="kv card">
        <dt>Campaign</dt>
        <dd>World 120 (single ruleset)</dd>
        <dt>Save</dt>
        <dd>{m.campaignName}</dd>
        <dt>Nation</dt>
        <dd>{v.self.name} ({cap(v.self.doctrine)} doctrine)</dd>
        <dt>Difficulty</dt>
        <dd>{cap(m.difficulty)} — sets planning effort of all 119 computer countries; no resource handicap</dd>
        <dt>Seed</dt>
        <dd>{m.seed}</dd>
        <dt>Started</dt>
        <dd>{m.startDate} 06:00 UTC (fictional calendar)</dd>
        <dt>Now</dt>
        <dd>{gameTime(v.tick)} · {v.time} UTC</dd>
        <dt>Save revision</dt>
        <dd>{m.saveRevision}</dd>
        <dt>Format / scenario</dt>
        <dd>
          v{m.formatVersion} / {m.scenarioVersion}
        </dd>
        <dt>Controllers</dt>
        <dd>1 human (you), {v.relations.filter((r) => r.controller === 'ai').length} computer</dd>
      </dl>
      <div className="card">
        <h4>Rules summary</h4>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
          <li>Simulation steps every 15 game minutes; economy accrues hourly; combat rounds hourly; score settles at each day change.</li>
          <li>Homeland cities produce 100%, annexed 50%, occupied 25%. Only homeland and annexed cities mobilize.</li>
          <li>Jobs reserve their full cost when queued. Cancelling a queued job refunds in full; an active job refunds 75% of the unspent share. Research cancellation refunds 80% of the unspent share.</li>
          <li>Entering territory without passage rights is an act of war and needs explicit confirmation.</li>
          <li>Unknown contacts reveal only what the observation justifies; reports are frozen snapshots with an expiry.</li>
        </ul>
      </div>
      <CareerLedger />
      <div className="row">
        <button type="button" className="btn" onClick={() => ui.patch({ panel: 'score' })}>
          Standings
        </button>
        <button type="button" className="btn" onClick={() => void leaveToTitle()}>
          Save and return to campaigns
        </button>
      </div>
    </div>
  );
}

function CareerLedger() {
  const q = useQuery<{ xp: number; entries: { event: string; kind: string; xp: number; at: number }[] }>('career');
  return (
    <div className="card" data-testid="career">
      <h4>Career ledger (local, separate from campaign VP)</h4>
      <p style={{ margin: '4px 0' }}>
        <strong>{q.data?.xp ?? 0} XP</strong> <span className="muted">— earned once per recorded event (captures, unit defeats, completed jobs); replaying a save never re-awards it and it never counts toward victory points.</span>
      </p>
      {q.data && q.data.entries.length > 0 ? (
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th className="num">XP</th>
            </tr>
          </thead>
          <tbody>
            {q.data.entries.slice(0, 30).map((e) => (
              <tr key={e.event + e.kind}>
                <td>{gameTime(e.at)}</td>
                <td>{cap(e.kind)}</td>
                <td className="num">+{e.xp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ margin: 0 }}>No career entries yet.</p>
      )}
    </div>
  );
}
