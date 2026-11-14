/** National commands: build/mobilize/annex/research/market/diplomacy/coalitions/missiles/intel/news/messages. */
import { RESOURCES, type CityKey, type CountryId, type NodeId } from '../data-types';
import type { GameState, Offer } from '../state';
import type { CommandOf } from './types';
import { fail, ok, shortReason, type Handler } from './common';
import { S } from '../scenario/registry';
import { addInto, copy, geq, mul, type ResM, shortfall, subInto, vecFromWhole, zero, fmtVec } from '../fixed';
import {
  cancelJobInternal,
  checkBuild,
  checkMobilize,
  enqueueJob,
  estimateStart,
  jobRefund,
  locationKey,
  type BuildCheck,
  buildingLevelDef,
} from '../systems/production';
import { cancelResearchInternal, researchRefund, startResearchInternal, techStatus } from '../systems/research';
import { cancelOrderInternal, escrowFor, placeOrderInternal, previewMatch, type FillPreview } from '../systems/market';
import {
  acceptability,
  declareWarInternal,
  MAX_PENDING,
  pendingOffersBetween,
  postMessage,
  proposeOfferInternal,
  renderIntent,
  respondOfferInternal,
  revokeGrantInternal,
  threadFor,
  validateTerms,
} from '../systems/diplomacy';
import { announceDeparture, canJoin, createCoalitionInternal, joinCoalitionInternal } from '../systems/coalitions';
import { checkLaunch, launchInternal, type LaunchCheck } from '../systems/missiles';
import { assignAgentInternal, snapshotReport } from '../systems/intel';
import { charge, credit } from '../systems/ledger';
import { bumpEconomy } from '../systems/economy';
import { atWar, coalitionOf, grantLevel, levelAtLeast, sameCoalition } from '../systems/world';
import { emit, toAll } from '../systems/events';
import { nextId } from '../ids';
import { hash64Hex } from '../rng';
import { dayOf } from '../time';
import { ANNEX_BASE_COST, ANNEX_COST_PER_TIER, ANNEX_HOURS, AGENT_COST, DEMOLISH_REFUND_FACTOR, INTEL_REPORT_COST, MARKET_MAX_OPEN_PER_COUNTRY, MARKET_MAX_PRICE, MAX_AGENTS } from '../rules';

// ───────────────────────────── bulk build / mobilize ─────────────────────────────

export interface BulkRow {
  target: CityKey | NodeId;
  name: string;
  ok: boolean;
  code?: string;
  reason?: string;
  level?: number;
  cost?: ResM;
  startTick?: number;
  durationMin?: number;
  queuePosition?: number;
  warning?: string;
}
export interface BulkPreview {
  rows: BulkRow[];
  eligible: number;
  total: ResM;
  token: string;
}

function tokenOf(state: GameState, country: CountryId, rows: BulkRow[]): string {
  return hash64Hex(JSON.stringify({ s: state.countries[country].stock, r: rows.map((r) => [r.target, r.ok, r.level, r.cost, r.startTick]) }));
}

function bulkFinish(state: GameState, country: CountryId, rows: BulkRow[], given?: string) {
  const total = zero();
  for (const r of rows) if (r.ok && r.cost) addInto(total, r.cost);
  const preview: BulkPreview = { rows, eligible: rows.filter((r) => r.ok).length, total, token: tokenOf(state, country, rows) };
  if (given && given !== preview.token) return fail('stale_preview', 'The situation changed since the preview (treasury, ownership or queues). Review the refreshed preview.', preview);
  if (!preview.eligible) return fail(rows[0]?.code ?? 'invalid_argument', rows.length ? `No eligible targets: ${rows.map((r) => `${r.name}: ${r.reason}`).join('; ')}` : 'No targets selected.', preview);
  return ok(preview);
}

