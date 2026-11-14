import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapRenderer, HIT_SLOP, type MapInput, type RouteLine, type Hit } from './renderer';
import { buildObjects, searchPlaces, type MapObject } from './objects';
import { loadGeometry, NODES, countryName, cityByNode, TERRAIN_LABEL, MAP } from '../data/static';
import { prefs, setMapPrefs, type FillLayer } from '../persist/prefs';
import { useStore } from '../state/store';
import { ui, select, centerOn, type Selection, openPanel, startMove } from '../state/ui';
import { targeting, pointKey, type MapPoint } from '../state/targeting';
import { getHost } from '../sim/host';
import { useFrame, Icon, Sym, isTypingTarget, useIsMobile } from '../components/common';
import { legendFor, THEMES } from './palette';
import { screenToWorld, worldToScreen, clampCamera } from './projection';
import { setSymbolReadyCallback } from './symbols';
import type { Frame } from '../sim/protocol';

export const mapRef: { current: MapRenderer | null } = { current: null };

/** Unit marker style (per device): APP-6 symbols by default (spec), or simplified game counters. */
type UnitStyle = 'app6' | 'counters';
const UNIT_STYLE_KEY = 'wc.unitStyle.v1';
function readUnitStyle(): UnitStyle {
  try {
    return localStorage.getItem(UNIT_STYLE_KEY) === 'counters' ? 'counters' : 'app6';
  } catch {
    return 'app6';
  }
}
function writeUnitStyle(u: UnitStyle) {
  try {
    localStorage.setItem(UNIT_STYLE_KEY, u);
  } catch {
    /* storage unavailable: keep for this session only */
  }
}

/** Performance harness only (window.__wc.perfInject): synthetic render-only objects, never part of the sim. */
export const synthetic: { objects: MapObject[] } = { objects: [] };

export function selectionIds(sel: Selection): string[] {
  if (!sel) return [];
  if (sel.kind === 'stack') return [`S:${sel.id}`];
  if (sel.kind === 'contact') return [`C:${sel.id}`];
  if (sel.kind === 'report') return [`R:${sel.id}:${sel.ref}`];
  if (sel.kind === 'multi') return sel.ids;
  return [];
}

export function objectToSelection(o: MapObject): Selection {
  if (o.kind === 'stack') return { kind: 'stack', id: o.ref };
  if (o.kind === 'contact') return { kind: 'contact', id: o.ref };
  return { kind: 'report', id: o.ref, ref: o.id.split(':').slice(2).join(':') };
}

const objCache: { seq: number; objs: MapObject[] } = { seq: -1, objs: [] };
export function useObjects(): MapObject[] {
  const frame = useFrame();
  return useMemo(() => {
    if (!frame) return [];
    if (objCache.seq === frame.seq) return objCache.objs;
    objCache.seq = frame.seq;
    objCache.objs = buildObjects(frame);
    return objCache.objs;
  }, [frame]);
}

function relationFn(frame: Frame) {
  const m = new Map(frame.view.relations.map((r) => [r.country, r]));
  const me = frame.view.viewer;
  return (owner: string) => {
    if (owner === me) return 'self' as const;
    const r = m.get(owner);
    if (!r) return 'peace' as const;
    if (r.war) return 'war' as const;
    if (r.sameCoalition) return 'coalition' as const;
    if (r.myStatusToThem !== 'peace' || r.theirStatusToMe !== 'peace') return 'access' as const;
    return 'peace' as const;
  };
}

export function routeFromSegments(start: [number, number], segs: { to: number }[]): [number, number][] {
  const pts: [number, number][] = [start];
  for (const s of segs) {
    const n = NODES[s.to];
    if (n) pts.push(n.center);
  }
  return pts;
}

function buildInput(frame: Frame, objects: MapObject[], extra: { routes: RouteLine[]; selection: Selection; pinned: string[]; draft: MapInput['draft']; preview: MapInput['previewMarker'] }): MapInput {
  const v = frame.view;
  const morale = new Map<number, number>();
  for (const p of v.provinces) morale.set(p.node, p.morale);
  for (const c of v.cities) morale.set(c.node, c.morale);
  // Visibility fill: the engine's projection of nodes covered by the viewer's own and allied
  // (coalition / shared-intel) sensors and territory — never derived from hidden foreign state.
  const observed = new Set<number>(v.observedNodes);
  const rel = relationFn(frame);
  const routes: RouteLine[] = [];
  for (const s of v.stacks) {
    if (s.order && s.order.kind === 'move' && s.order.route.length) routes.push({ id: s.id, points: routeFromSegments(s.lonlat, s.order.route), kind: 'order' });
  }
  const sensors: MapInput['sensors'] = [];
  for (const s of v.stacks) {
    // effective radii from the engine (terrain sight modifier, unit levels, radar_range_mult; 0 aboard)
    const km = Math.max(s.sightKm ?? 0, s.radarKm ?? 0);
    if (km > 0) sensors.push({ lonlat: s.lonlat, km });
  }
  const cityOwners = new Map<string, string | null>();
  for (const c of v.publicCities) cityOwners.set(c.key, c.owner);
  const sel = extra.selection;
  const selected = new Set(selectionIds(sel));
  let selectedNode: number | null = null;
  if (sel?.kind === 'city') selectedNode = sel.node;
  else if (sel?.kind === 'province') selectedNode = sel.node;
  const launches = (v.launches as unknown as { id: string; from: [number, number] | null; to: [number, number] | null; launchedAt: number; arriveAt: number; knowledge: string; mine: boolean; missile: string }[])
    .filter((l) => l.to && (l.knowledge === 'in_flight' || l.knowledge === 'incoming'))
    .map((l) => ({ id: l.id, from: l.from, to: l.to as [number, number], progress: Math.max(0, Math.min(1, (v.tick - l.launchedAt) / Math.max(1, l.arriveAt - l.launchedAt))), label: l.mine ? `Strike in flight · ${l.arriveAt - v.tick} min` : 'Incoming strike' }));
  const patrols = v.stacks.filter((s) => s.air?.patrol).map((s) => ({ center: s.air!.patrol!.center, km: s.air!.patrol!.radiusKm, label: `${s.name} patrol` }));
  const alertIds = new Set<string>();
  for (const o of objects) if (o.kind === 'contact' && o.affiliation === 'hostile' && o.node !== null && v.owners[o.node] === v.viewer) alertIds.add(o.id);
  return {
    owners: v.owners,
    me: v.viewer,
    relation: rel,
    morale,
    rebel: new Set(v.rebelNodes),
    objects,
    cityOwners,
    capitals: new Set(v.publicCities.filter((c) => c.capital).map((c) => c.node)),
    routes: [...routes, ...extra.routes],
    drawings: frame.drawings,
    draft: extra.draft,
    selected,
    selectedNode,
    pinned: new Set(extra.pinned),
    sensors,
    observedNodes: observed,
    previewMarker: extra.preview,
    alertIds,
    launches,
    patrols,
  };
}

