/** UI-only state (never part of the simulation). */
import { createStore } from './store';

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

export interface Toast {
  id: string;
  at: number;
  text: string;
  node: number | null;
  kind: string;
  level: 'info' | 'warn' | 'alert' | 'success';
  eventId?: string;
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
});

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
  ui.patch({ panel: null, panelArg: null, panelStack: [], focusReturn: null });
  if (ret && typeof ret.focus === 'function' && document.contains(ret)) setTimeout(() => ret.focus(), 0);
  else setTimeout(() => (document.getElementById('map-canvas') as HTMLElement | null)?.focus(), 0);
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
export function dismissToast(id: string) {
  ui.patch({ toasts: ui.get().toasts.filter((t) => t.id !== id) });
}

export function select(sel: Selection) {
  ui.patch({ selection: sel, lostSelection: null, contextMenu: null, chooser: null, inspectorOpen: true });
}