export const build: Handler<CommandOf<'build'>, BulkPreview> = {
  validate(state, cmd) {
    const bt = S(state).cat.buildings.get(cmd.building);
    if (!Array.isArray(cmd.targets) || !cmd.targets.length) return fail('invalid_argument', 'Select at least one city or province.');
    if (new Set(cmd.targets).size !== cmd.targets.length) return fail('invalid_argument', 'Duplicate targets.');
    const budget = copy(state.countries[cmd.country].stock);
    const rows: BulkRow[] = [];
    for (const t of cmd.targets) {
      const name = typeof t === 'string' ? state.cities[t]?.name ?? String(t) : S(state).map.data.nodes[t]?.name ?? String(t);
      const chk: BuildCheck = checkBuild(state, cmd.country, t, bt);
      if (!chk.ok) { rows.push({ target: t, name, ok: false, code: chk.code, reason: chk.reason }); continue; }
      if (!geq(budget, chk.cost as ResM)) { rows.push({ target: t, name, ok: false, code: 'insufficient_resources', reason: shortReason(shortfall(budget, chk.cost as ResM)), cost: chk.cost }); continue; }
      subInto(budget, chk.cost as ResM);
      const key = chk.city ? `c:${chk.city}:construct` : `n:${chk.node}:construct`;
      rows.push({ target: t, name, ok: true, level: chk.level, cost: chk.cost, durationMin: chk.durationMin, startTick: estimateStart(state, cmd.country, key), queuePosition: state.countries[cmd.country].jobs.filter((j) => locationKey(j) === key).length + 1, warning: chk.warning });
    }
    return bulkFinish(state, cmd.country, rows, cmd.previewToken);
  },
  apply(state, cmd, p) {
    const jobs: string[] = [];
    for (const r of p.rows) {
      if (!r.ok) continue;
      const city = typeof r.target === 'string' ? r.target : null;
      const node = city ? state.cities[city].node : (r.target as NodeId);
      const j = enqueueJob(state, { kind: 'construct', country: cmd.country, city, node, building: cmd.building, level: r.level, cost: r.cost as ResM, durationMin: r.durationMin as number, slot: 'construct', reason: cmd.reason });
      if (j) jobs.push(j.id);
    }
    return { jobs, charged: p.total };
  },
};

export const mobilize: Handler<CommandOf<'mobilize'>, BulkPreview> = {
  validate(state, cmd) {
    const ut = S(state).cat.units.get(cmd.unit);
    if (!Array.isArray(cmd.cities) || !cmd.cities.length) return fail('invalid_argument', 'Select at least one city.');
    if (new Set(cmd.cities).size !== cmd.cities.length) return fail('invalid_argument', 'Duplicate cities.');
    const budget = copy(state.countries[cmd.country].stock);
    const rows: BulkRow[] = [];
    for (const c of cmd.cities) {
      const name = state.cities[c]?.name ?? c;
      const chk = checkMobilize(state, cmd.country, c, ut);
      if (!chk.ok) { rows.push({ target: c, name, ok: false, code: chk.code, reason: chk.reason }); continue; }
      if (!geq(budget, chk.cost as ResM)) { rows.push({ target: c, name, ok: false, code: 'insufficient_resources', reason: shortReason(shortfall(budget, chk.cost as ResM)), cost: chk.cost }); continue; }
      subInto(budget, chk.cost as ResM);
      const key = `c:${c}:mobilize`;
      rows.push({ target: c, name, ok: true, cost: chk.cost, durationMin: chk.durationMin, startTick: estimateStart(state, cmd.country, key), queuePosition: state.countries[cmd.country].jobs.filter((j) => locationKey(j) === key).length + 1 });
    }
    return bulkFinish(state, cmd.country, rows, cmd.previewToken);
  },
  apply(state, cmd, p) {
    const jobs: string[] = [];
    for (const r of p.rows) {
      if (!r.ok) continue;
      const city = r.target as CityKey;
      const j = enqueueJob(state, { kind: 'mobilize', country: cmd.country, city, node: state.cities[city].node, unit: cmd.unit, cost: r.cost as ResM, durationMin: r.durationMin as number, slot: 'mobilize', reason: cmd.reason });
      if (j) jobs.push(j.id);
    }
    return { jobs, charged: p.total };
  },
};

