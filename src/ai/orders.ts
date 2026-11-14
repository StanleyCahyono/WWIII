/**
 * Shared order helpers for the operational layers (ground, alliance, naval): stack state checks
 * and a `move` issuer with a commitment window (stack task) and repeated-no-op protection.
 */
import type { CountryId, NodeId } from '../engine/data-types';
import type { StackView } from '../engine/view/country-view';
import type { Turn } from './turn';

export const HOUR = 60;
export const DAY = 1440;

export function idleGround(s: StackView): boolean {
  return s.moveClass === 'ground' && s.pos.kind === 'node' && !s.aboard && (!s.order || (s.order.kind === 'move' && s.order.route.length === 0));
}
export function orderDest(s: StackView): NodeId | null {
  if (!s.order) return null;
  if (s.order.kind === 'move') return s.order.dest;
  return s.order.targetNode;
}
export function nodeOf(s: StackView): NodeId | null {
  return s.pos.kind === 'node' ? s.pos.node : null;
}

/** Stack tasks that hold a formation against re-tasking by the offence/staging layers. */
export const HOLDING_TASKS = new Set(['defend', 'ally_defend', 'escort', 'blockade', 'carrier_station']);
export function heldByTask(t: Turn, s: StackView): boolean {
  const task = t.mem.tasks[s.id];
  return !!task && task.until > t.now && HOLDING_TASKS.has(task.kind);
}

export function issueMove(t: Turn, s: StackView, dest: NodeId, kind: string, reason: string, hold = 12 * HOUR): boolean {
  if (t.movedStacks.has(s.id)) return false;
  if (orderDest(s) === dest) return false; // already heading there: avoid a repeated no-op
  if (s.pos.kind === 'node' && s.pos.node === dest) return false;
  const r = t.add({ type: 'move', country: t.me, stack: s.id, dest }, 'operational', kind, reason, { path: true });
  if (!r) return false;
  t.movedStacks.add(s.id);
  t.mem.tasks[s.id] = { dest, until: t.now + hold, kind };
  return true;
}

/** Can our formations legally cross a node owned by `owner` (own, coalition, or passage granted to us)? */
export function passable(t: Turn, owner: CountryId | null | undefined): boolean {
  if (!owner) return false;
  if (owner === t.me) return true;
  const r = t.rel.get(owner);
  if (!r || r.war) return false;
  return r.sameCoalition || r.theirStatusToMe === 'right_of_way' || r.theirStatusToMe === 'shared_intel';
}
