/**
 * Naval layer (never runs for landlocked states). Signals: own fleet (stack naval power), OBSERVED
 * enemy sea/subsurface contacts with age discounts (priors when unobserved), public port cities,
 * own embarked ground formations and own air wings.
 *
 *  1. Escort: an embarked ground formation (at sea or with a sea leg ahead) gets the nearest free
 *     warship sent to its sea zone — once per convoy point (no repeated orders).
 *  2. Blockade: at war, the most valuable reachable enemy port is blockaded from an adjacent sea zone
 *     only when we hold sea superiority there (available fleet ≥ attack ratio + 0.2 × observed or
 *     prior hostile naval strength); otherwise the fleet holds and the decision is logged.
 *  3. Carriers: carrier-qualified aircraft (catalog `carrierCapable`, or the carrier's families when
 *     the catalog has no such flag) rebase onto own carriers with free deck slots; at war a carrier
 *     with an air wing takes station off the objective/threatened coast under sea superiority, so the
 *     wing's patrols reach it; otherwise it stays in port.
 *  4. Housekeeping: idle ships far from home in peace return to the nearest own port.
 *  5. Break a blockade (engine rule, AI request #12): an own port listed as `blockaded` in the view
 *     (output −30 %, no shipyard launches) gets the nearest free ship sent to an adjacent sea zone —
 *     any friendly naval presence there lifts the blockade — when our fleet in reach is not clearly
 *     outmatched by the observed hostile naval strength around that zone.
 */
import type { CountryId, NodeId } from '../engine/data-types';
import type { StackView } from '../engine/view/country-view';
import type { Turn } from './turn';
import type { Analysis } from './analysis';
import { km } from './geo';
import { carrierDeck, carrierEligible, contactNavalStrength, stackNavalPower } from './value';
import { DAY, HOUR, issueMove, orderDest, nodeOf } from './orders';

const FLEET_REACH_KM = 3000;
const SEA_THREAT_KM = 600;

function isCarrierGroup(t: Turn, s: StackView): boolean {
  return carrierDeck(t.ix, s).slots > 0;
}
function freeShip(t: Turn, s: StackView, allow: string[] = []): boolean {
  if (s.moveClass !== 'naval' || s.pos.kind !== 'node' || s.order || t.movedStacks.has(s.id)) return false;
  const task = t.mem.tasks[s.id];
  return !task || task.until <= t.now || allow.includes(task.kind);
}

/** Observed (or prior) hostile naval strength around a sea zone. */
export function seaThreat(t: Turn, a: Analysis, zone: NodeId, prior = 0): { strength: number; observed: boolean } {
  const enemies = new Set(a.enemies);
  let s = 0, observed = false;
  for (const c of t.view.contacts) {
    if (c.node === null || (c.domain !== 'sea' && c.domain !== 'subsurface')) continue;
    if (c.owner === t.me || (c.owner && !enemies.has(c.owner))) continue;
    if (km(t.geo, c.node, zone) > SEA_THREAT_KM) continue;
    s += contactNavalStrength(t.ix, c) * (c.owner ? 1 : 0.5);
    observed = true;
  }
  return { strength: observed ? s : prior, observed };
}

/** The sea node a convoy needs cover at: where it is now, or the first sea node of its embarked route. */
function convoyPoint(t: Turn, s: StackView): NodeId | null {
  const g = t.geo;
  if (s.pos.kind === 'node' && !g.isLand[s.pos.node]) return s.pos.node;
  if (s.pos.kind === 'edge') {
    if (!g.isLand[s.pos.to]) return s.pos.to;
    if (!g.isLand[s.pos.from]) return s.pos.from;
  }
  if (s.order && s.order.kind === 'move') for (const seg of s.order.route) if (!g.isLand[seg.to]) return seg.to;
  return null;
}

