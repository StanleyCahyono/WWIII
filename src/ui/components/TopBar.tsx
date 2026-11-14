import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { getHost } from '../sim/host';
import { ui, openPanel } from '../state/ui';
import { prefs, setPrefs } from '../persist/prefs';
import { SPEEDS, SPEED_BASE } from '../sim/protocol';
import { FlagChip, Icon, useFrame, useIsMobile, Modal } from './common';
import { dayOf, hourLabel, duration, relWall } from '../format';
import { techById, unitById, buildingById, placeName } from '../data/static';
import { leaveToTitle } from '../session';
import { SettingsPanel } from '../screens/Menus';

export function nextEvents(frame: NonNullable<ReturnType<typeof useFrame>>) {
  const v = frame.view;
  const out: { at: number; label: string; kind: string; node: number | null; observed: boolean }[] = [];
  for (const r of v.self.research) out.push({ at: r.endsAt, label: `Research: ${techById.get(r.tech)?.name ?? r.tech}`, kind: 'research', node: null, observed: false });
  for (const j of v.self.jobs) if (j.endsAt) out.push({ at: j.endsAt, label: `${j.kind === 'mobilize' ? 'Mobilize' : j.kind === 'annex' ? 'Annex' : j.kind === 'missile' ? 'Missile batch' : 'Build'}: ${j.unit ? unitById.get(j.unit)?.name ?? j.unit : j.building ? buildingById.get(j.building)?.name ?? j.building : j.missile ?? ''} @ ${placeName(j.node)}`, kind: 'job', node: j.node, observed: false });
  for (const s of v.stacks) if (s.eta && s.order) out.push({ at: s.eta, label: `Arrival: ${s.name} → ${s.order.kind === 'move' ? placeName(s.order.dest) : 'target'}`, kind: 'arrival', node: s.order.kind === 'move' ? s.order.dest : null, observed: false });
  for (const s of v.stacks) if (s.refit) out.push({ at: v.tick + 1440, label: `Refit in progress: ${s.name}`, kind: 'refit', node: s.pos.kind === 'node' ? s.pos.node : null, observed: false });
  for (const r of v.reports) if (!r.expired) out.push({ at: r.expiresAt, label: `Report expires: ${placeName(r.targetNode)} (as of ${hourLabel(r.observedAt)} day ${dayOf(r.observedAt)})`, kind: 'report', node: r.targetNode, observed: true });
  for (const o of v.offers) if (o.status === 'pending') out.push({ at: o.expiresAt, label: `Offer expires: ${o.from === v.viewer ? 'to' : 'from'} ${o.from === v.viewer ? o.to : o.from}`, kind: 'offer', node: null, observed: false });
  const settle = (v.day) * 1440 - 360;
  out.push({ at: settle, label: `Score settlement (end of day ${v.day})`, kind: 'settlement', node: null, observed: false });
  return out.filter((e) => e.at >= v.tick).sort((a, b) => a.at - b.at);
}

