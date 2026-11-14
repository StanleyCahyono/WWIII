import { describe, it, expect } from 'vitest';
import { effectsText, effectText, effectName } from '../../src/ui/effects';
import { humanizeIds, readableEventText, offerSummary } from '../../src/ui/eventText';
import type { Frame } from '../../src/ui/sim/protocol';
import type { Offer } from '../../src/engine/index';

/** Readable UI copy: building effects and diplomatic event text never show raw identifiers. */
describe('building effect labels (one shared formatter)', () => {
  it('formats every catalog effect key as plain text', () => {
    expect(effectsText({ productionMult: 1.1, recruitSpeedMult: 1.05 })).toBe('+10% production · +5% recruiting speed');
    expect(effectsText({ defenseMult: 1.05, hpRecoveryPerDay: 4 })).toBe('+5% defense · +4 HP recovery/day');
    expect(effectsText({ navalSlots: 9, hpRecoveryPerDay: 9 })).toBe('9 naval slots · +9 HP recovery/day');
    expect(effectsText({ researchSlots: 1, researchSpeedMult: 1 })).toBe('1 research slot');
    expect(effectText('produces', { money: 5, fuel: 2 })).toBe('produces 5 money, 2 fuel per day');
    expect(effectText('populationShield', 0.3)).toBe('30% of population sheltered');
    expect(effectText('radarKm', 300)).toBe('300 km radar range');
    expect(effectText('speedMult', 0.9)).toBe('−10% movement speed');
    expect(effectName('maintenanceSlots')).toBe('maintenance slots');
    expect(effectName('someNewKey')).toBe('some new key');
    // no raw camelCase key survives for any key the catalog uses
    const keys = ['productionMult', 'produces', 'manpowerPerDay', 'recruitSpeedMult', 'defenseMult', 'populationShield', 'hpRecoveryPerDay', 'moraleDelta', 'radarKm', 'radarSensitivity', 'airSlots', 'navalSlots', 'researchSlots', 'researchSpeedMult', 'speedMult', 'maintenanceSlots', 'liftCapacity', 'missileSlots'];
    for (const k of keys) {
      const t = effectText(k, k === 'produces' ? { money: 1 } : 1.5) ?? '';
      expect(t, k).not.toMatch(/[a-z][A-Z]/);
      expect(t, k).not.toContain(':');
    }
  });
});

describe('diplomatic event text', () => {
  const offer = (o: Partial<Offer>): Offer => ({ id: 'of31', from: 'MEX', to: 'USA', give: [], receive: [], createdAt: 0, expiresAt: 1440, effectiveDelayMin: 0, relationVersion: 0, status: 'pending', resolvedAt: null, effectiveAt: null, applied: false, reason: null, responseReason: null, ...o });
  const frame = (offers: Offer[]) => ({ view: { viewer: 'USA', offers, coalitions: [{ id: 'co3', name: 'Levant Accord' }] } }) as unknown as Frame;

  it('rebuilds offer events from structured data: names, readable terms, a readable reference', () => {
    const o = offer({ give: [{ kind: 'status', level: 'right_of_way' }, { kind: 'resource', resource: 'money', amount: 500_000 }], receive: [{ kind: 'status', level: 'right_of_way' }] });
    const f = frame([o, offer({ id: 'of32', from: 'ISR', give: [{ kind: 'coalition_invite', coalition: 'co3' }] })]);
    expect(readableEventText({ kind: 'offer_received', text: 'MEX sent an offer: MEX gives [right of_way, 500 money] for [right of_way].', data: { offer: 'of31' } }, f)).toBe('Mexico sent an offer: Mexico gives right of way and 500 money in exchange for right of way.');
    expect(readableEventText({ kind: 'offer_received', text: 'ISR sent an offer: ISR gives [coalition membership (co3)] for [—].', data: { offer: 'of32' } }, f)).toBe('Israel sent an offer: Israel gives membership of Levant Accord, asking nothing in return.');
    expect(readableEventText({ kind: 'offer_expired', text: 'Offer of31 expired without an answer.', data: { offer: 'of31' } }, f)).toBe("Mexico's offer expired without an answer.");
    expect(offerSummary(offer({ from: 'USA', to: 'MEX', receive: [{ kind: 'peace' }] }), 'USA')).toBe('you ask for a peace treaty, offering nothing in return');
    const mine = offer({ from: 'USA', to: 'MEX', give: [{ kind: 'status', level: 'shared_intel' }] });
    expect(readableEventText({ kind: 'offer_expired', text: 'Offer of33 expired without an answer.', data: { offer: mine.id } }, frame([mine]))).toBe('Your offer to Mexico expired without an answer.');
  });

  it('falls back to resolving identifiers when the offer is no longer in the view', () => {
    const f = frame([]);
    const t = humanizeIds('MEX sent an offer: MEX gives [right of_way, 500 money] for [right of_way].', f.view);
    expect(t).toBe('Mexico sent an offer: Mexico gives right of way, 500 money in exchange for right of way.');
    expect(humanizeIds('ISR gives [coalition membership (co3)] for [—].', f.view)).toBe('Israel gives membership of Levant Accord, asking nothing in return.');
    expect(readableEventText({ kind: 'offer_expired', text: 'Offer of31 expired without an answer.', data: { offer: 'of31' } }, f)).toBe('An offer expired without an answer.');
    for (const raw of ['of_way', 'of31', '(co3)', '[—]', 'MEX', 'ISR']) expect(t + humanizeIds('ISR gives [coalition membership (co3)] for [—].', f.view)).not.toContain(raw);
  });
});
