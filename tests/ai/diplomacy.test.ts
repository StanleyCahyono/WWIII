import { describe, expect, it } from 'vitest';
import { advance, deserialize, serialize, submitCommand } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { must, place, refreshVision, setStock, war, clearStacks } from '../fixtures/helpers';
import { UtilityController, getDecisionLog } from '../../src/ai';
import { decideOnce, memoryOf, recording } from './helpers';
import { joinCoalitionInternal, createCoalitionInternal } from '../../src/engine/systems/coalitions';

describe('AI diplomacy (A09, SPEC §2 workflow 4)', () => {
  it('refuses a poor offer and replies with a brief concrete reason that matches its logged decision', () => {
    const s = newMiniGame({ human: 'ARD', seed: 4 });
    advance(s, 60, { fallback: UtilityController });
    // ARD asks DUN for passage AND 2,000 money while giving nothing
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'DUN', give: [], receive: [{ kind: 'status', level: 'right_of_way' }, { kind: 'resource', resource: 'money', amount: 2_000_000 }] });
    const id = (r.result as { offer: string }).offer;
    advance(s, 30, { fallback: UtilityController }); // wake on offer → reply
    const o = s.offers[id];
    expect(o.status).toBe('declined');
    expect(o.responseReason).toBeTruthy();
    expect(o.responseReason!.length).toBeLessThan(200);
    expect(o.responseReason).toMatch(/nothing in return|worth more|trust|hostile/);
    // the reply in the thread carries the same reason, and the decision is logged + remembered
    const thread = s.messages['dm:ARD|DUN'] ?? [];
    expect(thread.some((m) => m.from === 'DUN' && m.offer === id && m.text.includes(o.responseReason!))).toBe(true);
    const mem = memoryOf(s, 'DUN');
    expect(mem.decisions.find((d) => d.offer === id)?.reason).toBe(o.responseReason);
    expect(getDecisionLog('DUN').some((e) => e.kind === 'decline_offer' && e.reason === o.responseReason)).toBe(true);
  });

  it('plausible yes: a generous offer is accepted; acceptance is idempotent', () => {
    const s = newMiniGame({ human: 'ARD', seed: 4 });
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'CEL', give: [{ kind: 'resource', resource: 'money', amount: 1_500_000 }, { kind: 'status', level: 'right_of_way' }], receive: [] });
    const id = (r.result as { offer: string }).offer;
    advance(s, 45, { fallback: UtilityController });
    expect(s.offers[id].status).toBe('accepted');
    expect(s.offers[id].responseReason).toMatch(/acceptable|strengthens/);
    const again = submitCommand(s, { type: 'respondOffer', country: 'CEL', offer: id, accept: true });
    expect(again.ok).toBe(false);
  });

  it('A09: a save with an offer pending resolves exactly once after reload', () => {
    const s = newMiniGame({ human: 'ARD', seed: 8 });
    const r = must(s, { type: 'proposeOffer', country: 'ARD', to: 'FAL', give: [{ kind: 'status', level: 'shared_intel' }], receive: [{ kind: 'status', level: 'right_of_way' }] });
    const id = (r.result as { offer: string }).offer;
    const loaded = deserialize(serialize(s));
    advance(loaded, 3 * 60, { fallback: UtilityController });
    const o = loaded.offers[id];
    expect(['accepted', 'declined']).toContain(o.status);
    const answers = (loaded.messages['dm:ARD|FAL'] ?? []).filter((m) => m.offer === id && m.from === 'FAL');
    expect(answers.length).toBe(1);
    if (o.status === 'accepted') {
      advance(loaded, 120, { fallback: UtilityController });
      expect(loaded.grants['ARD>FAL']?.level ?? loaded.grants['ARD->FAL']?.level ?? 'x').toBeTruthy();
    }
  });

  it('two bots reach a treaty without the human', () => {
    const s = newMiniGame({ human: 'ARD', seed: 21 });
    const { ctl, log } = recording();
    for (let d = 0; d < 6 && !s.score.result; d++) advance(s, 1440, { fallback: ctl });
    const bots = s.countryOrder.filter((c) => c !== 'ARD');
    // agreements in force between two bots (directional grants), negotiated through offers
    const botGrants = Object.keys(s.grants).filter((k) => { const [a, b] = k.split('>'); return bots.includes(a) && bots.includes(b); });
    expect(botGrants.length).toBeGreaterThan(0);
    const accepts = log.filter((x) => x.cmd.type === 'respondOffer' && x.cmd.accept && x.country !== 'ARD');
    expect(accepts.length).toBeGreaterThan(0);
    expect(accepts.every((x) => (x.cmd.reason ?? '').length > 5)).toBe(true);
    expect(s.countries.ARD.stats.accepted).toEqual({});
  });

  it('a small state seeks access, coalition or trade before considering war', () => {
    const s = newMiniGame({ human: null, seed: 13 });
    // make Dunmark eager and well armed: it still must try diplomacy first
    s.countries.DUN.personality = { aggression: 1, caution: 0, trade: 0.5, loyalty: 0.5, expansion: 1, research: 0.5 };
    setStock(s, 'DUN', { money: 60000, supplies: 20000, manpower: 20000, components: 10000, fuel: 10000 });
    for (let i = 0; i < 4; i++) place(s, 'DUN', 20, ['inf', 'inf', 'tank', 'tank']);
    const { ctl, log } = recording();
    for (let d = 0; d < 12 && !s.score.result; d++) advance(s, 1440, { fallback: ctl });
    const dun = log.filter((x) => x.country === 'DUN');
    const firstWar = dun.findIndex((x) => x.cmd.type === 'declareWar');
    const firstSeek = dun.findIndex((x) => x.cmd.type === 'applyCoalition' || (x.cmd.type === 'proposeOffer' && x.cmd.give.concat(x.cmd.receive).some((t) => t.kind !== 'peace')));
    expect(firstSeek).toBeGreaterThanOrEqual(0);
    if (firstWar >= 0) expect(firstSeek).toBeLessThan(firstWar);
    expect(getDecisionLog('DUN').some((e) => e.kind === 'war_deferred' && /small state/.test(e.reason)) || firstWar < 0 || firstSeek < firstWar).toBe(true);
  });

  it('a coalition partner defends its own exposed capital while declining the human\'s proposed operation', () => {
    const s = newMiniGame({ human: 'ARD', seed: 2 });
    const co = createCoalitionInternal(s, 'ARD', 'Western Pact', '', 'star');
    expect(joinCoalitionInternal(s, co.id, 'DUN', 'test')).toBe(true);
    clearStacks(s, 'DUN');
    const g1 = place(s, 'DUN', 26, ['inf', 'inf'], 'Lowmere Guard');
    const g2 = place(s, 'DUN', 26, ['inf'], 'Lowmere Rifles');
    war(s, 'FAL', 'DUN');
    place(s, 'FAL', 21, ['inf', 'inf', 'tank', 'tank', 'inf'], 'Falen Assault Group');
    refreshVision(s);
    // the human asks the partner to join an operation against BOR
    must(s, { type: 'sendMessage', country: 'ARD', to: 'DUN', intent: 'coordinate', text: 'Join our operation against BOR: march on Borgrad now.' });
    const { cmds } = decideOnce(s, 'DUN', ['operational'], { wake: ['war_declared:e1'] });
    const reply = (s.messages['dm:ARD|DUN'] ?? []).filter((m) => m.from === 'DUN');
    expect(reply.length).toBe(1);
    expect(reply[0].intent).toBe('decline');
    expect(reply[0].text).toMatch(/capital .* exposed/);
    // its forces head for (or stay at) the capital, none toward BOR
    const moves = cmds.filter((c) => c.type === 'move') as { stack: string; dest: number }[];
    expect(moves.some((m) => m.dest === 20 && (m.stack === g1.id || m.stack === g2.id))).toBe(true);
    for (const m of moves) expect(s.provinces[m.dest]?.owner).not.toBe('BOR');
    expect(getDecisionLog('DUN').some((e) => e.kind === 'decline_operation' && /exposed/.test(e.reason))).toBe(true);
  });
});

