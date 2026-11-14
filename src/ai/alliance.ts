/**
 * Mutual defence inside a coalition (signals: CountryView only — public cities/ownership,
 * contacts incl. coalition-shared ones, coalition roster, messages, own stacks and memory).
 *
 *  • Partner threat: a partner's capital or major core city with observed hostile ground strength
 *    nearby — contacts of countries publicly at war with the partner (`view.wars`), of our enemies,
 *    of the foe a partner named in a request, or unidentified formations INSIDE the partner's
 *    territory (half weight) — against the partner's (and our) forces present.
 *  • Commitment: a capable member (own capital not exposed, spare formations beyond every own city's
 *    garrison requirement, a land route through own/coalition/passage territory) sends a proportionate
 *    share of the deficit: its public power share among the other members, capped by loyalty
 *    (35–65 % of spare strength). Hopeless or low-value cases are declined with a logged reason.
 *  • Requests: a member whose capital is exposed asks the bloc (`request_operation`, reason carries the
 *    city, node, foe and strengths); partners answer through `operationRequests` (diplomacy.ts) and
 *    honour an accepted request for two days.
 *  • Broken commitments: a partner that accepted our call but never showed up within the window gets
 *    a grievance (+10, feeding trust-based leave rules and future replies); one that came gets a favour.
 */
import type { CountryId, NodeId } from '../engine/data-types';
import type { StackView } from '../engine/view/country-view';
import type { Turn } from './turn';
import type { Analysis } from './analysis';
import { km, landBfs } from './geo';
import { contactStrength, stackGroundPower } from './value';
import { bump } from './memory';
import { DAY, heldByTask, issueMove, nodeOf, orderDest, passable } from './orders';

const RADIUS_KM = 320;
const HELP_WINDOW = 2 * DAY;
export const ASSIST_WINDOW = 2 * DAY;
const MAX_HOPS = 8;
export const BROKEN_COMMITMENT_GRIEVANCE = 10;

export interface AllySite {
  partner: CountryId;
  node: NodeId;
  name: string;
  capital: boolean;
  threat: number;
  present: number;
  required: number;
  deficit: number;
  requested: boolean;
  /** The attacker with the most observed strength around the site (or the foe named in the request). */
  foe: CountryId | null;
}

export function coalitionPartners(t: Turn): CountryId[] {
  if (!t.view.myCoalition) return [];
  return t.view.relations.filter((r) => r.sameCoalition && r.alive).map((r) => r.country).sort();
}

