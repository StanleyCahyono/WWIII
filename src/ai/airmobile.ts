/**
 * Air-mobile reinforcement (helicopter lift). A threatened own city that land reinforcements reach
 * slowly (more than 3 land hops, or not at all) gets an air-mobile hop from an idle formation that
 * can fly it: helicopters with `airmobileCapacity` seating every light-infantry passenger, or
 * air-assault infantry with organic lift; all flyers past their turnaround; destination within the
 * flyers' range (catalog `operationalRangeKm`, default from `rules.AIRMOBILE`). The hop goes through
 * the shared validator (`airmobile` command), which also charges the fuel and estimates the
 * interception risk from our own observations — a hop whose estimate is ≥ 35 % is not flown.
 */
import type { NodeId } from '../engine/data-types';
import type { StackView } from '../engine/view/country-view';
import type { Turn } from './turn';
import type { Analysis, CityInfo } from './analysis';
import { km } from './geo';
import { stackGroundPower } from './value';
import { heldByTask, idleGround, HOUR } from './orders';

const MAX_RISK = 0.35;

interface Lift {
  ok: boolean;
  rangeKm: number;
}

/** Can this formation fly a hop (view-side mirror of the engine rule; the validator decides)? */
export function liftOf(t: Turn, s: StackView): Lift {
  const rules = (t.view.rules as { AIRMOBILE?: { defaultRangeKm: number; minKm: number } }).AIRMOBILE;
  let lift = 0, passengers = 0, flyers = 0, range = Infinity;
  for (const u of s.units) {
    if (u.hp <= 0) continue;
    const ut = t.ix.units.get(u.type);
    if (!ut) return { ok: false, rangeKm: 0 };
    const heli = ut.family === 'helicopter';
    const self = !heli && (ut.airmobileCapacity ?? 0) > 0;
    if (heli) lift += ut.airmobileCapacity ?? 0;
    else if (!self) {
      if (!((ut.family === 'infantry' && ut.targetClass === 'unarmored') || ut.family === 'officer')) return { ok: false, rangeKm: 0 };
      passengers++;
    }
    if (heli || self) {
      flyers++;
      if ((u.cooldownUntil ?? 0) > t.now) return { ok: false, rangeKm: 0 };
      const lv = ut.levels.find((l) => l.level === u.level) ?? ut.levels[0];
      range = Math.min(range, lv?.operationalRangeKm ?? rules?.defaultRangeKm ?? 400);
    }
  }
  const modifier = t.view.self.modifiers['air_operational_range_mult'] ?? 1;
  return { ok: flyers > 0 && passengers <= lift && passengers + flyers > 0 && Number.isFinite(range), rangeKm: range * modifier };
}

/**
 * Send air-mobile help to city `c` (still short by `need` ground power). `hops` = land hop distance
 * to the city per node (≤ 0 = unreachable within the horizon). Returns the power sent.
 */
export function airmobileReinforce(t: Turn, a: Analysis, stacks: StackView[], c: CityInfo, need: number, hops: Int16Array): number {
  if (need <= 0 || t.full || c.threat <= 0) return 0;
  const minKm = (t.view.rules as { AIRMOBILE?: { minKm: number } }).AIRMOBILE?.minKm ?? 20;
  let sent = 0;
  const cands = stacks
    .filter((s) => idleGround(s) && !t.movedStacks.has(s.id) && !heldByTask(t, s) && stackGroundPower(t.ix, s) > 0)
    .map((s) => ({ s, at: (s.pos as { node: NodeId }).node }))
    .filter((x) => x.at !== c.node && (hops[x.at] <= 0 || hops[x.at] > 3))
    .map((x) => ({ ...x, d: km(t.geo, x.at, c.node), lift: liftOf(t, x.s) }))
    .filter((x) => x.lift.ok && x.d >= minKm && x.d <= x.lift.rangeKm)
    .filter((x) => {
      // do not strip another threatened city below its own requirement
      const here = a.cityAt.get(x.at);
      return !here || here.present - stackGroundPower(t.ix, x.s) >= here.required;
    })
    .sort((x, y) => x.d - y.d || (x.s.id < y.s.id ? -1 : 1));
  for (const { s, d } of cands.slice(0, 2)) {
    if (sent >= need || t.full) break;
    const p = stackGroundPower(t.ix, s);
    const reason = `air-mobile reinforcement of ${c.capital ? 'capital' : 'city'} ${c.key}: hostile ${c.threat.toFixed(0)} vs ${c.present.toFixed(0)}, ${Math.round(d)} km by helicopter instead of a slow land route`;
    const prev = t.ctx.preview({ type: 'airmobile', country: t.me, stack: s.id, dest: c.node });
    if (!prev.ok) continue;
    const risk = (prev.preview as { riskEstimate?: number }).riskEstimate ?? 0;
    if (risk >= MAX_RISK) {
      t.note('operational', 'airmobile_skipped', `${s.id} → ${c.node}`, `observed air defence makes the hop too risky (${Math.round(risk * 100)} %)`);
      continue;
    }
    if (!t.add({ type: 'airmobile', country: t.me, stack: s.id, dest: c.node }, 'operational', 'airmobile_defend', `${reason}; estimated interception risk ${Math.round(risk * 100)} %`)) continue;
    t.movedStacks.add(s.id);
    t.mem.tasks[s.id] = { dest: c.node, until: t.now + 18 * HOUR, kind: 'defend' };
    sent += p;
  }
  return sent;
}