export const cancelJob: Handler<CommandOf<'cancelJob'>, { refund: ResM; active: boolean }> = {
  validate(state, cmd) {
    const j = state.countries[cmd.country].jobs.find((x) => x.id === cmd.job);
    if (!j) return fail('unknown_target', 'No such job in your queues (it may have completed).');
    return ok({ refund: jobRefund(j, state.clock.tick), active: j.startedAt !== null });
  },
  apply(state, cmd) {
    return { refund: cancelJobInternal(state, cmd.country, cmd.job, 'cancelled by order') };
  },
};

export const annex: Handler<CommandOf<'annex'>, { cost: ResM; durationMin: number; startTick: number }> = {
  validate(state, cmd) {
    const city = state.cities[cmd.city];
    if (!city) return fail('unknown_target', 'Unknown city.');
    const p = state.provinces[city.node];
    if (!p || p.owner !== cmd.country) return fail('not_owner', `You do not control ${city.name}.`);
    if (p.status !== 'occupied') return fail('invalid_argument', p.status === 'annexed' ? `${city.name} is already annexed.` : `${city.name} is part of your homeland.`);
    if (state.countries[cmd.country].jobs.some((j) => j.kind === 'annex' && j.city === cmd.city)) return fail('busy', 'Annexation already queued.');
    const cost = vecFromWhole(ANNEX_BASE_COST);
    addInto(cost, mul(vecFromWhole(ANNEX_COST_PER_TIER), city.tier));
    if (!geq(state.countries[cmd.country].stock, cost)) return fail('insufficient_resources', shortReason(shortfall(state.countries[cmd.country].stock, cost)), { shortfall: shortfall(state.countries[cmd.country].stock, cost) });
    return ok({ cost, durationMin: ANNEX_HOURS * 60, startTick: estimateStart(state, cmd.country, `c:${cmd.city}:construct`) });
  },
  apply(state, cmd, p) {
    const city = state.cities[cmd.city];
    const j = enqueueJob(state, { kind: 'annex', country: cmd.country, city: cmd.city, node: city.node, cost: p.cost, durationMin: p.durationMin, slot: 'construct' });
    return { job: j?.id };
  },
};

export const demolish: Handler<CommandOf<'demolish'>, { refund: ResM; newLevel: number; effectsLost: string[] }> = {
  validate(state, cmd) {
    const city = typeof cmd.target === 'string' ? state.cities[cmd.target] : null;
    const node = city ? city.node : (cmd.target as NodeId);
    const p = state.provinces[node];
    if (!p || p.owner !== cmd.country) return fail('not_owner', 'You do not control that location.');
    const list = city ? city.buildings : p.buildings;
    const b = list.find((x) => x.type === cmd.building);
    if (!b) return fail('unknown_target', 'No such building there.');
    const d = buildingLevelDef(state, b);
    return ok({ refund: mul(vecFromWhole(d?.cost), DEMOLISH_REFUND_FACTOR), newLevel: b.level - 1, effectsLost: Object.keys(d?.effects ?? {}) });
  },
  apply(state, cmd, p) {
    const city = typeof cmd.target === 'string' ? state.cities[cmd.target] : null;
    const list = city ? city.buildings : (state.provinces[cmd.target as NodeId] as { buildings: { type: string; level: number }[] }).buildings;
    const idx = list.findIndex((x) => x.type === cmd.building);
    if (p.newLevel <= 0) list.splice(idx, 1);
    else list[idx].level = p.newLevel;
    credit(state, cmd.country, 'refund', p.refund);
    bumpEconomy(state);
    return { refund: p.refund };
  },
};

export const setRally: Handler<CommandOf<'setRally'>, { node: NodeId | null }> = {
  validate(state, cmd) {
    const city = state.cities[cmd.city];
    if (!city || state.provinces[city.node]?.owner !== cmd.country) return fail('not_owner', 'You do not control that city.');
    if (cmd.node !== null && (!Number.isInteger(cmd.node) || cmd.node < 0 || cmd.node >= S(state).map.n)) return fail('unknown_target', 'Unknown rally point.');
    return ok({ node: cmd.node });
  },
  apply(state, cmd) {
    state.cities[cmd.city].rally = cmd.node;
    return {};
  },
};

// ───────────────────────────── research ─────────────────────────────

