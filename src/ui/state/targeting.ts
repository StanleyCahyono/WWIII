/**
 * Direct map targeting (UI-only state, never part of the simulation).
 *
 * While an order picks its target (move destination, patrol area, rebase base, attack target,
 * landing zone, missile sector, rally point…) the map is in a targeting mode: MapView publishes
 * what is under the pointer here (`hover`), the active order resolves it into a candidate command
 * and asks the engine's validator for a preview, and publishes a short live answer (`tip`) that
 * MapView shows next to the crosshair and the renderer uses to colour the highlight.
 *
 * Only viewer-safe data passes through: a map point is a node id (public map geometry) plus the
 * ids of filtered MapObjects under the pointer (the same objects the map already draws).
 */
import { createStore } from './store';

export interface MapPoint {
  /** Province / sea zone under the pointer (null = off the map). */
  node: number | null;
  /** Ids of map objects (S:/C:/R:) under the pointer, nearest first. */
  objects: string[];
  lonlat: [number, number];
}

export interface TargetTip {
  /** Key of the hovered point this answer belongs to. */
  key: string;
  title: string;
  lines: string[];
  /** true = legal target, false = not possible (lines say why), null = checking / needs confirmation. */
  ok: boolean | null;
  /** Legal but needs an explicit confirmation (act of war). */
  warn?: boolean;
  /** What the candidate targets, for the map highlight (sector and/or object ids). */
  node?: number | null;
  ids?: string[];
}

export interface TargetingState {
  hover: MapPoint | null;
  tip: TargetTip | null;
  /** Show the accessible list fallback expanded (set when an order is started from the keyboard). */
  listOpen: boolean;
}

export const targeting = createStore<TargetingState>({ hover: null, tip: null, listOpen: false });

export function pointKey(p: MapPoint | null): string {
  if (!p) return '';
  return `${p.node ?? '-'}|${p.objects.join(',')}`;
}

/** True when a click/activation event came from the keyboard (Enter/Space on a button). */
export function fromKeyboard(e?: { detail?: number; nativeEvent?: Event } | null): boolean {
  if (!e) return false;
  const ne = e.nativeEvent as (MouseEvent & { pointerType?: string }) | undefined;
  if (ne && 'pointerType' in ne && ne.pointerType) return false;
  return e.detail === 0;
}

/** Reset hover/tip (keeps the list preference) when a targeting mode starts or ends. */
export function clearTargetHover() {
  const s = targeting.get();
  if (s.hover || s.tip) targeting.patch({ hover: null, tip: null });
}
