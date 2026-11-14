/**
 * Diplomacy: exactly four statuses per direction — war, peace, right_of_way, shared_intel.
 * War is symmetric (PairRelation.war). Passage and shared intel are DIRECTIONAL grants layered
 * on peace (shared_intel ⊇ right_of_way). Coalition membership is a separate record.
 *
 * Offers: recipient-only decision; accept/decline/expire are idempotent (an offer resolves once);
 * an offer created against an older relation version is STALE and voids on acceptance (it can
 * never silently override a later war or agreement). Accepted terms apply at the published
 * effective time (acceptedAt + effectiveDelayMin) via a scheduled `offer_effect`.
 * Trust: private per ordered pair, with history entries and daily decay toward 0.
 */
import { invalidateDerived } from '../derived';
import type { CountryId } from '../data-types';
import type { DiploLevel, GameState, Message, Offer, OfferTerm } from '../state';
import { MAX_PENDING_OFFERS_PER_PAIR, OFFER_DEFAULT_EXPIRY_MIN, OFFER_EFFECT_DELAY_MIN, TRUST, AGREEMENT_FULFILLED_AFTER_MIN } from '../rules';
import { dirKey, nextId, pairKey } from '../ids';
import { schedule } from './queue';
import { emit, toAll } from './events';
import { atWar, bumpRelations, coalitionOf, grantLevel, levelAtLeast, sameCoalition } from './world';
import { charge, credit } from './ledger';
import { zero, fmtVec } from '../fixed';
import { streamRng } from '../rng';
import { scenarioOf } from '../scenario/registry';

// ───────────────────────────── trust ─────────────────────────────

const initialTrustCache = new WeakMap<GameState, Map<string, number>>();
/** Opening trust of `from` toward `to`: authored profile trust + seeded variation (stream "trust"). */
export function initialTrust(state: GameState, from: CountryId, to: CountryId): number {
  if (from === to) return 0;
  let m = initialTrustCache.get(state);
  if (!m) {
    m = new Map();
    initialTrustCache.set(state, m);
  }
  const k = dirKey(from, to);
  let v = m.get(k);
  if (v === undefined) {
    const r = streamRng(state.seed, 'trust', k);
    const authored = scenarioOf(state).profiles[from]?.relations?.find((x) => x.with === to);
    v = Math.round(((authored?.trust ?? 0) + TRUST.initialVariation * (2 * r.next() - 1)) * 100) / 100;
    m.set(k, v);
  }
  return v;
}
/** Trust value of a pair never touched by an event: the opening value decayed for every day change so far. */
function lazyTrust(state: GameState, from: CountryId, to: CountryId): number {
  const v0 = initialTrust(state, from, to);
  const days = state.ids.trustDays ?? 0;
  return days ? Math.round(v0 * Math.pow(1 - TRUST.decayPerDay, days) * 100) / 100 : v0;
}
export function trustOf(state: GameState, from: CountryId, to: CountryId): number {
  const t = state.trust[dirKey(from, to)];
  return t ? t.value : lazyTrust(state, from, to);
}
export function addTrust(state: GameState, holder: CountryId, about: CountryId, delta: number, kind: string, reason: string): void {
  if (holder === about) return;
  const k = dirKey(holder, about);
  const t = (state.trust[k] ??= { value: lazyTrust(state, holder, about), history: [] });
  t.value = Math.max(TRUST.min, Math.min(TRUST.max, Math.round((t.value + delta) * 100) / 100));
  t.history.push({ at: state.clock.tick, kind, delta, reason });
  while (t.history.length > TRUST.historyKept) t.history.shift();
}
export function trustDecayDay(state: GameState): void {
  state.ids.trustDays = (state.ids.trustDays ?? 0) + 1;
  for (const k of Object.keys(state.trust).sort()) {
    const t = state.trust[k];
    t.value = Math.round(t.value * (1 - TRUST.decayPerDay) * 100) / 100;
  }
}

// ───────────────────────────── relations ─────────────────────────────

function rel(state: GameState, a: CountryId, b: CountryId) {
  return (state.relations[pairKey(a, b)] ??= { war: false, since: 0, version: 0, warDeclaredBy: null });
}

export function setGrant(state: GameState, from: CountryId, to: CountryId, level: DiploLevel): void {
  const k = dirKey(from, to);
  if (level === 'peace') delete state.grants[k];
  else state.grants[k] = { level, since: state.clock.tick };
  rel(state, from, to).version++;
  state.ids.grv = (state.ids.grv ?? 0) + 1;
  invalidateDerived(state, 'command');
}

