/**
 * Peace settlements: war assessment, proportional terms (territory + resources) and multi-round
 * haggling. Inputs are public / own-view only: ownership (`view.owners`), static homelands and VP
 * (`geo`), public power estimates (`Analysis.power`), own stock and surplus, own memory.
 *
 * Advantage `adv` ∈ [−1, 1] = 0.55 × tanh(territory balance / scale) + 0.45 × tanh(ln power ratio)
 *   − 0.2 if our capital is threatened beyond its garrison − 0.2 per capital lost.
 * Terms for an effective advantage e = adv × (1 − concession):
 *   e ≥ 0.25 (winning): peace + they cede k provinces they hold next to our territory (our own lost
 *     homeland first, then their lowest-value border provinces; never their capital), k = 1/2/3 at
 *     e ≥ 0.25/0.45/0.7, + reparations ≈ (e × 1,000 + 100 × k) money, capped at 2,500;
 *   e ≤ −0.25 (losing): peace + we pay ≈ −e × 1,000 money from our spare money, and at e ≤ −0.55 we
 *     return / cede one low-value border province they border (occupied land of theirs first);
 *   otherwise: plain peace (status quo).
 * Haggling: a peace offer we would decline is answered with a counter-offer while rounds remain
 * (engine limit `rules.PEACE.maxRounds`); each of our counters concedes 25 % more (concession =
 * 0.25 × (round − 1)). The last round is accept-or-decline. Every step carries a logged reason.
 */
import type { CountryId, NodeId, Resource } from '../engine/data-types';
import type { Offer, OfferTerm } from '../engine/state';
import type { Turn } from './turn';
import type { Analysis } from './analysis';

export interface WarSituation {
  enemy: CountryId;
  adv: number;
  heldVp: number;
  lostVp: number;
  ratio: number;
  /** Enemy homeland nodes we hold / our homeland nodes they hold. */
  held: NodeId[];
  lost: NodeId[];
}

