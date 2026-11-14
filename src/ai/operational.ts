/**
 * Operational review (every ~2 game hours and on wake triggers): defend threatened cities, march
 * toward objectives with force-ratio estimates from OBSERVED (possibly stale) contacts only,
 * naval and air usage (sea patrols/strikes, air patrols over threatened cities or fronts, rebase),
 * missile launches valued vs alternatives, and intel purchases when uncertainty is high.
 * Route previews (A*) are bounded per review by difficulty; stack tasks have commitment windows
 * so stacks never oscillate between adjacent objectives or re-issue identical orders.
 */
import type { CountryId, NodeId } from '../engine/data-types';
import type { StackView } from '../engine/view/country-view';
import type { Turn } from './turn';
import { defenceAt, type Analysis } from './analysis';
import { km, landBfs } from './geo';
import { canCapture, stackAirPower, stackGroundPower } from './value';
import { DAY, HOUR, heldByTask, idleGround, issueMove, orderDest } from './orders';
import { allianceDefence, callForHelp } from './alliance';
import { navalReview } from './naval';
import { airmobileReinforce } from './airmobile';

function defend(t: Turn, a: Analysis, stacks: StackView[]): void {
  // cities short of their requirement, capital first
  const short = a.cities.filter((c) => c.present < c.required && (c.threat > 0 || c.capital)).sort((x, y) => Number(y.capital) - Number(x.capital) || y.threat - x.threat || y.vp - x.vp);
  if (!short.length) return;
  const g = t.geo;
  const pass = (n: NodeId) => t.view.owners[n] === t.me || !!t.rel.get(t.view.owners[n] ?? '')?.sameCoalition;
  for (const c of short.slice(0, 2)) {
    if (t.full || t.pathLeft <= 0) return;
    const d = landBfs(g, [c.node], 6, pass);
    const avail = stacks
      .filter((s) => s.pos.kind === 'node' && !t.movedStacks.has(s.id) && d[(s.pos as { node: NodeId }).node] > 0 && orderDest(s) !== c.node)
      .filter((s) => {
        const at = a.cityAt.get((s.pos as { node: NodeId }).node);
        // do not strip another city below its own requirement (unless defending the capital)
        return !at || c.capital || at.present - stackGroundPower(t.ix, s) >= at.required;
      })
      .sort((x, y) => d[(x.pos as { node: NodeId }).node] - d[(y.pos as { node: NodeId }).node] || (x.id < y.id ? -1 : 1));
    let need = c.required - c.present;
    // short-notice help by helicopter first when land reinforcements are far away or cut off
    need -= airmobileReinforce(t, a, stacks, c, need, d);
    for (const s of avail.slice(0, 3)) {
      if (need <= 0 || t.full) break;
      const reason = c.threat > 0 ? `defend ${c.capital ? 'capital' : 'city'} ${c.key}: observed hostile strength ${c.threat.toFixed(0)} vs ${c.present.toFixed(0)}` : `garrison capital ${c.key}`;
      if (issueMove(t, s, c.node, 'defend', reason, 18 * HOUR)) need -= stackGroundPower(t.ix, s);
    }
  }
}

function attackTargets(t: Turn, a: Analysis): { node: NodeId; value: number; owner: CountryId | null }[] {
  const v = t.view, g = t.geo;
  const enemies = new Set(a.enemies);
  const obj = t.mem.objective;
  const out: { node: NodeId; value: number; owner: CountryId | null }[] = [];
  for (const n of v.rebelNodes) if (a.hops[n] >= 0 && a.hops[n] <= 4) out.push({ node: n, value: g.vp[n] * 1.2 / (1 + a.hops[n]), owner: null });
  if (!enemies.size) return out;
  for (let n = 0; n < g.n; n++) {
    const o = v.owners[n];
    if (!o || !enemies.has(o)) continue;
    const h = a.hops[n];
    if (h < 0 || h > 6) continue;
    const objBonus = obj?.target === o ? 1.5 : 1;
    out.push({ node: n, value: (g.vp[n] * objBonus) / (1 + h * 0.7), owner: o });
  }
  out.sort((x, y) => y.value - x.value || x.node - y.node);
  return out.slice(0, 12);
}