export function TopBar() {
  const frame = useFrame()!;
  const host = getHost();
  const hs = useStore(host.store, (s) => ({ lastSave: s.lastSave, saving: s.saving, lockLost: s.lockLost }), (a, b) => a.lastSave === b.lastSave && a.saving === b.saving && a.lockLost === b.lockLost);
  const speedPref = useStore(prefs, (p) => p.speed);
  const isMobile = useIsMobile();
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const v = frame.view;
  const c = frame.clock;
  const myScore = v.scores.byCountry[v.viewer] ?? 0;
  const coalition = v.myCoalition ? v.coalitions.find((x) => x.id === v.myCoalition) : null;
  const target = coalition ? v.scores.coalitionThresholds[Math.max(2, coalition.members.length)] ?? v.scores.soloThreshold : v.scores.soloThreshold;
  const shown = coalition ? coalition.score : myScore;
  const nxt = useMemo(() => nextEvents(frame)[0], [frame]);
  const ro = frame.meta.readOnly || frame.meta.reviewMode;
  const setSpeed = (s: number) => {
    setPrefs({ speed: s });
    void host.setClock({ speed: s });
  };
  const togglePause = () => void host.setClock({ paused: !c.paused, speed: speedPref });
  const saveState = hs.saving ? 'busy' : hs.lastSave && !hs.lastSave.ok ? 'err' : '';
  const saveText = hs.saving ? 'Saving…' : hs.lastSave ? (hs.lastSave.ok ? `Saved ${relWall(hs.lastSave.at)}` : hs.lastSave.conflict ? 'Save conflict' : 'Save failed') : 'Not saved yet';
  const realPerHour = !c.paused && c.speed ? 60 / (c.speed * SPEED_BASE) : null;

  return (
    <header className="topbar" role="banner">
      <button type="button" className="nation" onClick={() => openPanel('campaign')} aria-label={`${v.self.name} — campaign information`} data-testid="nation-chip">
        <FlagChip id={v.viewer} />
        <span className="desktop-only">{v.self.name}</span>
      </button>
      <button type="button" className="btn ghost clock" onClick={() => document.getElementById('pause-btn')?.focus()} aria-label={`Game time day ${v.day}, ${hourLabel(v.tick)} UTC`} data-testid="game-clock" title={v.time + ' UTC'}>
        D{v.day} {hourLabel(v.tick)}
        <span className="desktop-only">&nbsp;UTC</span>
      </button>
      <button id="pause-btn" type="button" className={`btn icon${c.paused ? '' : ' primary'}`} onClick={togglePause} aria-label={c.paused ? 'Resume game clock' : 'Pause game clock'} title={ro ? 'Read-only / review mode' : c.paused ? 'Resume (Space)' : 'Pause (Space)'} aria-pressed={!c.paused} disabled={ro} data-testid="pause-toggle">
        <Icon name={c.paused ? 'play' : 'pause'} />
      </button>
      {!isMobile && (
        <div className="speed-group" role="group" aria-label="Game speed">
          {SPEEDS.slice(0, 7).map((s) => (
            <button key={s} type="button" aria-pressed={c.speed === s} onClick={() => setSpeed(s)} title={`${s}× — 1 game hour ≈ ${Math.round(60 / (s * SPEED_BASE))} s real time`}>
              {s}×
            </button>
          ))}
        </div>
      )}
      {isMobile && (
        <select className="speed-sel" aria-label="Game speed" value={c.speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ minHeight: 34, padding: '2px 2px' }}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn icon" aria-label="Advance one game hour" title="Advance one hour (pauses after)" onClick={() => void host.step(60)} disabled={ro} data-testid="step-hour">
        <Icon name="step" />
      </button>
      <button type="button" className="btn icon hide-narrow" aria-label="Jump to next significant event" title="Jump to next significant event (max 1 day)" onClick={() => void host.nextEvent(1440)} disabled={ro}>
        <Icon name="skip" />
      </button>
      {!isMobile && <span className="muted" style={{ fontSize: 11.5 }} aria-live="off">{realPerHour ? `1 h ≈ ${realPerHour < 1 ? '<1' : Math.round(realPerHour)} s${c.behind ? ' (max sim rate)' : ''}` : 'Paused'}</span>}
      <div className="sep" />
      <button type="button" className="btn ghost" onClick={() => openPanel('score')} aria-label={`Score ${shown} of ${target} victory points — open standings`} data-testid="score-button">
        <span className="desktop-only"><Icon name="score" size={16} /></span> {shown}/{target}
        <span className="desktop-only">&nbsp;VP</span>
      </button>
      {!isMobile && nxt && (
        <button type="button" className="btn ghost" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12.5, justifyContent: 'flex-start' }} onClick={() => ui.patch({ timeStripOpen: true })} title={nxt.label} aria-label={`Next event: ${nxt.label} in ${duration(nxt.at - v.tick)}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Next {duration(nxt.at - v.tick)}: {nxt.label}</span>
        </button>
      )}
      <div className="grow" />
      {isMobile && (
        <button type="button" className="btn small" aria-expanded={ui.get().resourceBarOpen} onClick={() => ui.patch({ resourceBarOpen: !ui.get().resourceBarOpen })} aria-label="Toggle resource bar">
          Res
        </button>
      )}
      {(hs.lockLost || frame.meta.readOnly) && <span className="tag warn">Read-only</span>}
      {frame.meta.reviewMode && <span className="tag accent">Review</span>}
      <button type="button" className={`save-ind btn ghost ${saveState}`} onClick={() => void host.save('manual')} aria-label={`${saveText}. Save now.`} title={hs.lastSave?.error ?? 'Save now'} data-testid="save-indicator" disabled={ro}>
        <span className="dot" aria-hidden />
        <span className="desktop-only">{saveText}</span>
        {isMobile && <Icon name="save" size={16} />}
      </button>
      <button type="button" className="btn icon hide-narrow" aria-label="Help and advisor" title="Help (advisor)" onClick={() => openPanel('help')} data-testid="help-button">
        <Icon name="help" />
      </button>
      <button type="button" className="btn icon" aria-label="Game menu" aria-expanded={menu} onClick={() => setMenu(true)} data-testid="game-menu">
        <Icon name="menu" />
      </button>
      {menu && (
        <Modal title="Campaign menu" onClose={() => setMenu(false)}>
          <div className="col">
            <button type="button" className="btn" onClick={() => { setMenu(false); void host.save('manual'); }} disabled={ro}>
              Save now
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); void host.nextEvent(1440); }} disabled={ro}>
              Jump to next significant event
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); openPanel('help'); }}>
              Help & advisor
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); openPanel('campaign'); }}>
              Campaign information & rules
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); setSettings(true); }}>
              Settings
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); ui.patch({ tutorialOpen: true }); }}>
              Reopen tutorial
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); ui.patch({ briefingOpen: true }); }}>
              Reopen briefing
            </button>
            <button type="button" className="btn" onClick={() => { setMenu(false); ui.patch({ screen: 'diagnostics' }); }}>
              Diagnostics
            </button>
            <button type="button" className="btn primary" onClick={() => { setMenu(false); void leaveToTitle(); }} data-testid="home-button">
              Save and return to campaigns
            </button>
          </div>
        </Modal>
      )}
      {settings && (
        <Modal title="Settings" onClose={() => setSettings(false)}>
          <SettingsPanel />
        </Modal>
      )}
      {hs.lastSave?.conflict && <ConflictDialog />}
    </header>
  );
}

function ConflictDialog() {
  const host = getHost();
  const info = useStore(host.store, (s) => s.lastSave)!;
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <Modal
      title="Newer save detected"
      onClose={() => setDone(true)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => { setDone(true); void leaveToTitle(); }}>
            Return to campaigns (load the newer save)
          </button>
          <button type="button" className="btn danger" onClick={() => { setDone(true); void host.save('overwrite after conflict', true); }}>
            Overwrite with this tab's progress
          </button>
        </>
      }
    >
      <p>
        Another tab or window saved this campaign at revision {info.conflict!.storedRevision}, newer than this tab's revision {info.conflict!.myRevision}. Nothing was overwritten. This tab's progress was kept as a recovery copy (Load Campaign → Recovery copies).
      </p>
    </Modal>
  );
}
