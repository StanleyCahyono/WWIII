/** Device preferences in localStorage (separate from campaigns, which live in IndexedDB). */
import { createStore } from '../state/store';
import type { InterruptPrefs } from '../sim/protocol';

export type FillLayer = 'political' | 'terrain' | 'morale' | 'resources' | 'relations' | 'visibility';
export interface MapPrefs {
  fill: FillLayer;
  borders: boolean;
  names: boolean;
  routes: boolean;
  symbols: boolean;
  sensors: boolean;
  /** Dim basemap under dense overlays. */
  dim: boolean;
}

export interface Prefs {
  theme: 'dark' | 'light';
  reducedMotion: boolean;
  sound: boolean;
  monochromeSymbols: boolean;
  interrupts: InterruptPrefs;
  catchUp: { enabled: boolean; maxHours: number };
  map: MapPrefs;
  speed: number;
  advisorSeen: string[];
  lastCampaign: string | null;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  reducedMotion: false,
  sound: false,
  monochromeSymbols: false,
  interrupts: { war: true, capital: true, end: true, other: false },
  catchUp: { enabled: false, maxHours: 24 },
  map: { fill: 'political', borders: true, names: true, routes: true, symbols: true, sensors: false, dim: true },
  speed: 4,
  advisorSeen: [],
  lastCampaign: null,
};

const KEY = 'wc.prefs.v1';

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const rm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      return { ...DEFAULT_PREFS, reducedMotion: rm };
    }
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...p, interrupts: { ...DEFAULT_PREFS.interrupts, ...(p.interrupts ?? {}) }, catchUp: { ...DEFAULT_PREFS.catchUp, ...(p.catchUp ?? {}) }, map: { ...DEFAULT_PREFS.map, ...(p.map ?? {}) } };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const prefs = createStore<Prefs>(load());
let localStorageOk = true;
prefs.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs.get()));
    localStorageOk = true;
  } catch {
    localStorageOk = false;
  }
});
export function prefsPersist(): boolean {
  return localStorageOk;
}
export function setPrefs(p: Partial<Prefs>) {
  prefs.patch(p);
}
export function setMapPrefs(p: Partial<MapPrefs>) {
  prefs.patch({ map: { ...prefs.get().map, ...p } });
}
