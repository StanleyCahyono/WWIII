/**
 * Ground/naval movement on the typed graph.
 *
 * Edge eligibility by movement class:
 *  ground: land/strait edges between land nodes (land mode); coast edges embark/disembark
 *          (embark only from a coastal province; +EMBARK_MIN); sea/canal edges in embarked mode.
 *  naval : sea/canal edges; coast edges only into/out of a PORT city node.
 *  Outside-campaign land nodes are impassable. Canals/straits with `via` need passage from the
 *  via province owner. Entering a node owned by a country at peace without passage (own,
 *  coalition, right_of_way/shared_intel grant, or war) is an ACT OF WAR: only allowed when the
 *  command lists that country in `confirmActOfWar`, and war is declared on entry.
 *
 * Remaining routes are re-validated every step: the first illegal segment truncates the route
 * so the stack stops at the last legal node (a stack mid-edge into an illegal node turns back —
 * no teleport) and an event explains why.
 */
import type { CountryId, NodeId, Terrain } from '../data-types';
import type { GameState, MoveMode, MoveOrder, RouteSegment, Stack } from '../state';
import { EMBARK_MIN, EMBARKED_SPEED_KMH, STEP_MIN, TERRAIN_SPEED } from '../rules';
import { S } from '../scenario/registry';
import { astar, nodeDist, other, type MapIndex, type PathResult } from './mapindex';
import { atWar, enemyMap, hasPassage, isRebel, ownerChangesSince, ownerOf, ustats, utype } from './world';
import { emit, toAll } from './events';
import { sumEffect, multEffect } from './economy';
import { cmod } from './modifiers';

export type BlockReason = 'unreachable' | 'no_access' | 'missing_facility' | 'outside_campaign' | 'invalid_domain';

export interface MoveCtx {
  country: CountryId;
  moveClass: Stack['moveClass'];
  speed: (mode: MoveMode, terrain: Terrain, node: NodeId) => number;
  ignoreRights?: boolean;
  ignoreFacilities?: boolean;
  allowActOfWar?: boolean | CountryId[];
}

export interface EdgeVerdict {
  ok: boolean;
  mode?: MoveMode;
  hours?: number;
  km?: number;
  extraKm?: number;
  /** Country whose territory is entered without passage (act of war). */
  actOfWar?: CountryId;
  reason?: BlockReason;
  detail?: string;
}

function isPort(state: GameState, m: MapIndex, node: NodeId): boolean {
  if (m.portNodes.has(node)) return true;
  const p = state.provinces[node];
  return !!p && sumEffect(state, p.buildings, 'navalSlots', false) > 0;
}

export function evalEdge(state: GameState, ctx: MoveCtx, ei: number, from: NodeId, to: NodeId): EdgeVerdict {
  const m = S(state).map;
  const e = m.edges[ei];
  const toLand = m.isLand[to] === 1;
  if (toLand && m.outside[to]) return { ok: false, reason: 'outside_campaign', detail: 'Land transit through an outside-campaign region is blocked.' };
  let mode: MoveMode;
  let extraHours = 0;
  if (ctx.moveClass === 'ground') {
    if (e.kind === 'land' || e.kind === 'strait') mode = 'land';
    else if (e.kind === 'coast') {
      if (toLand) mode = 'land';
      else {
        if (!m.coastal[from]) return { ok: false, reason: 'missing_facility', detail: 'Embarking requires a coastal province.' };
        mode = 'embarked';
      }
      extraHours = (EMBARK_MIN / 60) * cmod(state, ctx.country, 'embark_time_mult');
    } else mode = 'embarked';
  } else if (ctx.moveClass === 'naval') {
    if (e.kind === 'land' || e.kind === 'strait') return { ok: false, reason: 'invalid_domain', detail: 'Ships cannot cross land.' };
    if (e.kind === 'coast') {
      const land = toLand ? to : from;
      if (!ctx.ignoreFacilities && !isPort(state, m, land)) return { ok: false, reason: 'missing_facility', detail: 'No usable port in that province.' };
    }
    mode = 'naval';
  } else return { ok: false, reason: 'invalid_domain', detail: 'Aircraft fly direct routes between bases.' };

  let actOfWar: CountryId | undefined;
  const checkOwner = (owner: CountryId | null, what: string): EdgeVerdict | null => {
    if (ctx.ignoreRights || owner === null) return null;
    if (hasPassage(state, ctx.country, owner)) return null;
    const allowed = ctx.allowActOfWar === true || (Array.isArray(ctx.allowActOfWar) && ctx.allowActOfWar.includes(owner));
    if (allowed) {
      actOfWar = owner;
      return null;
    }
    return { ok: false, reason: 'no_access', detail: `${what} requires passage from ${owner}.` };
  };
  if (e.via !== undefined && (e.kind === 'canal' || e.kind === 'strait')) {
    const vo = ownerOf(state, e.via);
    const r = checkOwner(vo, `Crossing ${e.label ?? e.kind}`);
    if (r) return r;
  }
  if (toLand && !isRebel(state, to)) {
    const r = checkOwner(ownerOf(state, to), `Entering ${S(state).map.data.nodes[to].name}`);
    if (r) return r;
  }
  const terr = m.terrain[to];
  const sp = ctx.speed(mode, terr, to);
  if (!(sp > 0)) return { ok: false, reason: 'invalid_domain', detail: 'Stack cannot move.' };
  const km = e.km;
  const hours = km / sp + extraHours;
  return { ok: true, mode, hours, km, extraKm: extraHours * sp, actOfWar };
}

