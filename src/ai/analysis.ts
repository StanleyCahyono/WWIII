/**
 * Situational analysis derived from the filtered CountryView only: own territory, frontier,
 * neighbours, observed hostile contacts (possibly stale), threats per own city and power
 * estimates of rivals from PUBLIC data (opening power table, public scores, observations).
 */
import type { CountryId, NodeId } from '../engine/data-types';
import type { ContactView } from '../engine/view/country-view';
import { km, landBfs } from './geo';
import { contactStrength, groundPower, stackGroundPower } from './value';
import type { Turn } from './turn';

export interface CityInfo {
  key: string;
  node: NodeId;
  tier: number;
  capital: boolean;
  port: boolean;
  status: string;
  vp: number;
  /** Observed hostile ground strength within ~2 hops / 300 km. */
  threat: number;
  /** Own ground strength at the node. */
  present: number;
  required: number;
}

export interface Analysis {
  myNodes: NodeId[];
  capitalNode: NodeId | null;
  cities: CityInfo[];
  /** Land-neighbour countries of current territory → shared border edges. */
  neighbours: Map<CountryId, number>;
  frontier: NodeId[];
  hostile: ContactView[];
  myGround: number;
  myStacksGround: number;
  /** Rough national power of any country (public priors + observations). */
  power: (c: CountryId) => number;
  myPower: number;
  enemies: CountryId[];
  homelandVp: (c: CountryId) => number;
  ports: number;
  small: boolean;
  /** Hop distance from own territory over land (−1 = beyond horizon). */
  hops: Int16Array;
}

const hopCache = new WeakMap<readonly (string | null)[], Map<string, Int16Array>>();

export function analyse(t: Turn): Analysis {
  const v = t.view, g = t.geo, me = t.me, ix = t.ix;
  const myNodes: NodeId[] = v.provinces.map((p) => p.node);
  const enemies = t.atWarWith();
  const enemySet = new Set(enemies);
  const hostile = v.contacts.filter((c) => (c.owner ? enemySet.has(c.owner) : enemies.length > 0 && c.node !== null && v.owners[c.node] === me));
  // frontier and neighbours
  const neighbours = new Map<CountryId, number>();
  const frontier: NodeId[] = [];
  for (const n of myNodes) {
    let f = false;
    for (const y of g.land[n]) {
      const o = v.owners[y];
      if (o !== me) {
        f = true;
        if (o) neighbours.set(o, (neighbours.get(o) ?? 0) + 1);
      }
    }
    if (f) frontier.push(n);
  }
  // hop distances from own territory (cached by owners-array identity: content-identical ⇒ same result)
  let hc = hopCache.get(v.owners);
  if (!hc) { hc = new Map(); hopCache.set(v.owners, hc); }
  let hops = hc.get(me);
  if (!hops) {
    hops = landBfs(g, myNodes, 14, () => true);
    hc.set(me, hops);
  }
  // own strength per node
  const presentAt = new Map<NodeId, number>();
  let myGround = 0, myStacksGround = 0;
  for (const s of v.stacks) {
    if (s.moveClass !== 'ground') continue;
    const p = stackGroundPower(ix, s);
    myGround += p;
    myStacksGround++;
    if (s.pos.kind === 'node') presentAt.set(s.pos.node, (presentAt.get(s.pos.node) ?? 0) + p);
  }
  const capitalKey = v.self.capitalCity;
  let capitalNode: NodeId | null = null;
  const cities: CityInfo[] = [];
  const hostileNodes = hostile.filter((c) => c.node !== null);
  for (const c of v.cities) {
    const info = g.cityByNode.get(c.node);
    const capital = c.key === capitalKey || (info?.capital === true && info.country === me);
    if (c.key === capitalKey) capitalNode = c.node;
    let threat = 0;
    for (const h of hostileNodes) {
      const n = h.node as NodeId;
      if (n === c.node || km(g, n, c.node) <= 320) threat += contactStrength(ix, h);
    }
    const status = v.provinces.find((p) => p.node === c.node)?.status ?? 'homeland';
    const vp = g.vp[c.node];
    const base = ix.avgGround * (capital ? 2.2 : c.tier >= 3 ? 1.2 : 0.8);
    cities.push({ key: c.key, node: c.node, tier: c.tier, capital, port: c.port, status, vp, threat, present: presentAt.get(c.node) ?? 0, required: base + threat * 1.25 });
  }
  if (capitalNode === null && capitalKey) capitalNode = v.publicCities.find((p) => p.key === capitalKey)?.node ?? null;
  // power priors: opening composite × territorial trend (public score vs homeland VP)
  const op = v.openingPower;
  const scores = v.scores.byCountry;
  const hvCache = new Map<CountryId, number>();
  const homelandVp = (c: CountryId) => {
    let x = hvCache.get(c);
    if (x === undefined) {
      x = 0;
      for (const n of g.countryNodes.get(c) ?? []) x += g.vp[n];
      hvCache.set(c, x || 1);
      x = x || 1;
    }
    return x;
  };
  const power = (c: CountryId) => {
    const comp = op?.composite?.[c] ?? 30;
    const trend = Math.sqrt(Math.max(0.05, (scores[c] ?? homelandVp(c)) / homelandVp(c)));
    return Math.max(1, comp) * trend;
  };
  const myPower = power(me);
  const rank = op?.rank ? op.rank.indexOf(me) : -1;
  const small = myNodes.length <= 6 || (op?.composite?.[me] ?? 30) < 18 || (rank >= 0 && op!.rank.length > 40 && rank >= op!.rank.length * 0.6);
  return {
    myNodes,
    capitalNode,
    cities,
    neighbours,
    frontier,
    hostile,
    myGround,
    myStacksGround,
    power,
    myPower,
    enemies,
    homelandVp,
    ports: v.cities.filter((c) => c.port).length,
    small,
    hops,
  };
}

/** Estimated defending ground strength at a foreign node from observations (or a prior). */
export function defenceAt(t: Turn, a: Analysis, node: NodeId): { strength: number; observed: boolean; age: number } {
  const g = t.geo;
  let s = 0, observed = false, age = 1e9;
  for (const c of t.view.contacts) {
    if (c.node === null) continue;
    if (c.node !== node && !(g.land[node].includes(c.node) && km(g, node, c.node) < 120)) continue;
    if (c.owner === t.me) continue;
    const o = c.owner ?? t.view.owners[c.node];
    if (o && !a.enemies.includes(o)) continue;
    s += contactStrength(t.ix, c) * (c.node === node ? 1 : 0.4);
    observed = true;
    age = Math.min(age, c.ageMin);
  }
  // intel reports (frozen snapshots) for the node
  for (const r of t.view.reports) {
    if (r.expired || r.targetNode !== node) continue;
    observed = true;
    age = Math.min(age, t.now - r.observedAt);
    let rs = 0;
    for (const st of r.stacks) {
      if (!a.enemies.includes(st.owner)) continue;
      for (const u of st.units) {
        const ut = t.ix.units.get(u.type);
        rs += (ut ? groundPower(ut, 1) : t.ix.avgGround) * u.count;
      }
    }
    s = Math.max(s, rs);
  }
  if (!observed) {
    const ci = g.cityByNode.get(node);
    s = ci ? t.ix.avgGround * (1 + ci.tier * 0.6 + (ci.capital ? 1.5 : 0)) : t.ix.avgGround * 0.5;
  }
  return { strength: s, observed, age };
}
