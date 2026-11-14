/** Force commands: move/attack/stop/delay/split/merge/fire policy/patrol/rebase/ferry/embark/disembark/retreat/refit/deployables. */
import type { CountryId, NodeId } from '../data-types';
import type { GameState, Stack } from '../state';
import type { CommandOf } from './types';
import { fail, isFail, ok, ownStack, type Handler } from './common';
import { orderFromPlan, planRoute, type RoutePlan, stackSpeed } from '../systems/movement';
import { S } from '../scenario/registry';
import { atWar, cmpId, hasPassage, hostileStacks, stackLL, ustats, utype, stacksAt, isFriendlyTerritory, unitRange } from '../systems/world';
import { resolveContact } from '../systems/visibility';
import { declareWarInternal } from '../systems/diplomacy';
import { distKm, edgeBetween, nodeLL, other } from '../systems/mapindex';
import { nextId } from '../ids';
import { stackEfficiency } from '../systems/combat';
import { airRange, checkBase, launchPatrol, launchRebase, nodeAirSlots, baseLL, carrierSlots } from '../systems/air';
import { RETREAT_HP_COST, DEFAULT_PATROL_RADIUS_KM } from '../rules';
import { emit, toAll } from '../systems/events';
import { maintenanceCapacity } from '../systems/readiness';
import { snapshotReport } from '../systems/intel';
import { checkAirmobile, launchAirmobile, type AirmobilePreview } from '../systems/airmobile';

function confirmList(c: CountryId[] | boolean | undefined, need: CountryId[]): boolean {
  if (!need.length) return true;
  if (c === true) return true;
  if (!Array.isArray(c)) return false;
  return need.every((x) => c.includes(x));
}

export interface MovePreview {
  route: RoutePlan;
  actOfWar: CountryId[];
  dest: NodeId;
  waypoints: NodeId[];
}

function routeValidation(state: GameState, s: Stack, dest: NodeId, waypoints: NodeId[], confirm: CountryId[] | boolean | undefined) {
  if (s.moveClass === 'air') return fail('invalid_domain', 'Aircraft use Patrol or Rebase orders.');
  if (s.aboard) return fail('invalid_domain', 'Formation is aboard a carrier.');
  if (s.pos.kind === 'air') return fail('busy', 'Formation is in an air-mobile flight; order it after it lands.');
  const m = S(state).map;
  for (const n of [...waypoints, dest]) if (!Number.isInteger(n) || n < 0 || n >= m.n) return fail('unknown_target', 'Unknown destination.');
  let plan = planRoute(state, s, dest, waypoints);
  if (!plan.ok && plan.reason === 'no_access') {
    const aow = planRoute(state, s, dest, waypoints, { allowActOfWar: true });
    if (aow.ok) {
      if (!confirmList(confirm, aow.actOfWar)) {
        return fail('act_of_war', `This route enters ${aow.actOfWar.join(', ')} territory without passage rights — an act of war. Confirm to declare war on entry.`, { route: aow, actOfWar: aow.actOfWar });
      }
      plan = aow;
    }
  }
  if (!plan.ok) return fail(plan.reason ?? 'unreachable', plan.detail ?? 'Destination unreachable.', { route: plan });
  return ok<MovePreview>({ route: plan, actOfWar: plan.actOfWar, dest, waypoints });
}

export const move: Handler<CommandOf<'move'>, MovePreview> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    return routeValidation(state, s, cmd.dest, cmd.waypoints ?? [], cmd.confirmActOfWar);
  },
  apply(state, cmd, p) {
    const s = state.stacks[cmd.stack];
    s.order = orderFromPlan(state, s, p.route, p.dest, p.waypoints, p.actOfWar);
    s.delayUntil = null;
    return { eta: p.route.arriveTick };
  },
};

export const ferry: Handler<CommandOf<'ferry'>, MovePreview> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    return routeValidation(state, s, cmd.dest, [], cmd.confirmActOfWar);
  },
  apply: (state, cmd, p) => move.apply(state, { ...cmd, type: 'move' }, p),
};