/** Effective stack speed (km/h) = slowest unit × terrain × logistics. */
/** Slowest unit speed per (land / other mode, terrain), cached until the roster or unit levels change. */
const unitSpeedCache = new WeakMap<Stack, { units: object; len: number; techv: number; land: Map<Terrain, number>; other: Map<Terrain, number> }>();
function slowestUnit(state: GameState, s: Stack, mode: MoveMode, terrain: Terrain): number {
  const techv = state.ids.techv ?? 0;
  let c = unitSpeedCache.get(s);
  if (!c || c.units !== s.units || c.len !== s.units.length || c.techv !== techv) {
    c = { units: s.units, len: s.units.length, techv, land: new Map(), other: new Map() };
    unitSpeedCache.set(s, c);
  }
  const memo = mode === 'land' ? c.land : c.other;
  let min = memo.get(terrain);
  if (min !== undefined) return min;
  min = Infinity;
  for (const u of s.units) {
    const t = utype(state, u.type);
    const st = ustats(state, u);
    const tm = t.terrain[terrain]?.speed ?? (mode === 'land' ? TERRAIN_SPEED[terrain] : 1);
    const v = st.speedKmh * tm;
    if (v < min) min = v;
  }
  memo.set(terrain, min);
  return min;
}
export function stackSpeed(state: GameState, s: Stack, mode: MoveMode, terrain: Terrain, node: NodeId): number {
  if (mode === 'embarked') return EMBARKED_SPEED_KMH;
  const min = slowestUnit(state, s, mode, terrain);
  if (!Number.isFinite(min)) return 0;
  const p = state.provinces[node];
  let logi = p && p.buildings.length ? multEffect(state, p.buildings, 'speedMult') : 1;
  const city = S(state).map.cityByNode.get(node);
  if (city && state.cities[city]?.buildings.length) logi += multEffect(state, state.cities[city].buildings, 'speedMult') - 1;
  if (mode === 'land' && p && p.owner === s.owner) logi *= cmod(state, s.owner, 'land_speed_mult_own');
  return min * logi;
}

export function ctxFor(state: GameState, s: Stack, extra?: Partial<MoveCtx>): MoveCtx {
  return {
    country: s.owner,
    moveClass: s.moveClass,
    speed: (mode, terrain, node) => stackSpeed(state, s, mode, terrain, node),
    ...extra,
  };
}

export interface RouteSegmentPreview extends RouteSegment {
  kind: string;
  km: number;
  terrain: Terrain;
  hours: number;
  arriveTick: number;
  owner: CountryId | null;
  actOfWar: CountryId | null;
  label?: string;
}
export interface RoutePlan {
  ok: boolean;
  segments: RouteSegmentPreview[];
  arriveTick: number;
  totalHours: number;
  actOfWar: CountryId[];
  modeChanges: { at: NodeId; from: MoveMode; to: MoveMode }[];
  reason?: BlockReason;
  detail?: string;
  blockingOwners?: CountryId[];
}

const pathCaches = new WeakMap<GameState, Map<string, PathResult | null>>();
/**
 * Rights-independent optimal path, memoized per game state (a different state with equal version
 * counters must never share entries, so the memo is not global). The key holds every input of
 * the unconstrained search: movement class, owner (speed/embark modifiers), unit roster (types and
 * levels), economy version (logistics buildings, ports) and ownership version (own-territory speed).
 */
