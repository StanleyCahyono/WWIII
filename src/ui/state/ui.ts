/** UI-only state (never part of the simulation). */
import { createStore } from './store';
import { targeting, clearTargetHover, fromKeyboard } from './targeting';

export type Screen = 'boot' | 'title' | 'new' | 'load' | 'settings' | 'credits' | 'diagnostics' | 'game';
export type Panel =
  | 'forces'
  | 'economy'
  | 'research'
  | 'diplomacy'
  | 'intel'
  | 'journal'
  | 'cities'
  | 'coalition'
  | 'news'
  | 'market'
  | 'score'
  | 'planning'
  | 'dossier'
  | 'help'
  | 'campaign'
  | 'end'
  | 'roster';

export type Selection =
  | { kind: 'stack'; id: string }
  | { kind: 'contact'; id: string }
  | { kind: 'report'; id: string; ref: string }
  | { kind: 'city'; key: string; node: number }
  | { kind: 'province'; node: number }
  | { kind: 'multi'; ids: string[] }
  | null;

export type MapMode =
  | { kind: 'idle' }
  | { kind: 'move'; stacks: string[]; waypoints: number[]; dest: number | null }
  | { kind: 'draw'; drawKind: 'phase_line' | 'area' | 'route' | 'objective' | 'label' | 'bookmark'; points: [number, number][] }
  | { kind: 'pick'; purpose: string; prompt: string; land?: boolean };

/** Orders that pick their target directly on the map (OrderHost renders the targeting bar). */
export type OrderKind = 'attack' | 'patrol' | 'rebase' | 'embark' | 'retreat' | 'launch' | 'deploy' | 'airmobile' | 'rally';
export interface OrderRequest {
  kind: OrderKind;
  seq: number;
  stack?: string;
  unit?: string;
  missile?: string;
  target?: number | null;
  city?: string;
}

/** A panel hidden while the map is being targeted; restored when targeting ends. */
export interface PanelRestore {
  panel: Panel;
  panelArg: unknown;
  panelStack: { panel: Panel; arg: unknown }[];
}

export interface Toast {
  id: string;
  at: number;
  text: string;
  node: number | null;
  kind: string;
  level: 'info' | 'warn' | 'alert' | 'success';
  eventId?: string;
  /** Optional button on the toast that opens a screen (e.g. Diplomacy for collapsed offers). */
  action?: { label: string; panel: Panel };
  /** Number of notifications collapsed into this toast. */
  count?: number;
}

export interface CameraRequest {
  lon: number;
  lat: number;
  zoom?: number;
  seq: number;
}

export interface UiState {
  screen: Screen;
  panel: Panel | null;
  panelArg: unknown;
  /** Previous panel for "back" in dossier etc. */
  panelStack: { panel: Panel; arg: unknown }[];
  selection: Selection;
  lostSelection: { label: string; at: number } | null;
  mode: MapMode;
  toasts: Toast[];
  toastHistory: Toast[];
  camera: CameraRequest | null;
  timeStripOpen: boolean;
  rosterOpen: boolean;
  inspectorOpen: boolean;
  sheetExpanded: boolean;
  resourceBarOpen: boolean;
  previewMarker: { lonlat: [number, number]; label: string } | null;
  pinned: string[];
  chooser: { x: number; y: number; items: { id: string; label: string }[] } | null;
  contextMenu: { x: number; y: number; target: string } | null;
  briefingOpen: boolean;
  tutorialOpen: boolean;
  marketResource: string | null;
  focusReturn: HTMLElement | null;
  ledgerOpen: string | null;
  /** Active map-targeted order (patrol, rebase, attack, landing zone, missile target, rally…). */
  order: OrderRequest | null;
  /** Panel hidden by map targeting (order or move), restored when targeting ends. */
  restorePanel: PanelRestore | null;
}

export const ui = createStore<UiState>({
  screen: 'boot',
  panel: null,
  panelArg: null,
  panelStack: [],
  selection: null,
  lostSelection: null,
  mode: { kind: 'idle' },
  toasts: [],
  toastHistory: [],
  camera: null,
  timeStripOpen: false,
  rosterOpen: false,
  inspectorOpen: true,
  sheetExpanded: false,
  resourceBarOpen: false,
  previewMarker: null,
  pinned: [],
  chooser: null,
  contextMenu: null,
  briefingOpen: false,
  tutorialOpen: false,
  marketResource: null,
  focusReturn: null,
  ledgerOpen: null,
  order: null,
  restorePanel: null,
});

let orderSeq = 1;

/** Hide an open panel while the map is targeted (remember it once). */
function hidePanelForTargeting(s: UiState): Partial<UiState> {
  if (!s.panel) return {};
  return { restorePanel: s.restorePanel ?? { panel: s.panel, panelArg: s.panelArg, panelStack: s.panelStack }, panel: null, panelArg: null, panelStack: [] };
}

/**
 * Start a map-targeted order: the map enters targeting mode (crosshair, hover preview, click sets
 * the target) and a compact order bar holds the preview and Confirm/Cancel. An open panel is
 * hidden while the map is targeted and comes back when targeting ends. `e` = the activating event:
 * started from the keyboard, the accessible list fallback opens expanded.
 */