export const embark: Handler<CommandOf<'embark'>, MovePreview> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    const m = S(state).map;
    if (s.moveClass !== 'ground') return fail('invalid_domain', 'Only ground formations embark.');
    if (s.pos.kind !== 'node' || !m.isLand[s.pos.node]) return fail('invalid_domain', 'Formation must be in a land province.');
    if (!m.coastal[s.pos.node]) return fail('missing_facility', 'Embarking requires a coastal province.');
    const ei = edgeBetween(m, s.pos.node, cmd.sea);
    if (ei < 0 || m.edges[ei].kind !== 'coast') return fail('unreachable', 'That sea zone is not adjacent to this coast.');
    return routeValidation(state, s, cmd.sea, [], false);
  },
  apply: (state, cmd, p) => move.apply(state, { ...cmd, type: 'move', dest: cmd.sea }, p),
};

export const disembark: Handler<CommandOf<'disembark'>, MovePreview> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    const m = S(state).map;
    if (s.moveClass !== 'ground') return fail('invalid_domain', 'Only ground formations disembark.');
    if (s.pos.kind !== 'node' || m.isLand[s.pos.node]) return fail('invalid_domain', 'Formation must be at sea.');
    const ei = edgeBetween(m, s.pos.node, cmd.land);
    if (ei < 0 || m.edges[ei].kind !== 'coast') return fail('unreachable', 'That coast is not adjacent to this sea zone.');
    return routeValidation(state, s, cmd.land, [], cmd.confirmActOfWar);
  },
  apply: (state, cmd, p) => move.apply(state, { ...cmd, type: 'move', dest: cmd.land }, p),
};

export interface AttackPreview {
  mode: 'ranged' | 'assault';
  targetStack: string | null;
  targetNode: NodeId | null;
  route: RoutePlan | null;
  actOfWar: CountryId[];
  distanceKm: number | null;
}

export const attack: Handler<CommandOf<'attack'>, AttackPreview> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (s.moveClass === 'air') return fail('invalid_domain', 'Aircraft attack through Patrol orders (engage policy).');
    if (s.pos.kind === 'air') return fail('busy', 'Formation is in an air-mobile flight; order it after it lands.');
    let targetStack: Stack | null = null;
    let node: NodeId | null = cmd.targetNode ?? null;
    if (cmd.targetContact) {
      const sid = resolveContact(state, cmd.country, cmd.targetContact);
      if (!sid) return fail('unknown_target', 'Target contact is not currently observed.');
      targetStack = state.stacks[sid];
      node = targetStack.pos.kind === 'node' ? targetStack.pos.node : targetStack.pos.kind === 'edge' ? targetStack.pos.to : null;
      if (node === null) return fail('invalid_domain', 'Target is airborne.');
    }
    if (node === null) return fail('invalid_argument', 'Specify a target contact or province.');
    const aow: CountryId[] = [];
    if (targetStack && !atWar(state, cmd.country, targetStack.owner)) aow.push(targetStack.owner);
    const nodeOwner = state.provinces[node]?.owner ?? null;
    if (!targetStack && nodeOwner && nodeOwner !== cmd.country && !atWar(state, cmd.country, nodeOwner) && !hasPassage(state, cmd.country, nodeOwner)) aow.push(nodeOwner);
    if (aow.length && !confirmList(cmd.confirmActOfWar, aow)) return fail('act_of_war', `Attacking ${aow.join(', ')} is an act of war. Confirm to declare war.`, { actOfWar: aow });
    const maxR = Math.max(0, ...s.units.map((u) => unitRange(state, s.owner, u)));
    const ll = stackLL(state, s);
    const tll = targetStack ? stackLL(state, targetStack) : nodeLL(S(state).map, node);
    const d = distKm(ll[0], ll[1], tll[0], tll[1]);
    if (maxR > 0 && d <= maxR && d > 1 && s.pos.kind === 'node') return ok<AttackPreview>({ mode: 'ranged', targetStack: targetStack?.id ?? null, targetNode: node, route: null, actOfWar: aow, distanceKm: d });
    if (s.pos.kind === 'node' && s.pos.node === node) return ok<AttackPreview>({ mode: 'assault', targetStack: targetStack?.id ?? null, targetNode: node, route: null, actOfWar: aow, distanceKm: 0 });
    const r = routeValidation(state, s, node, [], cmd.confirmActOfWar ?? aow);
    if (!r.ok) return r;
    return ok<AttackPreview>({ mode: 'assault', targetStack: targetStack?.id ?? null, targetNode: node, route: r.preview.route, actOfWar: [...new Set([...aow, ...r.preview.actOfWar])].sort(), distanceKm: d });
  },
  apply(state, cmd, p) {
    const s = state.stacks[cmd.stack];
    const target = p.targetStack ? state.stacks[p.targetStack] : null;
    for (const c of p.actOfWar) if (target && c === target.owner) declareWarInternal(state, cmd.country, c, cmd.reason ?? `Attack ordered on ${c} forces`);
    if (!target) for (const c of p.actOfWar) if (state.provinces[p.targetNode as number]?.owner === c && !p.route) declareWarInternal(state, cmd.country, c, cmd.reason ?? 'Attack ordered');
    if (p.mode === 'ranged' || !p.route) {
      s.order = { kind: 'attack', targetStack: p.targetStack, targetNode: p.targetNode, warConfirmed: p.actOfWar, issuedAt: state.clock.tick };
    } else {
      const o = orderFromPlan(state, s, p.route, p.targetNode as number, [], p.actOfWar);
      o.attack = { targetStack: p.targetStack ?? undefined, targetNode: p.targetNode ?? undefined };
      s.order = o;
    }
    s.delayUntil = null;
    return { mode: p.mode };
  },
};