/** Fullscreen toggle (SPEC Annex A C: magnification, fullscreen, sound keep visible buttons). Local
 *  browser API only; hidden when the browser does not support it (with no other side effects). */
function FullscreenButton() {
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      className="round-btn"
      aria-label={on ? 'Exit fullscreen' : 'Enter fullscreen'}
      title={on ? 'Exit fullscreen' : 'Fullscreen'}
      aria-pressed={on}
      data-testid="fullscreen"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }}
    >
      <Icon name={on ? 'exit-fullscreen' : 'fullscreen'} />
    </button>
  );
}

function ownersSig(frame: Frame, fill: string): string {
  let h = 0;
  const o = frame.view.owners;
  for (let i = 0; i < o.length; i++) {
    const s = o[i];
    h = (h * 33 + (s ? s.charCodeAt(0) * 7 + s.charCodeAt(1) * 3 + s.charCodeAt(2) : 1) + i) | 0;
  }
  const mor = frame.view.provinces.reduce((a, p) => a + Math.round(p.morale / 5), 0) + frame.view.cities.reduce((a, c) => a + Math.round(c.morale / 5), 0);
  const rel = frame.view.relations.map((r) => (r.war ? 'w' : r.sameCoalition ? 'c' : r.myStatusToThem[0] + r.theirStatusToMe[0])).join('');
  // the visibility fill depends on the engine's observed-node set; hash it only when that layer is shown
  let obs = 0;
  if (fill === 'visibility') for (const n of frame.view.observedNodes) obs = (obs * 31 + n + 1) | 0;
  return `${h}|${mor}|${rel}|${frame.view.rebelNodes.length}|${frame.view.contacts.length}|${obs}`;
}