export function declareWarInternal(state: GameState, by: CountryId, target: CountryId, reason: string): void {
  if (by === target || atWar(state, by, target)) return;
  const r = rel(state, by, target);
  r.war = true;
  bumpRelations(state);
  r.since = state.clock.tick;
  r.version++;
  r.warDeclaredBy = by;
  invalidateDerived(state, 'command');
  delete state.grants[dirKey(by, target)];
  delete state.grants[dirKey(target, by)];
  state.ids.grv = (state.ids.grv ?? 0) + 1;
  // pending offers between them become void
  for (const o of Object.values(state.offers)) {
    if (o.status === 'pending' && ((o.from === by && o.to === target) || (o.from === target && o.to === by)) && !o.receive.concat(o.give).some((t) => t.kind === 'peace')) {
      o.status = 'void';
      o.resolvedAt = state.clock.tick;
      o.reason = 'superseded by declaration of war';
    }
  }
  addTrust(state, target, by, TRUST.warDeclared, 'war_declared', reason);
  const interrupt = target === state.meta.humanCountry ? [target] : [];
  emit(state, {
    kind: 'war_declared',
    category: 'diplomacy',
    public: { headline: `${by} declares war on ${target}`, countries: [by, target] },
    private: { ...toAll([by], `You declared war on ${target}. Reason: ${reason}`), ...toAll([target], `${by} declared war on you.`) },
    interrupt,
  });
}

export function makePeace(state: GameState, a: CountryId, b: CountryId): void {
  const r = rel(state, a, b);
  if (!r.war) return;
  r.war = false;
  bumpRelations(state);
  r.since = state.clock.tick;
  r.version++;
  r.warDeclaredBy = null;
  invalidateDerived(state, 'command');
  emit(state, { kind: 'peace', category: 'diplomacy', public: { headline: `${a} and ${b} conclude peace`, countries: [a, b] }, private: toAll([a, b], `Peace concluded between ${a} and ${b}.`) });
}

/** Unilateral downgrade of a grant (revoking passage/shared intel). */
export function revokeGrantInternal(state: GameState, from: CountryId, to: CountryId, toLevel: DiploLevel): void {
  const cur = state.grants[dirKey(from, to)];
  if (!cur) return;
  const young = state.clock.tick - cur.since < AGREEMENT_FULFILLED_AFTER_MIN;
  setGrant(state, from, to, toLevel);
  if (young) addTrust(state, to, from, TRUST.brokenAgreement, 'broken_agreement', `${from} revoked ${cur.level.replace('_', ' ')} shortly after granting it`);
  emit(state, { kind: 'grant_revoked', category: 'diplomacy', private: { ...toAll([from], `You reduced ${to}'s status to ${toLevel.replace('_', ' ')}.`), ...toAll([to], `${from} reduced your status to ${toLevel.replace('_', ' ')}.`) } });
}

// ───────────────────────────── offers ─────────────────────────────

export function validateTerms(state: GameState, from: CountryId, to: CountryId, give: OfferTerm[], receive: OfferTerm[]): string | null {
  const all = [...give, ...receive];
  if (!all.length) return 'An offer needs at least one term.';
  const war = atWar(state, from, to);
  for (const t of all) {
    if (t.kind === 'status' && war) return 'Statuses cannot be granted while at war — include peace first.';
    if (t.kind === 'peace' && !war) return 'You are not at war with that country.';
    if (t.kind === 'coalition_invite') {
      const co = state.coalitions[t.coalition];
      if (!co || co.dissolvedAt) return 'Unknown coalition.';
    }
    if (t.kind === 'resource' && (!Number.isInteger(t.amount) || t.amount <= 0)) return 'Resource amounts must be positive.';
  }
  for (const t of give) {
    if (t.kind === 'coalition_invite') {
      const co = state.coalitions[t.coalition];
      if (!co.members.some((m) => m.country === from)) return 'You can only invite into your own coalition.';
      if (coalitionOf(state, to)) return `${to} is already in a coalition.`;
    }
  }
  for (const t of receive) if (t.kind === 'coalition_invite') return 'Ask to join through a coalition application instead.';
  return null;
}