export function startOrder(req: Omit<OrderRequest, 'seq'>, e?: { detail?: number; nativeEvent?: Event } | null) {
  const s = ui.get();
  targeting.patch({ listOpen: fromKeyboard(e) });
  clearTargetHover();
  ui.patch({ ...hidePanelForTargeting(s), order: { ...req, seq: orderSeq++ }, mode: { kind: 'idle' }, contextMenu: null, chooser: null });
}

/** End the active map-targeted order (confirmed or cancelled). */
export function endOrder() {
  const s = ui.get();
  if (!s.order) return;
  clearTargetHover();
  ui.patch({ order: null, ...(s.mode.kind === 'pick' ? { mode: { kind: 'idle' as const } } : {}) });
}

/** Targeting has ended (no order, idle map): bring back a panel hidden for it. */
export function restorePanelAfterTargeting() {
  const s = ui.get();
  const r = s.restorePanel;
  if (!r || s.order || s.mode.kind !== 'idle') return;
  ui.patch({ restorePanel: null, ...(s.panel ? {} : { panel: r.panel, panelArg: r.panelArg, panelStack: r.panelStack }) });
}

/** Enter move targeting for one or more formations (any open targeted order is ended first). */
export function startMove(stacks: string[], e?: { detail?: number; nativeEvent?: Event } | null) {
  if (ui.get().order) endOrder();
  targeting.patch({ listOpen: fromKeyboard(e) });
  clearTargetHover();
  ui.patch({ ...hidePanelForTargeting(ui.get()), mode: { kind: 'move', stacks, waypoints: [], dest: null }, contextMenu: null, chooser: null });
}

let camSeq = 1;
export function centerOn(lon: number, lat: number, zoom?: number) {
  ui.patch({ camera: { lon, lat, zoom, seq: camSeq++ } });
}

export function openPanel(panel: Panel, arg: unknown = null) {
  const s = ui.get();
  const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  const stack = s.panel && s.panel !== panel ? [...s.panelStack, { panel: s.panel, arg: s.panelArg }].slice(-8) : s.panelStack;
  ui.patch({ panel, panelArg: arg, panelStack: stack, focusReturn: s.panel ? s.focusReturn : opener, contextMenu: null, chooser: null });
}

export function closePanel() {
  const s = ui.get();
  const ret = s.focusReturn;
  const before = typeof document !== 'undefined' ? document.activeElement : null;
  ui.patch({ panel: null, panelArg: null, panelStack: [], focusReturn: null });
  setTimeout(() => {
    // Restore focus to the opener (or the map) only if the user has not already moved focus
    // somewhere else meanwhile (e.g. straight into the search box) — never steal it back.
    if (userMovedFocus(before)) return;
    if (ret && typeof ret.focus === 'function' && document.contains(ret)) ret.focus();
    else (document.getElementById('map-canvas') as HTMLElement | null)?.focus();
  }, 0);
}

/** True when focus now rests on a live element other than the one focused when a layer closed. */
export function userMovedFocus(before: Element | null): boolean {
  const a = document.activeElement;
  return !!a && a !== document.body && a !== before && document.contains(a);
}

export function backPanel() {
  const s = ui.get();
  const prev = s.panelStack[s.panelStack.length - 1];
  if (!prev) return closePanel();
  ui.patch({ panel: prev.panel, panelArg: prev.arg, panelStack: s.panelStack.slice(0, -1) });
}

let toastSeq = 1;
export function toast(t: Omit<Toast, 'id' | 'at'> & { id?: string }) {
  const s = ui.get();
  const full: Toast = { id: t.id ?? `t${toastSeq++}`, at: Date.now(), ...t } as Toast;
  if (s.toasts.some((x) => x.id === full.id)) return;
  ui.patch({ toasts: [...s.toasts, full].slice(-5), toastHistory: [full, ...s.toastHistory].slice(0, 200) });
}
/**
 * Incoming offers: the first shows as an ordinary toast; further ones collapse into one summary
 * ("3 new offers — open Diplomacy") instead of stacking over the map. Every offer still goes to the
 * notification history individually.
 */
export function offerToast(t: Omit<Toast, 'id' | 'at'> & { id: string }) {
  const s = ui.get();
  const full: Toast = { ...t, at: Date.now(), action: { label: 'Open Diplomacy', panel: 'diplomacy' } } as Toast;
  if (s.toasts.some((x) => x.id === full.id) || s.toastHistory.some((x) => x.id === full.id)) return;
  const history = [full, ...s.toastHistory].slice(0, 200);
  const prior = s.toasts.filter((x) => x.kind === 'offer_received' || x.kind === 'offers_summary');
  if (!prior.length) {
    ui.patch({ toasts: [...s.toasts, full].slice(-5), toastHistory: history });
    return;
  }
  const n = prior.reduce((a, x) => a + (x.count ?? 1), 0) + 1;
  const summary: Toast = { id: `offers-${full.id}`, at: Date.now(), text: `${n} new offers — open Diplomacy to answer them.`, node: null, kind: 'offers_summary', level: 'info', count: n, action: { label: 'Open Diplomacy', panel: 'diplomacy' } };
  ui.patch({ toasts: [...s.toasts.filter((x) => !prior.includes(x)), summary].slice(-5), toastHistory: history });
}
export function dismissToast(id: string) {
  ui.patch({ toasts: ui.get().toasts.filter((t) => t.id !== id) });
}

export function select(sel: Selection) {
  ui.patch({ selection: sel, lostSelection: null, contextMenu: null, chooser: null, inspectorOpen: true });
}