function escorts(t: Turn, a: Analysis, ships: StackView[]): void {
  const convoys = t.view.stacks.filter((s) => s.moveClass === 'ground' && !s.aboard).map((s) => ({ s, at: convoyPoint(t, s) })).filter((x) => x.at !== null) as { s: StackView; at: NodeId }[];
  if (!convoys.length) return;
  const g = t.geo;
  for (const c of convoys.slice(0, 2)) {
    if (t.full || t.pathLeft <= 0) return;
    if (ships.some((x) => nodeOf(x) === c.at || orderDest(x) === c.at || (t.mem.tasks[x.id]?.kind === 'escort' && t.mem.tasks[x.id].dest === c.at && t.mem.tasks[x.id].until > t.now))) continue;
    const cand = ships
      .filter((x) => freeShip(t, x, ['blockade']) && !isCarrierGroup(t, x) && stackNavalPower(t.ix, x) > 0 && km(g, (x.pos as { node: NodeId }).node, c.at) <= FLEET_REACH_KM)
      .sort((x, y) => km(g, (x.pos as { node: NodeId }).node, c.at) - km(g, (y.pos as { node: NodeId }).node, c.at) || (x.id < y.id ? -1 : 1));
    for (const x of cand) {
      const threat = seaThreat(t, a, c.at);
      if (issueMove(t, x, c.at, 'escort', `escort embarked ${c.s.name} at sea zone ${c.at}${threat.observed ? ` (hostile naval strength ${threat.strength.toFixed(0)} nearby)` : ''}`, 12 * HOUR)) break;
    }
  }
}

function blockade(t: Turn, a: Analysis, ships: StackView[]): void {
  if (!a.enemies.length || t.full || t.pathLeft <= 0) return;
  const g = t.geo, v = t.view;
  const avail = ships.filter((x) => freeShip(t, x) && !isCarrierGroup(t, x) && stackNavalPower(t.ix, x) > 0);
  const onStation = new Map<NodeId, number>();
  for (const x of ships) {
    const task = t.mem.tasks[x.id];
    if (task?.kind === 'blockade' && task.until > t.now) onStation.set(task.dest, (onStation.get(task.dest) ?? 0) + stackNavalPower(t.ix, x));
  }
  if (!avail.length) return;
  const ports = v.publicCities.filter((c) => c.port && c.owner && a.enemies.includes(c.owner));
  const cands: { port: (typeof ports)[number]; zone: NodeId; score: number }[] = [];
  for (const p of ports) {
    const zones = g.coast[p.node].filter((n) => !g.isLand[n]);
    if (!zones.length) continue;
    const zone = zones[0];
    const near = Math.min(...avail.map((x) => km(g, (x.pos as { node: NodeId }).node, zone)));
    if (near > FLEET_REACH_KM) continue;
    const objBonus = t.mem.objective?.target === p.owner ? 1.5 : 1;
    cands.push({ port: p, zone, score: (g.vp[p.node] * objBonus) / (1 + near / 1000) });
  }
  cands.sort((x, y) => y.score - x.score || x.zone - y.zone);
  for (const c of cands.slice(0, 2)) {
    if (t.full || t.pathLeft <= 0) return;
    const already = onStation.get(c.zone) ?? 0;
    const prior = t.ix.avgNaval * (0.5 + c.port.tier * 0.4);
    const threat = seaThreat(t, a, c.zone, prior);
    const need = Math.max(t.ix.avgNaval * 0.5, threat.strength * (t.diff.attackRatio + 0.2));
    if (already >= need) continue; // blockade already holds
    const inReach = avail.filter((x) => !t.movedStacks.has(x.id) && km(g, (x.pos as { node: NodeId }).node, c.zone) <= FLEET_REACH_KM).sort((x, y) => km(g, (x.pos as { node: NodeId }).node, c.zone) - km(g, (y.pos as { node: NodeId }).node, c.zone) || (x.id < y.id ? -1 : 1));
    const fleet = inReach.reduce((s, x) => s + stackNavalPower(t.ix, x), 0) + already;
    const ratio = fleet / Math.max(1, threat.strength);
    if (fleet < need) {
      t.note('operational', 'blockade_held', `${c.port.owner} port ${c.port.name}`, `no sea superiority: fleet ${fleet.toFixed(0)} vs ${threat.observed ? 'observed' : 'estimated'} ${threat.strength.toFixed(0)} (ratio ${ratio.toFixed(2)} < ${(t.diff.attackRatio + 0.2).toFixed(2)})`);
      continue;
    }
    let sent = already;
    for (const x of inReach) {
      if (sent >= need || t.full || t.pathLeft <= 0) break;
      if (issueMove(t, x, c.zone, 'blockade', `blockade ${c.port.owner} port ${c.port.name} from sea zone ${c.zone}: sea superiority ${ratio.toFixed(2)} (${threat.observed ? 'observed' : 'estimated'} hostile ${threat.strength.toFixed(0)})`, 2 * DAY)) sent += stackNavalPower(t.ix, x);
    }
    return; // one blockade per review
  }
}