function offence(t: Turn, a: Analysis, stacks: StackView[]): void {
  if (t.mem.plan.stance === 'defend' && !t.view.rebelNodes.length) return;
  const targets = attackTargets(t, a);
  if (!targets.length) return;
  // free stacks: capture-capable, idle, not needed as garrison
  const free = stacks.filter((s) => {
    if (t.movedStacks.has(s.id) || !canCapture(t.ix, s) || !idleGround(s)) return false;
    if (heldByTask(t, s)) return false;
    const at = a.cityAt.get((s.pos as { node: NodeId }).node);
    return !at || at.present - stackGroundPower(t.ix, s) >= at.required * 0.9;
  });
  if (!free.length) return;
  const g = t.geo;
  let held = 0;
  let launched = 0;
  for (const tg of targets) {
    if (t.full || t.pathLeft <= 0 || !free.length) break;
    const def = defenceAt(t, a, tg.node);
    // nearest free stacks to the target (straight-line), accumulate power until the ratio is met
    free.sort((x, y) => km(g, (x.pos as { node: NodeId }).node, tg.node) - km(g, (y.pos as { node: NodeId }).node, tg.node) || (x.id < y.id ? -1 : 1));
    let power = 0;
    const group: StackView[] = [];
    for (const s of free) {
      if (km(g, (s.pos as { node: NodeId }).node, tg.node) > 1400) break;
      group.push(s);
      power += stackGroundPower(t.ix, s);
      if (power >= def.strength * t.diff.attackRatio) break;
    }
    if (!group.length || power < def.strength * t.diff.attackRatio) {
      if (!held++) t.note('operational', 'attack_held', `node ${tg.node}`, `force ratio ${(power / Math.max(1, def.strength)).toFixed(2)} below ${t.diff.attackRatio} (${def.observed ? `observed ${Math.round(def.age / 60)} h ago` : 'unobserved, prior estimate'})`);
      continue;
    }
    // concentrate co-located stacks first (normal/hard)
    if (t.diff.concentrate) {
      const byNode = new Map<NodeId, StackView[]>();
      for (const s of group) { const n = (s.pos as { node: NodeId }).node; (byNode.get(n) ?? byNode.set(n, []).get(n)!).push(s); }
      for (const [, list] of byNode) if (list.length > 1 && list.reduce((x, s) => x + s.units.length, 0) <= 10) {
        if (t.add({ type: 'merge', country: t.me, stacks: list.map((s) => s.id) }, 'operational', 'concentrate', `concentrate ${list.length} formations before attacking node ${tg.node}`)) {
          for (const s of list.slice(1)) { const i = group.indexOf(s); if (i >= 0) group.splice(i, 1); const j = free.indexOf(s); if (j >= 0) free.splice(j, 1); t.movedStacks.add(s.id); }
        }
      }
    }
    let moved = 0;
    for (const s of group) {
      const reason = `${tg.owner ? `attack ${tg.owner}` : 'retake rebel'} node ${tg.node} (VP ${g.vp[tg.node]}): ratio ${(power / Math.max(1, def.strength)).toFixed(2)}${def.observed ? `, observation ${Math.round(def.age / 60)} h old` : ', unobserved (prior)'}`;
      if (issueMove(t, s, tg.node, 'attack', reason)) { moved++; const i = free.indexOf(s); if (i >= 0) free.splice(i, 1); }
      if (t.pathLeft <= 0) break;
    }
    if (moved) launched++;
  }
  // nothing attackable yet: bring reserves to the front facing the enemy (concentration)
  if (!launched && free.length && a.enemies.length && t.pathLeft > 0) {
    const tgt = targets[0].node;
    let best: NodeId | null = null, bd = 1e9;
    for (const n of a.frontier) { const d = km(g, n, tgt); if (d < bd) { bd = d; best = n; } }
    if (best !== null) {
      free.sort((x, y) => km(g, (y.pos as { node: NodeId }).node, best!) - km(g, (x.pos as { node: NodeId }).node, best!) || (x.id < y.id ? -1 : 1));
      for (const s of free.slice(0, 2)) if ((s.pos as { node: NodeId }).node !== best && km(g, (s.pos as { node: NodeId }).node, best) > 50) issueMove(t, s, best, 'stage', `concentrate at the front facing node ${tgt} (attack held: insufficient local ratio)`, DAY);
    }
  }
}

