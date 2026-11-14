/**
 * Economic review (every ~6 game hours): research, construction, mobilization within upkeep
 * headroom, market orders (cover deficits, sell surpluses, cancel stale orders), annexation and
 * missile procurement valued against alternatives in campaign points. All spending goes through
 * the shared validator and depletes the visible ledger under the same rules as the human's.
 */
import type { BuildingLevel, BuildingType, NodeId, Resource, TechNode, UnitType } from '../engine/data-types';
import { RESOURCES } from '../engine/data-types';
import type { Turn } from './turn';
import type { Analysis } from './analysis';
import { airPower, groundPower, navalPower, resValue } from './value';
import { km } from './geo';

const DAY = 1440;
const TOTAL_DAYS = 180;

function shortMult(t: Turn, r: Resource): number {
  return 1 + (t.mem.plan.shortages.includes(r) ? 2 : 0) + (t.view.self.shortages.includes(r) ? 1 : 0);
}
function daysLeft(t: Turn): number {
  return Math.max(1, TOTAL_DAYS - t.view.day);
}

// ───────────────────────────── research ─────────────────────────────

const fieldedMemo = new WeakMap<Turn, Map<string, number>>();
function fieldedOf(t: Turn): Map<string, number> {
  let f = fieldedMemo.get(t);
  if (!f) {
    f = new Map();
    for (const s of t.view.stacks) for (const u of s.units) f.set(u.type, (f.get(u.type) ?? 0) + 1);
    fieldedMemo.set(t, f);
  }
  return f;
}
const milli = (v: Partial<Record<Resource, number>>, m = 1) => {
  const o: Partial<Record<Resource, number>> = {};
  for (const k of Object.keys(v) as Resource[]) o[k] = Math.round((v[k] ?? 0) * 1000 * m);
  return o;
};

function techValue(t: Turn, a: Analysis, tech: TechNode, w: Record<string, number>): number {
  const geo = t.mem.geography;
  let base = w[tech.branch] ?? 0.3;
  if (base <= 0) return 0;
  const txt = `${tech.id} ${tech.name}`.toLowerCase();
  if (geo === 'landlocked' && /sea|naval|carrier|amphib|marine|submarine|embark/.test(txt)) return 0;
  const e = tech.effects;
  let v = base;
  const fielded = fieldedOf(t);
  for (const id of e.unlockUnit ?? []) {
    const u = t.ix.units.get(id);
    if (!u) continue;
    if (geo === 'landlocked' && (u.domain === 'sea' || u.domain === 'subsurface')) continue;
    v += u.capture ? 0.7 + (a.enemies.length ? 0.3 : 0) : 0.4;
  }
  for (const ul of e.unitLevel ?? []) v += Math.min(1.5, 0.12 * (fielded.get(ul.unit) ?? 0));
  if (e.unlockBuilding?.length) v += 0.3;
  for (const m of e.modifiers ?? []) {
    v += 0.35;
    if (/industrial|output/.test(m.key)) v += 0.35;
    if (/electronics/.test(m.key) && t.mem.plan.shortages.includes('electronics')) v += 0.8;
    if (/embark|lift/.test(m.key) && geo === 'maritime') v += 0.8;
  }
  if (e.liftCapacity) v += geo === 'maritime' ? 1.2 : geo === 'landlocked' ? 0.1 : 0.3;
  if (e.missileProgram || e.unlockMissile) v += t.mem.plan.hypersonic || a.enemies.length ? 0.3 : 0;
  if (tech.branch === 'hypersonic' && !t.mem.plan.hypersonic) return 0;
  // electronics shortage: delay expensive electronics-heavy programs
  const ec = (tech.cost.electronics ?? 0) * 1000;
  if (t.mem.plan.shortages.includes('electronics') && ec > (t.res.electronics?.stock ?? 0) * 0.3) return 0;
  const cost = resValue(t.ix, tech.cost);
  return v / Math.sqrt(cost / 800 + 1) / (1 + tech.tier * 0.08);
}