export const startResearch: Handler<CommandOf<'startResearch'>, { cost: ResM; durationMin: number }> = {
  validate(state, cmd) {
    const info = techStatus(state, cmd.country, cmd.tech);
    if (info.status !== 'available') {
      const code = info.status === 'unaffordable' ? 'insufficient_resources' : info.status === 'slots_full' || info.status === 'busy' ? 'busy' : info.status === 'completed' ? 'already_resolved' : 'locked_tech';
      return fail(code, info.status === 'unaffordable' ? shortReason(info.shortfall) : info.reason, info);
    }
    return ok({ cost: info.cost, durationMin: info.durationMin });
  },
  apply(state, cmd) {
    return { started: startResearchInternal(state, cmd.country, cmd.tech) };
  },
};

export const cancelResearch: Handler<CommandOf<'cancelResearch'>, { refund: ResM }> = {
  validate(state, cmd) {
    const r = researchRefund(state, cmd.country, cmd.tech);
    if (!r) return fail('unknown_target', 'That research is not in progress.');
    return ok({ refund: r });
  },
  apply(state, cmd) {
    return { refund: cancelResearchInternal(state, cmd.country, cmd.tech) };
  },
};

// ───────────────────────────── market ─────────────────────────────

export const marketOrder: Handler<CommandOf<'marketOrder'>, { escrow: ResM; match: FillPreview; available: number }> = {
  validate(state, cmd) {
    if (cmd.side !== 'buy' && cmd.side !== 'sell') return fail('invalid_argument', 'Side must be buy or sell.');
    if (!RESOURCES.includes(cmd.resource) || cmd.resource === 'money') return fail('invalid_argument', 'Choose a tradeable resource (not money).');
    if (!Number.isInteger(cmd.qty) || cmd.qty < 1 || cmd.qty > 1_000_000) return fail('invalid_argument', 'Quantity must be a whole number between 1 and 1,000,000.');
    if (!Number.isInteger(cmd.price) || cmd.price < 1 || cmd.price > MARKET_MAX_PRICE) return fail('invalid_argument', `Price must be a whole number of milli-money between 1 and ${MARKET_MAX_PRICE}.`);
    const open = Object.values(state.market.orders).filter((o) => o.country === cmd.country && o.status === 'open').length;
    if (open >= MARKET_MAX_OPEN_PER_COUNTRY) return fail('busy', `You already have ${open} open orders (limit ${MARKET_MAX_OPEN_PER_COUNTRY}).`);
    const esc = escrowFor(cmd.side, cmd.resource, cmd.qty, cmd.price);
    const stock = state.countries[cmd.country].stock;
    if (!geq(stock, esc)) {
      const sh = shortfall(stock, esc);
      return fail('insufficient_resources', `${cmd.side === 'buy' ? 'Unavailable cash' : 'Unavailable goods'} — ${shortReason(sh)}`, { shortfall: sh });
    }
    const match = previewMatch(state, cmd.country, cmd.side, cmd.resource, cmd.qty, cmd.price);
    return ok({ escrow: esc, match, available: cmd.side === 'buy' ? stock.money : stock[cmd.resource] }, match.filledQty === 0 ? ['No order crosses at this price; it will rest in the book.'] : undefined);
  },
  apply(state, cmd) {
    const o = placeOrderInternal(state, cmd.country, cmd.side, cmd.resource, cmd.qty, cmd.price);
    return { order: o?.id, filled: o?.filled ?? 0 };
  },
};

export const cancelMarketOrder: Handler<CommandOf<'cancelMarketOrder'>, { release: number; qty: number }> = {
  validate(state, cmd) {
    const o = state.market.orders[cmd.order];
    if (!o) return fail('unknown_target', 'No such order.');
    if (o.country !== cmd.country) return fail('not_owner', 'Not your order.');
    if (o.status === 'filled') return fail('already_resolved', `Order already completely filled (${o.filled}/${o.qty}); nothing to cancel.`);
    if (o.status === 'cancelled') return fail('already_resolved', `Order already cancelled; its unfilled ${o.cancelledQty} were released.`);
    return ok({ release: o.escrow, qty: o.qty - o.filled });
  },
  apply(state, cmd) {
    return cancelOrderInternal(state, cmd.order);
  },
};