function staging(t: Turn, a: Analysis, stacks: StackView[]): void {
  // in peace with an expansion objective: stage spare forces at the frontier facing the objective
  const o = t.mem.objective;
  if (!o || o.node === null || a.enemies.length || t.mem.plan.stance !== 'expand') return;
  const g = t.geo;
  let best: NodeId | null = null, bd = 1e9;
  for (const n of a.frontier) {
    const d = km(g, n, o.node);
    if (d < bd) { bd = d; best = n; }
  }
  if (best === null) return;
  const spare = stacks.filter((s) => canCapture(t.ix, s) && idleGround(s) && !t.movedStacks.has(s.id) && !t.mem.tasks[s.id] && (() => {
    const at = a.cityAt.get((s.pos as { node: NodeId }).node);
    return !at || at.present - stackGroundPower(t.ix, s) >= at.required;
  })());
  for (const s of spare.slice(0, 1)) issueMove(t, s, best, 'stage', `stage at frontier facing objective ${o.target}`, DAY);
}

function air(t: Turn, a: Analysis): void {
  const v = t.view, g = t.geo;
  const planes = v.stacks.filter((s) => s.moveClass === 'air' && s.air && s.air.state === 'landed' && !s.air.grounded && !t.movedStacks.has(s.id) && stackAirPower(t.ix, s) > 0);
  if (!planes.length) return;
  const threatened = a.cities.filter((c) => c.threat > 0).sort((x, y) => y.threat - x.threat);
  const front = Object.values(t.mem.tasks).filter((x) => x.kind === 'attack').map((x) => x.dest);
  const rebasedTo = new Set<NodeId>();
  for (const s of planes.slice(0, 2)) {
    if (t.full) return;
    const base = 'node' in (s.air!.home) ? (s.air!.home as { node: NodeId }).node : null;
    const ll = s.lonlat;
    const focus: NodeId | null = threatened[0]?.node ?? front[0] ?? null;
    if (focus === null) continue;
    const d = base !== null ? km(g, base, focus) : 1e9;
    const r = t.add({ type: 'patrol', country: t.me, stack: s.id, center: focus }, 'operational', 'air_patrol', threatened.length ? `cover threatened city at node ${focus}` : `support attack at node ${focus}`);
    if (!r && base !== null && d > 300) {
      // out of range: rebase to the own city nearest the focus
      // one rebase per airfield per batch: previews run against the pre-batch slot usage
      const cand = v.cities.filter((c) => c.node !== base && !rebasedTo.has(c.node)).sort((x, y) => km(g, x.node, focus) - km(g, y.node, focus) || (x.key < y.key ? -1 : 1))[0];
      if (cand && t.add({ type: 'rebase', country: t.me, stack: s.id, base: { node: cand.node } }, 'operational', 'air_rebase', `rebase closer to the front (${Math.round(km(g, cand.node, focus))} km)`)) {
        rebasedTo.add(cand.node);
        t.movedStacks.add(s.id);
      }
    }
    void ll;
  }
}

function missiles(t: Turn, a: Analysis): void {
  if (!a.enemies.length) return;
  const v = t.view, g = t.geo;
  for (const [id, inv] of Object.entries(v.self.missiles).sort()) {
    if (t.full || inv.ready < 1) continue;
    const mt = t.ix.missileById.get(id);
    if (!mt) continue;
    // launch sites: own cities with a missile complex
    const sites = v.cities.filter((c) => c.buildings.some((b) => (t.ix.buildingById.get(b.type)?.levels.find((l) => l.level === b.level)?.effects.missileSlots ?? 0) > 0));
    if (!sites.length) continue;
    let best: { site: NodeId; target: NodeId; value: number } | null = null;
    for (const pc of v.publicCities) {
      if (!pc.owner || !a.enemies.includes(pc.owner)) continue;
      for (const s of sites) {
        const d = km(g, s.node, pc.node);
        if (d > mt.rangeKm) continue;
        const observed = v.contacts.filter((c) => c.node === pc.node && c.owner && a.enemies.includes(c.owner)).length;
        const value = (g.vp[pc.node] * 0.15 + observed * 2 + (t.mem.objective?.node === pc.node ? 3 : 0)) * (mt.outcomes.arrived_effect + mt.outcomes.arrived_limited * 0.5);
        if (!best || value > best.value) best = { site: s.node, target: pc.node, value };
      }
    }
    // value vs alternative: holding the round for a better target later (threshold)
    if (best && best.value >= 1.5) {
      t.add({ type: 'launchMissile', country: t.me, missile: id, from: { node: best.site }, target: best.target, confirmActOfWar: [] }, 'operational', 'missile_launch', `expected value ${best.value.toFixed(1)} pts at node ${best.target} exceeds holding threshold 1.5`);
    }
  }
}

