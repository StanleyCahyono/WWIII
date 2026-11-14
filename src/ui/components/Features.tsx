/**
 * UI for the engine features pass: helicopter air-mobile lift dialog, port-blockade report.
 * Both go through the engine view / validator only (preview on every change, commit via exec()).
 */
import React, { useState } from 'react';
import { CommandDialog, NodePicker, type TargetingSpec } from './Orders';
import { useFrame } from './common';
import { unitById, placeName, NODES } from '../data/static';
import { gameTime, duration, resM } from '../format';
import type { StackView, BlockadeView } from '../../engine/index';

/** Does this formation carry air-mobile lift (utility helicopters or organic-lift infantry)? */
export function hasAirLift(s: StackView): boolean {
  return s.moveClass === 'ground' && s.units.some((u) => (unitById.get(u.type)?.airmobileCapacity ?? 0) > 0);
}

/** Is this formation flying an air-mobile hop right now? */
export function inAirLift(s: StackView): boolean {
  return s.moveClass === 'ground' && s.pos.kind === 'air';
}

export function AirmobileDialog({ s, onClose }: { s: StackView; onClose: () => void }) {
  const [dest, setDest] = useState<number | null>(null);
  const seats = s.units.reduce((a, u) => {
    const t = unitById.get(u.type);
    return t?.family === 'helicopter' ? a + (t.airmobileCapacity ?? 0) : a;
  }, 0);
  const here = s.pos.kind === 'node' ? s.pos.node : null;
  const spec: TargetingSpec = {
    id: 'airmobile-dest',
    prompt: 'Click the landing zone (a land province in range)',
    chosen: dest !== null ? placeName(dest) : null,
    resolve: (p) => {
      if (p.node === null) return null;
      const n = p.node;
      if (NODES[n].kind !== 'land') return { label: placeName(n), reason: 'Landing zones are land provinces.' };
      if (NODES[n].outside) return { label: placeName(n), reason: 'Outside the campaign map.' };
      if (n === here) return { label: placeName(n), reason: 'The formation is already here.' };
      return { label: placeName(n), cmd: { type: 'airmobile', stack: s.id, dest: n }, apply: () => setDest(n) };
    },
    brief: (p) => [`${Math.round(p.km as number)} km of ${Math.round(p.rangeKm as number)} km range`, `Lands ${gameTime(p.arriveAt as number)}`, `Interception risk ${Math.round((p.riskEstimate as number) * 100)} % (estimate)`],
    list: <NodePicker id="airmobile-dest" label="Landing zone" origin={s.lonlat} value={dest} onChange={setDest} maxKm={800} filter={(n) => n.kind === 'land' && !(s.pos.kind === 'node' && s.pos.node === n.id)} />,
  };
  return (
    <CommandDialog
      title={`Air assault — ${s.name}`}
      testid="airmobile"
      okLabel="Confirm air-mobile hop"
      onClose={onClose}
      targeting={spec}
      build={(war) => (dest === null ? null : { type: 'airmobile', stack: s.id, dest, confirmActOfWar: war })}
      describe={(p) => {
        const fuel = p.fuel as Record<string, number>;
        const risk = p.riskEstimate as number;
        return (
          <dl className="kv" data-testid="airmobile-preview">
            <dt>Distance</dt>
            <dd>
              {Math.round(p.km as number)} km of {Math.round(p.rangeKm as number)} km range
            </dd>
            <dt>Load</dt>
            <dd>
              {p.passengers as number} infantry in {p.lift as number} seat(s); {p.flyers as number} unit(s) fly
            </dd>
            <dt>Lands</dt>
            <dd>
              {gameTime(p.arriveAt as number)} (flight {duration(p.flightMin as number)})
            </dd>
            <dt>Fuel</dt>
            <dd>{resM(fuel)}</dd>
            <dt>Interception risk</dt>
            <dd data-testid="airmobile-risk">
              {Math.round(risk * 100)} % (estimate) — {p.riskNote as string}
            </dd>
          </dl>
        );
      }}
    >
      <p className="dim" style={{ margin: 0, fontSize: 12 }}>
        Helicopters lift light infantry and officers straight to a land province in range ({seats} seat(s) in this formation; air-assault infantry flies itself). Armour and guns must be split off first. Hostile air defence near the flight path or forces at the landing zone may intercept the lift; the estimate counts only what you have observed. After landing the helicopters need {duration(120)} to refuel. Landing in enemy territory captures it by the normal rule once no defender remains.
      </p>
    </CommandDialog>
  );
}

/** Economy report section: own blockaded ports and enemy ports our warships blockade. */
export function BlockadeReport() {
  const frame = useFrame()!;
  const list = (frame.view.blockades ?? []) as BlockadeView[];
  const mine = list.filter((b) => b.role === 'blockaded');
  const ours = list.filter((b) => b.role === 'enforcing');
  return (
    <div className="card" data-testid="blockade-report">
      <h4>Blockades</h4>
      {!list.length ? (
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          No port is blockaded. A port city is blockaded when warships of a country at war with its owner hold an adjacent sea zone and no ship of the owner or a coalition partner is in any adjacent zone.
        </p>
      ) : (
        <>
          {mine.length > 0 && (
            <>
              <p style={{ margin: '4px 0' }} className="warn">
                Our blockaded ports: city output ×{mine[0].outputFactor} (port trade lost) and no new ships can be launched there. Move any ship into an adjacent sea zone, or end the war, to lift it.
              </p>
              <ul data-testid="blockaded-ports" style={{ margin: '0 0 6px', paddingLeft: 18 }}>
                {mine.map((b) => (
                  <li key={b.city}>
                    {b.name} — since {gameTime(b.since)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {ours.length > 0 && (
            <>
              <p style={{ margin: '4px 0' }}>Enemy ports our warships blockade (their output ×{ours[0].outputFactor}, shipyards closed):</p>
              <ul data-testid="enforced-blockades" style={{ margin: 0, paddingLeft: 18 }}>
                {ours.map((b) => (
                  <li key={b.city}>
                    {b.name} ({b.owner}) — since {gameTime(b.since)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Activity text for a formation in an air-mobile flight. */
export function airLiftActivity(s: StackView): string {
  const o = s.order && s.order.kind === 'move' ? s.order : null;
  return `Air-mobile hop to ${o ? placeName(o.dest) : '—'}${s.eta ? `, lands ${gameTime(s.eta)}` : ''}`;
}