// ───────────────────────────── diplomacy ─────────────────────────────

function aliveCountry(state: GameState, c: CountryId) {
  return !!state.countries[c] && state.countries[c].alive;
}

export const proposeOffer: Handler<CommandOf<'proposeOffer'>, { expiresAt: number; effectiveDelayMin: number }> = {
  validate(state, cmd) {
    if (!aliveCountry(state, cmd.to) || cmd.to === cmd.country) return fail('unknown_target', 'Unknown or eliminated recipient.');
    if (!Array.isArray(cmd.give) || !Array.isArray(cmd.receive)) return fail('invalid_argument', 'Terms must be lists.');
    const err = validateTerms(state, cmd.country, cmd.to, cmd.give, cmd.receive);
    if (err) return fail('invalid_argument', err);
    if (pendingOffersBetween(state, cmd.country, cmd.to).length >= MAX_PENDING) return fail('busy', `There are already ${MAX_PENDING} pending offers with ${cmd.to}.`);
    const need = zero();
    for (const t of cmd.give) if (t.kind === 'resource') need[t.resource] += t.amount;
    if (!geq(state.countries[cmd.country].stock, need)) return fail('insufficient_resources', shortReason(shortfall(state.countries[cmd.country].stock, need)));
    const exp = cmd.expiresInMin ?? 2880;
    if (!Number.isInteger(exp) || exp < 60 || exp > 14 * 1440) return fail('invalid_argument', 'Expiry must be between 1 hour and 14 days.');
    return ok({ expiresAt: state.clock.tick + exp, effectiveDelayMin: 60 });
  },
  apply(state, cmd) {
    const o = proposeOfferInternal(state, cmd.country, cmd.to, cmd.give, cmd.receive, cmd.expiresInMin, cmd.reason ?? null, cmd.text);
    return { offer: o.id };
  },
};

export const respondOffer: Handler<CommandOf<'respondOffer'>, { offer: Offer }> = {
  validate(state, cmd) {
    const o = state.offers[cmd.offer];
    if (!o) return fail('unknown_target', 'No such offer.');
    if (o.to !== cmd.country) return fail('not_recipient', 'Only the recipient can answer this offer.');
    if (o.status !== 'pending') return fail('already_resolved', `Offer already ${o.status}${o.status === 'accepted' ? ' — its effect applies once.' : '.'}`);
    if (cmd.accept) {
      const err = acceptability(state, o);
      if (err) return fail(err.startsWith('Offer is stale') ? 'stale_offer' : 'invalid_argument', err);
    }
    return ok({ offer: o });
  },
  apply(state, cmd) {
    const o = state.offers[cmd.offer];
    respondOfferInternal(state, o, cmd.accept, cmd.reason ?? null);
    return { status: o.status, effectiveAt: o.effectiveAt };
  },
};

export const withdrawOffer: Handler<CommandOf<'withdrawOffer'>, object> = {
  validate(state, cmd) {
    const o = state.offers[cmd.offer];
    if (!o || o.from !== cmd.country) return fail('not_owner', 'Not your offer.');
    if (o.status !== 'pending') return fail('already_resolved', `Offer already ${o.status}.`);
    return ok({});
  },
  apply(state, cmd) {
    const o = state.offers[cmd.offer];
    o.status = 'withdrawn';
    o.resolvedAt = state.clock.tick;
    return {};
  },
};

export const revokeGrant: Handler<CommandOf<'revokeGrant'>, { from: string; to: string }> = {
  validate(state, cmd) {
    const cur = grantLevel(state, cmd.country, cmd.to);
    if (!['peace', 'right_of_way'].includes(cmd.level)) return fail('invalid_argument', 'You can reduce a grant to peace or right of way.');
    if (cur === 'peace' || !levelAtLeast(cur, cmd.level) || cur === cmd.level) return fail('invalid_argument', `Current grant to ${cmd.to} is ${cur.replace('_', ' ')}; nothing to revoke.`);
    return ok({ from: cur, to: cmd.level });
  },
  apply(state, cmd) {
    revokeGrantInternal(state, cmd.country, cmd.to, cmd.level);
    return {};
  },
};

