import { describe, it, expect } from 'vitest';
import { advance, buildWorld120Scenario, createCampaign, dayOf, submitCommand, techStatus, validateCommand } from '../../src/engine';
import type { Command, GameState } from '../../src/engine';
import { labLevel } from '../../src/engine/systems/research';
import { territoryOf } from '../../src/engine/systems/world';
import { loadMapData } from '../../src/data/map-index';
import { CATALOG } from '../../src/data/catalog/index';
import { MANIFEST } from '../../src/data/countries';
import { PROFILES } from '../../src/data/profiles/index';

/**
 * W04: "At least two peers can complete either hypersonic branch in a legal playthrough."
 *
 * Real World 120 data (map, catalog, 120 profiles). Three non-U.S. peers pursue a hypersonic branch
 * using only commands submitted through the shared validator (`submitCommand`): research every node of
 * the chain as soon as the validator accepts it, upgrade laboratories when a node is facility-locked,
 * and order production once qualification research is done. Time only moves through `advance`.
 * Every other seat is idle (no AI host), so nothing external helps or hinders the peers.
 * Checked gates: day gates, prerequisites, doctrine, national laboratory level and resources — each
 * blocked attempt is shown to be rejected by `validateCommand` before the gate opens.
 */

const techById = new Map(CATALOG.techs.map((t) => [t.id, t]));
/** Prerequisite-first order of every node needed for `final`. */
function chainOf(final: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id)) return;
    for (const p of techById.get(id)!.prereqs) visit(p);
    out.push(id);
  };
  visit(final);
  return out;
}

interface Plan { country: string; final: 'hyp_glide_qualified' | 'hyp_cruise_qualified'; missile: 'msl_hgv' | 'msl_hcm' }
const PLANS: Plan[] = [
  { country: 'CHN', final: 'hyp_cruise_qualified', missile: 'msl_hcm' },
  { country: 'RUS', final: 'hyp_glide_qualified', missile: 'msl_hgv' },
  { country: 'IND', final: 'hyp_glide_qualified', missile: 'msl_hgv' },
];

interface Record_ {
  started: Map<string, number>; // tech → day accepted
  blocked: Map<string, Set<string>>; // tech → statuses the validator rejected before acceptance
  labBuilds: number;
  complexBuilds: number;
  producedAt: number | null;
  readyAt: number | null;
  stockBeforeProduce: number | null;
  ledgerDelta: number | null;
  readyAtSubmit: number | null;
}

function must(st: GameState, cmd: Command) {
  const r = submitCommand(st, cmd);
  expect(r.ok, `${cmd.country} ${cmd.type}: ${r.ok ? '' : (r as { reason?: string }).reason}`).toBe(true);
  return r;
}

