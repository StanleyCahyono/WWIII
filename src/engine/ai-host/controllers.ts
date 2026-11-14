/**
 * Built-in controllers for tests and as a safe default. The real planner lives in src/ai/.
 *  - IdleController: issues nothing.
 *  - BasicController: a deterministic, view-only rules bot that researches, builds, mobilizes,
 *    answers offers, proposes passage, declares war on a weak neighbour and marches to capture.
 */
import type { NodeId } from '../data-types';
import type { Command } from '../commands/types';
import type { CountryController, PlannerContext } from './types';
import type { CountryView } from '../view/country-view';

export const IdleController: CountryController = { decide: () => [] };

interface BasicMemory {
  target: string | null;
  lastWarDay: number;
  proposed: string[];
}

function neighbours(view: CountryView, map: PlannerContext['map']): Map<string, number> {
  const adj = new Map<string, number>();
  const owners = view.owners;
  for (const e of map.edges) {
    if (e.kind !== 'land' && e.kind !== 'strait') continue;
    const oa = owners[e.a], ob = owners[e.b];
    if (oa === view.viewer && ob && ob !== view.viewer) adj.set(ob, (adj.get(ob) ?? 0) + 1);
    if (ob === view.viewer && oa && oa !== view.viewer) adj.set(oa, (adj.get(oa) ?? 0) + 1);
  }
  return adj;
}