export const declareWar: Handler<CommandOf<'declareWar'>, { target: string; effects: string[] }> = {
  validate(state, cmd) {
    if (!aliveCountry(state, cmd.target) || cmd.target === cmd.country) return fail('unknown_target', 'Unknown or eliminated country.');
    if (atWar(state, cmd.country, cmd.target)) return fail('already_resolved', `Already at war with ${cmd.target}.`);
    if (sameCoalition(state, cmd.country, cmd.target)) return fail('invalid_argument', `${cmd.target} is in your coalition — leave the coalition first.`);
    return ok({ target: cmd.target, effects: ['All grants between you are cancelled.', 'Pending offers without peace terms become void.', 'Their trust in you drops sharply.'] });
  },
  apply(state, cmd) {
    declareWarInternal(state, cmd.country, cmd.target, cmd.reason ?? 'declared');
    return {};
  },
};

export const createCoalition: Handler<CommandOf<'createCoalition'>, { name: string }> = {
  validate(state, cmd) {
    if (coalitionOf(state, cmd.country)) return fail('invalid_argument', 'You are already in a coalition.');
    const name = String(cmd.name ?? '').trim();
    if (!name || name.length > 60) return fail('invalid_argument', 'Coalition name must be 1–60 characters.');
    return ok({ name });
  },
  apply(state, cmd, p) {
    return { coalition: createCoalitionInternal(state, cmd.country, p.name, cmd.description ?? '', cmd.emblem ?? 'star').id };
  },
};

export const applyCoalition: Handler<CommandOf<'applyCoalition'>, object> = {
  validate(state, cmd) {
    const co = state.coalitions[cmd.coalition];
    if (!co) return fail('unknown_target', 'No such coalition.');
    const err = canJoin(state, co, cmd.country);
    if (err) return fail('invalid_argument', err);
    if (co.applications.some((a) => a.country === cmd.country)) return fail('already_resolved', 'Application already pending.');
    return ok({});
  },
  apply(state, cmd) {
    const co = state.coalitions[cmd.coalition];
    co.applications.push({ country: cmd.country, at: state.clock.tick });
    emit(state, { kind: 'coalition_application', category: 'diplomacy', private: toAll([co.leader, cmd.country], `${cmd.country} applied to join "${co.name}".`, { coalition: co.id }) });
    return {};
  },
};

export const respondApplication: Handler<CommandOf<'respondApplication'>, object> = {
  validate(state, cmd) {
    const co = state.coalitions[cmd.coalition];
    if (!co) return fail('unknown_target', 'No such coalition.');
    if (co.leader !== cmd.country) return fail('not_owner', 'Only the coalition leader decides applications.');
    if (!co.applications.some((a) => a.country === cmd.applicant)) return fail('already_resolved', 'No pending application from that country.');
    if (cmd.accept) {
      const err = canJoin(state, co, cmd.applicant);
      if (err) return fail('invalid_argument', err);
    }
    return ok({});
  },
  apply(state, cmd) {
    const co = state.coalitions[cmd.coalition];
    co.applications = co.applications.filter((a) => a.country !== cmd.applicant);
    if (cmd.accept) joinCoalitionInternal(state, co.id, cmd.applicant, 'application accepted');
    else emit(state, { kind: 'coalition_application_declined', category: 'diplomacy', private: toAll([cmd.applicant], `Your application to "${co.name}" was declined.`) });
    return {};
  },
};

export const leaveCoalition: Handler<CommandOf<'leaveCoalition'>, { effectiveAt: number }> = {
  validate(state, cmd) {
    const co = coalitionOf(state, cmd.country);
    if (!co) return fail('invalid_argument', 'You are not in a coalition.');
    if (co.departures.some((d) => d.country === cmd.country)) return fail('already_resolved', 'Departure already announced.');
    return ok({ effectiveAt: state.clock.tick + 24 * 60 });
  },
  apply(state, cmd) {
    const co = coalitionOf(state, cmd.country)!;
    return { effectiveAt: announceDeparture(state, co.id, cmd.country) };
  },
};

// ───────────────────────────── missiles ─────────────────────────────

