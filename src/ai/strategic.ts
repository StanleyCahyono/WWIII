/**
 * Strategic layer (low frequency, default daily; easy every 2 days): geography, research focus,
 * shortage forecast, force/garrison plan, stance, territorial objective with a commitment window,
 * re-targeting triggers (lost port, new transit agreement, expired observation, target gone) and
 * war decisions (small states must try access/coalition/trade first).
 */
import type { CountryId, NodeId, Resource } from '../engine/data-types';
import { RESOURCES } from '../engine/data-types';
import type { Turn } from './turn';
import { defenceAt, type Analysis } from './analysis';
import { bump, decayMemory } from './memory';
import { km } from './geo';

const DAY = 1440;

/** Update grievances/favours and intel findings from the private journal (own events only). */
export function ingestJournal(t: Turn, a: Analysis): void {
  const mem = t.mem;
  let maxId = mem.journalCursor;
  for (const e of [...t.view.journal].reverse()) {
    const id = Number(String(e.id).replace(/\D/g, '')) || 0;
    if (id <= mem.journalCursor) continue;
    if (id > maxId) maxId = id;
    const first = e.text.split(/\s+/)[0];
    const who = t.rel.has(first) ? first : null;
    switch (e.kind) {
      case 'war_declared':
        if (who && /declared war on you/.test(e.text)) {
          bump(mem.grievance, who, 50);
          t.note('strategic', 'grievance', `${who} declared war on us`, 'hostile act recorded');
        }
        break;
      case 'grant_revoked':
        if (who && /reduced your status/.test(e.text)) bump(mem.grievance, who, 12);
        break;
      case 'offer_declined':
        break;
      case 'agreement_effective':
        for (const r of t.view.relations) if (e.text.includes(r.country)) bump(mem.favour, r.country, 4);
        break;
      case 'city_captured':
      case 'province_captured': {
        if (/occupied|liberated/.test(e.text) && !/captured by/.test(e.text)) t.mem.counters['captures'] = (t.mem.counters['captures'] ?? 0) + 1;
        const m = /captured by ([A-Z]{3})/.exec(e.text);
        if (m && t.rel.has(m[1])) {
          bump(mem.grievance, m[1], e.kind === 'city_captured' ? 15 : 4);
          if (/\(capital\)/.test(e.text)) mem.capitalsLost++;
          if (mem.objective) mem.objective.commitUntil = 0; // territory change re-opens planning
        }
        break;
      }
      case 'intel_report': {
        for (const req of mem.intel) if (!req.reportSeen && e.node === req.node) t.note('strategic', 'intel_finding', `report on node ${req.node} (${req.country})`, e.text.slice(0, 120));
        break;
      }
      default:
        break;
    }
  }
  mem.journalCursor = maxId;
  void a;
}

function techWeights(t: Turn, a: Analysis): Record<string, number> {
  const geo = t.mem.geography;
  const p = t.personality;
  const war = a.enemies.length > 0;
  const threat = a.cities.reduce((s, c) => s + c.threat, 0) > 0;
  return {
    industry: 1.1 + p.research * 0.6,
    land: 0.8 + (war || threat ? 0.6 : 0) + p.aggression * 0.3,
    support: 0.45 + (war ? 0.2 : 0),
    aviation: 0.45 + p.research * 0.2,
    naval: geo === 'landlocked' ? 0 : geo === 'maritime' ? 1.1 : 0.35,
    mobility: geo === 'maritime' ? 1.3 : geo === 'landlocked' ? 0.2 : 0.45,
    recon: 0.35,
    officer: 0.3,
    strategic: 0.25 + (war && a.myPower > 60 ? 0.4 : 0),
    hypersonic: t.mem.plan.hypersonic ? 0.9 : 0,
  };
}