export const stop: Handler<CommandOf<'stop'>, { returning: boolean }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (s.moveClass !== 'air' && s.pos.kind === 'air') return fail('busy', 'An air-mobile lift cannot stop in mid-air; it lands at its destination.');
    return ok({ returning: s.moveClass === 'air' && !!s.air && s.air.state === 'on_station' });
  },
  apply(state, cmd) {
    const s = state.stacks[cmd.stack];
    if (s.moveClass === 'air' && s.air && s.air.patrol && s.air.state === 'on_station') {
      s.air.patrol.until = state.clock.tick; // return home on next step
      return { stopped: true };
    }
    if (s.pos.kind === 'edge' && s.order?.kind === 'move' && s.order.route.length) {
      s.order.route = s.order.route.slice(0, 1);
      s.order.dest = s.order.route[0].to;
      s.order.waypoints = [];
      s.order.attack = undefined;
    } else s.order = null;
    s.delayUntil = null;
    return { stopped: true };
  },
};

export const delay: Handler<CommandOf<'delay'>, { until: number }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (!Number.isInteger(cmd.minutes) || cmd.minutes <= 0 || cmd.minutes > 7 * 1440) return fail('invalid_argument', 'Delay must be 1 minute to 7 days.');
    if (!s.order) return fail('invalid_argument', 'Formation has no order to delay.');
    if (s.moveClass !== 'air' && s.pos.kind === 'air') return fail('busy', 'An air-mobile lift in flight cannot be delayed.');
    return ok({ until: state.clock.tick + cmd.minutes });
  },
  apply(state, cmd, p) {
    state.stacks[cmd.stack].delayUntil = p.until;
    return p;
  },
};

export const split: Handler<CommandOf<'split'>, { before: number; after: [number, number]; efficiency: [number, number] }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (s.pos.kind !== 'node' || (s.air && s.air.state !== 'landed' && s.air.state !== 'refueling')) return fail('busy', 'Formations can only split while stationary at a province or base.');
    const ids = new Set(cmd.units);
    if (ids.size !== cmd.units.length) return fail('invalid_argument', 'Duplicate unit ids.');
    for (const id of ids) if (!s.units.some((u) => u.id === id)) return fail('invalid_argument', `Unit ${id} is not in this formation.`);
    if (!ids.size || ids.size >= s.units.length) return fail('invalid_argument', 'Select at least one unit and leave at least one behind.');
    const a = s.units.length - ids.size, b = ids.size;
    return ok({ before: s.units.length, after: [a, b], efficiency: [stackEfficiency(a), stackEfficiency(b)] });
  },
  apply(state, cmd) {
    const s = state.stacks[cmd.stack];
    const ids = new Set(cmd.units);
    const moved = s.units.filter((u) => ids.has(u.id));
    s.units = s.units.filter((u) => !ids.has(u.id));
    const id = nextId(state, 'stack');
    const ns: Stack = JSON.parse(JSON.stringify({ ...s, units: [] }));
    ns.id = id;
    ns.units = moved;
    ns.name = `${s.name} (detached ${id.slice(1)})`;
    ns.order = null;
    ns.engagement = null;
    state.stacks[id] = ns;
    return { newStack: id };
  },
};

