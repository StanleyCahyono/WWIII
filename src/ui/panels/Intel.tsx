import React, { useEffect, useState } from 'react';
import { useFrame, ActionButton } from '../components/common';
import { useStore } from '../state/store';
import { ui, select, centerOn } from '../state/ui';
import { getHost } from '../sim/host';
import { NODES, cityByNode, countryName, placeName, unitById } from '../data/static';
import { gameTime, resM, cap, ageLabel } from '../format';
import { exec } from '../sim/exec';

export function IntelPanel({ arg }: { arg: { node?: number | null } | null }) {
  const frame = useFrame()!;
  const sel = useStore(ui, (s) => s.selection);
  const selNode = arg?.node ?? (sel?.kind === 'city' || sel?.kind === 'province' ? sel.node : null);
  const [node, setNode] = useState<number | null>(selNode ?? null);
  const [mission, setMission] = useState<'information' | 'sabotage' | 'corruption'>('information');
  const [agentCost, setAgentCost] = useState<{ ok: boolean; text: string } | null>(null);
  const [reportCost, setReportCost] = useState<{ ok: boolean; text: string } | null>(null);
  const v = frame.view;
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const city = node !== null ? cityByNode.get(node) : undefined;
  const owner = node !== null ? v.owners[node] : null;
  useEffect(() => {
    if (selNode !== null && selNode !== undefined) setNode(selNode);
  }, [selNode]);
  useEffect(() => {
    let alive = true;
    if (node === null) return;
    if (city && owner && owner !== v.viewer)
      void getHost().preview<{ cost: Record<string, number> }>({ type: 'assignAgent', city: city.key, mission }).then((r) => alive && setAgentCost(r.ok ? { ok: true, text: `Cost ${resM(r.preview.cost)}` } : { ok: false, text: r.reason }));
    else setAgentCost({ ok: false, text: city ? 'Agents operate in foreign-held cities only.' : 'Agents need a city target; select a foreign city.' });
    void getHost().preview<{ cost: Record<string, number>; expiresInMin: number }>({ type: 'buyIntelReport', node }).then((r) => alive && setReportCost(r.ok ? { ok: true, text: `Cost ${resM(r.preview.cost)}; valid ${Math.round(r.preview.expiresInMin / 60)} h` } : { ok: false, text: r.reason }));
    return () => {
      alive = false;
    };
  }, [node, mission, v.tick, city, owner, v.viewer]);
  const foreignCities = v.publicCities.filter((c) => c.owner && c.owner !== v.viewer).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="col" data-testid="intel-panel">
      <div className="card col">
        <h4>Selected place</h4>
        <div className="row wrap">
          <strong>{node !== null ? placeName(node) : 'None'}</strong>
          {owner && <span className="muted">held by {countryName(owner)}</span>}
          <label className="sr-only" htmlFor="intel-target">Target city</label>
          <select id="intel-target" value={city?.key ?? ''} onChange={(e) => { const c = v.publicCities.find((x) => x.key === e.target.value); if (c) setNode(c.node); }}>
            <option value="">Choose a foreign city…</option>
            {foreignCities.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({countryName(c.owner)})
              </option>
            ))}
          </select>
        </div>
        <div className="row wrap">
          <label className="row" style={{ gap: 6 }}>
            Mission
            <select value={mission} onChange={(e) => setMission(e.target.value as typeof mission)}>
              <option value="information">Information (periodic reports)</option>
              <option value="sabotage">Sabotage (damage buildings)</option>
              <option value="corruption">Corruption (drain resources)</option>
            </select>
          </label>
          <ActionButton className="btn primary" disabledReason={ro ? 'Read-only campaign' : !agentCost?.ok ? agentCost?.text ?? 'Select a target.' : null} onClick={() => city && exec({ type: 'assignAgent', city: city.key, mission }, `Agent assigned to ${city.name}.`)}>
            Assign agent
          </ActionButton>
          {agentCost?.ok && <span className="muted">{agentCost.text}</span>}
        </div>
        <div className="row wrap">
          <ActionButton className="btn" disabledReason={ro ? 'Read-only campaign' : node === null ? 'Select a place first.' : !reportCost?.ok ? reportCost?.text ?? '—' : null} onClick={() => node !== null && exec({ type: 'buyIntelReport', node }, `Intelligence report purchased for ${placeName(node)}.`)} data-testid="buy-report">
            Buy intelligence report
          </ActionButton>
          {reportCost?.ok && <span className="muted">{reportCost.text}</span>}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>A report is a frozen, dated snapshot of the sector: it pins observed formations at their observed positions until it expires. It does not track them afterwards.</p>
      </div>
      <h3>Agents ({v.agents.filter((a) => a.active).length} active)</h3>
      {v.agents.length === 0 ? (
        <div className="empty">No agents assigned.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Target</th>
              <th>Mission</th>
              <th>Next report</th>
              <th className="num">Reports</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {v.agents.map((a) => (
              <tr key={a.id}>
                <td>{v.publicCities.find((c) => c.key === a.targetCity)?.name ?? a.targetCity}</td>
                <td>{cap(a.mission)}</td>
                <td>{a.active ? gameTime(a.nextReportAt) : 'Inactive'}</td>
                <td className="num">{a.reports}</td>
                <td>{a.active && <button type="button" className="btn small" onClick={() => exec({ type: 'recallAgent', agent: a.id }, 'Agent recalled.')}>Recall</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Report history</h3>
      {v.reports.length === 0 ? (
        <div className="empty">No reports yet.</div>
      ) : (
        <table className="data" data-testid="report-history">
          <thead>
            <tr>
              <th>Sector</th>
              <th>As of</th>
              <th>Expires</th>
              <th>Source</th>
              <th>Observed</th>
            </tr>
          </thead>
          <tbody>
            {v.reports.map((r) => (
              <tr key={r.id} style={{ opacity: r.expired ? 0.6 : 1 }}>
                <td>
                  <button type="button" className="btn ghost small" onClick={() => { const n = NODES[r.targetNode]; centerOn(n.center[0], n.center[1], 40); const s0 = r.stacks[0]; if (s0 && !r.expired) select({ kind: 'report', id: r.id, ref: s0.ref }); }}>
                    {placeName(r.targetNode)}
                  </button>
                </td>
                <td>
                  {gameTime(r.observedAt)} <span className="muted">({ageLabel(v.tick - r.observedAt)})</span>
                </td>
                <td>{r.expired ? <span className="tag stale">expired</span> : gameTime(r.expiresAt)}</td>
                <td>{cap(r.source)}{r.shared ? ' (shared)' : ''}</td>
                <td style={{ fontSize: 12 }}>
                  {r.stacks.length === 0 ? 'No formations observed' : r.stacks.map((s) => `${countryName(s.owner)}: ${s.units.map((u) => `${u.count}× ${unitById.get(u.type)?.name ?? u.type}`).join(', ')}`).join(' · ')}
                  {r.city && ` · city morale ${Math.round(r.city.morale)}, condition ${r.city.condition}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