describe('W04 — peers complete a hypersonic branch in a legal real-data playthrough', () => {
  it('China (cruise), Russia and India (glide) research, qualify and produce through the validator before day 180; no free inventory', () => {
    const sc = buildWorld120Scenario({ map: loadMapData(), catalog: CATALOG as never, manifest: MANIFEST, profiles: PROFILES });
    const st = createCampaign({ seed: 7, humanCountry: 'USA', scenario: sc });
    expect(Object.keys(st.countries)).toHaveLength(120);

    // Opening: no peer owns a hypersonic program node or any missile inventory.
    for (const p of PLANS) {
      const cs = st.countries[p.country];
      expect(cs.controller === 'ai', p.country).toBe(true);
      for (const id of Object.keys(cs.techs)) expect(id.startsWith('hyp_glide') || id.startsWith('hyp_cruise'), `${p.country} ${id}`).toBe(false);
      for (const inv of Object.values(cs.missiles)) expect(inv.ready).toBe(0);
      expect(cs.missiles[p.missile]).toBeUndefined();
    }

    const rec: Record<string, Record_> = {};
    for (const p of PLANS) rec[p.country] = { started: new Map(), blocked: new Map(), labBuilds: 0, complexBuilds: 0, producedAt: null, readyAt: null, stockBeforeProduce: null, ledgerDelta: null, readyAtSubmit: null };
    let nonce = 0;

    while (dayOf(st.clock.tick) <= 180 && PLANS.some((p) => rec[p.country].readyAt === null)) {
      const day = dayOf(st.clock.tick);
      for (const p of PLANS) {
        const r = rec[p.country];
        if (r.readyAt !== null) continue;
        const cs = st.countries[p.country];
        for (const id of chainOf(p.final)) {
          const s = techStatus(st, p.country, id);
          expect(s.status, `${p.country} ${id}`).not.toBe('doctrine_unavailable');
          if (s.status === 'available') {
            must(st, { type: 'startResearch', country: p.country, tech: id, nonce: `hyp-${nonce++}` });
            r.started.set(id, day);
            continue;
          }
          if (s.status === 'completed' || s.status === 'busy' || s.status === 'slots_full') continue;
          // Locked: the shared validator must refuse the same order.
          const v = validateCommand(st, { type: 'startResearch', country: p.country, tech: id });
          expect(v.ok, `${p.country} ${id} should be refused while ${s.status}`).toBe(false);
          if (!r.blocked.has(id)) r.blocked.set(id, new Set());
          r.blocked.get(id)!.add(s.status);
          if (s.status === 'time_locked') expect(day).toBeLessThan(s.dayAvailable);
          if (s.status === 'facility_locked' && !cs.jobs.some((j) => j.kind === 'construct' && j.building === 'research_lab')) {
            // Upgrade/build laboratories in owned cities (one level per city), validated like any order.
            const cities = territoryOf(st, p.country).cities.slice(0, 6);
            must(st, { type: 'build', country: p.country, building: 'research_lab', targets: cities, nonce: `lab-${nonce++}` });
            r.labBuilds++;
          }
        }
        const inv = cs.missiles[p.missile];
        if (inv && inv.maturity !== 'prototype' && r.producedAt === null) {
          const pre = validateCommand(st, { type: 'produceMissile', country: p.country, missile: p.missile });
          if (!pre.ok) {
            // Only a missing launch complex may block production at this point.
            if (!cs.jobs.some((j) => j.kind === 'construct' && j.building === 'missile_complex')) {
              must(st, { type: 'build', country: p.country, building: 'missile_complex', targets: [cs.capitalCity!], nonce: `mc-${nonce++}` });
              r.complexBuilds++;
            }
          } else {
            const mt = CATALOG.missiles.find((m) => m.id === p.missile)!;
            r.stockBeforeProduce = cs.stock.money;
            const ledgerBefore = cs.ledger.totals.missile_production?.money ?? 0;
            must(st, { type: 'produceMissile', country: p.country, missile: p.missile, nonce: `msl-${nonce++}` });
            r.ledgerDelta = (cs.ledger.totals.missile_production?.money ?? 0) - ledgerBefore;
            expect(r.ledgerDelta).toBe(-mt.cost.money! * 1000);
            r.readyAtSubmit = inv.ready;
            r.producedAt = day;
          }
        }
        if (inv && inv.ready > 0) r.readyAt = day;
      }
      advance(st, 360);
    }

    for (const p of PLANS) {
      const r = rec[p.country];
      const cs = st.countries[p.country];
      const mt = CATALOG.missiles.find((m) => m.id === p.missile)!;
      // Every node of the branch completed domestically (no grant, no licence).
      for (const id of chainOf(p.final)) {
        expect(cs.techs[id], `${p.country} ${id}`).toBeTruthy();
        if (r.started.has(id)) expect(cs.techs[id].lineage).toBe('domestic');
        // Never started before its day gate.
        if (r.started.has(id)) expect(r.started.get(id)!, `${p.country} ${id}`).toBeGreaterThanOrEqual(techById.get(id)!.dayAvailable);
      }
      expect(r.started.has(p.final), p.country).toBe(true);
      // The other family's program is not granted by the common prerequisite.
      const other = p.missile === 'msl_hgv' ? 'msl_hcm' : 'msl_hgv';
      expect(cs.missiles[other], `${p.country} ${other}`).toBeUndefined();
      // Research permits production but never creates inventory: zero ready when the order was placed.
      expect(r.producedAt, p.country).not.toBeNull();
      expect(r.readyAtSubmit).toBe(0);
      expect(r.ledgerDelta).toBeLessThan(0);
      expect(r.readyAt, p.country).not.toBeNull();
      expect(r.readyAt!).toBeLessThanOrEqual(180);
      expect(r.readyAt!).toBeGreaterThanOrEqual(r.producedAt!);
      expect(cs.missiles[p.missile].ready).toBe(mt.batchSize);
      expect(cs.missiles[p.missile].produced).toBeGreaterThanOrEqual(mt.batchSize);
      expect(cs.stats.rejected.startResearch ?? 0, `${p.country} rejected research`).toBe(0);
      expect(cs.stats.rejected.produceMissile ?? 0).toBe(0);
      // Hypersonic nodes all required a laboratory level; it was checked by the validator.
      expect(labLevel(st, p.country)).toBeGreaterThanOrEqual(techById.get(p.final)!.requiresLabLevel ?? 0);
      // The day gates were real constraints: each hypersonic node was refused at least once before.
      for (const id of chainOf(p.final).filter((x) => x.startsWith('hyp_'))) {
        expect([...(r.blocked.get(id) ?? [])].length, `${p.country} ${id} was never gated`).toBeGreaterThan(0);
      }
      // eslint-disable-next-line no-console
      console.log(`[W04] ${p.country} ${p.final}: started ${[...r.started].map(([t, d]) => `${t}@d${d}`).join(', ')}; labs ${r.labBuilds} order(s), complexes ${r.complexBuilds}; produce d${r.producedAt}, ready d${r.readyAt}; blocked ${[...r.blocked].map(([t, s]) => `${t}:${[...s].join('/')}`).join(', ')}`);
    }
    // Russia started below the glide blueprint's laboratory requirement and had to build up to it.
    expect([...(rec.RUS.blocked.get('hyp_glide_blueprint') ?? [])]).toContain('facility_locked');
    expect(rec.RUS.labBuilds).toBeGreaterThan(0);
  }, 300_000);
});