export const merge: Handler<CommandOf<'merge'>, { into: string; units: number; efficiency: number }> = {
  validate(state, cmd) {
    if (!Array.isArray(cmd.stacks) || cmd.stacks.length < 2 || new Set(cmd.stacks).size !== cmd.stacks.length) return fail('invalid_argument', 'Select two or more different formations.');
    const list: Stack[] = [];
    for (const id of cmd.stacks) {
      const s = ownStack(state, cmd.country, id);
      if (isFail(s)) return s;
      list.push(s);
    }
    const first = list[0];
    for (const s of list) {
      if (s.pos.kind !== 'node' || first.pos.kind !== 'node' || s.pos.node !== first.pos.node) return fail('invalid_argument', 'Formations must be at the same location.');
      if (s.moveClass !== first.moveClass) return fail('invalid_domain', 'Cannot combine formations of different movement domains.');
      if (s.aboard !== first.aboard) return fail('invalid_argument', 'Formations must be at the same base.');
      if (s.air && s.air.state !== 'landed') return fail('busy', 'Aircraft must be landed and refuelled.');
    }
    const n = list.reduce((a, s) => a + s.units.length, 0);
    return ok({ into: first.id, units: n, efficiency: stackEfficiency(n) });
  },
  apply(state, cmd) {
    const into = state.stacks[cmd.stacks[0]];
    for (const id of cmd.stacks.slice(1)) {
      const s = state.stacks[id];
      into.units.push(...s.units);
      into.stationarySince = Math.max(into.stationarySince, s.stationarySince);
      delete state.stacks[id];
    }
    into.units.sort(cmpId);
    into.order = null;
    return { into: into.id };
  },
};

export const setFirePolicy: Handler<CommandOf<'setFirePolicy'>, { policy: string }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (!['hold', 'return_fire', 'engage'].includes(cmd.policy)) return fail('invalid_argument', 'Unknown fire policy.');
    return ok({ policy: cmd.policy });
  },
  apply(state, cmd) {
    state.stacks[cmd.stack].firePolicy = cmd.policy;
    return {};
  },
};

export const patrol: Handler<CommandOf<'patrol'>, { center: [number, number]; radiusKm: number; distanceKm: number; untilEstimate: number }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (s.moveClass !== 'air' || !s.air) return fail('invalid_domain', 'Only aircraft patrol.');
    if (s.air.state === 'refueling') return fail('refueling', `Aircraft are refuelling until tick ${s.air.refuelUntil}.`);
    if (s.air.grounded) return fail('grounded', 'Aircraft are grounded: their airfield is disabled.');
    if (s.air.state !== 'landed' && s.air.state !== 'on_station') return fail('busy', 'Aircraft are in transit.');
    const m = S(state).map;
    if (!Number.isInteger(cmd.center) || cmd.center < 0 || cmd.center >= m.n) return fail('unknown_target', 'Unknown patrol area.');
    const home = baseLL(state, s.air.home);
    if (!home) return fail('missing_facility', 'Home base lost.');
    const c = nodeLL(m, cmd.center);
    const d = distKm(home[0], home[1], c[0], c[1]);
    const range = airRange(state, s);
    if (d > range / 2) return fail('insufficient_range', `Patrol area is ${Math.round(d)} km from base; round-trip limit is ${Math.round(range / 2)} km.`);
    const radius = Math.max(10, Math.min(cmd.radiusKm ?? DEFAULT_PATROL_RADIUS_KM, 400));
    return ok({ center: c, radiusKm: radius, distanceKm: d, untilEstimate: state.clock.tick });
  },
  apply(state, cmd, p) {
    const s = state.stacks[cmd.stack];
    launchPatrol(state, s, p.center, cmd.center, p.radiusKm);
    return { until: s.air?.patrol?.until };
  },
};