function breakBlockade(t: Turn, a: Analysis, ships: StackView[]): void {
  const mine = (t.view.blockades ?? []).filter((b) => b.role === 'blockaded');
  if (!mine.length || t.full || t.pathLeft <= 0) return;
  const g = t.geo;
  for (const b of mine.slice(0, 1)) {
    const zones = g.coast[b.node].filter((n) => !g.isLand[n]);
    if (!zones.length) continue;
    if (ships.some((x) => zones.includes(nodeOf(x) ?? -1) || zones.includes(orderDest(x) ?? -1))) continue; // relief already under way
    const cand = ships
      .filter((x) => freeShip(t, x, ['blockade']) && !isCarrierGroup(t, x))
      .map((x) => ({ x, zone: zones.slice().sort((p, q) => km(g, (x.pos as { node: NodeId }).node, p) - km(g, (x.pos as { node: NodeId }).node, q) || p - q)[0] }))
      .filter((c) => km(g, (c.x.pos as { node: NodeId }).node, c.zone) <= FLEET_REACH_KM)
      .sort((p, q) => km(g, (p.x.pos as { node: NodeId }).node, p.zone) - km(g, (q.x.pos as { node: NodeId }).node, q.zone) || (p.x.id < q.x.id ? -1 : 1));
    if (!cand.length) continue;
    const fleet = cand.reduce((s, c) => s + stackNavalPower(t.ix, c.x), 0);
    const threat = seaThreat(t, a, cand[0].zone, t.ix.avgNaval);
    if (fleet < threat.strength * 0.6) {
      t.note('operational', 'blockade_unbroken', `own port ${b.name}`, `fleet ${fleet.toFixed(0)} vs ${threat.observed ? 'observed' : 'estimated'} hostile ${threat.strength.toFixed(0)}: too weak to contest the blockade`);
      continue;
    }
    issueMove(t, cand[0].x, cand[0].zone, 'escort', `break the blockade of ${b.name}: a friendly ship in sea zone ${cand[0].zone} restores port trade and shipyard launches`, DAY);
  }
}

