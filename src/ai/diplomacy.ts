/**
 * Diplomatic layer. Every call answers pending offers / applications / operation requests (so a
 * woken bot replies promptly); proposals happen on the staggered diplomatic review only.
 * Signals: trust by counterpart, remembered grievances (war declarations, revoked grants,
 * captures) and favours (agreements in effect), common threats, border exposure, offer history
 * (cooldowns keyed by counterpart+kind) and relative score/power.
 * Every reply carries a brief concrete reason that is ALSO stored as a logged decision.
 */
import type { CountryId, NodeId, Resource } from '../engine/data-types';
import type { Offer, OfferTerm } from '../engine/state';
import type { Turn } from './turn';
import type { Analysis } from './analysis';
import { resValue } from './value';
import { km } from './geo';

const DAY = 1440;
const PROPOSAL_COOLDOWN = 3 * DAY;
const DECLINED_COOLDOWN = 5 * DAY;
const COALITION_COMMIT = 10 * DAY;

interface Eval {
  accept: boolean;
  score: number;
  reason: string;
}

function termValue(t: Turn, a: Analysis, other: CountryId, term: OfferTerm, giving: boolean): { v: number; label: string } {
  const r = t.rel.get(other);
  const ratio = a.power(other) / Math.max(1, a.myPower);
  const border = a.neighbours.get(other) ?? 0;
  if (term.kind === 'resource') {
    const v = resValue(t.ix, { [term.resource]: term.amount } as Partial<Record<Resource, number>>, true);
    const need = t.mem.plan.shortages.includes(term.resource) ? 1.5 : 1;
    return { v: (giving ? -v : v * need), label: `${(term.amount / 1000).toFixed(0)} ${term.resource}` };
  }
  if (term.kind === 'status') {
    const lvl = term.level === 'shared_intel' ? 1.5 : 1;
    if (giving) {
      // giving passage/intel: risk grows with their relative power, border length and distrust
      const risk = (border > 0 ? 6 + border * 1.5 : 4) * Math.pow(Math.min(3, ratio), 1.2) * lvl;
      const distrust = Math.max(0, -(r?.trust ?? 0)) * 0.6 + (t.mem.grievance[other] ?? 0) * 0.5;
      return { v: -(risk + distrust), label: `${term.level.replace('_', ' ')} to ${other}` };
    }
    const obj = t.mem.objective;
    let useful = border > 0 ? 10 : 6;
    if (obj?.target && obj.node !== null && t.geo.homeland[obj.node] !== other) {
      // their territory may lie between us and the objective
      const myCap = a.capitalNode;
      if (myCap !== null) {
        const theirs = t.geo.capitals.get(other);
        if (theirs !== undefined && km(t.geo, myCap, theirs) < km(t.geo, myCap, obj.node)) useful += 12;
      }
    }
    return { v: useful * lvl, label: `${term.level.replace('_', ' ')} from ${other}` };
  }
  if (term.kind === 'peace') {
    const since = t.mem.warStartedAt[other] !== undefined ? (t.now - t.mem.warStartedAt[other]) / DAY : 0;
    const losing = a.cities.some((c) => c.threat > c.present) ? 25 : 0;
    const ratioNow = a.myPower / Math.max(1, a.power(other));
    const winning = ratioNow > 1.5 ? 30 : ratioNow > 1.1 ? 10 : 0;
    const wars = a.enemies.length > 1 ? 10 : 0;
    return { v: 15 + since + losing + t.mem.capitalsLost * 20 + wars - winning - t.personality.aggression * 15 - (t.mem.grievance[other] ?? 0) * 0.3, label: 'peace' };
  }
  if (term.kind === 'coalition_invite') {
    if (t.view.myCoalition) return { v: -999, label: 'coalition (already a member elsewhere)' };
    const co = t.view.coalitions.find((c) => c.id === term.coalition);
    if (!co) return { v: -999, label: 'unknown coalition' };
    const blocPower = co.members.reduce((s, m) => s + a.power(m), 0);
    const common = a.enemies.length > 0 && a.enemies.every((e) => t.rel.get(e)?.coalition !== co.id);
    const threat = a.cities.reduce((s, c) => s + c.threat, 0) > 0 ? 15 : 0;
    const memberDistrust = co.members.reduce((s, m) => s + Math.min(0, t.rel.get(m)?.trust ?? 0) + -(t.mem.grievance[m] ?? 0), 0) * 0.5;
    const smallBonus = a.small ? 20 : 0;
    const strong = a.myPower > blocPower * 0.9 && !a.small ? -25 : 0;
    return { v: 10 + Math.min(30, blocPower / Math.max(1, a.myPower) * 6) + (common ? 10 : 0) + threat + smallBonus + strong + memberDistrust, label: `membership in "${co.name}"` };
  }
  return { v: 0, label: 'term' };
}