function research(t: Turn, a: Analysis): void {
  if (t.researchFree <= 0) return;
  const v = t.view;
  const have = new Set(v.self.techs);
  const busy = new Set(v.self.research.map((r) => r.tech));
  const w: Record<string, number> = {};
  const focus = t.mem.plan.researchFocus;
  for (const tech of t.ctx.catalog.techs) w[tech.branch] = 0.3;
  const geo = t.mem.geography;
  Object.assign(w, { industry: 1.1 + t.personality.research * 0.5, land: 0.9, support: 0.45, aviation: 0.45, naval: geo === 'landlocked' ? 0 : geo === 'maritime' ? 1.1 : 0.35, mobility: geo === 'maritime' ? 1.3 : geo === 'landlocked' ? 0.15 : 0.45, recon: 0.35, officer: 0.3, strategic: 0.3, hypersonic: t.mem.plan.hypersonic ? 1 : 0 });
  for (const f of focus) w[f] = (w[f] ?? 0.3) * 1.25;
  const cands: { tech: TechNode; u: number }[] = [];
  for (const tech of t.ctx.catalog.techs) {
    if (have.has(tech.id) || busy.has(tech.id)) continue;
    if (tech.dayAvailable > v.day) continue;
    if (!tech.prereqs.every((p) => have.has(p))) continue;
    const u = techValue(t, a, tech, w);
    if (u > 0) cands.push({ tech, u });
  }
  cands.sort((x, y) => y.u - x.u || (x.tech.id < y.tech.id ? -1 : 1));
  let tries = 0;
  for (const c of cands) {
    if (t.researchFree <= 0 || t.full || tries >= 3) break;
    if (!t.affordable(milli(c.tech.cost))) continue;
    tries++;
    const r = t.add({ type: 'startResearch', country: t.me, tech: c.tech.id }, 'economic', 'research', `${c.tech.branch} priority (focus ${focus.slice(0, 2).join('/')}${geo === 'maritime' && c.tech.branch === 'mobility' ? ', archipelago needs sea mobility' : ''})`);
    if (r) t.researchFree--;
  }
}

// ───────────────────────────── construction ─────────────────────────────

const incCache = new WeakMap<BuildingType, Map<number, BuildingLevel['effects'] | null>>();
/** Incremental effects of upgrading to `level` (catalog effects are totals). Static ⇒ cached. */
function incEffects(bt: BuildingType, level: number): BuildingLevel['effects'] | null {
  let m = incCache.get(bt);
  if (!m) { m = new Map(); incCache.set(bt, m); }
  if (m.has(level)) return m.get(level)!;
  const r = incEffectsRaw(bt, level);
  m.set(level, r);
  return r;
}
function incEffectsRaw(bt: BuildingType, level: number): BuildingLevel['effects'] | null {
  const L = bt.levels.find((l) => l.level === level);
  if (!L) return null;
  const P = bt.levels.find((l) => l.level === level - 1);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(L.effects) as (keyof BuildingLevel['effects'])[]) {
    const cur = L.effects[k];
    const prev = P?.effects[k];
    // `*Mult` effects use catalog multiplier semantics (1 = no change; engine combines Σ(mult − 1))
    if (typeof cur === 'number') out[k] = cur - (typeof prev === 'number' ? prev : /Mult$/.test(k) ? 1 : 0);
    else if (cur && typeof cur === 'object') {
      const o: Record<string, number> = {};
      for (const r of Object.keys(cur)) o[r] = ((cur as Record<string, number>)[r] ?? 0) - (((prev ?? {}) as Record<string, number>)[r] ?? 0);
      out[k] = o;
    }
  }
  return out as BuildingLevel['effects'];
}

function wantedRequirements(t: Turn): Map<string, number> {
  // buildings (and level) required by units we would like to field but no city can produce
  const need = new Map<string, number>();
  const techs = new Set(t.view.self.techs);
  for (const u of t.ctx.catalog.units) {
    if (u.unlockTech && !techs.has(u.unlockTech)) continue;
    if (!u.capture && u.domain === 'land') continue;
    if (t.mem.geography === 'landlocked' && (u.domain === 'sea' || u.domain === 'subsurface')) continue;
    if (u.domain === 'air' && u.family !== 'fighter') continue;
    for (const req of u.requires) {
      const ok = t.view.cities.some((c) => (c.buildings.find((b) => b.type === req.building)?.level ?? 0) >= req.level);
      if (!ok && (need.get(req.building) ?? 99) > req.level) need.set(req.building, req.level);
    }
  }
  return need;
}