export const launchMissile: Handler<CommandOf<'launchMissile'>, LaunchCheck> = {
  validate(state, cmd) {
    const chk = checkLaunch(state, cmd.country, cmd.missile, cmd.from, cmd.target, cmd.confirmActOfWar);
    if (!chk.ok) return fail(chk.code ?? 'invalid_argument', chk.reason ?? 'Launch not possible.', chk);
    return ok(chk);
  },
  apply(state, cmd, p) {
    if (p.actOfWar) declareWarInternal(state, cmd.country, p.actOfWar, cmd.reason ?? 'missile strike');
    const l = launchInternal(state, cmd.country, cmd.missile, p, 'stack' in cmd.from ? cmd.from.stack : null, cmd.target);
    return { launch: l.id, arriveAt: l.arriveAt, ready: state.countries[cmd.country].missiles[cmd.missile].ready };
  },
};

export const produceMissile: Handler<CommandOf<'produceMissile'>, { cost: ResM; batches: number; durationMin: number; startTick: number; ceiling: number; backlog: number }> = {
  validate(state, cmd) {
    const mt = S(state).cat.missiles.get(cmd.missile);
    if (!mt) return fail('unknown_target', 'Unknown missile type.');
    const inv = state.countries[cmd.country].missiles[cmd.missile];
    if (!inv) return fail('locked_tech', `Research the ${mt.name} blueprint first.`);
    if (inv.maturity === 'prototype') return fail('locked_tech', `${mt.name} is a prototype — complete qualification research first.`);
    const batches = cmd.batches ?? 1;
    if (!Number.isInteger(batches) || batches < 1 || batches > 10) return fail('invalid_argument', 'Batches must be 1–10.');
    const queued = state.countries[cmd.country].jobs.filter((j) => j.kind === 'missile' && j.missile === cmd.missile).reduce((a, j) => a + (j.batch ?? 0), 0);
    if (inv.ready + queued + batches * mt.batchSize > mt.inventoryCeiling) return fail('invalid_argument', `Inventory ceiling ${mt.inventoryCeiling} would be exceeded (ready ${inv.ready}, backlog ${queued}).`);
    const cost = mul(vecFromWhole(mt.cost), batches);
    if (!geq(state.countries[cmd.country].stock, cost)) return fail('insufficient_resources', shortReason(shortfall(state.countries[cmd.country].stock, cost)));
    return ok({ cost, batches, durationMin: Math.round(mt.buildHours * 60), startTick: estimateStart(state, cmd.country, 'missile'), ceiling: mt.inventoryCeiling, backlog: queued });
  },
  apply(state, cmd, p) {
    const mt = S(state).cat.missiles.get(cmd.missile)!;
    const cap = state.countries[cmd.country].capitalCity;
    const node = cap ? state.cities[cap].node : 0;
    const per = mul(p.cost, 1 / p.batches);
    const jobs: string[] = [];
    for (let i = 0; i < p.batches; i++) {
      const cost = i === p.batches - 1 ? (() => { const c = copy(p.cost); for (let k = 0; k < p.batches - 1; k++) subInto(c, per); return c; })() : per;
      const j = enqueueJob(state, { kind: 'missile', country: cmd.country, city: null, node, missile: cmd.missile, batch: mt.batchSize, cost, durationMin: p.durationMin, slot: 'missile' });
      if (j) jobs.push(j.id);
    }
    return { jobs };
  },
};

// ───────────────────────────── intel / news / messages ─────────────────────────────

export const assignAgent: Handler<CommandOf<'assignAgent'>, { cost: ResM }> = {
  validate(state, cmd) {
    const city = state.cities[cmd.city];
    if (!city) return fail('unknown_target', 'Unknown city.');
    const owner = state.provinces[city.node]?.owner;
    if (!owner || owner === cmd.country) return fail('invalid_argument', 'Agents operate in foreign-held cities only.');
    if (!['information', 'sabotage', 'corruption'].includes(cmd.mission)) return fail('invalid_argument', 'Unknown mission.');
    const n = Object.values(state.agents).filter((a) => a.country === cmd.country && a.active).length;
    if (n >= MAX_AGENTS) return fail('busy', `All ${MAX_AGENTS} agents are assigned.`);
    const cost = vecFromWhole(AGENT_COST);
    if (!geq(state.countries[cmd.country].stock, cost)) return fail('insufficient_resources', shortReason(shortfall(state.countries[cmd.country].stock, cost)));
    return ok({ cost });
  },
  apply(state, cmd, p) {
    charge(state, cmd.country, 'intel', p.cost);
    return { agent: assignAgentInternal(state, cmd.country, cmd.city, cmd.mission) };
  },
};

