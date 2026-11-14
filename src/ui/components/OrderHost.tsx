/**
 * Hosts the active map-targeted order (ui.order): patrol, rebase, attack, embark/disembark,
 * retreat, deployable, air assault, missile launch, rally point. Lives in the game screen — not in
 * the inspector or a panel — so the order bar survives the inspector/panel layout changing while
 * the map is being targeted (a panel that started the order is hidden meanwhile and restored after).
 */
import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { ui, endOrder, restorePanelAfterTargeting } from '../state/ui';
import type { MapPoint } from '../state/targeting';
import { useFrame } from './common';
import { AttackDialog, PatrolDialog, RebaseDialog, EmbarkDialog, RetreatDialog, LaunchDialog, DeployableDialog, CommandDialog, type TargetingSpec } from './Orders';
import { AirmobileDialog } from './Features';
import { placeName, MAP } from '../data/static';

export function OrderHost() {
  const req = useStore(ui, (s) => s.order);
  const frame = useFrame();
  const s = req?.stack && frame ? frame.view.stacks.find((x) => x.id === req.stack) : undefined;
  const gone = !!req?.stack && !!frame && !s;
  const idle = useStore(ui, (x) => x.mode.kind === 'idle' && !x.order && !!x.restorePanel);
  useEffect(() => {
    // targeting ended (confirmed or cancelled): the panel that started it comes back
    if (idle) restorePanelAfterTargeting();
  }, [idle]);
  useEffect(() => {
    // the formation was destroyed/merged while targeting: nothing left to order
    if (gone) endOrder();
  }, [gone]);
  if (!req || !frame || gone) return null;
  const k = `${req.kind}:${req.seq}`;
  const close = endOrder;
  switch (req.kind) {
    case 'attack':
      return <AttackDialog key={k} s={s!} onClose={close} />;
    case 'patrol':
      return <PatrolDialog key={k} s={s!} onClose={close} />;
    case 'rebase':
      return <RebaseDialog key={k} s={s!} onClose={close} />;
    case 'embark':
      return <EmbarkDialog key={k} s={s!} onClose={close} />;
    case 'retreat':
      return <RetreatDialog key={k} s={s!} onClose={close} />;
    case 'deploy':
      return <DeployableDialog key={k} s={s!} unitId={req.unit ?? ''} onClose={close} />;
    case 'airmobile':
      return <AirmobileDialog key={k} s={s!} onClose={close} />;
    case 'launch':
      return <LaunchDialog key={k} missile={req.missile} target={req.target ?? null} onClose={close} />;
    case 'rally':
      return req.city ? <RallyDialog key={k} city={req.city} onClose={close} /> : null;
    default:
      return null;
  }
}

/** Rally point for a city's new units, picked on the map (own provinces only). */
function RallyDialog({ city, onClose }: { city: string; onClose: () => void }) {
  const frame = useFrame()!;
  const c = MAP.cityByKey.get(city);
  const cur = frame.view.cities.find((x) => x.key === city);
  const [node, setNode] = useState<number | null | undefined>(undefined);
  const own = new Set(frame.view.provinces.map((p) => p.node));
  const ownSorted = [...own].sort((a, b) => placeName(a).localeCompare(placeName(b)));
  const name = c?.name ?? city;
  const spec: TargetingSpec = {
    id: 'rally-node',
    prompt: 'Click one of your provinces',
    chosen: node === undefined ? null : node === null ? 'None (units stay in the city)' : placeName(node),
    resolve: (p: MapPoint) => {
      if (p.node === null) return null;
      const n = p.node;
      if (!own.has(n)) return { label: placeName(n), reason: 'Rally points must be in your own provinces.' };
      return { label: placeName(n), cmd: { type: 'setRally', city, node: n }, apply: () => setNode(n) };
    },
    brief: () => [`New units from ${name} march here when ready`],
    list: (
      <label className="field">
        Rally point for new units
        <select value={node === undefined ? '' : node === null ? 'none' : String(node)} onChange={(e) => setNode(e.target.value === '' ? undefined : e.target.value === 'none' ? null : Number(e.target.value))} data-testid="rally-select">
          <option value="">Choose…</option>
          <option value="none">None (stay in city)</option>
          {ownSorted.map((n) => (
            <option key={n} value={n}>
              {placeName(n)}
            </option>
          ))}
        </select>
      </label>
    ),
  };
  return (
    <CommandDialog
      title={`Rally point — ${name}`}
      testid="rally"
      okLabel="Set rally point"
      onClose={onClose}
      targeting={spec}
      build={() => (node === undefined ? null : { type: 'setRally', city, node })}
      describe={() => <span>{node === null ? `New units mobilized in ${name} stay in the city.` : `New units mobilized in ${name} march to ${placeName(node!)} when they are ready.`}</span>}
    >
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Current rally point: {cur?.rally !== null && cur?.rally !== undefined ? placeName(cur.rally) : 'none (units appear in the city)'}.</p>
    </CommandDialog>
  );
}