export function strategicPass(t: Turn, a: Analysis): void {
  const mem = t.mem;
  const v = t.view;
  const days = mem.lastStrategic < 0 ? 0 : Math.floor((t.now - mem.lastStrategic) / DAY);
  decayMemory(mem, v, days);
  mem.lastStrategic = t.now;
  if (!mem.geography) mem.geography = t.geo.countryGeo.get(t.me) ?? 'coastal';

  // economic plan: forecast shortages within the difficulty lookahead
  const shortages: Resource[] = [];
  for (const r of RESOURCES) {
    if (r === 'money' && (t.res.money?.netPerDay ?? 0) >= 0) continue;
    const s = t.res[r];
    if (!s) continue;
    const h = s.hoursToDepletion;
    const low = s.consumptionPerDay > 0 && s.stock < s.consumptionPerDay * 2;
    if (v.self.shortages.includes(r) || low || (h !== null && h < t.diff.forecastHours * 2.5)) shortages.push(r);
  }
  // hypersonic only for capable peers with surplus
  const op = v.openingPower;
  const rank = op?.rank ? op.rank.indexOf(t.me) : -1;
  const surplus = (t.res.money?.netPerDay ?? 0) > 0 && (t.res.electronics?.netPerDay ?? 0) >= 0 && !shortages.includes('rare');
  mem.plan.hypersonic = rank >= 0 && rank < 8 && surplus && v.day >= 20;
  const w = techWeights(t, a);
  mem.plan.researchFocus = Object.entries(w).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 4).map((x) => x[0]);
  mem.plan.shortages = shortages;
  const threat = a.cities.reduce((s, c) => s + c.threat, 0);
  mem.plan.garrison = Math.round(a.cities.reduce((s, c) => s + c.required, 0));
  mem.plan.stance = a.enemies.length && threat > a.myGround * 0.6 ? 'defend' : a.enemies.length || t.personality.expansion > 0.45 ? 'expand' : 'consolidate';
  t.note('strategic', 'plan', `stance=${mem.plan.stance} focus=${mem.plan.researchFocus.join('/')} shortages=${shortages.join(',') || 'none'} hyp=${mem.plan.hypersonic}`, `power ${a.myPower.toFixed(0)}, threat ${threat.toFixed(0)}, ${a.enemies.length} war(s)`);

  // war bookkeeping (a concluded peace starts a truce: no new war on that country for 15 days)
  for (const e of a.enemies) if (mem.warStartedAt[e] === undefined) mem.warStartedAt[e] = t.now;
  for (const k of Object.keys(mem.warStartedAt)) if (!a.enemies.includes(k)) { mem.cooldown[`truce:${k}`] = t.now + 15 * DAY; delete mem.warStartedAt[k]; }

  chooseObjective(t, a);
  considerWar(t, a);
}

/** Re-target triggers checked on every call (cheap). Returns the trigger or null. */
export function retargetTrigger(t: Turn, a: Analysis): string | null {
  const o = t.mem.objective;
  if (!o) return 'no objective';
  if (o.target && !t.rel.get(o.target)?.alive) return 'target eliminated';
  if (o.target && t.rel.get(o.target)?.sameCoalition) return 'target joined our coalition';
  if (a.ports < o.ports) return 'lost a port';
  const grants = t.view.relations.filter((r) => r.theirStatusToMe !== 'peace' && r.theirStatusToMe !== 'war').length;
  if (grants > o.grants) return 'new transit agreement';
  if (o.node !== null && o.observedAt > 0 && t.now - o.observedAt > 2 * DAY && !t.view.reports.some((r) => !r.expired && r.targetNode === o.node)) return 'observation of objective expired';
  if (o.node !== null && t.view.owners[o.node] === t.me) return 'objective taken';
  return null;
}