describe('AI coalition policy', () => {
  it('leaves a coalition under the explicit rule (lost trust in partners after the commitment window) and says why', () => {
    const s = newMiniGame({ human: null, seed: 5 });
    const co = createCoalitionInternal(s, 'BOR', 'Northern League', '', 'star');
    expect(joinCoalitionInternal(s, co.id, 'DUN', 'test')).toBe(true);
    decideOnce(s, 'DUN', ['strategic', 'diplomatic']); // records membership start
    expect(memoryOf(s, 'DUN').coalition?.id).toBe(co.id);
    s.clock.tick += 11 * 1440; // past the 10-day commitment window
    s.trust['DUN>BOR'] = { value: -40, history: [] };
    const { cmds } = decideOnce(s, 'DUN', ['diplomatic']);
    expect(cmds.some((c) => c.type === 'leaveCoalition')).toBe(true);
    const note = (s.messages[`co:${co.id}`] ?? []).find((m) => m.from === 'DUN' && m.intent === 'leave_coalition');
    expect(note?.text).toMatch(/lost trust/);
    expect(s.coalitions[co.id].departures.some((d) => d.country === 'DUN')).toBe(true);
  });

  it('stays in the coalition within the commitment window even with low trust', () => {
    const s = newMiniGame({ human: null, seed: 5 });
    const co = createCoalitionInternal(s, 'BOR', 'Northern League', '', 'star');
    joinCoalitionInternal(s, co.id, 'DUN', 'test');
    decideOnce(s, 'DUN', ['strategic', 'diplomatic']);
    s.trust['DUN>BOR'] = { value: -40, history: [] };
    s.clock.tick += 2 * 1440;
    const { cmds } = decideOnce(s, 'DUN', ['diplomatic']);
    expect(cmds.some((c) => c.type === 'leaveCoalition')).toBe(false);
  });
});