export function MapView({ extraRoutes = [] }: { extraRoutes?: RouteLine[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<MapRenderer | null>(null);
  const frame = useFrame();
  const objects = useObjects();
  const p = useStore(prefs);
  const selection = useStore(ui, (s) => s.selection);
  const mode = useStore(ui, (s) => s.mode);
  const camReq = useStore(ui, (s) => s.camera);
  const pinned = useStore(ui, (s) => s.pinned);
  const previewMarker = useStore(ui, (s) => s.previewMarker);
  const ctxMenu = useStore(ui, (s) => s.contextMenu);
  const chooser = useStore(ui, (s) => s.chooser);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  const tstate = useStore(targeting);
  /** Last time a camera request (centre on an object) was applied: a resize right after it keeps the centre. */
  const camReqAt = useRef(0);
  const [showLayers, setShowLayers] = useState(false);
  const [showLegend, setShowLegend] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const [scale, setScale] = useState({ px: 100, label: '' });
  const [zs, setZs] = useState('regional');
  const lastSig = useRef('');
  const isMobile = useIsMobile();

  // mount renderer
  useEffect(() => {
    const c = canvasRef.current!;
    const r = new MapRenderer(c, prefs.get().map);
    rRef.current = r;
    mapRef.current = r;
    r.setTheme(prefs.get().theme);
    r.mono = prefs.get().monochromeSymbols;
    r.onFrame = () => {
      const sb = r.scaleBar();
      setScale((o) => (o.label === sb.label && Math.abs(o.px - sb.px) < 1 ? o : sb));
      setZs(r.zoomState);
    };
    setSymbolReadyCallback(() => r.requestDraw());
    r.overlayRects = () => {
      const cb = c.getBoundingClientRect();
      const scope = wrapRef.current?.parentElement ?? wrapRef.current;
      return [...(scope?.querySelectorAll<HTMLElement>('.map-tools, .legend, .map-search, .scalebar, .dpad, .layers-pop, .hud-card, .side-tabs, .roster, .unit-dock, .timestrip, .order-bar, .mode-banner') ?? [])].map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.left - cb.left, y: b.top - cb.top, w: b.width, h: b.height };
      });
    };
    let sized = false;
    const ro = new ResizeObserver(() => {
      const b = wrapRef.current!.getBoundingClientRect();
      const w0 = r.w;
      r.resize(b.width, b.height, window.devicePixelRatio);
      // The inspector opens/closes on the right of the map: keep every world point at the same screen
      // x (anchor the left edge) instead of re-centring, so the map does not slide under the pointer
      // between two clicks. Right after an explicit "centre on" request the centre is kept instead.
      if (sized && r.w !== w0 && performance.now() - camReqAt.current > 600) r.cam = clampCamera({ ...r.cam, cx: r.cam.cx + (r.w - w0) / 2 / r.cam.z }, r.w, r.h);
      sized = true;
      r.requestDraw();
    });
    ro.observe(wrapRef.current!);
    let alive = true;
    void loadGeometry().then((g) => alive && r.setGeometry(g));
    const cam = ui.get().camera;
    if (cam) r.center(cam.lon, cam.lat, cam.zoom ?? r.cam.z);
    return () => {
      alive = false;
      ro.disconnect();
      r.destroy();
      if (mapRef.current === r) mapRef.current = null;
    };
  }, []);

  const [unitStyle, setUnitStyle] = useState<UnitStyle>(readUnitStyle);
  useEffect(() => {
    const r = rRef.current;
    if (!r) return;
    r.setTheme(p.theme);
    r.mono = p.monochromeSymbols;
    r.unitStyle = unitStyle;
    r.setPrefs(p.map);
  }, [p, unitStyle]);

  useEffect(() => {
    if (camReq && rRef.current) {
      const r = rRef.current;
      camReqAt.current = performance.now();
      r.center(camReq.lon, camReq.lat, camReq.zoom ?? r.cam.z);
    }
  }, [camReq]);

  const draft = mode.kind === 'draw' ? { kind: mode.drawKind, points: mode.points } : null;
  useEffect(() => {
    const r = rRef.current;
    if (!r || !frame) return;
    const sig = ownersSig(frame, p.map.fill);
    const changed = sig !== lastSig.current;
    lastSig.current = sig;
    r.setInput(buildInput(frame, synthetic.objects.length ? [...objects, ...synthetic.objects] : objects, { routes: extraRoutes, selection, pinned, draft, preview: previewMarker }), changed);
  }, [frame, objects, selection, pinned, extraRoutes, draft, previewMarker, p.map.fill]);

  // ───────── pointer handling ─────────
  /** Pointer gesture: (x0, y0) = where it went down (a click acts there); (x, y) = last pan point. */
  const ptr = useRef<{ id: number; x0: number; y0: number; x: number; y: number; button: number; moved: boolean; shift: boolean; ctrl: boolean; touch: boolean } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const b = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  function nodeAtScreen(x: number, y: number): number | null {
    const r = rRef.current!;
    const [lon, lat] = screenToWorld(r.cam, r.w, r.h, x, y);
    return r.nodeAt(lon, lat);
  }

  function selectObjectIds(ids: string[], additive: boolean) {
    const sel = ui.get().selection;
    if (additive) {
      const cur = new Set(selectionIds(sel).filter((i) => i.startsWith('S:')));
      for (const i of ids) if (i.startsWith('S:')) (cur.has(i) ? cur.delete(i) : cur.add(i));
      const arr = [...cur];
      if (arr.length === 1) select({ kind: 'stack', id: arr[0].slice(2) });
      else if (arr.length > 1) select({ kind: 'multi', ids: arr });
      else select(null);
      return;
    }
    const o = objects.find((x) => x.id === ids[0]);
    if (o) select(objectToSelection(o));
  }

  /** Viewer-safe description of what is under a screen point (targeting): sector + map objects. */
  function mapPointAt(x: number, y: number, slop: number): MapPoint {
    const r = rRef.current!;
    const ll = screenToWorld(r.cam, r.w, r.h, x, y) as [number, number];
    const ids = [...new Set(r.objectsAt(x, y, slop).flatMap((h) => h.ids))];
    return { node: r.nodeAt(ll[0], ll[1]), objects: ids, lonlat: ll };
  }

  function onClick(x: number, y: number, shift: boolean, ctrl: boolean, slop: number = HIT_SLOP.mouse) {
    const r = rRef.current!;
    const m = ui.get().mode;
    if (m.kind === 'move') {
      const n = nodeAtScreen(x, y);
      if (n === null) return;
      if (shift) ui.patch({ mode: { ...m, waypoints: m.dest !== null ? [...m.waypoints, m.dest] : m.waypoints, dest: n } });
      else ui.patch({ mode: { ...m, dest: n } });
      return;
    }
    if (m.kind === 'draw') {
      const ll = screenToWorld(r.cam, r.w, r.h, x, y);
      const pts = [...m.points, ll as [number, number]];
      ui.patch({ mode: { ...m, points: pts } });
      return;
    }
    if (m.kind === 'pick') {
      const pt = mapPointAt(x, y, slop);
      if (pt.node !== null || pt.objects.length) window.dispatchEvent(new CustomEvent('wc-pick', { detail: { purpose: m.purpose, ...pt } }));
      return;
    }
    const h = r.hitAt(x, y, slop);
    if (h) {
      if (h.kind === 'object' && h.locate) {
        // locator arrow at the viewport edge: bring the off-screen selection into view
        const o = objects.find((ob) => ob.id === h.ids[0]);
        if (o) centerOn(o.lonlat[0], o.lonlat[1], r.cam.z);
        return;
      }
      if (h.kind === 'object') return selectObjectIds(h.ids, shift || ctrl);
      if (h.kind === 'cluster') {
        if (shift || ctrl) return selectObjectIds(h.ids, true);
        const items = h.ids.map((id) => objects.find((o) => o.id === id)).filter(Boolean).map((o) => ({ id: o!.id, label: o!.label }));
        ui.patch({ chooser: { x, y, items } });
        return;
      }
      if ((h.kind === 'city' || h.kind === 'small') && h.node !== undefined) {
        const c = cityByNode.get(h.node);
        if (h.kind === 'small' && c) centerOn(c.lonlat[0], c.lonlat[1], Math.max(r.cam.z, 40));
        if (c) return select({ kind: 'city', key: c.key, node: c.node });
      }
    }
    const n = nodeAtScreen(x, y);
    if (n === null || NODES[n].kind === 'sea') {
      // clicking the ocean clears ordinary selection
      select(null);
      return;
    }
    const c = cityByNode.get(n);
    if (c) select({ kind: 'city', key: c.key, node: n });
    else select({ kind: 'province', node: n });
  }

  function openContext(x: number, y: number) {
    const r = rRef.current!;
    const h = r.hitAt(x, y);
    if (!h || (h.kind !== 'object' && h.kind !== 'cluster')) return false;
    const o = objects.find((ob) => ob.id === h.ids[0]);
    if (!o) return false;
    selectObjectIds([o.id], false);
    ui.patch({ contextMenu: { x, y, target: o.id } });
    return true;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.focus({ preventScroll: true });
    const { x, y } = local(e);
    if (e.pointerType === 'touch') pinch.current.set(e.pointerId, { x, y });
    if (pinch.current.size >= 2) {
      ptr.current = null;
      return;
    }
    ptr.current = { id: e.pointerId, x0: x, y0: y, x, y, button: e.button, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, touch: e.pointerType !== 'mouse' };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    ui.patch({ contextMenu: null, chooser: null });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = rRef.current;
    if (!r) return;
    const { x, y } = local(e);
    if (e.pointerType === 'touch' && pinch.current.has(e.pointerId)) {
      pinch.current.set(e.pointerId, { x, y });
      if (pinch.current.size >= 2) {
        const [a, b] = [...pinch.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist.current) r.zoomAt(d / pinchDist.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist.current = d;
        return;
      }
    }
    const pd = ptr.current;
    if (pd && pd.id === e.pointerId) {
      // click vs drag: a press that wanders less than the threshold is still a click (at the press point)
      if (!pd.moved && Math.hypot(x - pd.x0, y - pd.y0) > (pd.touch ? CLICK_SLOP.touch : CLICK_SLOP.mouse)) pd.moved = true;
      if (pd.moved) {
        if (pd.button === 2 && ui.get().mode.kind === 'idle') {
          r.lasso = { x0: pd.x0, y0: pd.y0, x1: x, y1: y };
          r.requestDraw();
        } else if (pd.button === 0 || e.pointerType !== 'mouse') {
          r.panBy(x - pd.x, y - pd.y);
          pd.x = x;
          pd.y = y;
        }
        setTip(null);
        r.setHover([]);
      }
      return;
    }
    if (e.pointerType === 'mouse') hoverAt(x, y);
  };

  /** Mouse hover: idle → pointer cursor + ring + name over what a click would select; targeting →
   *  crosshair + the active order's live preview of the target under the pointer. */
  function hoverAt(x: number, y: number) {
    const r = rRef.current!;
    const c = canvasRef.current!;
    const m = ui.get().mode;
    if (m.kind === 'pick' || m.kind === 'move') {
      c.style.cursor = 'crosshair';
      r.setHover([]);
      const pt = mapPointAt(x, y, HIT_SLOP.mouse);
      if (pointKey(pt) !== pointKey(targeting.get().hover)) targeting.patch({ hover: pt, tip: null });
      setTip({ x, y, text: '' });
      return;
    }
    if (m.kind === 'draw') {
      c.style.cursor = 'crosshair';
      setTip(null);
      return;
    }
    const h = r.hitAt(x, y, HIT_SLOP.mouse);
    if (h && (h.kind === 'object' || h.kind === 'cluster')) {
      c.style.cursor = 'pointer';
      r.setHover(h.locate ? [] : h.ids);
      if (h.kind === 'cluster') {
        const names = h.ids.map((id) => objects.find((o) => o.id === id)?.label).filter(Boolean) as string[];
        setTip({ x, y, text: `${names.length} here — click to choose`, sub: names.slice(0, 5).join(' · ') + (names.length > 5 ? ` · +${names.length - 5} more` : '') });
      } else setTip({ x, y, text: h.label, sub: h.locate ? 'Click to bring into view' : undefined });
      return;
    }
    r.setHover([]);
    if (h && (h.kind === 'city' || h.kind === 'small')) {
      c.style.cursor = 'pointer';
      setTip({ x, y, text: h.label });
      return;
    }
    c.style.cursor = '';
    const n = nodeAtScreen(x, y);
    if (n !== null) {
      const node = NODES[n];
      const owner = frame?.view.owners[n] ?? null;
      const txt = node.kind === 'sea' ? `${node.name} · ${TERRAIN_LABEL[node.terrain]}` : node.outside ? `${node.territory?.name ?? node.name} — Outside campaign: no seat, no production, no score; land transit blocked.` : `${node.name} · ${countryName(owner)} · ${TERRAIN_LABEL[node.terrain]}`;
      setTip({ x, y, text: txt });
    } else setTip(null);
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const r = rRef.current;
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchDist.current = null;
    const pd = ptr.current;
    ptr.current = null;
    if (!r || !pd || pd.id !== e.pointerId) return;
    const { x, y } = local(e);
    if (pd.button === 2) {
      if (r.lasso) {
        const hits = r.hitsInRect(r.lasso.x0, r.lasso.y0, r.lasso.x1, r.lasso.y1);
        r.lasso = null;
        r.requestDraw();
        const ids = [...new Set(hits.flatMap((h) => h.ids).filter((i) => i.startsWith('S:')))];
        if (ids.length === 1) select({ kind: 'stack', id: ids[0].slice(2) });
        else if (ids.length > 1) select({ kind: 'multi', ids });
        return;
      }
      // secondary click: cancel targeting, else context menu on a known unit
      const m = ui.get().mode;
      if (m.kind !== 'idle') {
        window.dispatchEvent(new CustomEvent('wc-cancel-mode'));
        return;
      }
      openContext(pd.x0, pd.y0);
      return;
    }
    if (!pd.moved) {
      onClick(pd.x0, pd.y0, pd.shift, pd.ctrl, pd.touch ? HIT_SLOP.touch : HIT_SLOP.mouse);
      if (!pd.touch) hoverAt(x, y);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = rRef.current;
    if (!r) return;
    const { x, y } = local(e);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    r.zoomAt(f, x, y);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const m = ui.get().mode;
    // targeting: a double click must not move the map between picking and confirming
    if (m.kind !== 'idle') return;
    const { x, y } = local(e);
    const r = rRef.current;
    if (!r) return;
    // a double click on a formation/city selects it (twice) — never zoom the map out from under it
    if (r.hitAt(x, y, HIT_SLOP.mouse)) return;
    r.zoomAt(2, x, y);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rRef.current;
    if (!r || isTypingTarget(e.target)) return;
    if (e.key === '+' || e.key === '=') {
      r.zoomAt(1.4, r.w / 2, r.h / 2);
      e.preventDefault();
    } else if (e.key === '-' || e.key === '_') {
      r.zoomAt(1 / 1.4, r.w / 2, r.h / 2);
      e.preventDefault();
    } else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && selection) {
      const o = objects.find((ob) => selectionIds(selection).includes(ob.id));
      if (o) {
        const [x, y] = worldToScreen(r.cam, r.w, r.h, o.lonlat[0], o.lonlat[1]);
        ui.patch({ contextMenu: { x: Math.max(10, Math.min(r.w - 200, x)), y: Math.max(10, Math.min(r.h - 160, y)), target: o.id } });
        e.preventDefault();
      }
    } else if (e.key === 'Enter' && mode.kind === 'draw') {
      window.dispatchEvent(new CustomEvent('wc-finish-draw'));
      e.preventDefault();
    } else if (e.key === 'Enter' && (mode.kind === 'pick' || mode.kind === 'move')) {
      // keyboard confirm of the targeted order (the order bar validates exactly as its button)
      window.dispatchEvent(new CustomEvent('wc-confirm-order'));
      e.preventDefault();
    }
  };

  const resetToCapital = () => {
    const cap = frame?.view.self.capitalCity;
    const c = cap ? MAP.cityByKey.get(cap) : null;
    const fallback = frame?.view.cities[0];
    if (c) centerOn(c.lonlat[0], c.lonlat[1], 18);
    else if (fallback) centerOn(NODES[fallback.node].center[0], NODES[fallback.node].center[1], 18);
  };

  const targeting_ = mode.kind === 'pick' || mode.kind === 'move';
  // targeting highlight: the candidate the active order resolved (coloured by the validator), else the hovered sector
  useEffect(() => {
    const r = rRef.current;
    const c = canvasRef.current;
    if (!r || !c) return;
    if (!targeting_) {
      r.setTarget(null);
      if (c.style.cursor === 'crosshair') c.style.cursor = '';
      return;
    }
    c.style.cursor = 'crosshair';
    r.setHover([]);
    const h = tstate.hover;
    if (!h) return r.setTarget(null);
    const t = tstate.tip && tstate.tip.key === pointKey(h) ? tstate.tip : null;
    r.setTarget(t ? { node: t.node === undefined ? h.node : t.node, ids: t.ids ?? [], state: t.ok === true ? (t.warn ? 'warn' : 'ok') : t.ok === false ? 'bad' : 'pending' } : { node: h.node, ids: [], state: 'pending' });
  }, [targeting_, tstate]);

  const legend = legendFor(p.map.fill, THEMES[p.theme]);
  const objCount = objects.length;
  const ariaSummary = frame ? `Operations map, ${zs} zoom. ${objects.filter((o) => o.kind === 'stack').length} friendly formations and ${objects.filter((o) => o.kind !== 'stack').length} contacts or reports known. Use the Forces roster or search for a list of the same objects. Drag or WASD to pan, plus and minus to zoom.` : 'Operations map';

  return (
    <div className="mapwrap" ref={wrapRef} data-testid="map" data-zoom-state={zs} data-fill={p.map.fill} data-objects={objCount}>
      <canvas
        id="map-canvas"
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label={ariaSummary}
        aria-roledescription="map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          ptr.current = null;
          pinch.current.clear();
        }}
        onPointerLeave={() => {
          setTip(null);
          rRef.current?.setHover([]);
          if (targeting.get().hover) targeting.patch({ hover: null, tip: null });
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      />
      <MapSearch objects={objects} />
      <div className="map-tools" role="toolbar" aria-label="Map controls">
        <button type="button" className="round-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => rRef.current?.zoomAt(1.5, rRef.current.w / 2, rRef.current.h / 2)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="round-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => rRef.current?.zoomAt(1 / 1.5, rRef.current.w / 2, rRef.current.h / 2)}>
          <Icon name="minus" />
        </button>
        <button type="button" className="round-btn" aria-label="Reset view to capital" title="Reset to capital (Home)" onClick={resetToCapital} data-testid="recenter">
          <Icon name="home" />
        </button>
        <button type="button" className="round-btn" aria-label="Map layers" title="Map layers and display settings" aria-expanded={showLayers} onClick={() => setShowLayers((s) => !s)} data-testid="layers-button">
          <Icon name="settings" />
        </button>
        <button type="button" className="round-btn" aria-label={showLegend ? 'Hide legend' : 'Show legend'} title="Legend" aria-pressed={showLegend} onClick={() => setShowLegend((s) => !s)}>
          <Icon name="legend" />
        </button>
        <FullscreenButton />
      </div>
      {isMobile && (
        <div className="dpad" role="group" aria-label="Pan the map">
          {(['', 'up', '', 'left', '', 'right', '', 'down', ''] as const).map((d, i) =>
            d ? (
              <button key={i} type="button" className="btn" aria-label={`Pan ${d}`} onClick={() => rRef.current?.panBy(d === 'left' ? 120 : d === 'right' ? -120 : 0, d === 'up' ? 120 : d === 'down' ? -120 : 0)}>
                {d === 'up' ? '↑' : d === 'down' ? '↓' : d === 'left' ? '←' : '→'}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      )}
      {showLayers && <LayerPanel onClose={() => setShowLayers(false)} unitStyle={unitStyle} onUnitStyle={(u) => { setUnitStyle(u); writeUnitStyle(u); }} />}
      {showLegend && (
        <div className={`legend${isMobile ? ' open' : ''}`} aria-label="Map legend" role="region" data-testid="legend" data-legend={p.map.fill}>
          <div className="row">
            <strong style={{ fontSize: 12.5 }}>{legend.title}</strong>
            {isMobile && (
              <button type="button" className="btn ghost small close-x" onClick={() => setShowLegend(false)} aria-label="Close legend">
                ✕
              </button>
            )}
          </div>
          <ul>
            {legend.items.map((it) => (
              <li key={it.label}>
                <Swatch color={it.color} pattern={it.pattern} />
                <span>{it.label}</span>
              </li>
            ))}
          </ul>
          {legend.note && <div className="muted" style={{ marginTop: 4, fontSize: 11.5 }}>{legend.note}</div>}
          <SymbolLegend />
        </div>
      )}
      <div className="scalebar" aria-label={`Scale: ${scale.label}`}>
        <div className="b" style={{ width: scale.px }} />
        {scale.label} · <span style={{ textTransform: 'capitalize' }}>{zs}</span>
      </div>
      {tip && !ctxMenu && !chooser && (targeting_ ? (
        <TargetTooltip x={tip.x} y={tip.y} w={rRef.current?.w ?? 800} />
      ) : (
        tip.text && (
          <div className="tooltip" style={{ left: Math.min(tip.x + 14, (rRef.current?.w ?? 800) - 300), top: tip.y + 14 }} role="tooltip" data-testid="map-tooltip">
            {tip.text}
            {tip.sub && <div className="muted" style={{ fontSize: 11.5 }}>{tip.sub}</div>}
          </div>
        )
      ))}
      {ctxMenu && <ContextMenu objects={objects} />}
      {chooser && <Chooser objects={objects} />}
    </div>
  );
}


/** Click-vs-drag threshold (CSS px): a press that moves less than this is a click at the press point. */
const CLICK_SLOP = { mouse: 6, touch: 10 } as const;

/** Live preview next to the crosshair while an order picks its target (from the validator). */
function TargetTooltip({ x, y, w }: { x: number; y: number; w: number }) {
  const t = useStore(targeting);
  const h = t.hover;
  if (!h) return null;
  const tip = t.tip && t.tip.key === pointKey(h) ? t.tip : null;
  const place = h.node !== null ? placeLabel(h.node) : 'Off the map';
  return (
    <div className={`tooltip target-tip${tip ? (tip.ok === false ? ' bad' : tip.warn ? ' warn' : tip.ok ? ' ok' : '') : ''}`} style={{ left: Math.min(x + 18, w - 300), top: y + 18 }} role="tooltip" data-testid="target-tip" data-state={tip ? (tip.ok === false ? 'bad' : tip.warn ? 'warn' : tip.ok ? 'ok' : 'pending') : 'pending'}>
      <strong>{tip?.title ?? place}</strong>
      {(tip?.lines ?? ['Checking…']).map((l) => (
        <div key={l}>{l}</div>
      ))}
      {tip && tip.ok !== false && <div className="muted" style={{ fontSize: 11 }}>Click to set the target</div>}
    </div>
  );
}

function placeLabel(n: number): string {
  const node = NODES[n];
  return node.kind === 'sea' ? `${node.name} (sea)` : node.outside ? `${node.territory?.name ?? node.name} (outside campaign)` : node.name;
}

function Swatch({ color, pattern }: { color: string; pattern: string }) {
  const bg: React.CSSProperties = { background: color };
  const pat: Record<string, string> = {
    hatch: 'repeating-linear-gradient(135deg, rgba(0,0,0,.5) 0 1px, transparent 1px 5px)',
    hatch2: 'repeating-linear-gradient(45deg, rgba(0,0,0,.5) 0 1px, transparent 1px 5px)',
    cross: 'repeating-linear-gradient(45deg, rgba(0,0,0,.5) 0 1px, transparent 1px 5px), repeating-linear-gradient(135deg, rgba(0,0,0,.5) 0 1px, transparent 1px 5px)',
    dots: 'radial-gradient(rgba(0,0,0,.6) 1px, transparent 1.4px) 0 0/5px 5px',
    dense: 'radial-gradient(rgba(0,0,0,.6) 1px, transparent 1.4px) 0 0/3px 3px',
    grid: 'linear-gradient(rgba(0,0,0,.5) 1px, transparent 1px) 0 0/5px 5px, linear-gradient(90deg, rgba(0,0,0,.5) 1px, transparent 1px) 0 0/5px 5px',
    wave: 'repeating-linear-gradient(0deg, rgba(0,0,0,.45) 0 1px, transparent 1px 4px)',
    stipple: 'radial-gradient(rgba(0,0,0,.6) .7px, transparent 1px) 0 0/4px 4px',
  };
  if (pat[pattern]) bg.backgroundImage = pat[pattern];
  return <span className="sw" style={{ ...bg, backgroundColor: color }} aria-hidden />;
}

function SymbolLegend() {
  const inf = '13031000001211040000';
  const arm = '13031000001205000000';
  const hos = '13061000001211040000';
  const unk = '13011000000000000000';
  const neu = '13041000001211040000';
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12 }}>Unit symbols (APP-6)</summary>
      <ul>
        <li><Sym sidc={inf} size={16} /> Friendly infantry</li>
        <li><Sym sidc={arm} size={16} /> Friendly armor</li>
        <li><Sym sidc={hos} size={16} /> Hostile (diamond)</li>
        <li><Sym sidc={neu} size={16} /> Neutral (square)</li>
        <li><Sym sidc={unk} size={16} /> Unknown contact (quatrefoil)</li>
        <li><span className="tag stale">6h</span> Observation age badge</li>
        <li><span className="tag">×3</span> Stack count (not echelon)</li>
        <li><span style={{ display: 'inline-block', width: 20, borderTop: '2px solid currentColor' }} /> Committed order · <span style={{ display: 'inline-block', width: 20, borderTop: '2px dashed #c58cff' }} /> Planning draft</li>
      </ul>
    </details>
  );
}