/** Public score leader (excluding us) and the fractions of the solo threshold (balance of power). */
export function leaderInfo(t: Turn): { leader: CountryId | null; leaderFrac: number; myFrac: number; secondFrac: number } {
  const sc = t.view.scores.byCountry;
  const thr = Math.max(1, t.view.scores.soloThreshold);
  let leader: CountryId | null = null, best = -1, second = -1;
  for (const r of t.view.relations) {
    if (!r.alive) continue;
    const v = sc[r.country] ?? 0;
    if (v > best) { second = best; best = v; leader = r.country; } else if (v > second) second = v;
  }
  const mine = sc[t.me] ?? 0;
  return { leader, leaderFrac: best / thr, myFrac: mine / thr, secondFrac: Math.max(second, 0) / thr };
}

function chooseObjective(t: Turn, a: Analysis): void {
  const mem = t.mem;
  const trig = retargetTrigger(t, a);
  if (mem.objective && !trig && t.now < mem.objective.commitUntil) return;
  const g = t.geo, v = t.view;
  const cands: { c: CountryId; node: NodeId; score: number; why: string }[] = [];
  const enemies = new Set(a.enemies);
  const li = leaderInfo(t);
  // candidate countries: land neighbours + enemies + (maritime) nearby overseas
  const cset = new Set<CountryId>([...a.neighbours.keys(), ...a.enemies]);
  if (mem.geography !== 'landlocked' && a.capitalNode !== null) {
    for (const pc of v.publicCities) if (pc.owner && pc.owner !== t.me && pc.capital && km(g, pc.node, a.capitalNode) < 1600) cset.add(pc.owner);
  }
  for (const c of [...cset].sort()) {
    const r = t.rel.get(c);
    if (!r || !r.alive || r.sameCoalition) continue;
    // best reachable node of c: nearest high-VP node by hops from our territory
    let best: NodeId | null = null, bestS = -1, bestHop = 99;
    for (let n = 0; n < g.n; n++) {
      if (v.owners[n] !== c) continue;
      const h = a.hops[n];
      const reach = h >= 0 ? h : mem.geography !== 'landlocked' && g.coast[n].length ? 10 : -1;
      if (reach < 0) continue;
      const s = g.vp[n] / (1 + reach * 0.6);
      if (s > bestS) { bestS = s; best = n; bestHop = reach; }
    }
    if (best === null) continue;
    const ratio = a.myPower / a.power(c);
    const trustPen = Math.max(0, r.trust) / 25 + (r.theirStatusToMe !== 'peace' ? 1 : 0);
    const griev = (mem.grievance[c] ?? 0) / 25;
    const exposure = (a.neighbours.get(c) ?? 0) * 0.1;
    // balance of power: a runaway leader becomes a preferred objective for capable neighbours
    const contain = c === li.leader && li.leaderFrac >= 0.18 && li.leaderFrac > li.myFrac * 1.3 && ratio >= 0.5 ? (li.leaderFrac - 0.15) * 10 : 0;
    const score = bestS * (0.6 + t.personality.expansion) * Math.min(2.5, ratio) + griev + (enemies.has(c) ? 2.5 : 0) + exposure + contain - trustPen - bestHop * 0.15;
    cands.push({ c, node: best, score, why: `${enemies.has(c) ? 'at war; ' : ''}VP ${g.vp[best]} at ${bestHop} hop(s), power ratio ${ratio.toFixed(2)}${griev > 0 ? `, grievance ${(griev * 25).toFixed(0)}` : ''}` });
  }
  cands.sort((x, y) => y.score - x.score || (x.c < y.c ? -1 : 1));
  const top = cands.slice(0, t.diff.targetCandidates)[0];
  const prev = mem.objective;
  const grants = v.relations.filter((r) => r.theirStatusToMe !== 'peace' && r.theirStatusToMe !== 'war').length;
  if (!top) {
    mem.objective = { target: null, node: null, value: 0, reason: 'no reachable objective', setAt: t.now, commitUntil: t.now + DAY, ports: a.ports, grants, observedAt: 0 };
    return;
  }
  // hysteresis: keep the previous target unless the new one is clearly better (anti-oscillation)
  if (prev && prev.target && !trig) {
    const keep = cands.find((x) => x.c === prev.target);
    if (keep && keep.score >= top.score * 0.8) {
      prev.commitUntil = t.now + 2 * DAY;
      prev.node = keep.node;
      prev.ports = a.ports;
      prev.grants = grants;
      return;
    }
  }
  const d = defenceAt(t, a, top.node);
  mem.objective = { target: top.c, node: top.node, value: top.score, reason: top.why, setAt: t.now, commitUntil: t.now + 2 * DAY, ports: a.ports, grants, observedAt: d.observed ? t.now - Math.min(d.age, DAY) : 0 };
  t.note('strategic', 'objective', `${top.c} node ${top.node}`, `${trig ? `re-target (${trig}): ` : ''}${top.why}`);
}

