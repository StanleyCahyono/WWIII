/** Shared state queries: ownership, relations, access rights, stack positions, coalition membership. */
import type { CountryId, NodeId, UnitType } from '../data-types';
import type { Coalition, DiploLevel, DiploStatus, GameState, Stack, Unit } from '../state';
import { dirKey, pairKey } from '../ids';
import { S, unitStats } from '../scenario/registry';
import { lerpLonLat, nodeLL } from './mapindex';
import { derived } from '../derived';

export function ownerOf(state: GameState, node: NodeId): CountryId | null {
  const p = state.provinces[node];
  return p ? p.owner : null;
}
export function isRebel(state: GameState, node: NodeId): boolean {
  const p = state.provinces[node];
  return !!p && p.control === 'rebel';
}
export function cityKeyAt(state: GameState, node: NodeId): string | null {
  return S(state).map.cityByNode.get(node) ?? null;
}
export function relation(state: GameState, a: CountryId, b: CountryId) {
  return state.relations[pairKey(a, b)];
}
export function atWar(state: GameState, a: CountryId, b: CountryId): boolean {
  if (a === b) return false;
  const r = state.relations[pairKey(a, b)];
  return !!r && r.war;
}
/** Level granted by `from` to `to` (peace if none). */
export function grantLevel(state: GameState, from: CountryId, to: CountryId): DiploLevel {
  const g = state.grants[dirKey(from, to)];
  return g ? g.level : 'peace';
}
export function statusFrom(state: GameState, from: CountryId, to: CountryId): DiploStatus {
  if (atWar(state, from, to)) return 'war';
  return grantLevel(state, from, to);
}
const LEVEL_RANK: Record<DiploLevel, number> = { peace: 0, right_of_way: 1, shared_intel: 2 };
export function levelAtLeast(l: DiploLevel, min: DiploLevel): boolean {
  return LEVEL_RANK[l] >= LEVEL_RANK[min];
}
export function coalitionOf(state: GameState, c: CountryId): Coalition | null {
  const ids = Object.keys(state.coalitions);
  if (!ids.length) return null;
  for (const id of ids.sort()) {
    const co = state.coalitions[id];
    if (!co.dissolvedAt && co.members.some((m) => m.country === c)) return co;
  }
  return null;
}
export function sameCoalition(state: GameState, a: CountryId, b: CountryId): boolean {
  if (a === b) return true;
  const co = coalitionOf(state, a);
  return !!co && co.members.some((m) => m.country === b);
}
/** May `mover` enter territory owned by `owner` without an act of war? */
export function hasPassage(state: GameState, mover: CountryId, owner: CountryId | null): boolean {
  if (owner === null) return true;
  if (owner === mover) return true;
  if (atWar(state, mover, owner)) return true; // hostile entry (attack) is legal at war
  if (sameCoalition(state, mover, owner)) return true;
  return levelAtLeast(grantLevel(state, owner, mover), 'right_of_way');
}
/** Friendly (non-hostile, allowed) territory for supply/landing: own, coalition, passage grant. */
export function isFriendlyTerritory(state: GameState, c: CountryId, owner: CountryId | null): boolean {
  if (owner === null) return false;
  if (owner === c) return true;
  if (atWar(state, c, owner)) return false;
  return sameCoalition(state, c, owner) || levelAtLeast(grantLevel(state, owner, c), 'right_of_way');
}
/** Countries whose sensors `viewer` sees through (self, coalition, shared_intel grantors). Sorted. */
export function visionSources(state: GameState, viewer: CountryId): CountryId[] {
  return derived(state, `vision:${viewer}`, () => computeVisionSources(state, viewer));
}
function computeVisionSources(state: GameState, viewer: CountryId): CountryId[] {
  const out = new Set<CountryId>([viewer]);
  const co = coalitionOf(state, viewer);
  if (co) for (const m of co.members) out.add(m.country);
  const shared = derived(state, 'sharedIntel', () => {
    const m = new Map<CountryId, CountryId[]>();
    for (const k of Object.keys(state.grants)) {
      if (state.grants[k].level !== 'shared_intel') continue;
      const [from, to] = k.split('>');
      if (atWar(state, from, to)) continue;
      const l = m.get(to) ?? [];
      l.push(from);
      m.set(to, l);
    }
    return m;
  });
  for (const c of shared.get(viewer) ?? []) out.add(c);
  return [...out].sort();
}
export function hostileStacks(state: GameState, a: Stack, b: Stack): boolean {
  return a.owner !== b.owner && atWar(state, a.owner, b.owner);
}

export function stackNode(s: Stack): NodeId | null {
  return s.pos.kind === 'node' ? s.pos.node : null;
}
export function stackLL(state: GameState, s: Stack): [number, number] {
  const m = S(state).map;
  if (s.aboard) {
    const c = state.stacks[s.aboard];
    if (c && c.id !== s.id) return stackLL(state, c);
  }
  const p = s.pos;
  if (p.kind === 'node') return nodeLL(m, p.node);
  if (p.kind === 'edge') return lerpLonLat(nodeLL(m, p.from), nodeLL(m, p.to), p.length > 0 ? p.progress / p.length : 0);
  const t = p.arrive > p.depart ? Math.min(1, Math.max(0, (state.clock.tick - p.depart) / (p.arrive - p.depart))) : 1;
  return lerpLonLat(p.from, p.to, t);
}
/** Nearest node id for display/anchor purposes. */
export function stackAnchorNode(s: Stack): NodeId | null {
  if (s.pos.kind === 'node') return s.pos.node;
  if (s.pos.kind === 'edge') return s.pos.progress * 2 < s.pos.length ? s.pos.from : s.pos.to;
  return null;
}

export function utype(state: GameState, id: string): UnitType {
  const t = S(state).cat.units.get(id);
  if (!t) throw new Error(`Unknown unit type ${id}`);
  return t;
}
export function ustats(state: GameState, u: Unit) {
  return unitStats(utype(state, u.type), u.level);
}
export function isAirType(t: UnitType): boolean {
  return t.domain === 'air' && t.family !== 'helicopter';
}
export function isNavalType(t: UnitType): boolean {
  return t.domain === 'sea' || t.domain === 'subsurface';
}
export function moveClassOf(t: UnitType): 'ground' | 'naval' | 'air' {
  if (isAirType(t)) return 'air';
  if (isNavalType(t)) return 'naval';
  return 'ground';
}
export function stacksAt(state: GameState, node: NodeId): Stack[] {
  const out: Stack[] = [];
  for (const id of Object.keys(state.stacks)) {
    const s = state.stacks[id];
    if (s.pos.kind === 'node' && s.pos.node === node && !s.aboard && !(s.air && s.air.state !== 'landed' && s.air.state !== 'refueling')) out.push(s);
  }
  return out.sort(cmpId);
}
export function cmpId(a: { id: string }, b: { id: string }): number {
  return idNum(a.id) - idNum(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function idNum(id: string): number {
  let i = id.length;
  while (i > 0 && id.charCodeAt(i - 1) >= 48 && id.charCodeAt(i - 1) <= 57) i--;
  return Number(id.slice(i)) || 0;
}
export function sortedStacks(state: GameState): Stack[] {
  return Object.values(state.stacks).sort(cmpId);
}
export function ownedNodes(state: GameState, c: CountryId): NodeId[] {
  const out: NodeId[] = [];
  for (const p of state.provinces) if (p && p.owner === c) out.push(p.node);
  return out;
}
export function countryAlive(state: GameState, c: CountryId): boolean {
  return state.countries[c]?.alive ?? false;
}