/** Threat picture around partners' capitals and major core cities (plus sites a partner asked us to defend). */
export function partnerSites(t: Turn, a: Analysis): AllySite[] {
  const partners = coalitionPartners(t);
  if (!partners.length) return [];
  const v = t.view, g = t.geo, ix = t.ix;
  const pset = new Set(partners);
  const enemies = new Set(a.enemies);
  const namedFoes = new Map<CountryId, Set<CountryId>>();
  for (const x of t.mem.assist) if (x.foe) (namedFoes.get(x.partner) ?? namedFoes.set(x.partner, new Set()).get(x.partner)!).add(x.foe);
  // public war list (newspaper facts): who is fighting each partner
  const partnerFoes = new Map<CountryId, Set<CountryId>>();
  for (const [x, y] of v.wars ?? []) {
    if (pset.has(x)) (partnerFoes.get(x) ?? partnerFoes.set(x, new Set()).get(x)!).add(y);
    if (pset.has(y)) (partnerFoes.get(y) ?? partnerFoes.set(y, new Set()).get(y)!).add(x);
  }
  // only partners publicly at war (combat needs a war) or with an open request can be under attack
  const active = new Set<CountryId>([...partnerFoes.keys(), ...t.mem.assist.filter((x) => x.until > t.now).map((x) => x.partner)]);
  if (!active.size) return [];
  const sites = new Map<NodeId, AllySite>();
  const land = v.contacts.filter((c) => c.node !== null && (c.domain === 'land' || c.domain === 'unknown'));
  const mine = v.stacks.filter((s) => s.moveClass === 'ground');
  const assess = (partner: CountryId, node: NodeId, name: string, capital: boolean, stated: number, requested: boolean, named: CountryId | null) => {
    let threat = 0, present = 0;
    const by = new Map<CountryId, number>();
    for (const c of land) {
      const n = c.node as NodeId;
      const o = c.owner;
      if (o === partner || (o && pset.has(o))) {
        if (n === node) present += contactStrength(ix, c);
        continue;
      }
      if (o === t.me) continue;
      // cheap latitude pre-filter (3° ≈ 333 km) before the great-circle distance
      if (n !== node && (Math.abs(g.lat[n] - g.lat[node]) > 3 || km(g, n, node) > RADIUS_KM)) continue;
      // attackers: at war with the partner (public), our own enemies, or the foe the partner named;
      // an unidentified formation counts (half) only inside the partner's territory
      const hostile = o ? !!partnerFoes.get(partner)?.has(o) || enemies.has(o) || !!namedFoes.get(partner)?.has(o) : v.owners[n] === partner;
      if (!hostile) continue;
      const cs = contactStrength(ix, c);
      threat += cs * (o ? 1 : 0.5);
      if (o) by.set(o, (by.get(o) ?? 0) + cs);
    }
    const foe = [...by.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? named;
    for (const s of mine) if (nodeOf(s) === node || orderDest(s) === node) present += stackGroundPower(ix, s);
    threat = Math.max(threat, stated);
    const required = ix.avgGround * (capital ? 2.2 : 1.2) + threat * 1.25;
    const prev = sites.get(node);
    const site: AllySite = { partner, node, name, capital, threat, present, required, deficit: threat > 0 ? required - present : 0, requested: requested || !!prev?.requested, foe: foe ?? prev?.foe ?? null };
    if (!prev || site.deficit > prev.deficit) sites.set(node, site);
    else if (requested) {
      prev.requested = true;
      prev.foe = prev.foe ?? named;
    }
  };
  for (const pc of v.publicCities) {
    if (!pc.owner || !active.has(pc.owner) || pc.status === 'rebel') continue;
    if (!pc.capital && !(pc.homeland === pc.owner && pc.tier >= 3)) continue;
    assess(pc.owner, pc.node, pc.name, pc.capital, 0, false, null);
  }
  for (const x of t.mem.assist) {
    if (!pset.has(x.partner) || x.until <= t.now || v.owners[x.node] !== x.partner) continue;
    const pc = v.publicCities.find((c) => c.node === x.node);
    assess(x.partner, x.node, pc?.name ?? `node ${x.node}`, pc?.capital ?? false, x.threat, true, x.foe);
  }
  return [...sites.values()].sort((x, y) => Number(y.requested) - Number(x.requested) || Number(y.capital) - Number(x.capital) || y.deficit - x.deficit || x.node - y.node);
}

/**
 * Combat only happens between countries at war, so defending a partner against an attacker we are
 * at peace with means joining that war. Explicit rule: no truce with the foe, at most 2 wars (3 when
 * loyal/aggressive), the bloc must be able to match the foe (≥ 70 % of its public power), and a
 * much stronger foe on our own border is not provoked unless the bloc clearly outweighs it.
 */
export function joinVerdict(t: Turn, a: Analysis, partner: CountryId, foe: CountryId | null): { ok: boolean; war: boolean; reason: string } {
  if (!foe) return { ok: true, war: false, reason: 'attacker unidentified: presence only' };
  if (a.enemies.includes(foe)) return { ok: true, war: false, reason: `already at war with ${foe}` };
  const r = t.rel.get(foe);
  if (!r || !r.alive) return { ok: false, war: false, reason: `${foe} is not an active country` };
  if (r.sameCoalition) return { ok: false, war: false, reason: `${foe} is a coalition partner` };
  if ((t.mem.cooldown[`truce:${foe}`] ?? 0) > t.now) return { ok: false, war: false, reason: `our truce with ${foe} is still in force` };
  const p = t.personality;
  const maxWars = p.loyalty > 0.6 || p.aggression > 0.7 ? 3 : 2;
  if (a.enemies.length >= maxWars) return { ok: false, war: false, reason: `we already fight ${a.enemies.length} war(s)` };
  const co = t.view.coalitions.find((c) => c.id === t.view.myCoalition);
  const bloc = (co?.members ?? [t.me, partner]).filter((m) => m === t.me || t.rel.get(m)?.alive).reduce((s, m) => s + (m === t.me ? a.myPower : a.power(m)), 0);
  const fp = a.power(foe);
  if (bloc < fp * 0.7) return { ok: false, war: false, reason: `the bloc (power ${bloc.toFixed(0)}) cannot match ${foe} (${fp.toFixed(0)})` };
  if (a.neighbours.has(foe) && a.myPower < fp * 0.35 && bloc < fp * 1.2) return { ok: false, war: false, reason: `${foe} borders us and is ${(fp / Math.max(1, a.myPower)).toFixed(1)}× stronger` };
  return { ok: true, war: true, reason: `join the defence of ${partner} against ${foe} (bloc ${bloc.toFixed(0)} vs ${fp.toFixed(0)})` };
}

/** Our own security comes first: an exposed capital (or a threatened city we cannot cover) blocks commitments abroad. */
export function homeExposed(a: Analysis): { exposed: boolean; key?: string; threat?: number; present?: number } {
  const cap = a.cities.find((c) => c.capital);
  if (cap && cap.threat > 0 && cap.present < cap.required) return { exposed: true, key: cap.key, threat: cap.threat, present: cap.present };
  return { exposed: false };
}

/** Formations that can go: ground, idle at a node, not held by another task, not needed by an own city's garrison. */
function spareStacks(t: Turn, a: Analysis, stacks: StackView[]): StackView[] {
  return stacks.filter((s) => {
    if (s.moveClass !== 'ground' || s.pos.kind !== 'node' || s.aboard || t.movedStacks.has(s.id)) return false;
    if (s.order && !(s.order.kind === 'move' && s.order.route.length === 0)) return false;
    if (heldByTask(t, s)) return false;
    const p = stackGroundPower(t.ix, s);
    if (p <= 0) return false;
    const at = a.cityAt.get((s.pos as { node: NodeId }).node);
    return !at || at.present - p >= at.required;
  });
}

/** Reach + spare forces for a partner site (shared by the operational layer and request replies). */
export function reachFor(t: Turn, a: Analysis, node: NodeId, stacks: StackView[]): { list: { s: StackView; hops: number; p: number }[]; spare: number } {
  const d = landBfs(t.geo, [node], MAX_HOPS, (n) => passable(t, t.view.owners[n]));
  const list: { s: StackView; hops: number; p: number }[] = [];
  let spare = 0;
  for (const s of spareStacks(t, a, stacks)) {
    const h = d[(s.pos as { node: NodeId }).node];
    if (h <= 0) continue;
    const p = stackGroundPower(t.ix, s);
    list.push({ s, hops: h, p });
    spare += p;
  }
  list.sort((x, y) => x.hops - y.hops || y.p - x.p || (x.s.id < y.s.id ? -1 : 1));
  return { list, spare };
}

/** Our proportionate share of a partner's deficit: public power share among the other members (≥ ⅓). */
export function shareOf(t: Turn, a: Analysis, partner: CountryId): number {
  const co = t.view.coalitions.find((c) => c.id === t.view.myCoalition);
  const others = (co?.members ?? [t.me]).filter((m) => m !== partner && (m === t.me || t.rel.get(m)?.alive));
  const total = others.reduce((s, m) => s + (m === t.me ? a.myPower : a.power(m)), 0);
  return Math.max(1 / 3, Math.min(1, a.myPower / Math.max(1, total)));
}

/** Operational layer: commit a proportionate share of spare forces to threatened partners. */
export function allianceDefence(t: Turn, a: Analysis, stacks: StackView[]): void {
  if (!t.view.myCoalition || t.full || t.pathLeft <= 0) return;
  const sites = partnerSites(t, a).filter((s) => s.deficit > 0);
  if (!sites.length) return;
  const home = homeExposed(a);
  if (home.exposed) {
    t.note('operational', 'ally_defence_declined', `${sites[0].partner} ${sites[0].name}`, `our capital ${home.key} is exposed (${home.threat!.toFixed(0)} vs ${home.present!.toFixed(0)}): home defence first`);
    return;
  }
  const g = t.geo, p = t.personality;
  // strength not tied down by our own garrison requirements (per-city check in spareStacks)
  const ownSpare = spareStacks(t, a, stacks).reduce((s, x) => s + stackGroundPower(t.ix, x), 0);
  let budget = ownSpare * (0.35 + 0.3 * p.loyalty);
  for (const site of sites.slice(0, 2)) {
    if (t.full || t.pathLeft <= 0 || budget <= 0) return;
    const griev = t.mem.grievance[site.partner] ?? 0;
    if (griev >= 25) {
      t.note('operational', 'ally_defence_declined', `${site.partner} ${site.name}`, `grievance ${griev.toFixed(0)} after broken commitments`);
      continue;
    }
    const { list, spare } = reachFor(t, a, site.node, stacks);
    if (!list.length) {
      t.note('operational', 'ally_defence_declined', `${site.partner} ${site.name}`, 'no spare formation can reach it through own, coalition or passage territory');
      continue;
    }
    if (site.threat > (site.present + spare) * 2.5) {
      t.note('operational', 'ally_defence_declined', `${site.partner} ${site.name}`, `hopeless: hostile strength ${site.threat.toFixed(0)} vs ${site.present.toFixed(0)} present + ${spare.toFixed(0)} we could send`);
      continue;
    }
    const trust = t.rel.get(site.partner)?.trust ?? 0;
    const worth = (g.vp[site.node] + 4) * (0.6 + p.loyalty) + trust / 8 + (site.requested ? 6 : 0) - list[0].hops * 0.7;
    if (worth < 4) {
      t.note('operational', 'ally_defence_declined', `${site.partner} ${site.name}`, `not worth the detour (value ${worth.toFixed(1)}, ${list[0].hops} hops)`);
      continue;
    }
    const verdict = joinVerdict(t, a, site.partner, site.foe);
    if (!verdict.ok) {
      t.note('operational', 'ally_defence_declined', `${site.partner} ${site.name}`, verdict.reason);
      continue;
    }
    if (verdict.war && !t.declaredWar.has(site.foe!)) {
      if (!t.add({ type: 'declareWar', country: t.me, target: site.foe! }, 'strategic', 'join_defence', verdict.reason)) continue;
      t.mem.warStartedAt[site.foe!] = t.now;
    }
    const share = shareOf(t, a, site.partner);
    const want = Math.min(site.deficit * share * 1.1, budget);
    let sent = 0;
    const ids: string[] = [];
    for (const x of list) {
      if (sent >= want || t.full || t.pathLeft <= 0) break;
      // never send more than the budget unless it is the first (smallest useful) formation
      if (sent > 0 && sent + x.p > budget) continue;
      const reason = `${site.requested ? 'honour request: ' : ''}defend partner ${site.partner} ${site.capital ? 'capital' : 'city'} ${site.name}: hostile ${site.threat.toFixed(0)} vs ${site.present.toFixed(0)} present, our share ${(share * 100).toFixed(0)}%`;
      if (issueMove(t, x.s, site.node, 'ally_defend', reason, 2 * DAY)) {
        sent += x.p;
        ids.push(x.s.id);
      }
    }
    if (sent > 0) {
      budget -= sent;
      const prev = t.mem.commitments[site.partner];
      t.mem.commitments[site.partner] = { node: site.node, at: t.now, until: t.now + 2 * DAY, power: Math.round(sent + (prev && prev.node === site.node ? prev.power : 0)), stacks: [...(prev && prev.node === site.node ? prev.stacks : []), ...ids].slice(-8) };
    }
  }
}

/** A member whose capital is exposed asks the bloc for help (cooldown 2 days, one open call at a time). */
export function callForHelp(t: Turn, a: Analysis): void {
  if (!t.view.myCoalition || t.full) return;
  const partners = coalitionPartners(t);
  if (!partners.length) return;
  const cap = a.cities.find((c) => c.capital);
  if (!cap || cap.threat <= 0 || cap.present >= cap.required) return;
  if (t.mem.help && t.mem.help.until > t.now) return;
  if ((t.mem.cooldown['help'] ?? 0) > t.now) return;
  // the foe with the most observed strength around the capital
  const by = new Map<CountryId, number>();
  for (const c of a.hostile) if (c.owner && c.node !== null && km(t.geo, c.node, cap.node) <= RADIUS_KM) by.set(c.owner, (by.get(c.owner) ?? 0) + contactStrength(t.ix, c));
  const foe = [...by.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? null;
  const name = t.view.cities.find((c) => c.key === cap.key)?.name ?? cap.key;
  const reason = `defend ${name} (node ${cap.node}) against ${foe ?? 'invading forces'}: observed hostile strength ${cap.threat.toFixed(0)} vs ${cap.present.toFixed(0)}`;
  if (t.add({ type: 'sendMessage', country: t.me, to: 'coalition', intent: 'request_operation', reason }, 'diplomatic', 'request_help', reason)) {
    t.mem.help = { at: t.now, node: cap.node, foe, until: t.now + HELP_WINDOW, accepted: [], arrived: [] };
    t.mem.cooldown['help'] = t.now + HELP_WINDOW;
  }
}

/**
 * Every call (cheap): track who accepted our call for help and whose forces arrived; when the window
 * closes, remember broken commitments as grievances and kept ones as favours.
 */
export function trackHelp(t: Turn): void {
  const h = t.mem.help;
  if (!h) return;
  const v = t.view;
  const partners = new Set(coalitionPartners(t));
  for (const [thread, msgs] of Object.entries(v.messages)) {
    if (!thread.startsWith('co:') && !thread.startsWith('dm:')) continue;
    for (const m of msgs) {
      if (m.at < h.at || m.from === t.me || m.intent !== 'accept' || m.offer || h.accepted.includes(m.from)) continue;
      if (thread.startsWith('dm:') && !thread.includes(t.me)) continue;
      if (!/defend|help|reinforce/i.test(`${m.reason ?? ''} ${m.text}`)) continue;
      h.accepted.push(m.from);
    }
  }
  for (const c of v.contacts) {
    if (!c.owner || c.node === null || c.owner === t.me || h.arrived.includes(c.owner)) continue;
    if (!partners.has(c.owner) && !h.accepted.includes(c.owner)) continue;
    if (c.domain !== 'land') continue;
    if (km(t.geo, c.node, h.node) <= RADIUS_KM && (v.owners[c.node] === t.me || c.node === h.node)) {
      // count only formations that came to us (not their own home garrisons across the border)
      h.arrived.push(c.owner);
    }
  }
  h.accepted.sort();
  h.arrived.sort();
  if (t.now < h.until) return;
  for (const p of h.accepted) {
    if (h.arrived.includes(p)) {
      bump(t.mem.favour, p, 6);
      t.note('diplomatic', 'commitment_kept', `${p} sent forces`, `${p} honoured its promise to help defend node ${h.node}`);
    } else {
      bump(t.mem.grievance, p, BROKEN_COMMITMENT_GRIEVANCE);
      t.note('diplomatic', 'broken_commitment', `${p} promised help`, `${p} accepted our call to defend node ${h.node} but no forces arrived within ${HELP_WINDOW / DAY} days`);
    }
  }
  t.mem.help = null;
}

/** Parse a defence request (human or bot text): the node to defend, the named foe and a stated strength. */
export function parseDefenceRequest(t: Turn, from: CountryId, text: string): { node: NodeId | null; foe: CountryId | null; threat: number } | null {
  if (!/\b(defend|defence|defense|reinforce|relief|protect)\b/i.test(text)) return null;
  const v = t.view;
  let node: NodeId | null = null;
  const nm = /\(node (\d+)\)/.exec(text);
  if (nm && v.owners[Number(nm[1])] === from) node = Number(nm[1]);
  if (node === null) {
    // a named city of the requester, else its capital
    const own = v.publicCities.filter((c) => c.owner === from);
    node = own.find((c) => text.includes(c.name))?.node ?? own.find((c) => c.capital)?.node ?? null;
  }
  const codes = text.match(/\b[A-Z]{3}\b/g) ?? [];
  const foe = codes.find((w) => w !== from && w !== t.me && t.rel.has(w) && !t.rel.get(w)?.sameCoalition) ?? null;
  const sm = /strength (\d+)/.exec(text);
  const threat = sm ? Number(sm[1]) : t.ix.avgGround * 3;
  return { node, foe, threat };
}