function LayerPanel({ onClose, unitStyle, onUnitStyle }: { onClose: () => void; unitStyle: UnitStyle; onUnitStyle: (u: UnitStyle) => void }) {
  const p = useStore(prefs, (s) => s.map);
  const fills: { id: FillLayer; label: string }[] = [
    { id: 'political', label: 'Political control' },
    { id: 'terrain', label: 'Terrain' },
    { id: 'morale', label: 'Morale' },
    { id: 'resources', label: 'Resources' },
    { id: 'relations', label: 'Relations / coalition' },
    { id: 'visibility', label: 'Visibility' },
  ];
  const toggles: { id: 'borders' | 'names' | 'routes' | 'symbols' | 'sensors' | 'dim'; label: string }[] = [
    { id: 'borders', label: 'Borders' },
    { id: 'names', label: 'Names' },
    { id: 'routes', label: 'Routes & orders' },
    { id: 'symbols', label: 'Unit symbols' },
    { id: 'sensors', label: 'Sensor coverage' },
    { id: 'dim', label: 'Dim basemap under overlays' },
  ];
  return (
    <div className="layers-pop" role="dialog" aria-label="Map layers" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <fieldset>
        <legend>Primary fill (one at a time)</legend>
        {fills.map((f) => (
          <label key={f.id} className="row" style={{ gap: 6 }}>
            <input type="radio" name="fill" checked={p.fill === f.id} onChange={() => setMapPrefs({ fill: f.id })} data-testid={`fill-${f.id}`} />
            {f.label}
          </label>
        ))}
      </fieldset>
      <fieldset style={{ marginTop: 8 }}>
        <legend>Overlays</legend>
        {toggles.map((t) => (
          <label key={t.id} className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={p[t.id]} onChange={(e) => setMapPrefs({ [t.id]: e.target.checked })} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <fieldset style={{ marginTop: 8 }}>
        <legend>Unit markers</legend>
        <label className="row" style={{ gap: 6 }}>
          <input type="radio" name="unit-style" checked={unitStyle === 'app6'} onChange={() => onUnitStyle('app6')} data-testid="unit-style-app6" />
          Military symbols (APP-6)
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="radio" name="unit-style" checked={unitStyle === 'counters'} onChange={() => onUnitStyle('counters')} data-testid="unit-style-counters" />
          Game counters (class icon + count)
        </label>
      </fieldset>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function ContextMenu({ objects }: { objects: MapObject[] }) {
  const cm = useStore(ui, (s) => s.contextMenu)!;
  const ref = useRef<HTMLDivElement>(null);
  const o = objects.find((x) => x.id === cm.target);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  if (!o) return null;
  const close = () => {
    ui.patch({ contextMenu: null });
    document.getElementById('map-canvas')?.focus();
  };
  const items: { label: string; act: (e?: React.MouseEvent) => void }[] = [{ label: 'Inspect', act: () => ui.patch({ inspectorOpen: true, sheetExpanded: true }) }];
  if (o.kind === 'stack') {
    items.push({ label: 'Locate in roster', act: () => { ui.patch({ rosterOpen: true }); setTimeout(() => document.querySelector<HTMLElement>(`[data-roster-id="${o.id}"]`)?.focus(), 30); } });
    items.push({ label: 'Orders: Move…', act: (e) => startMove([o.ref], e) });
  }
  if (o.kind !== 'stack') items.push({ label: ui.get().pinned.includes(o.id) ? 'Unpin report' : 'Pin report', act: () => { const pins = ui.get().pinned; ui.patch({ pinned: pins.includes(o.id) ? pins.filter((x) => x !== o.id) : [...pins, o.id] }); } });
  if (o.kind === 'contact' || o.kind === 'report') items.push({ label: 'Open intelligence', act: () => openPanel('intel') });
  return (
    <div className="ctxmenu" role="menu" aria-label={`Actions for ${o.label}`} style={{ left: cm.x, top: cm.y }} ref={ref} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const bs = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        const i = bs.indexOf(document.activeElement as HTMLElement);
        bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
      }
    }}>
      <div className="muted" style={{ padding: '4px 10px', fontSize: 12 }}>{o.label}</div>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" onClick={(e) => { ui.patch({ contextMenu: null }); it.act(e); }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Chooser({ objects }: { objects: MapObject[] }) {
  const ch = useStore(ui, (s) => s.chooser)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div className="chooser" role="listbox" aria-label="Choose an object at this location" style={{ left: ch.x, top: ch.y }} ref={ref} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), ui.patch({ chooser: null }))}>
      <div className="muted" style={{ padding: '4px 10px', fontSize: 12 }}>{ch.items.length} objects here — pick one</div>
      {ch.items.map((it) => {
        const o = objects.find((x) => x.id === it.id);
        return (
          <button key={it.id} type="button" role="option" aria-label={o?.aria ?? it.label} onClick={() => { if (o) select(objectToSelection(o)); ui.patch({ chooser: null }); }}>
            {o && <Sym sidc={o.sidc} size={16} />} {it.label}
          </button>
        );
      })}
    </div>
  );
}