/** Embark carrier-qualified air wings and station carriers with a wing off the focus coast. */
function carriers(t: Turn, a: Analysis, ships: StackView[]): void {
  const v = t.view, g = t.geo;
  const decks = ships.filter((s) => isCarrierGroup(t, s));
  if (!decks.length) return;
  const air = v.stacks.filter((s) => s.moveClass === 'air' && s.air);
  for (const cv of decks) {
    if (t.full) return;
    const deck = carrierDeck(t.ix, cv);
    const wing = air.filter((s) => 'stack' in s.air!.home && (s.air!.home as { stack: string }).stack === cv.id);
    const used = wing.reduce((n, s) => n + s.units.length, 0);
    const at = nodeOf(cv);
    // 1. embark: landed land-based aircraft that the carrier can operate
    if (at !== null && used < deck.slots) {
      const cand = air
        .filter((s) => s.air!.state === 'landed' && !s.air!.grounded && 'node' in s.air!.home && s.units.length <= deck.slots - used && carrierEligible(t.ix, s, deck.families))
        .map((s) => ({ s, d: km(g, (s.air!.home as { node: NodeId }).node, at) }))
        .filter((x) => x.d <= 1200)
        .sort((x, y) => x.d - y.d || (x.s.id < y.s.id ? -1 : 1));
      for (const x of cand.slice(0, 1)) {
        if (t.movedStacks.has(x.s.id)) continue;
        if (t.add({ type: 'rebase', country: t.me, stack: x.s.id, base: { stack: cv.id } }, 'operational', 'carrier_embark', `embark carrier-qualified ${x.s.name} on ${cv.name} (${deck.slots - used} free deck slot(s))`)) t.movedStacks.add(x.s.id);
      }
    }
    // 2. station at war with a wing aboard
    if (!a.enemies.length || !wing.length || !freeShip(t, cv) || t.pathLeft <= 0) continue;
    const focus = a.cities.filter((c) => c.threat > 0 && c.port).sort((x, y) => y.threat - x.threat)[0]?.node ?? (t.mem.objective?.node ?? null);
    if (focus === null) continue;
    let zone: NodeId | null = null, bd = 1e9;
    for (const n of g.coast[focus]) if (!g.isLand[n]) { const d = km(g, n, focus); if (d < bd) { bd = d; zone = n; } }
    if (zone === null) {
      for (let n = 0; n < g.n; n++) if (!g.isLand[n] && g.sea[n].length) { const d = km(g, n, focus); if (d < bd) { bd = d; zone = n; } }
      if (bd > 700) zone = null;
    }
    if (zone === null || at === zone || orderDest(cv) === zone) continue;
    const threat = seaThreat(t, a, zone, t.ix.avgNaval);
    const own = ships.filter((s) => s.id !== cv.id && nodeOf(s) !== null && km(g, nodeOf(s)!, zone!) <= 800).reduce((s, x) => s + stackNavalPower(t.ix, x), 0) + stackNavalPower(t.ix, cv);
    if (own < threat.strength * 2) {
      t.note('operational', 'carrier_held', `${cv.name}`, `no sea superiority off node ${focus}: own ${own.toFixed(0)} vs ${threat.strength.toFixed(0)}`);
      continue;
    }
    issueMove(t, cv, zone, 'carrier_station', `station ${cv.name} with ${wing.length} air wing(s) off node ${focus} (sea superiority ${(own / Math.max(1, threat.strength)).toFixed(2)})`, 2 * DAY);
  }
}

function housekeeping(t: Turn, a: Analysis, ships: StackView[]): void {
  if (a.enemies.length) return;
  const g = t.geo;
  const homes = t.view.cities.filter((c) => c.port);
  for (const s of ships) {
    if (t.full || t.pathLeft <= 0) return;
    if (!freeShip(t, s)) continue;
    const at = (s.pos as { node: NodeId }).node;
    if (g.isLand[at]) continue;
    // an escort stays while a convoy is still at sea nearby
    if (t.view.stacks.some((x) => x.moveClass === 'ground' && x.mode === 'embarked' && nodeOf(x) !== null && km(g, nodeOf(x)!, at) < 400)) continue;
    const home = [...homes].sort((x, y) => km(g, at, x.node) - km(g, at, y.node) || (x.key < y.key ? -1 : 1))[0];
    if (home && km(g, at, home.node) > 600) issueMove(t, s, home.node, 'naval_return', 'return to a home port', 3 * DAY);
  }
}

export function navalReview(t: Turn, a: Analysis): void {
  if (t.mem.geography === 'landlocked') return; // never issue naval orders without a coast
  const ships = t.view.stacks.filter((s) => s.moveClass === 'naval');
  if (!ships.length) return;
  escorts(t, a, ships);
  breakBlockade(t, a, ships);
  carriers(t, a, ships);
  blockade(t, a, ships);
  housekeeping(t, a, ships);
}
export type { CountryId };
