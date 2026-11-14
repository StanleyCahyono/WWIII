import { describe, expect, it } from 'vitest';
import { advance, submitCommand, previewCommand, serialize, deserialize, stateHash, getCountryView, BasicController, IdleController } from '../../src/engine';
import { newMiniGame, N } from '../fixtures/mini-world';
import { must, war, clearStacks, place } from '../fixtures/helpers';
import { atWar, grantLevel, hasPassage, coalitionOf, statusFrom } from '../../src/engine/systems/world';
import { trustOf } from '../../src/engine/systems/diplomacy';
import type { CountryController } from '../../src/engine/ai-host/types';

describe('diplomacy, offers & coalitions', () => {
  it('exactly four statuses per direction; passage is directional and changes access, not affiliation', () => {
    const s = newMiniGame();
    must(s, { type: 'proposeOffer', country: 'ARD', to: 'BOR', give: [], receive: [{ kind: 'status', level: 'right_of_way' }] });
    const o = Object.values(s.offers)[0];
    must(s, { type: 'respondOffer', country: 'BOR', offer: o.id, accept: true });
    expect(grantLevel(s, 'BOR', 'ARD')).toBe('peace'); // not yet effective
    advance(s, 59);
    expect(hasPassage(s, 'ARD', 'BOR')).toBe(false);
    advance(s, 15);
    expect(statusFrom(s, 'BOR', 'ARD')).toBe('right_of_way');
    expect(statusFrom(s, 'ARD', 'BOR')).toBe('peace'); // directional
    expect(hasPassage(s, 'ARD', 'BOR')).toBe(true);
    expect(hasPassage(s, 'BOR', 'ARD')).toBe(false);
    expect(coalitionOf(s, 'ARD')).toBeNull();
    const statuses = new Set<string>();
    for (const a of s.countryOrder) for (const b of s.countryOrder) if (a !== b) statuses.add(statusFrom(s, a, b));
    for (const st of statuses) expect(['war', 'peace', 'right_of_way', 'shared_intel']).toContain(st);
  });

  it('A09: accept is idempotent (double accept applies once); expiry is idempotent; only the recipient decides', () => {
    const s = newMiniGame();
    must(s, { type: 'proposeOffer', country: 'ARD', to: 'CEL', give: [{ kind: 'resource', resource: 'money', amount: 500_000 }], receive: [{ kind: 'status', level: 'shared_intel' }] });
    const o = Object.values(s.offers)[0];
    expect(submitCommand(s, { type: 'respondOffer', country: 'ARD', offer: o.id, accept: true }).ok).toBe(false); // sender can't accept
    const m0 = s.countries.CEL.stock.money;
    const r1 = submitCommand(s, { type: 'respondOffer', country: 'CEL', offer: o.id, accept: true });
    const r2 = submitCommand(s, { type: 'respondOffer', country: 'CEL', offer: o.id, accept: true });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('already_resolved');
    expect(s.countries.CEL.stock.money - m0).toBe(500_000);
    advance(s, 120);
    expect(grantLevel(s, 'CEL', 'ARD')).toBe('shared_intel');
    expect(s.events.filter((e) => e.kind === 'agreement_effective').length).toBe(1);
    // expiry
    must(s, { type: 'proposeOffer', country: 'DUN', to: 'ESK', give: [{ kind: 'status', level: 'right_of_way' }], receive: [], expiresInMin: 60 });
    const o2 = Object.values(s.offers).find((x) => x.from === 'DUN')!;
    advance(s, 120);
    expect(o2.status).toBe('expired');
    expect(submitCommand(s, { type: 'respondOffer', country: 'ESK', offer: o2.id, accept: true }).ok).toBe(false);
    expect(s.events.filter((e) => e.kind === 'offer_expired').length).toBe(1);
  });

  it('a stale offer cannot override a later war or agreement', () => {
    const s = newMiniGame();
    must(s, { type: 'proposeOffer', country: 'ARD', to: 'BOR', give: [{ kind: 'status', level: 'right_of_way' }], receive: [{ kind: 'status', level: 'right_of_way' }] });
    const o = Object.values(s.offers)[0];
    war(s, 'BOR', 'ARD');
    expect(o.status).toBe('void');
    expect(submitCommand(s, { type: 'respondOffer', country: 'BOR', offer: o.id, accept: true }).ok).toBe(false);
    expect(atWar(s, 'ARD', 'BOR')).toBe(true);
    // relation change other than war also stales
    must(s, { type: 'proposeOffer', country: 'CEL', to: 'DUN', give: [{ kind: 'status', level: 'right_of_way' }], receive: [] });
    const o2 = Object.values(s.offers).find((x) => x.from === 'CEL')!;
    must(s, { type: 'proposeOffer', country: 'DUN', to: 'CEL', give: [{ kind: 'status', level: 'shared_intel' }], receive: [] });
    const o3 = Object.values(s.offers).find((x) => x.from === 'DUN' && x.to === 'CEL')!;
    must(s, { type: 'respondOffer', country: 'CEL', offer: o3.id, accept: true });
    advance(s, 61);
    const r = submitCommand(s, { type: 'respondOffer', country: 'DUN', offer: o2.id, accept: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('stale_offer');
  });

  it('peace offers end wars; trust history records reasons', () => {
    const s = newMiniGame();
    war(s, 'ARD', 'DUN');
    expect(trustOf(s, 'DUN', 'ARD')).toBeLessThan(-30);
    expect(s.trust['DUN>ARD'].history.some((h) => h.kind === 'war_declared')).toBe(true);
    expect(previewCommand(s, { type: 'proposeOffer', country: 'DUN', to: 'ARD', give: [{ kind: 'status', level: 'right_of_way' }], receive: [] }).ok).toBe(false);
    must(s, { type: 'proposeOffer', country: 'DUN', to: 'ARD', give: [{ kind: 'peace' }], receive: [] });
    must(s, { type: 'respondOffer', country: 'ARD', offer: Object.values(s.offers)[0].id, accept: true });
    advance(s, 61);
    expect(atWar(s, 'ARD', 'DUN')).toBe(false);
  });

  it('A09: pending offer survives save/load; two bots reach a treaty without the human; a bot refuses a poor offer with a reason', () => {
    const s = newMiniGame({ human: 'ARD' });
    must(s, { type: 'proposeOffer', country: 'ARD', to: 'DUN', give: [], receive: [{ kind: 'status', level: 'shared_intel' }] });
    const id = Object.values(s.offers)[0].id;
    // DUN distrusts ARD
    s.trust['DUN>ARD'].value = -40;
    const loaded = deserialize(serialize(s));
    expect(loaded.offers[id].status).toBe('pending');
    const host = { fallback: BasicController };
    advance(s, 2 * 1440, host);
    advance(loaded, 2 * 1440, host);
    expect(stateHash(loaded)).toBe(stateHash(s));
    expect(s.offers[id].status).toBe('declined');
    const thread = getCountryView(s, 'ARD').messages['dm:ARD|DUN'];
    expect(thread.some((m) => m.from === 'DUN' && m.intent === 'decline' && /trust/.test(m.text))).toBe(true);
    // bot-to-bot treaties concluded independently
    const botDeals = Object.values(s.offers).filter((o) => o.status === 'accepted' && o.from !== 'ARD' && o.to !== 'ARD');
    expect(botDeals.length).toBeGreaterThan(0);
    expect(botDeals.every((o) => o.applied)).toBe(true);
  });

  it('coalitions: capacity, applications, members share transit, timed departure with history', () => {
    void coalitionOf;
    const s = newMiniGame();
    must(s, { type: 'createCoalition', country: 'ARD', name: 'Northern League', description: 'test', emblem: 'star' });
    const co = Object.values(s.coalitions)[0];
    for (const c of ['BOR', 'CEL', 'DUN', 'ESK']) {
      must(s, { type: 'applyCoalition', country: c, coalition: co.id });
      must(s, { type: 'respondApplication', country: 'ARD', coalition: co.id, applicant: c, accept: true });
    }
    expect(co.members.length).toBe(5);
    const full = previewCommand(s, { type: 'applyCoalition', country: 'FAL', coalition: co.id });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toMatch(/full/);
    expect(hasPassage(s, 'ARD', 'BOR')).toBe(true); // coalition transit
    expect(previewCommand(s, { type: 'declareWar', country: 'ARD', target: 'BOR' }).ok).toBe(false);
    // timed departure (separate 2-member coalition so no victory settles meanwhile)
    const s2 = newMiniGame();
    must(s2, { type: 'createCoalition', country: 'ARD', name: 'Duo' });
    const co2 = Object.values(s2.coalitions)[0];
    must(s2, { type: 'applyCoalition', country: 'DUN', coalition: co2.id });
    must(s2, { type: 'respondApplication', country: 'ARD', coalition: co2.id, applicant: 'DUN', accept: true });
    departure(s2, co2.id);
  });

  function departure(s: ReturnType<typeof newMiniGame>, coId: string) {
    const co = s.coalitions[coId];
    expect(hasPassage(s, 'ARD', 'DUN')).toBe(true);
    const r = must(s, { type: 'leaveCoalition', country: 'DUN' });
    const at = (r.result as { effectiveAt: number }).effectiveAt;
    expect(at).toBe(24 * 60);
    advance(s, 23 * 60);
    expect(co.members.some((m) => m.country === 'DUN')).toBe(true);
    expect(getCountryView(s, 'ARD').coalitions[0].departures[0].effectiveAt).toBe(at);
    advance(s, 2 * 60);
    expect(s.score.result).toBeNull();
    expect(co.members.some((m) => m.country === 'DUN')).toBe(false);
    expect(co.history.find((h) => h.country === 'DUN')!.leftAt).toBe(at);
    expect(hasPassage(s, 'ARD', 'DUN')).toBe(false);
  }

  it('a bot in the human coalition remains an independent controller', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s);
    must(s, { type: 'createCoalition', country: 'ARD', name: 'Pact' });
    const co = Object.values(s.coalitions)[0];
    must(s, { type: 'proposeOffer', country: 'ARD', to: 'DUN', give: [{ kind: 'coalition_invite', coalition: co.id }], receive: [] });
    const calls: string[] = [];
    const spy: CountryController = { decide: (v, ctx) => { if (v.viewer === 'DUN') calls.push(ctx.reviews.join(',')); return BasicController.decide(v, ctx); } };
    advance(s, 1440, { controllers: (c) => (c === 'DUN' ? spy : IdleController) });
    expect(co.members.map((m) => m.country)).toContain('DUN');
    expect(s.countries.DUN.controller).toBe('ai');
    expect(calls.length).toBeGreaterThan(3);
    place(s, 'DUN', N.dunCapital, ['inf']);
  });

  it('messages: private threads and coalition thread with intent templates', () => {
    const s = newMiniGame();
    must(s, { type: 'sendMessage', country: 'ARD', to: 'BOR', text: 'Hello neighbour' });
    must(s, { type: 'sendMessage', country: 'BOR', to: 'ARD', intent: 'warn', reason: 'troops massing on the border' });
    const th = getCountryView(s, 'BOR').messages['dm:ARD|BOR'];
    expect(th.length).toBe(2);
    expect(th[1].text).toMatch(/troops massing/);
    expect(getCountryView(s, 'CEL').messages['dm:ARD|BOR']).toBeUndefined();
    expect(previewCommand(s, { type: 'sendMessage', country: 'ARD', to: 'coalition', text: 'x' }).ok).toBe(false);
  });
});
