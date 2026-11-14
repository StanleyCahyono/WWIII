import React, { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { ui, toast, closePanel, select, openPanel, centerOn, type Panel } from '../state/ui';
import { getHost } from '../sim/host';
import { prefs } from '../persist/prefs';
import { MapView, mapRef, useObjects, selectionIds } from '../map/MapView';
import { TopBar } from '../components/TopBar';
import { ResourceStrip } from '../components/ResourceStrip';
import { LeftRail, MobileNav } from '../components/LeftRail';
import { Roster } from '../components/Roster';
import { Inspector } from '../components/Inspector';
import { TimeStrip } from '../components/TimeStrip';
import { Toasts, InterruptDialog } from '../components/Toasts';
import { MoveOrder, useMoveRoutes } from '../components/MoveOrder';
import { DrawBanner } from '../components/Planning';
import { Briefing, Tutorial } from '../components/Briefing';
import { PanelHost } from '../panels/PanelHost';
import { useFrame, isTypingTarget, isModalOpen, useIsMobile } from '../components/common';
import { placeName } from '../data/static';
import { cycle } from '../actions';

export function Game() {
  const frame = useFrame();
  const panel = useStore(ui, (s) => s.panel);
  const briefing = useStore(ui, (s) => s.briefingOpen);
  const tutorial = useStore(ui, (s) => s.tutorialOpen);
  const rosterOpen = useStore(ui, (s) => s.rosterOpen);
  const inspectorOpen = useStore(ui, (s) => s.inspectorOpen && (!!s.selection || !!s.lostSelection));
  const resOpen = useStore(ui, (s) => s.resourceBarOpen);
  const mode = useStore(ui, (s) => s.mode);
  const isMobile = useIsMobile();
  const objects = useObjects();
  const moveRoutes = useMoveRoutes();
  const seen = useRef<Set<string> | null>(null);
  const lastLabels = useRef(new Map<string, string>());
  const endShown = useRef(false);

  // toasts from new journal entries (real simulation events)
  useEffect(() => {
    if (!frame) return;
    const j = frame.view.journal;
    if (!seen.current) {
      seen.current = new Set(j.map((e) => e.id));
      return;
    }
    const fresh = j.filter((e) => !seen.current!.has(e.id)).reverse();
    for (const e of fresh) {
      seen.current.add(e.id);
      const where = e.node !== null ? ` — ${placeName(e.node)}` : '';
      const level = e.interrupt ? 'alert' : e.category === 'combat' ? 'warn' : e.kind.includes('completed') || e.kind.includes('concluded') ? 'success' : 'info';
      if (e.routine) ui.patch({ toastHistory: [{ id: e.id, at: Date.now(), text: e.text + where, node: e.node, kind: e.kind, level: 'info' as const, eventId: e.id }, ...ui.get().toastHistory].slice(0, 200) });
      else toast({ id: e.id, text: e.text + where, node: e.node, kind: e.kind, level, eventId: e.id });
    }
    if (frame.view.finished && !endShown.current) {
      endShown.current = true;
      openPanel('end');
    }
  }, [frame]);

  // lost selection: the selected object disappeared → explain and recover
  useEffect(() => {
    const sel = ui.get().selection;
    for (const o of objects) lastLabels.current.set(o.id, o.label);
    if (!sel || !frame) return;
    const ids = selectionIds(sel);
    if (!ids.length) return;
    const present = ids.filter((id) => objects.some((o) => o.id === id));
    if (present.length === ids.length) return;
    if (sel.kind === 'multi' && present.length > 0) {
      ui.patch({ selection: present.length === 1 ? { kind: 'stack', id: present[0].slice(2) } : { kind: 'multi', ids: present } });
      return;
    }
    const label = lastLabels.current.get(ids[0]) ?? 'The selected object';
    const why = sel.kind === 'stack' ? 'no longer exists — it may have been destroyed, merged or split. Check the journal for the event.' : sel.kind === 'contact' ? 'is no longer observed. Its last known position may survive as a stale report.' : 'has expired.';
    ui.patch({ selection: null, lostSelection: { label: `${label} ${why}`, at: frame.view.tick } });
  }, [objects, frame]);

  // global keyboard: pause, Escape layering, WASD pan, arrow cycling
  useEffect(() => {
    const keys = new Set<string>();
    let raf = 0;
    const panLoop = () => {
      raf = 0;
      const r = mapRef.current;
      if (!r || !keys.size) return;
      const s = 14;
      let dx = 0, dy = 0;
      if (keys.has('a')) dx += s;
      if (keys.has('d')) dx -= s;
      if (keys.has('w')) dy += s;
      if (keys.has('s')) dy -= s;
      if (keys.has('arrowup')) dy += s;
      if (keys.has('arrowdown')) dy -= s;
      r.panBy(dx, dy);
      raf = requestAnimationFrame(panLoop);
    };
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isModalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        const s = ui.get();
        if (s.contextMenu || s.chooser) ui.patch({ contextMenu: null, chooser: null });
        else if (s.mode.kind !== 'idle') window.dispatchEvent(new CustomEvent('wc-cancel-mode'));
        else if (s.panel) closePanel();
        else if (s.selection) select(null);
        return;
      }
      if (k === ' ' && (e.target === document.body || (e.target as HTMLElement).id === 'map-canvas')) {
        e.preventDefault();
        const f = getHost().store.get().frame;
        if (f) void getHost().setClock({ paused: !f.clock.paused });
        return;
      }
      const onMapOrBody = e.target === document.body || (e.target as HTMLElement).id === 'map-canvas';
      if (!onMapOrBody) return;
      if (['w', 'a', 's', 'd'].includes(k)) {
        keys.add(k);
        if (!raf) raf = requestAnimationFrame(panLoop);
        e.preventDefault();
        return;
      }
      if (k === 'arrowleft' || k === 'arrowright') {
        const s = ui.get().selection;
        const f = getHost().store.get().frame;
        if (f && s && (s.kind === 'stack' || s.kind === 'city' || s.kind === 'province')) {
          e.preventDefault();
          cycle(s.kind === 'stack' ? 'stack' : 'city', k === 'arrowright' ? 1 : -1);
          return;
        }
        keys.add(k === 'arrowleft' ? 'a' : 'd');
        if (!raf) raf = requestAnimationFrame(panLoop);
        e.preventDefault();
        return;
      }
      if (k === 'arrowup' || k === 'arrowdown') {
        keys.add(k);
        if (!raf) raf = requestAnimationFrame(panLoop);
        e.preventDefault();
        return;
      }
      if (k === 'home' || k === 'c') {
        document.querySelector<HTMLButtonElement>('[data-testid="recenter"]')?.click();
        return;
      }
      const hot: Record<string, Panel> = { f: 'forces', e: 'economy', r: 'research', g: 'diplomacy', i: 'intel', j: 'journal', y: 'cities', m: 'market', n: 'news', v: 'score' };
      if (hot[k] && !e.shiftKey) {
        openPanel(hot[k]);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      if (k === 'arrowleft') keys.delete('a');
      if (k === 'arrowright') keys.delete('d');
    };
    const blur = () => keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  if (!frame)
    return (
      <div className="page" aria-busy="true">
        <div className="page-inner">
          <p role="status">Loading campaign…</p>
        </div>
      </div>
    );

  return (
    <div className="app" data-testid="game">
      <a className="skip" href="#map-canvas">Skip to map</a>
      <TopBar />
      <ResourceStrip open={resOpen} />
      {!isMobile && <LeftRail />}
      {!isMobile && (
        <div className={`roster${rosterOpen ? '' : ' closed'}`} style={{ gridArea: 'roster' }}>
          {rosterOpen && <Roster />}
        </div>
      )}
      <div style={{ gridArea: 'map', position: 'relative', minWidth: 0, minHeight: 0, display: 'flex' }}>
        <MapView extraRoutes={moveRoutes} />
        <Toasts />
        {mode.kind === 'move' && <MoveOrder />}
        {mode.kind === 'draw' && <DrawBanner />}
        {panel && <PanelHost />}
        {isMobile && mode.kind === 'idle' && <Inspector mobile />}
        {isMobile && <MobileNav />}
      </div>
      {!isMobile && (
        <aside className={`inspector${inspectorOpen ? '' : ' closed'}`} aria-label="Inspector">
          {inspectorOpen && <Inspector />}
        </aside>
      )}
      {!isMobile && <TimeStrip />}
      <InterruptDialog />
      {briefing && <Briefing />}
      {tutorial && <Tutorial />}
    </div>
  );
}

export { cycle };
void prefs;