export const rebase: Handler<CommandOf<'rebase'>, { distanceKm: number; arriveEstimate: number }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (s.moveClass !== 'air' || !s.air) return fail('invalid_domain', 'Only aircraft rebase; use Ferry/Move for ground and naval forces.');
    if (s.air.state === 'refueling') return fail('refueling', `Aircraft are refuelling until tick ${s.air.refuelUntil}.`);
    if (s.air.grounded) return fail('grounded', 'Aircraft are grounded: their airfield is disabled.');
    if (s.air.state !== 'landed') return fail('busy', 'Aircraft must be landed to rebase.');
    const bv = checkBase(state, cmd.country, cmd.base);
    if (!bv.ok) return fail(bv.code ?? 'missing_facility', bv.reason ?? 'Invalid base.');
    const from = stackLL(state, s);
    const to = baseLL(state, cmd.base) as [number, number];
    const d = distKm(from[0], from[1], to[0], to[1]);
    if (d > airRange(state, s)) return fail('insufficient_range', `New base is ${Math.round(d)} km away; operational range is ${Math.round(airRange(state, s))} km.`);
    if ('node' in cmd.base) {
      let used = 0;
      for (const o of Object.values(state.stacks)) if (o.air && 'node' in o.air.home && o.air.home.node === cmd.base.node && o.id !== s.id) used += o.units.length;
      if (used + s.units.length > nodeAirSlots(state, cmd.base.node)) return fail('missing_facility', `Airfield capacity exceeded (${used}/${nodeAirSlots(state, cmd.base.node)} slots used).`);
    } else {
      let used = 0;
      for (const o of Object.values(state.stacks)) if (o.air && 'stack' in o.air.home && o.air.home.stack === cmd.base.stack && o.id !== s.id) used += o.units.length;
      const carrier = state.stacks[cmd.base.stack];
      if (used + s.units.length > carrierSlots(state, carrier)) return fail('missing_facility', 'Carrier deck capacity exceeded.');
      if (!s.units.every((u) => (utype(state, carrier.units.find((x) => utype(state, x.type).carries)!.type).carries?.families ?? []).includes(utype(state, u.type).family))) return fail('invalid_domain', 'These aircraft are not carrier-capable.');
    }
    const sp = Math.min(...s.units.map((u) => ustats(state, u).speedKmh));
    return ok({ distanceKm: d, arriveEstimate: state.clock.tick + Math.ceil((d / sp) * 60) });
  },
  apply(state, cmd) {
    launchRebase(state, state.stacks[cmd.stack], cmd.base);
    return {};
  },
};

export const retreat: Handler<CommandOf<'retreat'>, { dest: NodeId; hpCost: number; route: RoutePlan }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    if (s.moveClass === 'air') return fail('invalid_domain', 'Aircraft cannot retreat; they return to base.');
    if (s.pos.kind !== 'node') return fail('invalid_argument', 'Formation is not engaged at a province.');
    const here = stacksAt(state, s.pos.node);
    if (!here.some((o) => hostileStacks(state, s, o))) return fail('invalid_argument', 'Formation is not in combat — use Move.');
    const m = S(state).map;
    const ei = edgeBetween(m, s.pos.node, cmd.dest);
    if (ei < 0) return fail('unreachable', 'Retreat destination must be adjacent.');
    if (stacksAt(state, cmd.dest).some((o) => hostileStacks(state, s, o))) return fail('invalid_argument', 'Retreat destination is held by hostile forces.');
    const plan = planRoute(state, s, cmd.dest, []);
    if (!plan.ok) return fail(plan.reason ?? 'unreachable', plan.detail ?? 'No legal path.');
    const hpCost = s.units.reduce((a, u) => a + Math.floor(u.hp * RETREAT_HP_COST), 0);
    return ok({ dest: cmd.dest, hpCost, route: plan });
  },
  apply(state, cmd, p) {
    const s = state.stacks[cmd.stack];
    for (const u of s.units) u.hp = Math.max(1, u.hp - Math.floor(u.hp * RETREAT_HP_COST));
    const o = orderFromPlan(state, s, p.route, p.dest, [], []);
    o.retreat = true;
    s.order = o;
    s.firePolicy = 'return_fire';
    emit(state, { kind: 'retreat', category: 'combat', node: (s.pos as { node: number }).node, private: toAll([s.owner], `${s.name} retreats towards ${S(state).map.data.nodes[p.dest].name} (HP cost ${(p.hpCost / 100).toFixed(1)}).`) });
    return { hpCost: p.hpCost };
  },
};