function intel(t: Turn, a: Analysis): void {
  if (!t.diff.intel) return;
  const o = t.mem.objective;
  if (!o || !o.target || o.node === null) return;
  if (!(a.enemies.includes(o.target) || t.mem.plan.stance === 'expand')) return;
  const pending = t.mem.intel.find((i) => i.node === o.node && t.now - i.at < DAY);
  if (pending) {
    // findings arrived → update the plan
    const rep = t.view.reports.find((r) => r.targetNode === o.node && r.observedAt >= pending.at);
    if (rep && !pending.reportSeen) {
      pending.reportSeen = true;
      const d = defenceAt(t, a, o.node);
      o.observedAt = rep.observedAt;
      const ratio = (a.myGround * 0.6) / Math.max(1, d.strength);
      if (ratio < t.diff.attackRatio) {
        o.commitUntil = 0; // re-plan on the next strategic pass
        t.mem.lastStrategic = -1e9;
        t.note('operational', 'plan_update', `objective ${o.target} node ${o.node}`, `intel report shows defence ${d.strength.toFixed(0)} (ratio ${ratio.toFixed(2)}): re-plan`);
      } else {
        o.value *= 1.1;
        t.note('operational', 'plan_update', `objective ${o.target} node ${o.node}`, `intel report confirms weak defence ${d.strength.toFixed(0)} (ratio ${ratio.toFixed(2)}): commit`);
      }
    }
    return;
  }
  const d = defenceAt(t, a, o.node);
  const fresh = d.observed && d.age < 12 * HOUR;
  if (fresh) return;
  const money = t.budget.money - t.reserve.money;
  if (money < 3000_000) return;
  const r = t.add({ type: 'buyIntelReport', country: t.me, node: o.node }, 'operational', 'intel_purchase', `uncertainty about ${o.target} defences at node ${o.node} (${d.observed ? `last seen ${Math.round(d.age / 60)} h ago` : 'never observed'})`);
  if (r) t.mem.intel.push({ node: o.node, country: o.target, at: t.now });
  // agents for persistent coverage of an enemy capital
  if (a.enemies.includes(o.target) && t.view.agents.filter((x) => x.active).length < 1 && money > 8000_000) {
    const cap = t.view.publicCities.find((c) => c.owner === o.target && c.capital);
    if (cap) t.add({ type: 'assignAgent', country: t.me, city: cap.key, mission: 'information' }, 'operational', 'intel_agent', `persistent information on ${o.target} capital`);
  }
}

export function operationalReview(t: Turn, a: Analysis): void {
  const ground = t.view.stacks.filter((s) => s.moveClass === 'ground');
  defend(t, a, ground);
  callForHelp(t, a);
  allianceDefence(t, a, ground);
  offence(t, a, ground);
  staging(t, a, ground);
  navalReview(t, a);
  air(t, a);
  missiles(t, a);
  intel(t, a);
}

/**
 * Peace-time review riding on the economic review (no extra wake-ups): mutual defence of
 * coalition partners (their wars do not wake us), frontier staging, fleet/carrier housekeeping.
 */
export function stagingOnly(t: Turn, a: Analysis): void {
  const ground = t.view.stacks.filter((s) => s.moveClass === 'ground');
  allianceDefence(t, a, ground);
  staging(t, a, ground);
  navalReview(t, a);
}