function considerWar(t: Turn, a: Analysis): void {
  const mem = t.mem, v = t.view, p = t.personality;
  const o = mem.objective;
  if (!o || !o.target || a.enemies.includes(o.target)) return;
  const r = t.rel.get(o.target);
  if (!r || r.sameCoalition || !r.alive) return;
  const maxWars = p.aggression > 0.7 ? 2 : 1;
  if (a.enemies.length >= maxWars) return;
  const earliest = 2 + Math.round((1 - p.aggression) * 8);
  if (v.day < earliest) return;
  if (mem.cooldown['war']) return;
  // small states seek access/coalition/trade first
  if (a.small && mem.soughtDiplomacy < 2) {
    t.note('strategic', 'war_deferred', `war on ${o.target} deferred`, 'small state: seek access, coalition or trade first');
    return;
  }
  if ((mem.cooldown[`truce:${o.target}`] ?? 0) > t.now) return;
  const ratio = a.myPower / a.power(o.target);
  // score pressure grows with the calendar; a clearly weaker target is an opportunity
  const pressure = Math.min(0.25, (v.day / 180) * 0.5);
  const opportunity = ratio > 1.5 ? Math.min(0.2, (ratio - 1.5) * 0.1) : 0;
  // anti-snowball: a clear score leader consolidates (occupation upkeep, morale) instead of overextending
  const li = leaderInfo(t);
  const consolidate = li.myFrac >= 0.15 && li.myFrac > li.leaderFrac * 1.25 ? Math.min(0.25, (li.myFrac / Math.max(0.01, li.leaderFrac) - 1.25) * 0.5 + 0.1) : 0;
  const appetite = p.aggression * 0.5 + p.expansion * 0.4 + 0.1 + pressure + opportunity - consolidate + (mem.grievance[o.target] ?? 0) / 60 - Math.max(0, r.trust) / 80 - (r.theirStatusToMe !== 'peace' ? 0.2 : 0);
  const need = (a.small ? 1.6 : 1.25) + p.caution * 0.4;
  // local strength at the border vs estimated defence of the objective
  const d = defenceAt(t, a, o.node as NodeId);
  const local = a.myGround - a.cities.reduce((s, c) => s + c.required * 0.5, 0);
  if (appetite < 0.45 || ratio < need || local < d.strength * t.diff.attackRatio) {
    t.note('strategic', 'war_considered', `no war on ${o.target}`, `appetite ${appetite.toFixed(2)} (pressure ${pressure.toFixed(2)}${consolidate ? `, leader consolidating −${consolidate.toFixed(2)}` : ''}), power ratio ${ratio.toFixed(2)} (need ${need.toFixed(2)}), local ${local.toFixed(0)} vs defence ${d.strength.toFixed(0)}`);
    return;
  }
  const reason = `objective ${o.reason}; power ratio ${ratio.toFixed(2)}`;
  if (t.add({ type: 'declareWar', country: t.me, target: o.target }, 'strategic', 'declare_war', reason)) {
    mem.warStartedAt[o.target] = t.now;
    mem.cooldown['war'] = t.now + 4 * DAY;
  }
}