export function evaluateOffer(t: Turn, a: Analysis, o: Offer): Eval {
  const from = o.from;
  const r = t.rel.get(from);
  const trust = r?.trust ?? 0;
  const griev = t.mem.grievance[from] ?? 0;
  let score = 0;
  const gets: string[] = [];
  const costs: string[] = [];
  let worst = { v: 0, label: '' };
  for (const term of o.give) {
    const x = termValue(t, a, from, term, false);
    score += x.v;
    gets.push(x.label);
  }
  for (const term of o.receive) {
    const x = termValue(t, a, from, term, true);
    score += x.v;
    costs.push(x.label);
    if (x.v < worst.v) worst = x;
  }
  const p = t.personality;
  score += trust * 0.4 + (t.mem.favour[from] ?? 0) * 0.5 - griev * 0.6 + (p.trade - 0.5) * 10;
  const peace = o.give.some((x) => x.kind === 'peace') || o.receive.some((x) => x.kind === 'peace');
  const statusOnly = [...o.give, ...o.receive].every((x) => x.kind === 'status');
  const threshold = peace ? 0 : statusOnly ? 2 + p.caution * 4 : 4 + p.caution * 6;
  const accept = score >= threshold && (peace || trust > -30) && !(o.give.some((x) => x.kind === 'coalition_invite') && t.view.myCoalition);
  let reason: string;
  if (accept) {
    if (peace) reason = `continuing the war no longer pays off (assessment ${score.toFixed(0)})`;
    else if (o.give.some((x) => x.kind === 'coalition_invite')) reason = `joining strengthens our position (bloc assessment ${score.toFixed(0)}, trust ${trust.toFixed(0)})`;
    else reason = `${gets.join(', ') || 'the terms'} for ${costs.join(', ') || 'nothing'} is acceptable (trust ${trust.toFixed(0)})`;
  } else if (trust <= -30 && !peace) reason = `trust in ${from} is ${trust.toFixed(0)} after recent hostile acts`;
  else if (griev >= 20) reason = `we have not forgotten recent hostile acts by ${from} (grievance ${griev.toFixed(0)})`;
  else if (o.give.some((x) => x.kind === 'coalition_invite') && t.view.myCoalition) reason = 'we already belong to a coalition';
  else if (peace) reason = `we hold the advantage in this war (assessment ${score.toFixed(0)})`;
  else if (!o.give.length || gets.length === 0) reason = `the offer asks for ${costs.join(', ')} and gives nothing in return`;
  else if (worst.label) reason = `${worst.label} is worth more to us than ${gets.join(', ')} (assessment ${score.toFixed(0)} below ${threshold.toFixed(0)})`;
  else reason = `the terms are not balanced enough for us (assessment ${score.toFixed(0)} below ${threshold.toFixed(0)})`;
  return { accept, score: Math.round(score * 10) / 10, reason };
}