export function proposeOfferInternal(state: GameState, from: CountryId, to: CountryId, give: OfferTerm[], receive: OfferTerm[], expiresInMin: number | undefined, reason: string | null, text?: string): Offer {
  const id = nextId(state, 'offer');
  const now = state.clock.tick;
  const o: Offer = {
    id,
    from,
    to,
    give,
    receive,
    createdAt: now,
    expiresAt: now + (expiresInMin ?? OFFER_DEFAULT_EXPIRY_MIN),
    effectiveDelayMin: OFFER_EFFECT_DELAY_MIN,
    relationVersion: rel(state, from, to).version,
    status: 'pending',
    resolvedAt: null,
    effectiveAt: null,
    applied: false,
    reason,
    responseReason: null,
  };
  state.offers[id] = o;
  schedule(state, o.expiresAt, 'offer_expire', id, null);
  postMessage(state, from, `dm:${pairKey(from, to)}`, to, text ?? `Proposal: ${describeTerms(o)}`, 'offer', reason, id);
  emit(state, { kind: 'offer_received', category: 'diplomacy', private: { ...toAll([to], `${from} sent an offer: ${describeTerms(o)}.`, { offer: id }), ...toAll([from], `Offer sent to ${to}: ${describeTerms(o)}.`, { offer: id }) } });
  return o;
}

export function pendingOffersBetween(state: GameState, a: CountryId, b: CountryId): Offer[] {
  return Object.values(state.offers).filter((o) => o.status === 'pending' && ((o.from === a && o.to === b) || (o.from === b && o.to === a)));
}
export const MAX_PENDING = MAX_PENDING_OFFERS_PER_PAIR;

function termText(t: OfferTerm): string {
  if (t.kind === 'status') return t.level.replace('_', ' ');
  if (t.kind === 'peace') return 'peace';
  if (t.kind === 'coalition_invite') return `coalition membership (${t.coalition})`;
  const v = zero();
  v[t.resource] = t.amount;
  return fmtVec(v);
}
export function describeTerms(o: Pick<Offer, 'from' | 'to' | 'give' | 'receive'>): string {
  const g = o.give.map(termText).join(', ');
  const r = o.receive.map(termText).join(', ');
  return `${o.from} gives [${g || '—'}] for [${r || '—'}]`;
}

/** Validate that an offer can still be accepted right now (stale/void checks + resource terms). */
export function acceptability(state: GameState, o: Offer): string | null {
  if (o.status !== 'pending') return `Offer is already ${o.status}.`;
  if (state.clock.tick >= o.expiresAt) return 'Offer has expired.';
  if (rel(state, o.from, o.to).version !== o.relationVersion) return 'Offer is stale: relations changed since it was made.';
  const err = validateTerms(state, o.from, o.to, o.give, o.receive);
  if (err) return err;
  for (const [payer, terms] of [[o.from, o.give], [o.to, o.receive]] as const) {
    const need = zero();
    for (const t of terms) if (t.kind === 'resource') need[t.resource] += t.amount;
    for (const r of Object.keys(need) as (keyof typeof need)[]) if (state.countries[payer].stock[r] < need[r]) return `${payer} can no longer pay the agreed resources.`;
  }
  for (const t of o.give) if (t.kind === 'coalition_invite') {
    const co = state.coalitions[t.coalition];
    if (co.members.length >= 5) return 'Coalition is full.';
  }
  return null;
}

export interface DiploHooks {
  joinCoalition: (state: GameState, coalition: string, country: CountryId, reason: string) => boolean;
}

export function respondOfferInternal(state: GameState, o: Offer, accept: boolean, reason: string | null): void {
  const now = state.clock.tick;
  o.resolvedAt = now;
  o.responseReason = reason;
  if (!accept) {
    o.status = 'declined';
    addTrust(state, o.from, o.to, TRUST.declinedOffer, 'offer_declined', reason ?? 'declined');
    postMessage(state, o.to, `dm:${pairKey(o.from, o.to)}`, o.from, reason ? `Declined: ${reason}` : 'Declined.', 'decline', reason, o.id);
    emit(state, { kind: 'offer_declined', category: 'diplomacy', private: toAll([o.from, o.to], `Offer ${o.id} (${describeTerms(o)}) declined${reason ? `: ${reason}` : ''}.`, { offer: o.id }) });
    return;
  }
  o.status = 'accepted';
  o.effectiveAt = now + o.effectiveDelayMin;
  // resources move immediately (atomic, both directions validated in acceptability)
  for (const [payer, payee, terms] of [[o.from, o.to, o.give], [o.to, o.from, o.receive]] as const) {
    const v = zero();
    for (const t of terms) if (t.kind === 'resource') v[t.resource] += t.amount;
    if (charge(state, payer, 'treaty_transfer', v)) credit(state, payee, 'treaty_transfer', v);
  }
  schedule(state, o.effectiveAt, 'offer_effect', o.id, null);
  addTrust(state, o.from, o.to, TRUST.acceptedAgreement, 'agreement', `accepted ${o.id}`);
  addTrust(state, o.to, o.from, TRUST.acceptedAgreement, 'agreement', `accepted ${o.id}`);
  postMessage(state, o.to, `dm:${pairKey(o.from, o.to)}`, o.from, reason ? `Accepted: ${reason}` : 'Accepted.', 'accept', reason, o.id);
  emit(state, { kind: 'offer_accepted', category: 'diplomacy', private: toAll([o.from, o.to], `Offer ${o.id} accepted: ${describeTerms(o)}. Effective at tick ${o.effectiveAt}.`, { offer: o.id, effectiveAt: o.effectiveAt }) });
}