function staticPath(state: GameState, s: Stack, from: NodeId, to: NodeId): PathResult | null {
  const m = S(state).map;
  let cache = pathCaches.get(state);
  if (!cache) {
    cache = new Map();
    pathCaches.set(state, cache);
  }
  const roster = s.units.map((u) => `${u.type}:${u.level}`).sort().join(',');
  const key = `${s.moveClass}|${s.owner}|${roster}|${state.ids.econv ?? 0}|${state.ids.ownv ?? 0}|${state.ids.techv ?? 0}|${from}|${to}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const ctx = ctxFor(state, s, { ignoreRights: true });
  const res = astar(m, from, to, (ei, a, b) => {
    const v = evalEdge(state, ctx, ei, a, b);
    return v.ok ? { hours: v.hours as number } : null;
  }, maxSpeedFor(s.moveClass));
  if (cache.size > 20000) cache.clear();
  cache.set(key, res);
  return res;
}

function maxSpeedFor(cls: Stack['moveClass']): number {
  return cls === 'naval' ? 80 : 120;
}

/** Plan a route for a stack through waypoints to dest (starting from its current/next node). */
export function planRoute(state: GameState, s: Stack, dest: NodeId, waypoints: NodeId[] = [], opts: { allowActOfWar?: boolean | CountryId[] } = {}): RoutePlan {
  const m = S(state).map;
  let start: NodeId;
  let t0 = state.clock.tick;
  let leadIn: RouteSegmentPreview | null = null;
  if (s.pos.kind === 'node') start = s.pos.node;
  else if (s.pos.kind === 'edge') {
    // finish the current edge first
    const p = s.pos;
    const sp = stackSpeed(state, s, s.mode, m.terrain[p.to], p.to);
    const h = sp > 0 ? (p.length - p.progress) / sp : 0;
    t0 += Math.ceil(h * 60);
    start = p.to;
    leadIn = { from: p.from, to: p.to, edge: p.edge, mode: s.mode, kind: m.edges[p.edge].kind, km: p.length - p.progress, terrain: m.terrain[p.to], hours: h, arriveTick: t0, owner: ownerOf(state, p.to), actOfWar: null };
  } else return { ok: false, segments: [], arriveTick: t0, totalHours: 0, actOfWar: [], modeChanges: [], reason: 'invalid_domain', detail: 'Aircraft are routed by patrol/rebase orders.' };
  if (dest < 0 || dest >= m.n) return { ok: false, segments: [], arriveTick: t0, totalHours: 0, actOfWar: [], modeChanges: [], reason: 'unreachable', detail: 'Unknown destination.' };

  const ctx = ctxFor(state, s, { allowActOfWar: opts.allowActOfWar ?? false });
  const points = [...waypoints, dest];
  const segments: RouteSegmentPreview[] = leadIn ? [leadIn] : [];
  let cur = start;
  let t = t0;
  for (const target of points) {
    if (target === cur) continue;
    const verdicts = new Map<number, EdgeVerdict>();
    const ev = (ei: number, a: NodeId, b: NodeId) => {
      const v = evalEdge(state, ctx, ei, a, b);
      if (!v.ok) return null;
      verdicts.set(ei * 2 + (m.edges[ei].a === a ? 0 : 1), v);
      return { hours: v.hours as number + (v.actOfWar ? 1000 : 0) };
    };
    // 1) unconstrained (rights-ignoring) optimum from MapIndex.staticCache; if every edge is legal now
    //    without an act of war it is also the constrained optimum → use it. 2) otherwise constrained A*.
    let res: PathResult | null = null;
    const sp = staticPath(state, s, cur, target);
    if (sp) {
      let legal = true;
      for (let i = 0; i < sp.edges.length && legal; i++) {
        const a = sp.nodes[i], b = sp.nodes[i + 1];
        const v = evalEdge(state, ctx, sp.edges[i], a, b);
        if (!v.ok || v.actOfWar) legal = false;
        else verdicts.set(sp.edges[i] * 2 + (m.edges[sp.edges[i]].a === a ? 0 : 1), v);
      }
      if (legal) res = sp;
      else verdicts.clear();
    }
    if (!res) res = astar(m, cur, target, ev, maxSpeedFor(s.moveClass));
    if (!res) return classifyFailure(state, s, cur, target, segments, t);
    for (let i = 0; i < res.edges.length; i++) {
      const ei = res.edges[i];
      const a = res.nodes[i], b = res.nodes[i + 1];
      const v = verdicts.get(ei * 2 + (m.edges[ei].a === a ? 0 : 1)) ?? evalEdge(state, ctx, ei, a, b);
      t += Math.ceil((v.hours as number) * 60);
      segments.push({ from: a, to: b, edge: ei, mode: v.mode as MoveMode, kind: m.edges[ei].kind, km: v.km as number, terrain: m.terrain[b], hours: v.hours as number, arriveTick: t, owner: ownerOf(state, b), actOfWar: v.actOfWar ?? null, label: m.edges[ei].label });
    }
    cur = target;
  }
  const aow = [...new Set(segments.map((x) => x.actOfWar).filter((x): x is CountryId => !!x))].sort();
  const modeChanges: RoutePlan['modeChanges'] = [];
  let prev = s.mode;
  for (const sg of segments) {
    if (sg.mode !== prev) modeChanges.push({ at: sg.from, from: prev, to: sg.mode });
    prev = sg.mode;
  }
  return { ok: true, segments, arriveTick: t, totalHours: segments.reduce((a, b) => a + b.hours, 0), actOfWar: aow, modeChanges };
}

function classifyFailure(state: GameState, s: Stack, from: NodeId, to: NodeId, segs: RouteSegmentPreview[], t: number): RoutePlan {
  const m = S(state).map;
  const base: RoutePlan = { ok: false, segments: segs, arriveTick: t, totalHours: 0, actOfWar: [], modeChanges: [] };
  if (m.isLand[to] && m.outside[to]) return { ...base, reason: 'outside_campaign', detail: 'Destination is outside the campaign.' };
  if (s.moveClass === 'naval' && m.isLand[to] && !isPort(state, m, to)) return { ...base, reason: 'missing_facility', detail: 'Ships can only enter provinces with a port.' };
  const tryCtx = (extra: Partial<MoveCtx>) => {
    const ctx = ctxFor(state, s, extra);
    return astar(m, from, to, (ei, a, b) => {
      const v = evalEdge(state, ctx, ei, a, b);
      return v.ok ? { hours: v.hours as number } : null;
    }, maxSpeedFor(s.moveClass));
  };
  const noRights = tryCtx({ ignoreRights: true });
  if (noRights) {
    const owners = new Set<CountryId>();
    for (let i = 0; i < noRights.edges.length; i++) {
      const b = noRights.nodes[i + 1];
      const e = m.edges[noRights.edges[i]];
      const o = ownerOf(state, b);
      if (m.isLand[b] && o && !hasPassage(state, s.owner, o)) owners.add(o);
      if (e.via !== undefined) {
        const vo = ownerOf(state, e.via);
        if (vo && !hasPassage(state, s.owner, vo)) owners.add(vo);
      }
    }
    const list = [...owners].sort();
    return { ...base, reason: 'no_access', blockingOwners: list, detail: `No movement rights: passage needed from ${list.join(', ') || 'a third owner'}.` };
  }
  const noFac = tryCtx({ ignoreRights: true, ignoreFacilities: true });
  if (noFac) return { ...base, reason: 'missing_facility', detail: 'Route needs a port or coastal embarkation point that is not available.' };
  return { ...base, reason: 'unreachable', detail: s.moveClass === 'naval' ? 'Destination is not reachable by sea.' : 'Destination is not reachable over land or sea lanes.' };
}

/** Convert a plan into a MoveOrder (dropping the lead-in edge if the stack is already on it). */
export function orderFromPlan(state: GameState, s: Stack, plan: RoutePlan, dest: NodeId, waypoints: NodeId[], warConfirmed: CountryId[]): MoveOrder {
  const route: RouteSegment[] = plan.segments.map((x) => ({ from: x.from, to: x.to, edge: x.edge, mode: x.mode }));
  return { kind: 'move', route, dest, waypoints: [...waypoints], warConfirmed: [...warConfirmed].sort(), issuedAt: state.clock.tick };
}

// ───────────────────────────── per-step movement ─────────────────────────────

export interface MoveHooks {
  declareWar: (state: GameState, by: CountryId, target: CountryId, reason: string) => void;
}

function stopWithEvent(state: GameState, s: Stack, text: string, kind = 'route_stopped'): void {
  const node = s.pos.kind === 'node' ? s.pos.node : null;
  emit(state, { kind, category: 'combat', node, private: toAll([s.owner], `${s.name}: ${text}`, { stack: s.id }) });
}

/** Re-validate the remaining route; truncate at the first illegal segment. */
interface RevalKey { relv: number; grv: number; cov: number; econ: number; rl: number; ul: number; pk: string; ownv: number }
const revalidated = new WeakMap<object, RevalKey>();
const routeNodes = new WeakMap<object, Set<NodeId>>();
export function revalidateRoute(state: GameState, s: Stack): void {
  const o = s.order;
  if (!o || o.kind !== 'move' || !o.route.length) return;
  // legality only changes with rights, ownership, facilities or the roster: skip when none changed
  const ownv = state.ids.ownv ?? 0;
  const key: RevalKey = { relv: state.ids.relv ?? 0, grv: state.ids.grv ?? 0, cov: state.ids.cov ?? 0, econ: s.moveClass === 'naval' ? state.ids.econv ?? 0 : 0, rl: o.route.length, ul: s.units.length, pk: s.pos.kind, ownv };
  const prev = revalidated.get(o);
  if (prev && prev.relv === key.relv && prev.grv === key.grv && prev.cov === key.cov && prev.econ === key.econ && prev.rl === key.rl && prev.ul === key.ul && prev.pk === key.pk) {
    if (prev.ownv === ownv) return;
    // ownership changed somewhere: only re-check if a changed node lies on the remaining route
    const changed = ownerChangesSince(state, prev.ownv);
    if (changed) {
      let touches = false;
      // nodes of the route (from/to/via), memoized per route array (a superset after shifts is fine:
      // a spurious full re-check finds the same result)
      let rn = routeNodes.get(o.route);
      if (!rn) {
        rn = new Set();
        const edges = S(state).map.edges;
        for (const sg of o.route) {
          rn.add(sg.to);
          rn.add(sg.from);
          const via = edges[sg.edge].via;
          if (via !== undefined) rn.add(via);
        }
        routeNodes.set(o.route, rn);
      }
      for (const n of changed) if (rn.has(n)) { touches = true; break; }
      if (!touches) {
        prev.ownv = ownv;
        return;
      }
    }
  }
  revalidated.set(o, key);
  const ctx = ctxFor(state, s, { allowActOfWar: o.warConfirmed });
  for (let i = 0; i < o.route.length; i++) {
    const seg = o.route[i];
    // the segment currently being travelled starts from s.pos.from
    const v = evalEdge(state, ctx, seg.edge, seg.from, seg.to);
    if (v.ok) continue;
    const m = S(state).map;
    const where = m.data.nodes[seg.to].name;
    if (i === 0 && s.pos.kind === 'edge' && s.pos.to === seg.to) {
      // turn back along the same edge to the last legal node
      const p = s.pos;
      s.pos = { kind: 'edge', from: p.to, to: p.from, edge: p.edge, progress: Math.max(0, p.length - p.progress), length: p.length };
      o.route = [{ from: p.to, to: p.from, edge: p.edge, mode: s.mode }];
      o.dest = p.from;
      o.waypoints = [];
      stopWithEvent(state, s, `route into ${where} is no longer legal (${v.detail ?? v.reason}); turning back to ${m.data.nodes[p.from].name}.`, 'route_revoked');
    } else {
      o.route = o.route.slice(0, i);
      const last = i > 0 ? o.route[i - 1].to : s.pos.kind === 'node' ? s.pos.node : seg.from;
      o.dest = last;
      o.waypoints = [];
      stopWithEvent(state, s, `route beyond ${m.data.nodes[last].name} is no longer legal (${v.detail ?? v.reason}); stopping at the last legal node.`, 'route_revoked');
    }
    return;
  }
}

/** Advance all moving ground/naval stacks by one step. */
export function moveStep(state: GameState, stacks: Stack[], hooks: MoveHooks): void {
  const m = S(state).map;
  // node → stacks standing there (same membership rule as world.stacksAt), kept current as stacks move
  let atNode: Map<NodeId, Set<Stack>> | null = null;
  const index = () => {
    if (atNode) return atNode;
    atNode = new Map();
    for (const x of stacks) {
      if (x.pos.kind !== 'node' || x.aboard || (x.air && x.air.state !== 'landed' && x.air.state !== 'refueling')) continue;
      (atNode.get(x.pos.node) ?? atNode.set(x.pos.node, new Set()).get(x.pos.node)!).add(x);
    }
    return atNode;
  };
  for (const s of stacks) {
    if (s.moveClass === 'air' || s.aboard) continue;
    const o = s.order;
    if (!o || o.kind !== 'move' || !o.route.length) continue;
    if (s.delayUntil !== null && s.delayUntil > state.clock.tick) continue;
    revalidateRoute(state, s);
    let budget = STEP_MIN / 60; // hours
    let guard = 0;
    while (budget > 1e-9 && o.route.length && guard++ < 64) {
      if (s.pos.kind === 'node') {
        const seg = o.route[0];
        if (seg.from !== s.pos.node) {
          o.route = [];
          break;
        }
        const ctx = ctxFor(state, s, { allowActOfWar: o.warConfirmed });
        const v = evalEdge(state, ctx, seg.edge, seg.from, seg.to);
        if (!v.ok) {
          stopWithEvent(state, s, `cannot continue to ${m.data.nodes[seg.to].name}: ${v.detail ?? v.reason}`);
          o.route = [];
          break;
        }
        if (v.actOfWar) {
          if (!atWar(state, s.owner, v.actOfWar)) hooks.declareWar(state, s.owner, v.actOfWar, `Border crossing into ${m.data.nodes[seg.to].name} by ${s.name}`);
        }
        s.mode = v.mode as MoveMode;
        if (atNode) atNode.get(seg.from)?.delete(s);
        s.pos = { kind: 'edge', from: seg.from, to: seg.to, edge: seg.edge, progress: 0, length: (v.km as number) + (v.extraKm ?? 0) };
        s.stationarySince = state.clock.tick;
        if (s.engagement) s.engagement = null;
      }
      if (s.pos.kind !== 'edge') break;
      const p = s.pos;
      const sp = stackSpeed(state, s, s.mode, m.terrain[p.to], p.to);
      if (!(sp > 0)) break;
      const need = (p.length - p.progress) / sp;
      if (need <= budget + 1e-9) {
        budget -= need;
        s.pos = { kind: 'node', node: p.to };
        s.stationarySince = state.clock.tick;
        o.route.shift();
        if (m.isLand[p.to]) s.mode = s.moveClass === 'naval' ? 'naval' : 'land';
        // halt on contact with hostile forces
        const enemies = enemyMap(state).get(s.owner);
        const idx = index();
        (idx.get(p.to) ?? idx.set(p.to, new Set()).get(p.to)!).add(s);
        let hostile = false;
        if (enemies && o.route.length) for (const x of idx.get(p.to)!) if (x !== s && enemies.has(x.owner)) { hostile = true; break; }
        if (hostile && o.route.length) {
          stopWithEvent(state, s, `halted by hostile forces at ${m.data.nodes[p.to].name}.`, 'halted');
          o.route = [];
        }
      } else {
        p.progress += sp * budget;
        budget = 0;
      }
    }
    if (!o.route.length) {
      s.order = null;
      s.delayUntil = null;
    }
  }
}

export function routeEtaTick(state: GameState, s: Stack): number | null {
  const o = s.order;
  if (!o || o.kind !== 'move' || !o.route.length) return null;
  const m = S(state).map;
  let t = state.clock.tick;
  if (s.delayUntil && s.delayUntil > t) t = s.delayUntil;
  for (let i = 0; i < o.route.length; i++) {
    const seg = o.route[i];
    let km = m.edges[seg.edge].km;
    const sp = stackSpeed(state, s, seg.mode, m.terrain[seg.to], seg.to);
    if (i === 0 && s.pos.kind === 'edge') km = s.pos.length - s.pos.progress;
    else if (m.edges[seg.edge].kind === 'coast' && s.moveClass === 'ground') km += (EMBARK_MIN / 60) * cmod(state, s.owner, 'embark_time_mult') * sp;
    t += sp > 0 ? Math.ceil((km / sp) * 60) : 0;
  }
  return t;
}

export function nearestNodeTo(state: GameState, s: Stack): NodeId | null {
  if (s.pos.kind === 'node') return s.pos.node;
  if (s.pos.kind === 'edge') return s.pos.progress * 2 < s.pos.length ? s.pos.from : s.pos.to;
  return null;
}
export { nodeDist, other };