function respond(t: Turn, a: Analysis): void {
  for (const o of t.view.offers) {
    if (t.full) return;
    if (o.status !== 'pending' || o.to !== t.me) continue;
    if (t.mem.decisions.some((d) => d.offer === o.id)) continue;
    const e = evaluateOffer(t, a, o);
    const ok = t.add({ type: 'respondOffer', country: t.me, offer: o.id, accept: e.accept }, 'reply', e.accept ? 'accept_offer' : 'decline_offer', e.reason);
    if (!ok && e.accept) {
      // stale/unpayable: decline instead (with the validator's reason)
      const ok2 = t.add({ type: 'respondOffer', country: t.me, offer: o.id, accept: false }, 'reply', 'decline_offer', 'the offer can no longer be honoured as written');
      if (ok2) t.mem.decisions.push({ offer: o.id, from: o.from, accept: false, reason: 'the offer can no longer be honoured as written', score: e.score, at: t.now });
      continue;
    }
    if (ok) {
      t.mem.decisions.push({ offer: o.id, from: o.from, accept: e.accept, reason: e.reason, score: e.score, at: t.now });
      if (!e.accept) t.mem.cooldown[`${o.from}:declined`] = t.now + DAY;
    }
  }
  // coalition applications (leader)
  const myCo = t.view.coalitions.find((c) => c.id === t.view.myCoalition);
  if (myCo && myCo.leader === t.me && myCo.applications) {
    for (const ap of myCo.applications) {
      if (t.full) return;
      const r = t.rel.get(ap.country);
      const trust = r?.trust ?? 0;
      const recent = (t.mem.cooldown['admit'] ?? 0) > t.now;
      const ok = myCo.members.length < 5 && trust >= 0 && (t.mem.grievance[ap.country] ?? 0) < 20 && !recent;
      const reason = ok ? `${ap.country} adds strength to the bloc (trust ${trust.toFixed(0)})` : myCo.members.length >= 5 ? 'the coalition is full' : recent ? 'we admitted a member recently and are consolidating' : `trust in ${ap.country} is too low (${trust.toFixed(0)})`;
      if (ok) t.mem.cooldown['admit'] = t.now + 3 * DAY;
      t.add({ type: 'respondApplication', country: t.me, coalition: myCo.id, applicant: ap.country, accept: ok }, 'reply', ok ? 'accept_application' : 'decline_application', reason);
    }
  }
}

/** Operation requests from partners (human or bot): intent "coordinate"/"request_operation". */
function operationRequests(t: Turn, a: Analysis): void {
  const v = t.view;
  for (const [thread, msgs] of Object.entries(v.messages).sort()) {
    for (const m of msgs) {
      if (t.full) return;
      if (m.from === t.me || t.mem.handledMessages.includes(m.id)) continue;
      if (m.intent !== 'coordinate' && m.intent !== 'request_operation') continue;
      if (t.now - m.at > 2 * DAY) { t.mem.handledMessages.push(m.id); continue; }
      t.mem.handledMessages.push(m.id);
      const words = `${m.text} ${m.reason ?? ''}`.match(/\b[A-Z]{3}\b/g) ?? [];
      const target = words.find((w) => w !== m.from && w !== t.me && t.rel.has(w)) ?? null;
      const isCoalitionThread = thread.startsWith('co:');
      const fromLeader = isCoalitionThread && v.coalitions.find((c) => c.id === v.myCoalition)?.leader === m.from;
      const cap = a.cities.find((c) => c.capital);
      const exposed = cap && (cap.threat > 0 && cap.present < cap.required);
      let accept: boolean;
      let reason: string;
      if (exposed && cap) {
        accept = false;
        reason = `our capital ${t.view.cities.find((c) => c.key === cap.key)?.name ?? cap.key} is exposed (observed hostile strength ${cap.threat.toFixed(0)} vs ${cap.present.toFixed(0)} defending); our forces stay home`;
      } else if (!target) {
        accept = false;
        reason = 'no target we can act on was named';
      } else if (t.rel.get(target)?.sameCoalition) {
        accept = false;
        reason = `${target} is a coalition partner`;
      } else {
        const reach = [...(t.geo.countryNodes.get(target) ?? [])].some((n) => a.hops[n] >= 0 && a.hops[n] <= 6);
        const ratio = a.myPower / a.power(target);
        accept = reach && (ratio > 0.8 || a.enemies.includes(target));
        reason = accept ? `${target} is within reach and the balance (${ratio.toFixed(2)}) allows it` : reach ? `${target} is too strong for us right now (ratio ${ratio.toFixed(2)})` : `${target} is beyond our reach`;
        if (accept && t.mem.objective) {
          t.mem.objective.target = target;
          t.mem.objective.commitUntil = t.now + 2 * DAY;
          t.mem.objective.reason = `coordinated operation requested by ${m.from}`;
        }
      }
      t.note('reply', accept ? 'accept_operation' : 'decline_operation', `${m.from} → ${target ?? '?'}`, reason);
      const to = isCoalitionThread && fromLeader ? 'coalition' : m.from;
      t.add({ type: 'sendMessage', country: t.me, to: to as CountryId, intent: accept ? 'accept' : 'decline', reason }, 'reply', accept ? 'accept_operation' : 'decline_operation', reason);
    }
  }
}