/** Apply accepted terms at the effective time (exactly once). */
export function applyOfferEffect(state: GameState, id: string, hooks: DiploHooks): void {
  const o = state.offers[id];
  if (!o || o.status !== 'accepted' || o.applied) return;
  o.applied = true;
  const apply = (giver: CountryId, receiver: CountryId, terms: OfferTerm[]) => {
    for (const t of terms) {
      if (t.kind === 'status') {
        if (atWar(state, giver, receiver)) continue;
        if (!levelAtLeast(grantLevel(state, giver, receiver), t.level)) setGrant(state, giver, receiver, t.level);
      } else if (t.kind === 'peace') makePeace(state, giver, receiver);
      else if (t.kind === 'coalition_invite') hooks.joinCoalition(state, t.coalition, receiver, `invited by ${giver}`);
    }
  };
  apply(o.from, o.to, o.give);
  apply(o.to, o.from, o.receive);
  emit(state, { kind: 'agreement_effective', category: 'diplomacy', public: o.give.concat(o.receive).some((t) => t.kind === 'peace' || t.kind === 'coalition_invite') ? null : null, private: toAll([o.from, o.to], `Agreement ${o.id} now in effect: ${describeTerms(o)}.`, { offer: o.id }) });
}

export function expireOffer(state: GameState, id: string): void {
  const o = state.offers[id];
  if (!o || o.status !== 'pending') return;
  o.status = 'expired';
  o.resolvedAt = state.clock.tick;
  emit(state, { kind: 'offer_expired', category: 'diplomacy', routine: true, private: toAll([o.from, o.to], `Offer ${o.id} expired without an answer.`, { offer: o.id }) });
}

// ───────────────────────────── messages ─────────────────────────────

export function postMessage(state: GameState, from: CountryId, thread: string, to: CountryId | null, text: string, intent: string | null, reason: string | null, offer: string | null = null): Message {
  const msg: Message = { id: nextId(state, 'message'), at: state.clock.tick, from, thread, to, text: String(text).slice(0, 2000), intent, reason, offer };
  (state.messages[thread] ??= []).push(msg);
  const l = state.messages[thread];
  if (l.length > 200) l.splice(0, l.length - 200);
  return msg;
}

/** Template replies driven by explicit intents (the AI supplies `reason` from a logged decision). */
export const INTENT_TEMPLATES: Record<string, (from: CountryId, to: CountryId | null, reason: string) => string> = {
  greet: (f, t) => `${f} sends greetings to ${t ?? 'all members'}.`,
  propose_passage: (f, _t, r) => `${f} proposes mutual passage rights. Reason: ${r}.`,
  propose_peace: (f, _t, r) => `${f} is prepared to end hostilities. Reason: ${r}.`,
  propose_coalition: (f, _t, r) => `${f} invites you to join its coalition. Reason: ${r}.`,
  accept: (f, _t, r) => `${f} accepts. Reason: ${r}.`,
  decline: (f, _t, r) => `${f} declines. Reason: ${r}.`,
  warn: (f, _t, r) => `${f} issues a warning: ${r}.`,
  threaten: (f, _t, r) => `${f} will respond with force if this continues: ${r}.`,
  coordinate: (f, _t, r) => `${f} proposes coordination: ${r}.`,
  trade: (f, _t, r) => `${f} is seeking trade: ${r}.`,
  leave_coalition: (f, _t, r) => `${f} is leaving the coalition: ${r}.`,
};
export function renderIntent(intent: string, from: CountryId, to: CountryId | null, reason: string): string {
  const f = INTENT_TEMPLATES[intent];
  return f ? f(from, to, reason || 'no further comment') : `${from}: ${reason}`;
}
export function threadFor(a: CountryId, b: CountryId): string {
  return `dm:${pairKey(a, b)}`;
}
export { sameCoalition };