function construction(t: Turn, a: Analysis): void {
  const v = t.view;
  const constructing = v.self.jobs.filter((j) => j.kind === 'construct' || j.kind === 'annex');
  const maxConcurrent = Math.max(2, Math.ceil(v.cities.length * 0.4));
  if (constructing.length >= maxConcurrent) return;
  const geo = t.mem.geography;
  const need = wantedRequirements(t);
  const dl = daysLeft(t);
  const cands: { b: BuildingType; target: string | NodeId; roi: number; why: string }[] = [];
  const busyNodes = new Set(constructing.map((j) => j.node));
  const counts = new Map<string, number>();
  for (const c of v.cities) for (const b of c.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  // bounded work: the most valuable cities plus capital and threatened ones
  const ranked = [...v.cities].sort((x, y) => t.geo.vp[y.node] - t.geo.vp[x.node] || (x.key < y.key ? -1 : 1));
  const pool = ranked.filter((c, i) => i < 8 || a.cities.some((x) => x.key === c.key && (x.capital || x.threat > 0)));
  for (const c of pool) {
    if (busyNodes.has(c.node)) continue;
    const info = a.cities.find((x) => x.key === c.key);
    let outVal = 0;
    for (const r of RESOURCES) outVal += ((c.baseOutput[r] ?? 0) / 1000) * (t.ix.price[r] ?? 1) * shortMult(t, r);
    for (const bt of t.ctx.catalog.buildings) {
      if (bt.scope !== 'city') continue;
      if (bt.unlockTech && !v.self.techs.includes(bt.unlockTech)) continue;
      if (bt.coastalOnly && (!c.port || geo === 'landlocked')) continue;
      const cur = c.buildings.find((b) => b.type === bt.id)?.level ?? 0;
      const level = cur + 1;
      if (level > bt.maxLevel) continue;
      const L = bt.levels.find((l) => l.level === level);
      const inc = incEffects(bt, level);
      if (!L || !inc) continue;
      if (!t.affordable(milli(L.cost))) continue;
      let gain = 0;
      const why: string[] = [];
      for (const r of Object.keys(inc.produces ?? {}) as Resource[]) {
        const q = inc.produces?.[r] ?? 0;
        if (q <= 0) continue;
        const sm = shortMult(t, r);
        gain += q * (t.ix.price[r] ?? 1) * sm;
        if (sm > 1) why.push(`${r} shortage forecast`);
      }
      if (inc.productionMult) gain += inc.productionMult * outVal * 0.6;
      if (inc.manpowerPerDay) gain += inc.manpowerPerDay * (t.ix.price.manpower ?? 1) * shortMult(t, 'manpower');
      if (inc.researchSlots) gain += inc.researchSlots * 50 * (0.5 + t.personality.research) * (v.self.researchSlots < 4 ? 1 : 0.3);
      if (inc.researchSpeedMult) gain += inc.researchSpeedMult * 30;
      if (inc.defenseMult && info) gain += inc.defenseMult * (info.threat > 0 ? info.vp * 25 : info.capital ? 6 : 0);
      if (inc.navalSlots) gain += inc.navalSlots * (geo === 'maritime' ? 6 : 2);
      if (inc.liftCapacity) gain += inc.liftCapacity * (geo === 'maritime' ? 12 : 3);
      if (inc.maintenanceSlots) gain += inc.maintenanceSlots * 4;
      if (inc.recruitSpeedMult) gain += inc.recruitSpeedMult * (a.enemies.length ? 40 : 12);
      if (inc.moraleDelta) gain += inc.moraleDelta * 2;
      const req = need.get(bt.id);
      if (req !== undefined && level <= req) { gain += 60; why.push('unlocks unit production'); }
      if (!gain) continue;
      const upkeep = resValue(t.ix, L.upkeepPerDay);
      const net = gain - upkeep;
      const costV = resValue(t.ix, L.cost);
      if (net <= 0 || costV / net > dl * 0.6) continue;
      const diversity = 1 / (1 + (counts.get(bt.id) ?? 0) * 0.15);
      cands.push({ b: bt, target: c.key, roi: (net / Math.max(1, costV)) * diversity * (info?.capital ? 1.1 : 1), why: why[0] ?? (inc.productionMult ? 'raise city output' : inc.researchSlots ? 'expand research capacity' : 'improve infrastructure') });
    }
  }
  // rural improvements on resource deposits
  let ruralSeen = 0;
  for (const p of v.provinces) {
    if (ruralSeen >= 12) break;
    const dep = t.ctx.map.nodes[p.node]?.deposit;
    if (!dep || busyNodes.has(p.node) || t.geo.cityByNode.has(p.node)) continue;
    for (const bt of t.ctx.catalog.buildings) {
      if (bt.scope !== 'rural' || !bt.levels.some((l) => l.effects.productionMult)) continue;
      if (bt.unlockTech && !v.self.techs.includes(bt.unlockTech)) continue;
      const cur = p.buildings.find((b) => b.type === bt.id)?.level ?? 0;
      if (cur + 1 > bt.maxLevel) continue;
      const L = bt.levels.find((l) => l.level === cur + 1);
      const inc = incEffects(bt, cur + 1);
      if (!L || !inc?.productionMult) continue;
      ruralSeen++;
      if (!t.affordable(milli(L.cost))) continue;
      const gain = inc.productionMult * 40 * (t.ix.price[dep] ?? 1) * shortMult(t, dep) * 0.5;
      const net = gain - resValue(t.ix, L.upkeepPerDay);
      const costV = resValue(t.ix, L.cost);
      if (net <= 0 || costV / net > dl * 0.6) continue;
      cands.push({ b: bt, target: p.node, roi: (net / costV) * 0.9, why: `${dep} deposit${shortMult(t, dep) > 1 ? ' (shortage)' : ''}` });
    }
  }
  cands.sort((x, y) => y.roi - x.roi || (x.b.id < y.b.id ? -1 : 1) || String(x.target).localeCompare(String(y.target)));
  let started = 0;
  const maxStart = Math.min(maxConcurrent - constructing.length, a.enemies.length || constructing.length >= 2 ? 1 : 2);
  const usedTargets = new Set<string | NodeId>();
  for (const c of cands.slice(0, 4)) {
    if (started >= maxStart || t.full) break;
    if (usedTargets.has(c.target)) continue;
    const r = t.add({ type: 'build', country: t.me, building: c.b.id, targets: [c.target] }, 'economic', 'build', `${c.b.name}: ${c.why}`);
    if (r) { started++; usedTargets.add(c.target); }
  }
}

// ───────────────────────────── mobilization ─────────────────────────────

function unitScore(t: Turn, u: UnitType, a: Analysis): { role: 'ground' | 'air' | 'naval'; s: number } | null {
  const lvl = t.view.self.unitLevels[u.id] ?? 1;
  const cost = Math.max(1, resValue(t.ix, u.cost) + resValue(t.ix, u.upkeepPerDay) * 20);
  if (u.domain === 'land') {
    if (!u.capture && u.family !== 'support') return null;
    return { role: 'ground', s: (groundPower(u, lvl) / cost) * (u.capture ? 1.35 : 0.9) };
  }
  if (u.domain === 'air') {
    if (u.family !== 'fighter') return null;
    return { role: 'air', s: airPower(u, lvl) / cost };
  }
  if (u.domain === 'sea' || u.domain === 'subsurface') {
    if (t.mem.geography === 'landlocked') return null;
    if (u.carries) return null;
    return { role: 'naval', s: navalPower(u, lvl) / cost };
  }
  void a;
  return null;
}

function headroom(t: Turn, u: UnitType, n: number): boolean {
  for (const r of Object.keys(u.upkeepPerDay) as Resource[]) {
    const up = (u.upkeepPerDay[r] ?? 0) * 1000 * n;
    if (!up) continue;
    const s = t.res[r];
    if (!s) continue;
    const net = s.netPerDay - up;
    if (net >= 0) continue;
    const stock = t.budget[r];
    if (stock / -net < 14) return false;
  }
  return true;
}

function mobilization(t: Turn, a: Analysis): void {
  const v = t.view;
  const geo = t.mem.geography;
  const mobilizing = v.self.jobs.filter((j) => j.kind === 'mobilize');
  const required = a.cities.reduce((s, c) => s + c.required, 0);
  const war = a.enemies.length > 0;
  const expand = t.mem.plan.stance === 'expand';
  let desired = required * (war ? 1.8 : expand ? 1.35 : 1.0) + (expand ? t.ix.avgGround * (2 + a.cities.length * 0.3) : 0);
  if (t.mem.objective?.node !== null && t.mem.objective?.node !== undefined && expand) desired += t.ix.avgGround * 2;
  const pipeline = mobilizing.length * t.ix.avgGround;
  const satisfied = a.myGround + pipeline >= desired;
  if (satisfied && (mobilizing.length > 0 || (t.res.money?.netPerDay ?? 0) <= 0 || v.day % 2 === 1)) return;
  const ground = { ground: 0, air: 0, naval: 0 };
  for (const s of v.stacks) for (const _ of s.units) ground[s.moveClass === 'air' ? 'air' : s.moveClass === 'naval' ? 'naval' : 'ground']++;
  const total = Math.max(1, ground.ground + ground.air + ground.naval);
  const target = geo === 'landlocked' ? { ground: 0.85, air: 0.15, naval: 0 } : geo === 'maritime' ? { ground: 0.55, air: 0.15, naval: 0.3 } : { ground: 0.72, air: 0.13, naval: 0.15 };
  const deficitRole = (['ground', 'air', 'naval'] as const).map((r) => ({ r, d: target[r] - ground[r] / total })).sort((x, y) => y.d - x.d || (x.r < y.r ? -1 : 1));
  const techs = new Set(v.self.techs);
  const avail = t.ctx.catalog.units.filter((u) => !u.unlockTech || techs.has(u.unlockTech));
  const scored = avail.map((u) => ({ u, sc: unitScore(t, u, a) })).filter((x) => x.sc) as { u: UnitType; sc: { role: 'ground' | 'air' | 'naval'; s: number } }[];
  const maxJobs = satisfied ? 1 : war ? 3 : 2;
  let issued = 0;
  const homeCities = v.cities.filter((c) => (v.provinces.find((p) => p.node === c.node)?.status ?? 'homeland') !== 'occupied');
  // order roles: ground first when below garrison requirement
  const roles = a.myGround < required ? ['ground', ...deficitRole.map((x) => x.r).filter((r) => r !== 'ground')] : deficitRole.map((x) => x.r);
  for (const role of roles) {
    if (issued >= maxJobs || t.full || mobilizing.length + issued >= Math.max(2, homeCities.length)) break;
    if (role !== 'ground' && a.myGround < required * 0.8) continue;
    if (satisfied && role === 'ground' && deficitRole[0].r !== 'ground') continue;
    const list = scored.filter((x) => x.sc.role === role).sort((x, y) => y.sc.s - x.sc.s || (x.u.id < y.u.id ? -1 : 1));
    for (const { u } of list.slice(0, 3)) {
      if (!headroom(t, u, 1) || !t.affordable(milli(u.cost, u.doctrine?.[t.view.self.doctrine as 'western']?.costMult ?? 1))) continue;
      // city meeting requirements, safest/closest to objective, without a mobilization this turn
      const cities = homeCities.filter((c) => !t.busyCity.has(`m:${c.key}`) && u.requires.every((req) => (c.buildings.find((b) => b.type === req.building)?.level ?? 0) >= req.level) && (role !== 'naval' || c.port));
      if (!cities.length) continue;
      const obj = t.mem.objective?.node;
      cities.sort((x, y) => {
        const qx = v.self.jobs.filter((j) => j.city === x.key && j.kind === 'mobilize').length;
        const qy = v.self.jobs.filter((j) => j.city === y.key && j.kind === 'mobilize').length;
        const dx = obj != null ? km(t.geo, x.node, obj) : 0;
        const dy = obj != null ? km(t.geo, y.node, obj) : 0;
        return qx - qy || dx - dy || (x.key < y.key ? -1 : 1);
      });
      const city = cities[0];
      const r = t.add({ type: 'mobilize', country: t.me, unit: u.id, cities: [city.key] }, 'economic', 'mobilize', satisfied ? `${role} share below plan mix; upkeep headroom ok` : `${role} force below plan (${a.myGround.toFixed(0)} vs ${desired.toFixed(0)}); upkeep headroom ok`);
      if (r) {
        t.busyCity.add(`m:${city.key}`);
        issued++;
        break;
      }
    }
  }
}

// ───────────────────────────── market ─────────────────────────────

function market(t: Turn): void {
  const v = t.view;
  const mine = v.market.myOrders.filter((o) => o.status === 'open');
  // cancel stale orders (no fill for days) and orders whose purpose vanished; a cooldown per
  // resource/side prevents cancel/requeue loops, and the next order is re-priced on a ladder.
  for (const o of mine) {
    if (t.full) break;
    const s = t.res[o.resource];
    const age = t.now - o.createdAt;
    const stale = age > (o.side === 'sell' ? 4 : 2) * DAY && o.filled === 0;
    const pointless = o.side === 'buy' ? (s?.netPerDay ?? 0) > 0 && (s?.stock ?? 0) > t.reserve[o.resource] * 2 : t.mem.plan.shortages.includes(o.resource);
    if (stale || pointless) {
      if (t.add({ type: 'cancelMarketOrder', country: t.me, order: o.id }, 'economic', 'cancel_order', stale ? `stale ${o.side} order (${Math.round(age / 60)} h without a fill)` : 'need changed')) {
        t.marketOpen--;
        t.mem.cooldown[`mkt:${o.side}:${o.resource}`] = t.now + 2 * DAY;
        if (stale) t.mem.counters[`ladder:${o.resource}`] = Math.min(4, (t.mem.counters[`ladder:${o.resource}`] ?? 0) + 1);
      }
    }
  }
  if (t.marketOpen >= 4) return;
  const openRes = new Set(mine.map((o) => o.resource));
  // 1. buy inputs that blocked a planned investment this review (creates real demand/liquidity)
  for (const r of RESOURCES) {
    const gap = t.blocked[r] ?? 0;
    if (r === 'money' || gap <= 0 || openRes.has(r) || t.full) continue;
    if ((t.mem.cooldown[`mkt:buy:${r}`] ?? 0) > t.now) continue;
    const ref = Math.round((t.ix.price[r] ?? 1) * 1000);
    const bestAsk = v.market.books[r]?.asks?.[0]?.price ?? null;
    const price = bestAsk !== null && bestAsk <= ref * 1.3 ? bestAsk : Math.round(ref * 1.1);
    const maxMoney = Math.max(0, t.budget.money - t.reserve.money) * 0.4;
    const qty = Math.min(Math.ceil(gap / 1000), Math.floor(maxMoney / price));
    if (qty < 1) continue;
    if (t.add({ type: 'marketOrder', country: t.me, side: 'buy', resource: r, qty, price }, 'economic', 'market_buy', `buy ${r} for a planned investment (short ${Math.ceil(gap / 1000)})`)) { t.marketOpen++; return; }
  }
  // 2. cash-starved: sell the largest surplus competitively, even into a crowded book
  if ((t.blocked.money ?? 0) > 0 && t.budget.money < t.reserve.money * 2 + 1_500_000) {
    const sur = (RESOURCES.filter((r) => r !== 'money' && !openRes.has(r) && !t.mem.plan.shortages.includes(r)) as Resource[])
      .map((r) => ({ r, ex: (t.res[r]?.stock ?? 0) - Math.max(t.reserve[r] * 3, (t.res[r]?.consumptionPerDay ?? 0) * 8) }))
      .filter((x) => x.ex > 20_000 && (t.res[x.r]?.netPerDay ?? 0) >= 0)
      .sort((a, b) => b.ex * (t.ix.price[b.r] ?? 1) - a.ex * (t.ix.price[a.r] ?? 1) || (a.r < b.r ? -1 : 1))[0];
    if (sur && (t.mem.cooldown[`mkt:sell:${sur.r}`] ?? 0) <= t.now) {
      const ref = Math.round((t.ix.price[sur.r] ?? 1) * 1000);
      const book = v.market.books[sur.r];
      const bestBid = book?.bids?.[0]?.price ?? null;
      const bestAsk = book?.asks?.[0]?.price ?? null;
      const price = bestBid !== null && bestBid >= ref * 0.7 ? bestBid : Math.max(Math.round(ref * 0.6), bestAsk !== null ? Math.round(bestAsk * 0.98) : Math.round(ref * 0.95));
      const qty = Math.floor((sur.ex * 0.3) / 1000);
      if (qty >= 5 && t.add({ type: 'marketOrder', country: t.me, side: 'sell', resource: sur.r, qty, price }, 'economic', 'market_sell', `raise money: sell ${sur.r} surplus competitively`)) { t.marketOpen++; return; }
    }
  }
  // 3. deficits first (cover shortages), then surpluses (supply liquidity)
  const order = [...RESOURCES].sort((x, y) => Number(t.mem.plan.shortages.includes(y)) - Number(t.mem.plan.shortages.includes(x)));
  for (const r of order) {
    if (r === 'money' || t.full) continue;
    if (openRes.has(r)) continue;
    const s = t.res[r];
    if (!s) continue;
    const ref = Math.round((t.ix.price[r] ?? 1) * 1000);
    const book = v.market.books[r];
    const deficit = t.mem.plan.shortages.includes(r) || s.stock < t.reserve[r];
    if (deficit) {
      if ((t.mem.cooldown[`mkt:buy:${r}`] ?? 0) > t.now) continue;
      const perDay = Math.max(s.consumptionPerDay - s.grossPerDay, t.reserve[r] - s.stock, 1000);
      let qty = Math.ceil((perDay * 2) / 1000);
      const bestAsk = book?.asks?.[0]?.price ?? null;
      const price = bestAsk !== null && bestAsk <= ref * 1.6 ? bestAsk : Math.round(ref * 1.25);
      const maxMoney = Math.max(0, t.budget.money - t.reserve.money) * 0.3;
      qty = Math.min(qty, Math.floor(maxMoney / price));
      if (qty < 1) continue;
      if (t.add({ type: 'marketOrder', country: t.me, side: 'buy', resource: r, qty, price }, 'economic', 'market_buy', `cover ${r} deficit (${(s.netPerDay / 1000).toFixed(0)}/day)`)) { t.marketOpen++; return; }
      continue;
    }
    // surplus: plenty of days of consumption and positive net flow → supply liquidity
    if ((t.mem.cooldown[`mkt:sell:${r}`] ?? 0) > t.now) continue;
    const days = s.consumptionPerDay > 0 ? s.stock / s.consumptionPerDay : s.stock > 0 ? 99 : 0;
    const glut = (book?.asks?.length ?? 0) >= 4 && (book?.bids?.length ?? 0) === 0;
    if (s.netPerDay >= 0 && days > 12 && s.stock > t.reserve[r] * 3 + 50_000 && !glut) {
      const excess = s.stock - Math.max(t.reserve[r] * 3, s.consumptionPerDay * 10);
      const qty = Math.floor((excess * 0.15) / 1000);
      if (qty < 5) continue;
      const bestBid = book?.bids?.[0]?.price ?? null;
      const ladder = t.mem.counters[`ladder:${r}`] ?? 0;
      const ask = Math.round(ref * (1.02 + t.personality.trade * 0.08 - ladder * 0.05));
      const price = bestBid !== null && bestBid >= ref * 0.85 ? bestBid : Math.max(Math.round(ref * 0.8), ask);
      if (t.add({ type: 'marketOrder', country: t.me, side: 'sell', resource: r, qty, price }, 'economic', 'market_sell', `sell ${r} surplus (${days.toFixed(0)} days of stock)`)) { t.marketOpen++; return; }
    }
  }
}

// ───────────────────────────── annex ─────────────────────────────

function annexation(t: Turn): void {
  if (t.mem.plan.stance === 'defend') return;
  for (const p of t.view.provinces) {
    if (t.full) return;
    if (p.status !== 'occupied') continue;
    const ci = t.geo.cityByNode.get(p.node);
    if (!ci) continue;
    if (t.view.self.jobs.some((j) => j.kind === 'annex' && j.node === p.node)) continue;
    if (t.add({ type: 'annex', country: t.me, city: ci.key }, 'economic', 'annex', 'occupied city: annex to restore output and mobilization')) return;
  }
}

// ───────────────────────────── missile procurement ─────────────────────────────

/** Trade position for a missile's inputs: days of coverage of one batch (min over inputs). */
export function tradeIndex(t: Turn, missileId: string): number {
  const mt = t.ix.missileById.get(missileId);
  if (!mt) return 0;
  let idx = 1e9;
  for (const r of Object.keys(mt.cost) as Resource[]) {
    const need = (mt.cost[r] ?? 0) * 1000;
    if (need <= 0) continue;
    const s = t.res[r];
    const stock = s?.stock ?? 0;
    const net = s?.netPerDay ?? 0;
    let cov = (stock + net * 3) / need;
    const ask = t.view.market.books[r]?.asks?.[0]?.price;
    if (r !== 'money' && ask !== undefined && ask > (t.ix.price[r] ?? 1) * 1000 * 1.5) cov *= 0.6;
    if (t.view.self.shortages.includes(r) || t.mem.plan.shortages.includes(r)) cov *= 0.5;
    idx = Math.min(idx, cov);
  }
  return Math.round(Math.max(0, idx) * 100) / 100;
}

/** Campaign-point value of one missile batch vs spending the same resources on ground units. */
export function procurementValue(t: Turn, a: Analysis, missileId: string): { value: number; alt: number; target: NodeId | null } {
  const mt = t.ix.missileById.get(missileId);
  if (!mt) return { value: 0, alt: 0, target: null };
  const from = a.capitalNode;
  let bestVp = 0, target: NodeId | null = null;
  if (from !== null) for (const pc of t.view.publicCities) {
    if (!pc.owner || !a.enemies.includes(pc.owner)) continue;
    const d = km(t.geo, from, pc.node);
    if (d > mt.rangeKm) continue;
    const vp = t.geo.vp[pc.node];
    if (vp > bestVp) { bestVp = vp; target = pc.node; }
  }
  const headline = mt.outcomes.arrived_effect + mt.outcomes.arrived_limited * 0.5;
  const intercept = Math.min(0.9, mt.interceptBase * 0.5);
  const value = mt.batchSize * headline * (1 - intercept) * (bestVp * 0.15 + mt.effect.unitDamage * 0.05 + mt.effect.conditionDelta * 0.02);
  // alternative: best capture unit bought with the same reference value
  const costV = resValue(t.ix, mt.cost);
  let alt = 0;
  for (const u of t.ctx.catalog.units) {
    if (!u.capture || (u.unlockTech && !t.view.self.techs.includes(u.unlockTech))) continue;
    const uc = Math.max(1, resValue(t.ix, u.cost));
    alt = Math.max(alt, (costV / uc) * (groundPower(u, t.view.self.unitLevels[u.id] ?? 1) / t.ix.avgGround) * 0.6);
  }
  return { value: Math.round(value * 100) / 100, alt: Math.round(alt * 100) / 100, target };
}

function procurement(t: Turn, a: Analysis): void {
  const mem = t.mem;
  const p = mem.procurement;
  if (p && p.status === 'proposed') {
    const idx = tradeIndex(t, p.missile);
    const mt = t.ix.missileById.get(p.missile);
    if (idx < p.tradeIndex * 0.6 || idx < 1) {
      const worst = mt ? (Object.keys(mt.cost) as Resource[]).filter((r) => r !== 'money').sort((x, y) => (t.res[x]?.stock ?? 0) / ((mt.cost[x] ?? 1) * 1000) - (t.res[y]?.stock ?? 0) / ((mt.cost[y] ?? 1) * 1000))[0] : 'inputs';
      p.status = 'cancelled';
      p.reason = `trade position deteriorated: ${worst} coverage index fell from ${p.tradeIndex} to ${idx}`;
      t.note('economic', 'procurement_cancelled', `${p.missile} batch`, p.reason);
      return;
    }
    if (t.now - p.proposedAt >= 4 * 60) {
      const r = t.add({ type: 'produceMissile', country: t.me, missile: p.missile, batches: 1 }, 'economic', 'procurement_ordered', `confirmed after review: value ${p.value} pts vs ${p.altValue} for ground units; trade index ${idx}`);
      if (r) {
        p.status = 'ordered';
        const job = t.view.self.jobs.find((j) => j.kind === 'missile' && j.missile === p.missile);
        if (job) p.job = job.id;
      }
    }
    return;
  }
  if (p && p.status === 'ordered') {
    // a queued (not started) batch can still be cancelled with a full refund if inputs collapse
    const job = t.view.self.jobs.find((j) => j.kind === 'missile' && j.missile === p.missile && j.startedAt === null);
    const idx = tradeIndex(t, p.missile);
    if (job && idx < p.tradeIndex * 0.3) {
      if (t.add({ type: 'cancelJob', country: t.me, job: job.id }, 'economic', 'procurement_cancelled', `queued batch cancelled: trade index ${idx} vs ${p.tradeIndex} at order`)) p.status = 'cancelled';
      return;
    }
    if (!t.view.self.jobs.some((j) => j.kind === 'missile' && j.missile === p.missile)) mem.procurement = null;
    return;
  }
  if (p && p.status === 'cancelled' && t.now - p.proposedAt < 2 * DAY) return;
  // new proposal: only with a qualified program, at war or threatened, and value beating ground units
  if (!a.enemies.length) return;
  for (const [id, inv] of Object.entries(t.view.self.missiles).sort()) {
    if (inv.maturity === 'prototype' || inv.maturity === 'expended') continue;
    const mt = t.ix.missileById.get(id);
    if (!mt || inv.ready >= mt.inventoryCeiling) continue;
    const { value, alt, target } = procurementValue(t, a, id);
    const idx = tradeIndex(t, id);
    if (target === null || value <= alt * 1.05 || idx < 2) {
      t.note('economic', 'procurement_rejected', id, `value ${value} pts vs ${alt} for ground units; trade index ${idx}`);
      continue;
    }
    mem.procurement = { missile: id, status: 'proposed', proposedAt: t.now, tradeIndex: idx, value, altValue: alt, reason: `value ${value} pts > ${alt} pts for ground units` };
    t.note('economic', 'procurement_proposed', `${id} batch`, mem.procurement.reason + `; trade index ${idx}`);
    return;
  }
}

export function economicReview(t: Turn, a: Analysis): void {
  const before = t.out.length;
  procurement(t, a);
  research(t, a);
  if (t.mem.plan.stance === 'defend' || a.myGround < a.cities.reduce((s, c) => s + c.required, 0)) {
    mobilization(t, a);
    construction(t, a);
  } else {
    construction(t, a);
    mobilization(t, a);
  }
  market(t);
  annexation(t);
  if (t.out.length === before) {
    t.mem.idleEconomic++;
    if (t.mem.idleEconomic >= 3) fallback(t);
  } else t.mem.idleEconomic = 0;
}

/** Anti-stall fallback after repeated idle economic reviews: cheapest legal productive action. */
function fallback(t: Turn): void {
  const v = t.view;
  const cap = v.cities.find((c) => c.key === v.self.capitalCity) ?? v.cities[0];
  if (cap) {
    const list = t.ctx.catalog.buildings.filter((b) => b.scope === 'city' && (!b.unlockTech || v.self.techs.includes(b.unlockTech)) && !b.coastalOnly).sort((x, y) => resValue(t.ix, x.levels[0].cost) - resValue(t.ix, y.levels[0].cost) || (x.id < y.id ? -1 : 1));
    for (const b of list.slice(0, 4)) if (t.add({ type: 'build', country: t.me, building: b.id, targets: [cap.key] }, 'economic', 'build', 'anti-stall: cheapest productive project', { useReserve: false })) { t.mem.idleEconomic = 0; return; }
  }
  const techs = [...t.ctx.catalog.techs].filter((x) => !v.self.techs.includes(x.id) && x.prereqs.every((p) => v.self.techs.includes(p)) && x.dayAvailable <= v.day).sort((x, y) => resValue(t.ix, x.cost) - resValue(t.ix, y.cost) || (x.id < y.id ? -1 : 1));
  for (const x of techs.slice(0, 3)) if (t.researchFree > 0 && t.add({ type: 'startResearch', country: t.me, tech: x.id }, 'economic', 'research', 'anti-stall: cheapest available research')) { t.mem.idleEconomic = 0; return; }
}