function cooled(t: Turn, key: string): boolean {
  return !t.mem.cooldown[key] || t.mem.cooldown[key] <= t.now;
}

function propose(t: Turn, a: Analysis, to: CountryId, give: OfferTerm[], receive: OfferTerm[], kind: string, reason: string, intent?: string): boolean {
  const key = `${to}:${kind}`;
  if (!cooled(t, key) || !cooled(t, `${to}:declined`)) return false;
  if ((t.pendingWith.get(to) ?? 0) >= 1) return false;
  const r = t.add({ type: 'proposeOffer', country: t.me, to, give, receive, expiresInMin: 2 * DAY, text: intent ? undefined : undefined }, 'diplomatic', `propose_${kind}`, reason);
  if (!r) return false;
  t.pendingWith.set(to, (t.pendingWith.get(to) ?? 0) + 1);
  t.mem.cooldown[key] = t.now + PROPOSAL_COOLDOWN;
  if (kind === 'passage' || kind === 'coalition' || kind === 'trade' || kind === 'intel') t.mem.soughtDiplomacy++;
  void a;
  return true;
}

function proposals(t: Turn, a: Analysis): void {
  const v = t.view, mem = t.mem, p = t.personality;
  let made = 0;
  const maxMade = t.diff.pathBudget >= 4 ? 2 : 1;
  // learn from our declined offers (offer history)
  for (const o of v.offers) if (o.from === t.me && o.status === 'declined' && o.resolvedAt !== null && t.now - o.resolvedAt < DAY) mem.cooldown[`${o.to}:declined`] = Math.max(mem.cooldown[`${o.to}:declined`] ?? 0, o.resolvedAt + DECLINED_COOLDOWN);

  // 1. peace where the war is costly or stalled
  for (const e of a.enemies) {
    if (made >= maxMade || t.full) break;
    const since = mem.warStartedAt[e] !== undefined ? (t.now - mem.warStartedAt[e]) / DAY : 0;
    const losing = a.cities.some((c) => c.threat > c.present * 1.2) || mem.capitalsLost > 0;
    const stalled = since > 12 && mem.objective?.target === e && (mem.counters['captures'] ?? 0) === 0;
    const weaker = a.power(e) > a.myPower * 1.3;
    if (!(losing || stalled || (weaker && since > 4))) continue;
    if (propose(t, a, e, [{ kind: 'peace' }], [], 'peace', losing ? 'the war is costing us territory' : weaker ? `${e} is stronger (${(a.power(e) / a.myPower).toFixed(1)}×)` : 'the war has stalled')) made++;
  }
  if (made >= maxMade || t.full) return;

  const coalitionId = v.myCoalition;
  // 2. coalition policy: small/threatened states seek a bloc; established peers found one
  if (!coalitionId && v.day >= 2) {
    const blocs = v.coalitions.filter((c) => !c.dissolvedAt && c.members.length < 5);
    const threatened = a.cities.some((c) => c.threat > 0) || a.enemies.length > 0;
    const candidates = blocs
      .map((c) => ({ c, s: c.members.reduce((s, m) => s + (t.rel.get(m)?.trust ?? 0) - (mem.grievance[m] ?? 0) + (a.neighbours.has(m) ? 5 : 0), 0) / c.members.length + c.members.reduce((s, m) => s + a.power(m), 0) / 20 }))
      .filter((x) => x.c.members.every((m) => !t.rel.get(m)?.war) && x.s > (a.small || threatened ? 0 : 6) && cooled(t, `apply:${x.c.id}`))
      .sort((x, y) => y.s - x.s || (x.c.id < y.c.id ? -1 : 1));
    if ((a.small || threatened || p.trade > 0.6) && candidates.length && cooled(t, 'apply')) {
      const best = candidates[0].c;
      if (t.add({ type: 'applyCoalition', country: t.me, coalition: best.id }, 'diplomatic', 'apply_coalition', a.small ? 'small state: a bloc improves security and joint victory odds' : 'shared threats: seek a bloc')) {
        mem.cooldown['apply'] = t.now + 2 * DAY;
        mem.cooldown[`apply:${best.id}`] = t.now + 7 * DAY;
        mem.soughtDiplomacy++;
        made++;
      }
    } else if (!a.small && p.trade + p.loyalty > 1.0 && cooled(t, 'found') && v.day >= 4 && !candidates.length && (v.openingPower?.rank.indexOf(t.me) ?? 99) < 40 && v.coalitions.filter((c) => !c.dissolvedAt).length < 10) {
      const friends = v.relations.filter((r) => r.alive && !r.war && !r.coalition && r.trust >= 8 && (mem.grievance[r.country] ?? 0) < 10).length;
      if (friends >= 1 && t.add({ type: 'createCoalition', country: t.me, name: `${v.self.name} Compact`, description: `Mutual security bloc led by ${v.self.name}.`, emblem: 'star' }, 'diplomatic', 'create_coalition', `${friends} trusted partner(s) for a joint victory bloc`)) {
        mem.cooldown['found'] = t.now + 30 * DAY;
        made++;
      }
    }
  } else if (coalitionId) {
    const co = v.coalitions.find((c) => c.id === coalitionId)!;
    // leader invites trusted partners (bots negotiate with each other)
    if (co.leader === t.me && co.members.length < 5) {
      const inv = v.relations.filter((r) => r.alive && !r.war && !r.coalition && r.trust >= 5 && (mem.grievance[r.country] ?? 0) < 10 && !co.members.some((m) => t.rel.get(m)?.war)).sort((x, y) => y.trust - x.trust || (x.country < y.country ? -1 : 1));
      for (const r of inv.slice(0, 2)) {
        if (made >= maxMade || t.full) break;
        if (propose(t, a, r.country, [{ kind: 'coalition_invite', coalition: co.id }], [], 'coalition', `invite ${r.country} (trust ${r.trust.toFixed(0)}) to pursue a joint victory`)) made++;
      }
      // coordinate joint objective
      const obj = mem.objective?.target;
      if (obj && a.enemies.includes(obj) && co.members.length > 1 && cooled(t, 'coord')) {
        if (t.add({ type: 'sendMessage', country: t.me, to: 'coalition', intent: 'coordinate', reason: `concentrate on ${obj}` }, 'diplomatic', 'coordinate', `joint objective ${obj}`)) mem.cooldown['coord'] = t.now + 3 * DAY;
      }
    }
    // explicit leave rules (after the commitment window)
    if (!mem.coalition || mem.coalition.id !== co.id) mem.coalition = { id: co.id, since: t.now };
    if (co.leader !== t.me && !co.departures.some((d) => d.country === t.me) && t.now - mem.coalition.since > COALITION_COMMIT) {
      const distrust = co.members.filter((m) => m !== t.me && ((t.rel.get(m)?.trust ?? 0) < -15 || (mem.grievance[m] ?? 0) >= 25)).length;
      const solo = (v.scores.byCountry[t.me] ?? 0) / Math.max(1, v.scores.soloThreshold);
      const bloc = co.score / Math.max(1, v.scores.coalitionThresholds[co.members.length] ?? v.scores.soloThreshold * 2);
      const reason = distrust * 2 >= co.members.length - 1 && co.members.length > 1 ? `lost trust in ${distrust} partner(s)` : v.day > 60 && solo > bloc * 1.25 && solo > 0.6 ? `solo path is stronger (${(solo * 100).toFixed(0)}% vs bloc ${(bloc * 100).toFixed(0)}% of threshold)` : null;
      if (reason && t.add({ type: 'leaveCoalition', country: t.me }, 'diplomatic', 'leave_coalition', reason)) {
        t.add({ type: 'sendMessage', country: t.me, to: 'coalition', intent: 'leave_coalition', reason }, 'diplomatic', 'leave_coalition', reason);
        made++;
      }
    }
  }
  if (made >= maxMade || t.full) return;

  // 3. revoke grants to countries that became hostile (respecting the fulfilment window unless severe)
  for (const r of v.relations) {
    if (t.full) break;
    if (r.myStatusToThem === 'peace' || r.myStatusToThem === 'war') continue;
    const griev = mem.grievance[r.country] ?? 0;
    const nearCapital = a.cities.some((c) => c.capital && t.view.contacts.some((x) => x.owner === r.country && x.node !== null && km(t.geo, x.node, c.node) < 200 && x.count && x.count >= 3));
    const severe = r.trust < -40 || griev >= 30;
    if ((severe || (nearCapital && r.trust < 0)) && cooled(t, `${r.country}:revoke`)) {
      if (t.add({ type: 'revokeGrant', country: t.me, to: r.country, level: 'peace' }, 'diplomatic', 'revoke_grant', severe ? `trust ${r.trust.toFixed(0)}, grievance ${griev.toFixed(0)}` : `${r.country} formations massing near our capital`)) {
        mem.cooldown[`${r.country}:revoke`] = t.now + 5 * DAY;
        made++;
      }
    }
  }
  if (made >= maxMade || t.full) return;

  // 4. passage: neighbours / route to objective; shared intel with trusted partners & common threats
  const obj = mem.objective;
  const cands = v.relations
    .filter((r) => r.alive && !r.war && !r.sameCoalition && (a.neighbours.has(r.country) || (obj?.target && obj.target !== r.country && a.neighbours.has(r.country))))
    .map((r) => ({ r, s: r.trust - (mem.grievance[r.country] ?? 0) + (mem.favour[r.country] ?? 0) + (a.neighbours.get(r.country) ?? 0) + (obj?.target === r.country ? -100 : 0) }))
    .sort((x, y) => y.s - x.s || (x.r.country < y.r.country ? -1 : 1));
  for (const { r, s } of cands) {
    if (made >= maxMade || t.full) break;
    if (s < 0 && !a.small) continue;
    if (r.theirStatusToMe === 'peace' && r.myStatusToThem === 'peace') {
      if (r.trust < 2 && !a.small) continue;
      // sweeten the offer when their territory matters for our objective (or we are small)
      const sweet = (a.small || (obj?.target && a.neighbours.has(r.country))) && t.budget.money - t.reserve.money > 3_000_000 ? [{ kind: 'resource' as const, resource: 'money' as Resource, amount: 500_000 }] : [];
      if (propose(t, a, r.country, [{ kind: 'status', level: 'right_of_way' }, ...sweet], [{ kind: 'status', level: 'right_of_way' }], 'passage', `mutual passage with ${r.country} (trust ${r.trust.toFixed(0)})${sweet.length ? ' with a 500 money sweetener' : ''}`)) made++;
    } else if (r.theirStatusToMe === 'right_of_way' && r.myStatusToThem === 'right_of_way' && r.trust >= 12 && (a.enemies.length > 0 || a.small)) {
      if (propose(t, a, r.country, [{ kind: 'status', level: 'shared_intel' }], [{ kind: 'status', level: 'shared_intel' }], 'intel', `share reports with ${r.country} against common threats`)) made++;
    }
  }
  if (made >= maxMade || t.full) return;

  // 5. trade agreement: swap a surplus for a shortage with a trusted partner
  const short = mem.plan.shortages.filter((x) => x !== 'money');
  if (short.length && (a.small || p.trade > 0.5)) {
    const need = short[0];
    const surplus = (['supplies', 'components', 'fuel', 'manpower', 'electronics', 'rare'] as Resource[]).filter((x) => x !== need && !mem.plan.shortages.includes(x) && (t.res[x]?.stock ?? 0) > t.reserve[x] * 4 + 100_000).sort((x, y) => (t.res[y]?.stock ?? 0) * (t.ix.price[y] ?? 1) - (t.res[x]?.stock ?? 0) * (t.ix.price[x] ?? 1))[0];
    const partner = v.relations.filter((r) => r.alive && !r.war && r.trust >= 0).sort((x, y) => y.trust - x.trust || (x.country < y.country ? -1 : 1))[0];
    if (surplus && partner) {
      const wantQty = 100_000;
      const giveQty = Math.ceil(((wantQty / 1000) * (t.ix.price[need] ?? 1) * 1.1) / (t.ix.price[surplus] ?? 1)) * 1000;
      if (giveQty <= (t.res[surplus]?.stock ?? 0) - t.reserve[surplus]) {
        if (propose(t, a, partner.country, [{ kind: 'resource', resource: surplus, amount: giveQty }], [{ kind: 'resource', resource: need, amount: wantQty }], 'trade', `trade ${surplus} surplus for ${need} (shortage forecast)`)) made++;
      }
    }
  }
}

export function diplomaticReplies(t: Turn, a: Analysis): void {
  respond(t, a);
  operationRequests(t, a);
}
export function diplomaticReview(t: Turn, a: Analysis): void {
  proposals(t, a);
}
export type { NodeId };