export interface PeaceTerms {
  give: OfferTerm[];
  receive: OfferTerm[];
  territory: { give: NodeId[]; receive: NodeId[] };
  summary: string;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function maxRounds(t: Turn): number {
  return (t.view.rules as { PEACE?: { maxRounds: number } }).PEACE?.maxRounds ?? 4;
}

export function warSituation(t: Turn, a: Analysis, enemy: CountryId): WarSituation {
  const v = t.view, g = t.geo;
  let heldVp = 0, lostVp = 0;
  const held: NodeId[] = [], lost: NodeId[] = [];
  for (const n of g.countryNodes.get(enemy) ?? []) if (v.owners[n] === t.me) { heldVp += g.vp[n]; held.push(n); }
  for (const n of g.countryNodes.get(t.me) ?? []) if (v.owners[n] === enemy) { lostVp += g.vp[n]; lost.push(n); }
  const ratio = a.myPower / Math.max(1, a.power(enemy));
  const scale = Math.max(4, 0.15 * Math.min(a.homelandVp(t.me), a.homelandVp(enemy)));
  const capThreat = a.cities.some((c) => c.capital && c.threat > c.present) ? 0.2 : 0;
  const adv = clamp(0.55 * Math.tanh((heldVp - lostVp) / scale) + 0.45 * Math.tanh(Math.log(Math.max(0.05, ratio))) - capThreat - 0.2 * t.mem.capitalsLost, -1, 1);
  return { enemy, adv: Math.round(adv * 1000) / 1000, heldVp, lostVp, ratio, held, lost };
}

function capitalNodeOf(t: Turn, c: CountryId): NodeId | null {
  const pc = t.view.publicCities.find((x) => x.capital && x.owner === c && x.homeland === c);
  return pc ? pc.node : t.geo.capitals.get(c) ?? null;
}

/** Provinces `holder` owns that touch `other`'s territory, ordered by preference for a cession. */
function borderNodes(t: Turn, holder: CountryId, other: CountryId, preferHomelandOf: CountryId | null): NodeId[] {
  const v = t.view, g = t.geo;
  const cap = capitalNodeOf(t, holder);
  const out: NodeId[] = [];
  for (let n = 0; n < g.n; n++) {
    if (v.owners[n] !== holder || !g.isLand[n] || g.outside[n] || n === cap) continue;
    if (g.land[n].some((y) => v.owners[y] === other)) out.push(n);
  }
  return out.sort((x, y) => Number(g.homeland[y] === preferHomelandOf) - Number(g.homeland[x] === preferHomelandOf) || g.vp[x] - g.vp[y] || x - y);
}

function money(amountWhole: number): OfferTerm {
  return { kind: 'resource', resource: 'money' as Resource, amount: Math.max(100, Math.round(amountWhole / 100) * 100) * 1000 };
}

/** Our preferred settlement with `enemy` (concession ∈ [0, 1] moves the terms toward the status quo). */
export function peaceTerms(t: Turn, a: Analysis, enemy: CountryId, concession = 0): PeaceTerms {
  const ws = warSituation(t, a, enemy);
  const e = ws.adv * (1 - clamp(concession, 0, 1));
  const give: OfferTerm[] = [{ kind: 'peace' }];
  const receive: OfferTerm[] = [];
  const territory = { give: [] as NodeId[], receive: [] as NodeId[] };
  const parts: string[] = [];
  if (e >= 0.25) {
    const k = e >= 0.7 ? 3 : e >= 0.45 ? 2 : 1;
    const theirs = borderNodes(t, enemy, t.me, t.me);
    // never ask for everything they hold
    const own = t.view.owners.reduce((s, o) => s + (o === enemy ? 1 : 0), 0);
    territory.receive = theirs.slice(0, Math.min(k, Math.max(0, own - 1)));
    const rep = Math.min(2500, e * 1000 + 100 * k);
    receive.push(money(rep));
    parts.push(`we hold the advantage (${e.toFixed(2)}): ${territory.receive.length} border province(s) and ${Math.round(rep / 100) * 100} money in reparations`);
  } else if (e <= -0.25) {
    const spare = Math.max(0, t.budget.money - t.reserve.money * 2);
    const pay = Math.min(spare / 1000, -e * 1000);
    if (pay >= 100) {
      give.push(money(pay));
      parts.push(`we are losing (${e.toFixed(2)}): ${Math.round(pay / 100) * 100} money`);
    } else parts.push(`we are losing (${e.toFixed(2)})`);
    if (e <= -0.55) {
      const mine = borderNodes(t, t.me, enemy, enemy);
      if (mine.length && a.myNodes.length > 1) {
        territory.give = [mine[0]];
        parts.push('one border province ceded');
      }
    }
  } else parts.push(`status quo peace (balance ${e.toFixed(2)})`);
  return { give, receive, territory, summary: parts.join('; ') };
}

/** Value (to us) of the territory clauses of an offer `from` sent us. */
export function territoryValue(t: Turn, o: Pick<Offer, 'territory'>): { v: number; gets: string[]; costs: string[]; worst: { v: number; label: string } } {
  const g = t.geo;
  let v = 0;
  const gets: string[] = [], costs: string[] = [];
  let worst = { v: 0, label: '' };
  const name = (n: NodeId) => t.view.publicCities.find((c) => c.node === n)?.name ?? `province ${n}`;
  for (const n of o.territory?.give ?? []) {
    const x = g.vp[n] * 6 + (g.homeland[n] === t.me ? 10 : 2);
    v += x;
    gets.push(`${name(n)}${g.homeland[n] === t.me ? ' (our homeland back)' : ''}`);
  }
  for (const n of o.territory?.receive ?? []) {
    const city = g.cityByNode.get(n);
    const x = -(g.vp[n] * 9 + (g.homeland[n] === t.me ? 12 : 4) + (city ? city.tier * 4 : 0));
    v += x;
    const label = `ceding ${name(n)}`;
    costs.push(label);
    if (x < worst.v) worst = { v: x, label };
  }
  return { v, gets, costs, worst };
}

/** Do the two term sets differ (so a counter actually moves the negotiation)? */
export function sameTerms(a: PeaceTerms, o: Offer): boolean {
  const key = (l: OfferTerm[]) => l.map((x) => JSON.stringify(x)).sort().join('|');
  // our terms are written from our side; the incoming offer from theirs
  return key(a.give) === key(o.receive) && key(a.receive) === key(o.give) && [...a.territory.give].sort().join() === [...(o.territory?.receive ?? [])].sort().join() && [...a.territory.receive].sort().join() === [...(o.territory?.give ?? [])].sort().join();
}
