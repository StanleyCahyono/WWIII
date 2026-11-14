import { describe, expect, it } from 'vitest';
import { advance, submitCommand, previewCommand, techStatus, serialize, deserialize, stateHash, researchRefund } from '../../src/engine';
import { newMiniGame } from '../fixtures/mini-world';
import { clearStacks, place, setStock, reconciled, must } from '../fixtures/helpers';

describe('research', () => {
  it('statuses: available, time-locked, prerequisite-locked, doctrine, facility, slots full, unaffordable, busy, completed', () => {
    const s = newMiniGame({ human: 'ARD' });
    expect(techStatus(s, 'ARD', 'land_infantry_2').status).toBe('available');
    expect(techStatus(s, 'ARD', 'late_tech').status).toBe('time_locked');
    expect(techStatus(s, 'ARD', 'late_tech').reason).toMatch(/day 30/);
    expect(techStatus(s, 'ARD', 'land_armor_doctrine').status).toBe('prerequisite_locked');
    expect(techStatus(s, 'ARD', 'east_only').status).toBe('doctrine_unavailable'); // western
    expect(techStatus(s, 'CEL', 'east_only').status).toBe('time_locked'); // european override day 10
    expect(techStatus(s, 'BOR', 'east_only').status).toBe('available'); // eastern
    expect(techStatus(s, 'ARD', 'lab_gated').status).toBe('facility_locked');
    expect(techStatus(s, 'ARD', 'str_missile_complex').status).toBe('completed');
    must(s, { type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' });
    expect(techStatus(s, 'ARD', 'land_infantry_2').status).toBe('busy');
    must(s, { type: 'startResearch', country: 'ARD', tech: 'ind_automation' });
    expect(techStatus(s, 'ARD', 'off_staff').status).toBe('slots_full');
    const r = submitCommand(s, { type: 'startResearch', country: 'ARD', tech: 'off_staff' });
    expect(r.ok).toBe(false);
    setStock(s, 'DUN', { money: 0 });
    const u = techStatus(s, 'DUN', 'off_staff');
    expect(u.status).toBe('unaffordable');
    expect(u.shortfall.money).toBe(300_000);
  });

  it('cancel refund is progress-dependent and quoted exactly', () => {
    const s = newMiniGame({ human: 'ARD' });
    must(s, { type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' });
    advance(s, 6 * 60); // 25 % of 24h
    const q = researchRefund(s, 'ARD', 'land_infantry_2')!;
    expect(q.money).toBe(Math.trunc(300_000 * 0.75 * 0.8));
    const v = previewCommand(s, { type: 'cancelResearch', country: 'ARD', tech: 'land_infantry_2' });
    expect(v.ok && (v.preview as { refund: { money: number } }).refund.money).toBe(q.money);
    const before = s.countries.ARD.stock.money;
    must(s, { type: 'cancelResearch', country: 'ARD', tech: 'land_infantry_2' });
    expect(s.countries.ARD.stock.money - before).toBe(q.money);
    advance(s, 24 * 60);
    expect(s.countries.ARD.techs.land_infantry_2).toBeUndefined();
    expect(reconciled(s, 'ARD')).toBe(true);
  });

  it('A08 / cross-check 3: save 1 minute before completion during research + recruitment; reload completes once, charges once, upgrades existing and in-production units', () => {
    const s = newMiniGame({ human: 'ARD' });
    clearStacks(s, 'ARD');
    const existing = place(s, 'ARD', 12, ['inf', 'inf']);
    existing.units[0].hp = 750; // half health
    const m0 = s.countries.ARD.stock.money;
    must(s, { type: 'startResearch', country: 'ARD', tech: 'land_infantry_2' }); // 24h
    must(s, { type: 'mobilize', country: 'ARD', unit: 'inf', cities: ['ARD-ardena'] }); // 12h / 1.25 → 576 min
    const charged = m0 - s.countries.ARD.stock.money;
    expect(charged).toBe(300_000 + 100_000);
    advance(s, 24 * 60 - 1);
    const hpAtSave = Object.values(s.stacks).flatMap((x) => x.units).find((u) => u.id === existing.units[0].id)!.hp;
    const save = serialize(s);
    const a = deserialize(save);
    advance(a, 120);
    advance(s, 120);
    expect(stateHash(a)).toBe(stateHash(s));
    for (const st of [a, s]) {
      expect(st.events.filter((e) => e.kind === 'research_concluded' && e.private.ARD).length).toBe(1);
      expect(st.countries.ARD.ledger.totals.research?.money).toBe(-300_000);
      expect(st.countries.ARD.ledger.totals.recruitment?.money).toBe(-100_000);
      const infs = Object.values(st.stacks).filter((x) => x.owner === 'ARD').flatMap((x) => x.units).filter((u) => u.type === 'inf');
      expect(infs.length).toBe(3);
      expect(infs.every((u) => u.level === 2)).toBe(true);
      expect(infs.every((u) => u.maxHp === 2000)).toBe(true);
      const half = infs.find((u) => u.id === existing.units[0].id)!;
      expect(half.hp).toBe(Math.round((hpAtSave * 2000) / 1500)); // HP fraction preserved
    }
    // reopening the completed save does not complete or charge again
    const b = deserialize(serialize(a));
    advance(b, 1440);
    expect(b.events.filter((e) => e.kind === 'research_concluded' && e.private.ARD).length).toBe(1);
    expect(b.countries.ARD.ledger.totals.research?.money).toBe(-300_000);
  });

  it('research grants blueprints only — never inventory', () => {
    const s = newMiniGame({ human: 'ARD' });
    setStock(s, 'ARD', { money: 100000, rare: 1000, electronics: 1000 });
    must(s, { type: 'startResearch', country: 'ARD', tech: 'str_cruise_blueprint' });
    must(s, { type: 'startResearch', country: 'ARD', tech: 'hyp_advanced_materials' });
    advance(s, 25 * 60);
    const inv = s.countries.ARD.missiles.cruise_x;
    expect(inv.maturity).toBe('qualified');
    expect(inv.ready).toBe(0);
    must(s, { type: 'startResearch', country: 'ARD', tech: 'hyp_glide_blueprint' });
    advance(s, 25 * 60);
    expect(s.countries.ARD.missiles.hgv_x.maturity).toBe('prototype');
    expect(s.countries.ARD.missiles.hgv_x.ready).toBe(0);
    expect(s.countries.ARD.missiles.hcm_x).toBeUndefined(); // common prerequisite doesn't grant the other family
  });
});