function MapSearch({ objects }: { objects: MapObject[] }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const frame = useFrame();
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return { armies: [] as MapObject[], places: [] as ReturnType<typeof searchPlaces> };
    return { armies: objects.filter((o) => o.search.includes(s)).slice(0, 8), places: searchPlaces(s, frame, 10) };
  }, [q, objects, frame]);
  const placesFirst = results.places.some((p) => p.label.toLowerCase() === q.trim().toLowerCase());
  const armyItems = results.armies.map((o) => ({ t: 'o' as const, o }));
  const placeItems = results.places.map((p) => ({ t: 'p' as const, p }));
  const flat: ({ t: 'o'; o: MapObject } | { t: 'p'; p: ReturnType<typeof searchPlaces>[number] })[] = placesFirst ? [...placeItems, ...armyItems] : [...armyItems, ...placeItems];
  const armyOffset = placesFirst ? placeItems.length : 0;
  const placeOffset = placesFirst ? 0 : armyItems.length;
  const pick = (i: number) => {
    const it = flat[i];
    if (!it) return;
    if (it.t === 'o') {
      select(objectToSelection(it.o));
      centerOn(it.o.lonlat[0], it.o.lonlat[1], Math.max(mapRef.current?.cam.z ?? 20, 30));
    } else {
      const c = it.p.kind === 'city' ? cityByNode.get(it.p.node) : null;
      if (c) select({ kind: 'city', key: c.key, node: c.node });
      else select({ kind: 'province', node: it.p.node });
      centerOn(it.p.lonlat[0], it.p.lonlat[1], Math.max(mapRef.current?.cam.z ?? 20, 30));
    }
    setQ('');
  };
  return (
    <div className="map-search" role="search">
      <span className="ms-ico" aria-hidden>
        <Icon name="search" size={16} />
      </span>
      <label className="sr-only" htmlFor="map-search-input">Search armies, cities and provinces</label>
      <input
        id="map-search-input"
        type="search"
        placeholder="Search armies, cities, provinces…"
        value={q}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(flat.length - 1, a + 1)); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
          else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
          else if (e.key === 'Escape') { if (q) { setQ(''); e.stopPropagation(); } }
        }}
        aria-controls="map-search-results"
        aria-expanded={!!q}
      />
      {q && (
        <div className="search-results" id="map-search-results" role="listbox" aria-label="Search results">
          {flat.length === 0 && <div className="muted" style={{ padding: 8 }}>No match. Clear the search to restore the map.</div>}
          {placesFirst ? (
            <>
          {results.places.length > 0 && <div className="g">Cities & provinces</div>}
          {results.places.map((p, j) => (
            <button key={p.id} type="button" role="option" aria-selected={active === placeOffset + j} onClick={() => pick(placeOffset + j)}>
              <span>{p.label}</span> <span className="muted" style={{ fontSize: 11.5 }}>{p.sub}</span>
            </button>
          ))}
          {results.armies.length > 0 && <div className="g">Armies & contacts</div>}
          {results.armies.map((o, i) => (
            <button key={o.id} type="button" role="option" aria-selected={active === armyOffset + i} aria-label={o.aria} onClick={() => pick(armyOffset + i)}>
              <Sym sidc={o.sidc} size={16} /> <span>{o.label}</span>
            </button>
          ))}
            </>
          ) : (
            <>
          {results.armies.length > 0 && <div className="g">Armies & contacts</div>}
          {results.armies.map((o, i) => (
            <button key={o.id} type="button" role="option" aria-selected={active === armyOffset + i} aria-label={o.aria} onClick={() => pick(armyOffset + i)}>
              <Sym sidc={o.sidc} size={16} /> <span>{o.label}</span>
            </button>
          ))}
          {results.places.length > 0 && <div className="g">Cities & provinces</div>}
          {results.places.map((p, j) => (
            <button key={p.id} type="button" role="option" aria-selected={active === placeOffset + j} onClick={() => pick(placeOffset + j)}>
              <span>{p.label}</span> <span className="muted" style={{ fontSize: 11.5 }}>{p.sub}</span>
            </button>
          ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export type { Hit };