export const setRefit: Handler<CommandOf<'setRefit'>, { capacity: number; used: number }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    const cap = maintenanceCapacity(state, cmd.country);
    let used = 0;
    for (const o of Object.values(state.stacks)) if (o.owner === cmd.country && o.refit && o.id !== s.id) used += o.units.length;
    if (cmd.refit) {
      if (s.pos.kind !== 'node') return fail('invalid_argument', 'Refit requires the formation to be stationary.');
      if (!isFriendlyTerritory(state, cmd.country, state.provinces[s.pos.node]?.owner ?? null)) return fail('missing_facility', 'Refit requires friendly territory.');
      if (used + s.units.length > cap) return fail('busy', `Maintenance slots full (${used}/${cap}).`);
    }
    return ok({ capacity: cap, used });
  },
  apply(state, cmd) {
    state.stacks[cmd.stack].refit = cmd.refit;
    return {};
  },
};

export const useDeployable: Handler<CommandOf<'useDeployable'>, { effect: string; distanceKm: number }> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    const u = s.units.find((x) => x.id === cmd.unit);
    if (!u) return fail('invalid_argument', 'Unit not in formation.');
    const t = utype(state, u.type);
    if (!t.deployable) return fail('invalid_domain', `${t.name} is not a deployable.`);
    if ((u.uses ?? 0) <= 0) return fail('insufficient_stock', 'No uses remaining.');
    if (u.cooldownUntil && u.cooldownUntil > state.clock.tick) return fail('busy', `On cooldown until tick ${u.cooldownUntil}.`);
    const m = S(state).map;
    if (!Number.isInteger(cmd.target) || cmd.target < 0 || cmd.target >= m.n) return fail('unknown_target', 'Unknown target.');
    const ll = stackLL(state, s);
    const d = distKm(ll[0], ll[1], m.lon[cmd.target], m.lat[cmd.target]);
    const range = Math.max(ustats(state, u).rangeKm, 50);
    if (d > range) return fail('insufficient_range', `Target ${Math.round(d)} km away; range ${range} km.`);
    return ok({ effect: t.deployable.effect, distanceKm: d });
  },
  apply(state, cmd, p) {
    const s = state.stacks[cmd.stack];
    const u = s.units.find((x) => x.id === cmd.unit)!;
    const t = utype(state, u.type);
    u.uses = (u.uses ?? 1) - 1;
    u.cooldownUntil = state.clock.tick + (t.deployable?.cooldownMin ?? 60);
    if (p.effect === 'recon') {
      const r = snapshotReport(state, cmd.country, cmd.target, 'agent', 0.8);
      return { report: r.id };
    }
    // strike: abstract tile damage to hostile stacks at target
    let hit = 0;
    for (const o of stacksAt(state, cmd.target)) {
      if (!atWar(state, cmd.country, o.owner)) continue;
      for (const x of o.units) {
        x.hp = Math.max(0, x.hp - Math.round(x.maxHp * 0.1));
        hit++;
      }
      o.units = o.units.filter((x) => x.hp > 0);
      if (!o.units.length) delete state.stacks[o.id];
    }
    if (u.uses <= 0) s.units = s.units.filter((x) => x.id !== u.id);
    if (!s.units.length) delete state.stacks[s.id];
    emit(state, { kind: 'deployable_used', category: 'combat', node: cmd.target, private: toAll([cmd.country], `${t.name} used at ${S(state).map.data.nodes[cmd.target].name}: ${hit} hostile unit(s) affected.`) });
    return { hit };
  },
};

export const airmobile: Handler<CommandOf<'airmobile'>, AirmobilePreview> = {
  validate(state, cmd) {
    const s = ownStack(state, cmd.country, cmd.stack);
    if (isFail(s)) return s;
    return checkAirmobile(state, s, cmd.dest, cmd.confirmActOfWar);
  },
  apply(state, cmd, p) {
    launchAirmobile(state, state.stacks[cmd.stack], p);
    return { arriveAt: p.arriveAt };
  },
};

export function stackEtaSpeed(state: GameState, s: Stack): number {
  const node = s.pos.kind === 'node' ? s.pos.node : s.pos.kind === 'edge' ? s.pos.to : 0;
  return stackSpeed(state, s, s.mode, S(state).map.terrain[node], node);
}
export { other };