function nearestEnemyNode(view: CountryView, map: PlannerContext['map'], from: NodeId, enemies: Set<string>): NodeId | null {
  const adj: number[][] = Array.from({ length: map.nodes.length }, () => []);
  for (const e of map.edges) {
    if (e.kind !== 'land' && e.kind !== 'strait') continue;
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const seen = new Set<number>([from]);
  let frontier = [from];
  for (let d = 0; d < 40 && frontier.length; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      for (const nb of adj[n].sort((a, b) => a - b)) {
        if (seen.has(nb) || map.nodes[nb].outside) continue;
        seen.add(nb);
        const o = view.owners[nb];
        if ((o && enemies.has(o)) || view.rebelNodes.includes(nb)) return nb;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

export const BasicController: CountryController = {
  decide(view, ctx) {
    const out: Command[] = [];
    const me = view.viewer;
    const mem: BasicMemory = (ctx.memory as BasicMemory) ?? { target: null, lastWarDay: -99, proposed: [] };
    const add = (c: Command) => {
      if (out.length < ctx.budget && ctx.preview(c).ok) out.push(c);
    };
    const cat = ctx.catalog;
    const cities = view.cities;
    const capital = cities.find((c) => c.key === view.self.capitalCity) ?? cities[0];

    // diplomacy: answer offers
    for (const o of view.offers) {
      if (o.status !== 'pending' || o.to !== me) continue;
      const rel = view.relations.find((r) => r.country === o.from);
      const peace = o.give.some((t) => t.kind === 'peace') || o.receive.some((t) => t.kind === 'peace');
      const accept = peace ? view.self.force.ready < 1000 || (rel?.trust ?? 0) > -60 : (rel?.trust ?? 0) >= -5;
      out.push({ type: 'respondOffer', country: me, offer: o.id, accept, reason: accept ? 'terms acceptable given our relationship' : 'insufficient trust after recent incidents' });
    }

    if (ctx.reviews.includes('economic') && capital) {
      // research cheapest available tech
      const techs = [...cat.techs].sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : 1));
      for (const t of techs) {
        if (view.self.research.length >= view.self.researchSlots) break;
        if (view.self.techs.includes(t.id)) continue;
        add({ type: 'startResearch', country: me, tech: t.id, reason: 'cheapest available node' });
        if (out.length && out[out.length - 1].type === 'startResearch') break;
      }
      // mobilize a capture-capable unit
      const inf = cat.units.filter((u) => u.capture && (!u.unlockTech || view.self.techs.includes(u.unlockTech))).sort((a, b) => (a.cost.money ?? 0) - (b.cost.money ?? 0));
      const home = cities.filter((c) => view.provinces.find((p) => p.node === c.node)?.status !== 'occupied');
      if (inf.length && view.self.jobs.filter((j) => j.kind === 'mobilize').length < Math.max(1, Math.floor(home.length / 2))) {
        for (const u of inf) {
          const target = home.find((c) => !view.self.jobs.some((j) => j.city === c.key && j.kind === 'mobilize'));
          if (!target) break;
          const before = out.length;
          add({ type: 'mobilize', country: me, unit: u.id, cities: [target.key], reason: 'expand ground forces' });
          if (out.length > before) break;
        }
      }
      // build the cheapest useful city building in the capital
      const bld = cat.buildings.filter((b) => b.scope === 'city' && (!b.unlockTech || view.self.techs.includes(b.unlockTech))).sort((a, b) => (a.levels[0].cost.money ?? 0) - (b.levels[0].cost.money ?? 0));
      if (view.self.stock.money > 3000_000 && !view.self.jobs.some((j) => j.kind === 'construct')) {
        for (const b of bld) {
          const before = out.length;
          add({ type: 'build', country: me, building: b.id, targets: [capital.key], reason: 'invest in capital' });
          if (out.length > before) break;
        }
      }
      // annex occupied cities
      for (const c of cities) {
        const p = view.provinces.find((x) => x.node === c.node);
        if (p?.status === 'occupied') add({ type: 'annex', country: me, city: c.key, reason: 'enable mobilization' });
      }
    }

    const nb = neighbours(view, ctx.map);
    const atWar = new Set(view.relations.filter((r) => r.war && r.alive).map((r) => r.country));

    if (ctx.reviews.includes('diplomatic')) {
      for (const [c] of [...nb.entries()].sort()) {
        if (atWar.has(c) || mem.proposed.includes(c)) continue;
        const r = view.relations.find((x) => x.country === c);
        if (!r || r.myStatusToThem !== 'peace' || r.pendingOffers.length) continue;
        add({ type: 'proposeOffer', country: me, to: c, give: [{ kind: 'status', level: 'right_of_way' }], receive: [{ kind: 'status', level: 'right_of_way' }], reason: 'mutual passage with a neighbour', text: undefined });
        mem.proposed.push(c);
        break;
      }
    }

    if (ctx.reviews.includes('strategic') && !atWar.size && view.day >= 3 && view.day - mem.lastWarDay > 5) {
      const pers = view.self.personality.aggression ?? 0.5;
      if (pers >= 0.3) {
        const cands = [...nb.keys()].filter((c) => !view.relations.find((r) => r.country === c)?.sameCoalition).sort((a, b) => (view.scores.byCountry[a] ?? 0) - (view.scores.byCountry[b] ?? 0) || (a < b ? -1 : 1));
        const myScore = view.scores.byCountry[me] ?? 0;
        const t = cands.find((c) => (view.scores.byCountry[c] ?? 0) < myScore);
        if (t) {
          add({ type: 'declareWar', country: me, target: t, reason: 'weaker neighbour with exposed provinces' });
          mem.target = t;
          mem.lastWarDay = view.day;
        }
      }
    }

    if (ctx.reviews.includes('operational') || ctx.wake.length) {
      const enemies = new Set(atWar);
      for (const s of view.stacks) {
        if (out.length >= ctx.budget) break;
        if (s.moveClass !== 'ground' || s.order || s.pos.kind !== 'node') continue;
        if (!enemies.size && !view.rebelNodes.length) continue;
        const dest = nearestEnemyNode(view, ctx.map, s.pos.node, enemies);
        if (dest === null) continue;
        add({ type: 'move', country: me, stack: s.id, dest, reason: 'advance on nearest hostile province' });
      }
    }
    ctx.setMemory(mem);
    return out;
  },
};