export const recallAgent: Handler<CommandOf<'recallAgent'>, object> = {
  validate(state, cmd) {
    const a = state.agents[cmd.agent];
    if (!a || a.country !== cmd.country) return fail('not_owner', 'Not your agent.');
    if (!a.active) return fail('already_resolved', 'Agent is not active.');
    return ok({});
  },
  apply(state, cmd) {
    state.agents[cmd.agent].active = false;
    state.queue = state.queue.filter((e) => !(e.kind === 'agent_report' && e.ref === cmd.agent));
    return {};
  },
};

export const buyIntelReport: Handler<CommandOf<'buyIntelReport'>, { cost: ResM; expiresInMin: number }> = {
  validate(state, cmd) {
    const m = S(state).map;
    if (!Number.isInteger(cmd.node) || cmd.node < 0 || cmd.node >= m.n) return fail('unknown_target', 'Unknown sector.');
    if (m.isLand[cmd.node] && m.outside[cmd.node]) return fail('outside_campaign', 'Sector is outside the campaign.');
    const cost = vecFromWhole(INTEL_REPORT_COST);
    if (!geq(state.countries[cmd.country].stock, cost)) return fail('insufficient_resources', shortReason(shortfall(state.countries[cmd.country].stock, cost)));
    return ok({ cost, expiresInMin: 1440 });
  },
  apply(state, cmd, p) {
    charge(state, cmd.country, 'intel', p.cost);
    const r = snapshotReport(state, cmd.country, cmd.node, 'purchase');
    emit(state, { kind: 'intel_report', category: 'intel', node: cmd.node, private: toAll([cmd.country], `Intelligence report on ${S(state).map.data.nodes[cmd.node].name}: ${r.stacks.length} formation(s) as of now; expires at tick ${r.expiresAt}.`, { report: r.id }) });
    return { report: r.id };
  },
};

function plain(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

export const publishArticle: Handler<CommandOf<'publishArticle'>, { headline: string; body: string }> = {
  validate(state, cmd) {
    const h = plain(cmd.headline, 120).trim();
    const b = plain(cmd.body, 4000).trim();
    if (!h) return fail('invalid_argument', 'Headline required.');
    if (!b) return fail('invalid_argument', 'Body required.');
    return ok({ headline: h, body: b });
  },
  apply(state, cmd, p) {
    const id = nextId(state, 'article');
    state.articles.push({ id, at: state.clock.tick, day: dayOf(state.clock.tick), author: cmd.country, anonymous: !!cmd.anonymous, headline: p.headline, body: p.body });
    return { article: id };
  },
};

export const sendMessage: Handler<CommandOf<'sendMessage'>, { thread: string; text: string }> = {
  validate(state, cmd) {
    let thread: string;
    if (cmd.to === 'coalition') {
      const co = coalitionOf(state, cmd.country);
      if (!co) return fail('invalid_argument', 'You are not in a coalition.');
      thread = `co:${co.id}`;
    } else {
      if (!state.countries[cmd.to] || cmd.to === cmd.country) return fail('unknown_target', 'Unknown recipient.');
      thread = threadFor(cmd.country, cmd.to);
    }
    const text = cmd.text ? plain(cmd.text, 2000).trim() : cmd.intent ? renderIntent(cmd.intent, cmd.country, cmd.to === 'coalition' ? null : cmd.to, cmd.reason ?? '') : '';
    if (!text) return fail('invalid_argument', 'Message text or intent required.');
    return ok({ thread, text });
  },
  apply(state, cmd, p) {
    const m = postMessage(state, cmd.country, p.thread, cmd.to === 'coalition' ? null : cmd.to, p.text, cmd.intent ?? null, cmd.reason ?? null);
    return { message: m.id };
  },
};

export { fmtVec };
