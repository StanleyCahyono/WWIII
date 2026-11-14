/** Shared state queries: ownership, relations, access rights, stack positions, coalition membership. */
import type { CountryId, NodeId, UnitType } from '../data-types';
import type { Coalition, DiploLevel, DiploStatus, GameState, Stack, Unit } from '../state';
import { dirKey, pairKey } from '../ids';
import { S, unitStats } from '../scenario/registry';
import { lerpLonLat, nodeLL } from './mapindex';
import { derived } from '../derived';

const ownerChanges = new WeakMap<GameState, { ownv: number; countries: Set<CountryId>; nodes: Set<NodeId> }>();
/** Record an ownership change (used by incremental visibility to limit recomputation). */
const ownerJournal = new WeakMap<GameState, { v: number; node: NodeId }[]>();
/** Nodes whose owner changed after ownership version `since`, or null if the journal cannot tell. */
const ownerSinceMemo = new WeakMap<GameState, { since: number; len: number; last: object | undefined; out: Set<NodeId> | null }>();
export function ownerChangesSince(state: GameState, since: number): Set<NodeId> | null {
  const j = ownerJournal.get(state);
  const memo = ownerSinceMemo.get(state);
  if (memo && memo.since === since && memo.len === (j?.length ?? 0) && memo.last === j?.[j.length - 1]) return memo.out;
  let out: Set<NodeId> | null = null;
  if (j && j.length && !(j[0].v > since + 1)) {
    out = new Set<NodeId>();
    for (let i = j.length - 1; i >= 0 && j[i].v > since; i--) out.add(j[i].node);
  }
  ownerSinceMemo.set(state, { since, len: j?.length ?? 0, last: j?.[j.length - 1], out });
  return out;
}
export function recordOwnerChange(state: GameState, node: NodeId, from: CountryId | null, to: CountryId | null): void {
  let j = ownerJournal.get(state);
  if (!j) {
    j = [];
    ownerJournal.set(state, j);
  }
  j.push({ v: (state.ids.ownv ?? 0) + 1, node });
  if (j.length > 5000) j.splice(0, j.length - 2500);
  let r = ownerChanges.get(state);
  if (!r) {
    r = { ownv: state.ids.ownv ?? 0, countries: new Set(), nodes: new Set() };
    ownerChanges.set(state, r);
  }
  if (from) r.countries.add(from);
  if (to) r.countries.add(to);
  r.nodes.add(node);
}
/** Take (and clear) the change log if it covers every change since ownership version `since`. */
export function takeOwnerChanges(state: GameState, since: number): { countries: Set<CountryId>; nodes: Set<NodeId> } | null {
  const r = ownerChanges.get(state);
  ownerChanges.delete(state);
  if (!r || r.ownv !== since) return null;
  return r;
}
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
const enemyCache = new WeakMap<GameState, { v: number; rel: object; m: Map<CountryId, Set<CountryId>> }>();
/** Map of country → countries it is at war with. Cached; keyed by the relations version counter. */
export function enemyMap(state: GameState): Map<CountryId, Set<CountryId>> {
  const v = state.ids.relv ?? 0;
  const c = enemyCache.get(state);
  if (c && c.v === v && c.rel === state.relations) return c.m;
  const m = new Map<CountryId, Set<CountryId>>();
  for (const k of Object.keys(state.relations)) {
    if (!state.relations[k].war) continue;
    const [a, b] = k.split('|');
    (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
    (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
  }
  enemyCache.set(state, { v, rel: state.relations, m });
  return m;
}
/** Bump whenever any PairRelation.war changes (keeps enemyMap caches valid). */
export function bumpRelations(state: GameState): void {
  state.ids.relv = (state.ids.relv ?? 0) + 1;
}
export function atWar(state: GameState, a: CountryId, b: CountryId): boolean {
  if (a === b) return false;
  const s = enemyMap(state).get(a);
  return !!s && s.has(b);
}
const grantCache = new WeakMap<GameState, { v: number; g: object; m: Map<CountryId, Map<CountryId, DiploLevel>> }>();
/** Level granted by `from` to `to` (peace if none). Cached; keyed by the relations version counter. */
export function grantLevel(state: GameState, from: CountryId, to: CountryId): DiploLevel {
  const v = state.ids.grv ?? 0;
  let c = grantCache.get(state);
  if (!c || c.v !== v || c.g !== state.grants) {
    const m = new Map<CountryId, Map<CountryId, DiploLevel>>();
    for (const k of Object.keys(state.grants)) {
      const [a, b] = k.split('>');
      (m.get(a) ?? m.set(a, new Map()).get(a)!).set(b, state.grants[k].level);
    }
    c = { v, g: state.grants, m };
    grantCache.set(state, c);
  }
  return c.m.get(from)?.get(to) ?? 'peace';
}
export function grantLevelUncached(state: GameState, from: CountryId, to: CountryId): DiploLevel {
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
  const idx = derived(state, `coMember:${state.ids.cov ?? 0}`, () => {
    const m = new Map<CountryId, string>();
    for (const id of ids.sort()) {
      const co = state.coalitions[id];
      if (co.dissolvedAt) continue;
      for (const mem of co.members) if (!m.has(mem.country)) m.set(mem.country, id);
    }
    return m;
  });
  const id = idx.get(c);
  return id ? state.coalitions[id] : null;
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
const visionCache = new WeakMap<GameState, { key: string; m: Map<CountryId, CountryId[]> }>();
export function visionSources(state: GameState, viewer: CountryId): CountryId[] {
  const key = `${state.ids.grv ?? 0}|${state.ids.relv ?? 0}|${state.ids.cov ?? 0}|${Object.keys(state.coalitions).length}`;
  let c = visionCache.get(state);
  if (!c || c.key !== key) {
    c = { key, m: new Map() };
    visionCache.set(state, c);
  }
  let v = c.m.get(viewer);
  if (!v) {
    v = computeVisionSources(state, viewer);
    c.m.set(viewer, v);
  }
  return v;
}
function computeVisionSources(state: GameState, viewer: CountryId): CountryId[] {
  const out = new Set<CountryId>([viewer]);
  const co = coalitionOf(state, viewer);
  if (co) for (const m of co.members) out.add(m.country);
  const shared = derived(state, `sharedIntel:${state.ids.grv ?? 0}:${state.ids.relv ?? 0}`, () => {
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
/** Effective weapon range (km) incl. the artillery_range_mult modifier for support/launchers. */
export function unitRange(state: GameState, owner: CountryId, u: Unit): number {
  const t = utype(state, u.type);
  const r = unitStats(t, u.level).rangeKm;
  if (r > 0 && (t.family === 'support' || t.family === 'missile_launcher')) {
    const m = state.countries[owner]?.modifiers['artillery_range_mult'];
    if (m !== undefined) return r * m;
  }
  return r;
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
/** Stacks sorted by numeric id (memoized; refreshed when stacks are added or removed). */
const sortedCache = new WeakMap<GameState, { list: Stack[]; counter: number; obj: object }>();
/** Read-only (do not mutate) sorted stack list without copying. */
export function stacksReadonly(state: GameState): readonly Stack[] {
  sortedStacks(state);
  return sortedCache.get(state)!.list;
}
export function sortedStacks(state: GameState): Stack[] {
  const counter = state.ids.stack ?? 0;
  let cached = sortedCache.get(state);
  if (!cached || cached.obj !== state.stacks) {
    cached = { list: sortStacks(state), counter, obj: state.stacks };
    sortedCache.set(state, cached);
    return cached.list.slice();
  }
  if (cached.counter !== counter) {
    cached.list = appendNewStacks(state, cached.list, cached.counter, counter) ?? sortStacks(state);
    cached.counter = counter;
    return cached.list.slice();
  }
  const out: Stack[] = [];
  let changed = false;
  for (const s of cached.list) {
    if (state.stacks[s.id] === s) out.push(s);
    else changed = true;
  }
  if (changed) cached.list = out.slice();
  return out;
}
/**
 * Stacks created since the last sort get ids `s<n>` from the counter, so they sort after every
 * existing stack: keep the surviving sorted prefix and append them. Returns null (→ full sort) if
 * the result cannot be proven complete and ordered.
 */
function appendNewStacks(state: GameState, prev: Stack[], c0: number, c1: number): Stack[] | null {
  if (c1 < c0 || c1 - c0 > 4096) return null;
  const out: Stack[] = [];
  for (const s of prev) if (state.stacks[s.id] === s) out.push(s);
  let last = out.length ? idNum(out[out.length - 1].id) : -Infinity;
  for (let n = c0 + 1; n <= c1; n++) {
    const s = state.stacks[`s${n}`];
    if (!s) continue;
    if (n <= last) return null;
    out.push(s);
    last = n;
  }
  let total = 0;
  for (const _ in state.stacks) total++;
  return total === out.length ? out : null;
}
function sortStacks(state: GameState): Stack[] {
  return Object.values(state.stacks)
    .map((s) => [idNum(s.id), s] as const)
    .sort((a, b) => a[0] - b[0] || (a[1].id < b[1].id ? -1 : 1))
    .map((x) => x[1]);
}
/** Nodes and city keys owned by a country (memoized per step / ownership change). */
export function territoryOf(state: GameState, c: CountryId): { nodes: NodeId[]; cities: string[] } {
  const idx = derived(state, '~territoryByOwner', () => {
    const m = new Map<CountryId, { nodes: NodeId[]; cities: string[] }>();
    for (const p of state.provinces) {
      if (!p || !p.owner) continue;
      (m.get(p.owner) ?? m.set(p.owner, { nodes: [], cities: [] }).get(p.owner)!).nodes.push(p.node);
    }
    for (const k of Object.keys(state.cities).sort()) {
      const o = state.provinces[state.cities[k].node]?.owner;
      if (o) (m.get(o) ?? m.set(o, { nodes: [], cities: [] }).get(o)!).cities.push(k);
    }
    return m;
  });
  return idx.get(c) ?? { nodes: [], cities: [] };
}
export function ownedNodes(state: GameState, c: CountryId): NodeId[] {
  const out: NodeId[] = [];
  for (const p of state.provinces) if (p && p.owner === c) out.push(p.node);
  return out;
}
export function countryAlive(state: GameState, c: CountryId): boolean {
  return state.countries[c]?.alive ?? false;
}
