import { describe, expect, it } from 'vitest';
import { RESOURCES, TARGET_CLASSES, TERRAINS, type TechNode } from '../../src/engine/data-types';
import {
  BUILDING_TYPES,
  CAMPAIGN_DAYS,
  CATALOG,
  MAX_NATIONAL_RESEARCH_SLOTS,
  MISSILE_TYPES,
  PROGRAM_MATURITY_ORDER,
  RESOURCE_DEFS,
  RURAL_BUILDING_IDS,
  STARTER_UNITS,
  TECH_NODES,
  UNIT_TYPES,
  buildingById,
  missileById,
  techById,
  unitById,
} from '../../src/data/catalog';

const LAND_GROUND_CAPTURE_FAMILIES = new Set(['infantry', 'armor']);

describe('resources', () => {
  it('defines all seven accounts once, with roles and positive reference prices (money = 1)', () => {
    expect(RESOURCE_DEFS.map((r) => r.id).sort()).toEqual([...RESOURCES].sort());
    for (const r of RESOURCE_DEFS) {
      expect(r.role.length).toBeGreaterThan(30);
      expect(r.referencePrice).toBeGreaterThan(0);
    }
    expect(RESOURCE_DEFS.find((r) => r.id === 'money')!.referencePrice).toBe(1);
  });

  it('every resource is used by some unit cost or upkeep (each material has a reason to exist)', () => {
    for (const res of RESOURCES) {
      const used = UNIT_TYPES.some((u) => (u.cost[res] ?? 0) > 0 || (u.upkeepPerDay[res] ?? 0) > 0);
      expect(used, res).toBe(true);
    }
  });
});

describe('ids', () => {
  it('ids are unique across each collection', () => {
    for (const xs of [UNIT_TYPES, BUILDING_TYPES, TECH_NODES, MISSILE_TYPES]) {
      const ids = xs.map((x: { id: string }) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('units', () => {
  it('covers every family and the required counts', () => {
    const count = (f: string) => UNIT_TYPES.filter((u) => u.family === f).length;
    expect(count('infantry')).toBe(7);
    expect(count('armor')).toBe(5);
    expect(count('support') + count('air_defense') + count('recon')).toBeGreaterThanOrEqual(7);
    expect(count('helicopter')).toBe(3);
    expect(count('fighter')).toBe(7);
    expect(count('heavy')).toBeGreaterThanOrEqual(5);
    expect(count('naval')).toBe(5);
    expect(count('submarine')).toBe(2);
    expect(count('missile_launcher')).toBe(2);
    expect(count('officer')).toBe(7);
    expect(count('deployable')).toBe(2);
  });

  it('starter set is available to everyone', () => {
    for (const id of ['inf_motorized', 'arm_afv', 'sup_towed_artillery', 'nav_corvette', 'ftr_air_superiority']) {
      expect(STARTER_UNITS).toContain(id);
    }
  });

  it('every unit has ≥1 level with consistent numbering, positive hp and speed', () => {
    for (const u of UNIT_TYPES) {
      expect(u.levels.length, u.id).toBeGreaterThanOrEqual(1);
      u.levels.forEach((l, i) => {
        expect(l.level, u.id).toBe(i + 1);
        expect(l.hp, u.id).toBeGreaterThan(0);
        expect(l.speedKmh, u.id).toBeGreaterThan(0);
        expect(l.signature).toBeGreaterThanOrEqual(0);
        expect(l.signature).toBeLessThanOrEqual(3);
        for (const k of Object.keys(l.attack)) expect(TARGET_CLASSES).toContain(k);
        for (const k of Object.keys(l.defense)) expect(TARGET_CLASSES).toContain(k);
        if (l.radarKm > 0) {
          expect(l.radarDetects?.length, u.id).toBeGreaterThan(0);
          expect(l.radarSensitivity, u.id).toBeGreaterThanOrEqual(0);
          expect(l.radarSensitivity!, u.id).toBeLessThanOrEqual(3);
        }
      });
      expect(u.levels[0].tech, u.id).toBe(u.unlockTech);
      for (const t of Object.keys(u.terrain)) expect(TERRAINS).toContain(t);
      expect(u.buildHours).toBeGreaterThan(0);
      expect(u.orders.length, u.id).toBeGreaterThan(0);
      expect(u.description.length).toBeGreaterThan(20);
    }
  });

  it('capture only for land ground infantry and armor; never for artillery, air, naval', () => {
    for (const u of UNIT_TYPES) {
      if (u.capture) {
        expect(u.domain, u.id).toBe('land');
        expect(LAND_GROUND_CAPTURE_FAMILIES.has(u.family), u.id).toBe(true);
        expect(u.orders, u.id).toContain('capture');
      } else {
        expect(u.orders, u.id).not.toContain('capture');
      }
      if (u.family === 'infantry') expect(u.capture, u.id).toBe(true);
    }
  });

  it('speed bands are plausible per domain', () => {
    for (const u of UNIT_TYPES) {
      const s = u.levels[0].speedKmh;
      if (u.domain === 'land') expect(s, u.id).toBeLessThanOrEqual(80);
      if (u.domain === 'sea' || u.domain === 'subsurface') expect(s, u.id).toBeLessThanOrEqual(60);
      if (u.domain === 'air' && u.family !== 'helicopter' && u.family !== 'officer' && u.family !== 'deployable' && u.id !== 'ftr_uav') {
        expect(s, u.id).toBeGreaterThanOrEqual(600);
        expect(s, u.id).toBeLessThanOrEqual(1500);
      }
    }
  });

  it('aircraft (fixed wing) carry endurance and operational range; stealth and subs have high signatures', () => {
    for (const u of UNIT_TYPES) {
      if (u.domain === 'air' && u.targetClass === 'airplane') {
        expect(u.levels[0].operationalRangeKm, u.id).toBeGreaterThan(0);
        expect(u.levels[0].enduranceMin, u.id).toBeGreaterThan(0);
      }
      if (u.domain === 'subsurface' && u.family === 'submarine') expect(u.levels[0].signature, u.id).toBeGreaterThanOrEqual(2);
      if (u.id.includes('stealth')) expect(u.levels[0].signature, u.id).toBe(3);
    }
  });

  it('only sonar/ASW sensors detect subsurface (no generic land radar sees submarines)', () => {
    for (const u of UNIT_TYPES) {
      for (const l of u.levels) {
        if (l.radarDetects?.includes('subsurface')) {
          expect(u.features.some((f) => f.id === 'sonar'), u.id).toBe(true);
        }
      }
    }
  });

  it('officers carry an officerBonus; deployables a deployable block; carriers carry carrier-capable aircraft', () => {
    for (const u of UNIT_TYPES) {
      if (u.family === 'officer') expect(u.officerBonus?.appliesTo.length, u.id).toBeGreaterThan(0);
      if (u.family === 'deployable') expect(u.deployable?.uses, u.id).toBeGreaterThan(0);
    }
    const carrier = unitById.get('nav_carrier')!;
    expect(carrier.carries!.slots).toBeGreaterThan(0);
    const capable = UNIT_TYPES.filter((u) => u.carrierCapable);
    expect(capable.map((u) => u.id)).toEqual(expect.arrayContaining(['ftr_naval_air_superiority', 'ftr_naval_strike', 'hvy_naval_aew']));
    for (const u of capable) expect(carrier.carries!.families).toContain(u.family);
    const officerTypes = UNIT_TYPES.filter((u) => u.family === 'officer').map((u) => u.id);
    expect(new Set(officerTypes).size).toBe(7);
  });

  it('every requires references an existing building and a valid level', () => {
    for (const u of UNIT_TYPES) {
      expect(u.requires.length, u.id).toBeGreaterThan(0);
      for (const r of u.requires) {
        const b = buildingById.get(r.building);
        expect(b, `${u.id} requires ${r.building}`).toBeDefined();
        expect(b!.scope).toBe('city');
        expect(r.level).toBeGreaterThanOrEqual(1);
        expect(r.level).toBeLessThanOrEqual(b!.maxLevel);
      }
    }
  });

  it('names are original (no obvious real platform designations like F-35, T-90, M1)', () => {
    const banned = /\b([A-Z]{1,3}-\d{1,3}|Abrams|Leopard|Patriot|Aegis|Tomahawk|Iskander|Kinzhal|Avangard|Zircon|Raptor|Lightning|Eagle|Apache|Hornet\s+Strike|Nimitz|Kirov|Virginia|Ohio|Typhoon|Rafale|Gripen)\b/;
    for (const u of UNIT_TYPES) expect(banned.test(u.name), u.name).toBe(false);
    for (const m of MISSILE_TYPES) expect(banned.test(m.name), m.name).toBe(false);
  });
});

describe('buildings', () => {
  it('has the documented city buildings and exactly the documented rural set', () => {
    const city = BUILDING_TYPES.filter((b) => b.scope === 'city').map((b) => b.id);
    for (const id of ['arms_industry', 'recruiting_office', 'army_base', 'air_base', 'naval_base', 'bunker', 'hospital', 'radar_station', 'research_lab', 'logistics_hub', 'maintenance_depot', 'missile_complex', 'electronics_plant', 'refinery']) {
      expect(city).toContain(id);
    }
    expect(city).not.toContain('annex');
    const rural = BUILDING_TYPES.filter((b) => b.scope === 'rural').map((b) => b.id).sort();
    expect(rural).toEqual([...RURAL_BUILDING_IDS].sort());
    expect(buildingById.get('local_industry')!.needsDeposit).toBe(true);
    expect(buildingById.get('coastal_pontoon')!.coastalOnly).toBe(true);
    expect(buildingById.get('naval_base')!.coastalOnly).toBe(true);
  });

  it('levels are numbered 1..maxLevel with positive costs and hours', () => {
    for (const b of BUILDING_TYPES) {
      expect(b.levels.length, b.id).toBe(b.maxLevel);
      b.levels.forEach((l, i) => {
        expect(l.level).toBe(i + 1);
        expect(l.buildHours).toBeGreaterThan(0);
        expect(Object.values(l.cost).reduce((a, x) => a + (x ?? 0), 0)).toBeGreaterThan(0);
      });
      if (b.unlockTech) expect(techById.has(b.unlockTech), b.id).toBe(true);
    }
  });

  it('maintenance depots provide maintenance slots (sustainment/readiness system)', () => {
    expect(buildingById.get('maintenance_depot')!.levels.every((l) => (l.effects.maintenanceSlots ?? 0) > 0)).toBe(true);
  });
});

describe('research tree', () => {
  it('every referenced tech exists (unit unlocks, unit levels, buildings, missiles, prereqs)', () => {
    for (const u of UNIT_TYPES) {
      if (u.unlockTech) expect(techById.has(u.unlockTech), `${u.id}.unlockTech ${u.unlockTech}`).toBe(true);
      for (const l of u.levels) if (l.tech) expect(techById.has(l.tech), `${u.id} L${l.level} ${l.tech}`).toBe(true);
      for (const l of u.levels.slice(1)) expect(l.tech, `${u.id} L${l.level} must have a tech`).not.toBeNull();
    }
    for (const m of MISSILE_TYPES) {
      expect(techById.has(m.blueprintTech), m.id).toBe(true);
      if (m.qualifyTech) expect(techById.has(m.qualifyTech), m.id).toBe(true);
    }
    for (const t of TECH_NODES) {
      for (const p of t.prereqs) expect(techById.has(p), `${t.id} prereq ${p}`).toBe(true);
      for (const id of t.effects.unlockUnit ?? []) expect(unitById.has(id), `${t.id} unlockUnit ${id}`).toBe(true);
      for (const ul of t.effects.unitLevel ?? []) {
        const u = unitById.get(ul.unit);
        expect(u, `${t.id} unitLevel ${ul.unit}`).toBeDefined();
        expect(u!.levels[ul.level - 1]?.tech, `${t.id} grants ${ul.unit} L${ul.level}`).toBe(t.id);
      }
      for (const id of t.effects.unlockBuilding ?? []) expect(buildingById.has(id), `${t.id} unlockBuilding ${id}`).toBe(true);
      for (const id of t.effects.unlockMissile ?? []) expect(missileById.has(id), `${t.id} unlockMissile ${id}`).toBe(true);
      if (t.effects.missileProgram) expect(missileById.has(t.effects.missileProgram.missile)).toBe(true);
    }
  });

  it('unit unlock techs list the unit in unlockUnit (blueprint and tech agree)', () => {
    for (const u of UNIT_TYPES) {
      if (!u.unlockTech) continue;
      expect(techById.get(u.unlockTech)!.effects.unlockUnit ?? [], u.id).toContain(u.id);
    }
  });

  it('has no prerequisite cycles', () => {
    const state = new Map<string, 0 | 1 | 2>();
    const visit = (id: string, path: string[]): void => {
      const s = state.get(id) ?? 0;
      if (s === 2) return;
      if (s === 1) throw new Error(`cycle: ${[...path, id].join(' → ')}`);
      state.set(id, 1);
      for (const p of techById.get(id)!.prereqs) visit(p, [...path, id]);
      state.set(id, 2);
    };
    for (const t of TECH_NODES) expect(() => visit(t.id, [])).not.toThrow();
  });

  it('dayAvailable is monotone with respect to prereqs, within the campaign, and tiers increase', () => {
    for (const t of TECH_NODES) {
      expect(t.dayAvailable).toBeGreaterThanOrEqual(1);
      expect(t.dayAvailable).toBeLessThanOrEqual(160);
      expect(t.hours).toBeGreaterThan(0);
      for (const p of t.prereqs) {
        const pn = techById.get(p)!;
        expect(t.dayAvailable, `${t.id} vs ${p}`).toBeGreaterThanOrEqual(pn.dayAvailable);
        expect(t.tier, `${t.id} tier vs ${p}`).toBeGreaterThanOrEqual(pn.tier);
      }
    }
  });

  it('covers all ten branches and includes the named U.S.-package nodes', () => {
    const branches = new Set(TECH_NODES.map((t) => t.branch));
    for (const b of ['land', 'support', 'aviation', 'naval', 'recon', 'officer', 'strategic', 'industry', 'mobility', 'hypersonic']) expect(branches.has(b as TechNode['branch'])).toBe(true);
    for (const id of [
      'mob_strategic_airlift_2', 'mob_refuel_support', 'mob_lift_1', 'nav_carrier_aviation', 'rec_broad_area_recon',
      'ind_systems_integration_1', 'ind_systems_integration_2', 'ind_systems_integration_3',
      'ind_advanced_electronics_1', 'ind_advanced_electronics_2', 'ind_advanced_electronics_3',
      'ind_sustainment_1', 'ind_sustainment_2', 'hyp_advanced_materials', 'hyp_glide_blueprint', 'hyp_glide_qualified',
      'hyp_cruise_blueprint', 'hyp_cruise_qualified', 'str_cruise_missile_1', 'str_cruise_missile_2', 'str_ballistic_missile_1', 'str_ballistic_missile_2',
    ]) {
      expect(techById.has(id), id).toBe(true);
    }
    expect(techById.get('mob_strategic_airlift_2')!.effects.liftCapacity).toBeGreaterThan(0);
    expect(techById.get('mob_lift_1')!.effects.liftCapacity).toBeGreaterThan(0);
    const refuel = techById.get('mob_refuel_support')!.effects.modifiers!.map((m) => m.key);
    expect(refuel).toEqual(expect.arrayContaining(['air_operational_range_mult', 'air_endurance_mult']));
    expect(techById.get('nav_carrier_aviation')!.effects.unlockUnit).toEqual(expect.arrayContaining(['ftr_naval_air_superiority', 'ftr_naval_strike']));
    expect(techById.get('rec_broad_area_recon')!.effects.unlockUnit).toContain('rec_broad_area');
    expect(techById.get('ind_sustainment_1')!.effects.maintenanceSlots).toBeGreaterThan(0);
    expect(techById.get('ind_sustainment_2')!.effects.maintenanceSlots).toBeGreaterThan(0);
  });

  it('specialization has an opportunity cost: the tree exceeds 180 days of research capacity', () => {
    const totalHours = TECH_NODES.reduce((a, t) => a + t.hours, 0);
    // Required sanity bound: 180 days × 3 slots × 24 h.
    expect(totalHours).toBeGreaterThan(180 * 3 * 24);
    // Optimistic bound: max national slots, best lab speed, all systems-integration bonuses.
    const optimistic = CAMPAIGN_DAYS * 24 * MAX_NATIONAL_RESEARCH_SLOTS * 1.35 * Math.pow(1.05, 3);
    expect(totalHours).toBeGreaterThan(optimistic);
  });
});

describe('missiles and hypersonic programs', () => {
  it('outcome probabilities are exclusive and sum to exactly 1 (±1e-9); interception is a separate draw', () => {
    for (const m of MISSILE_TYPES) {
      const sum = Object.values(m.outcomes).reduce((a, x) => a + x, 0);
      expect(Math.abs(sum - 1), m.id).toBeLessThan(1e-9);
      for (const p of Object.values(m.outcomes)) expect(p).toBeGreaterThanOrEqual(0);
      expect(m.outcomes.intercepted, m.id).toBe(0);
      expect(m.interceptBase).toBeGreaterThan(0);
      expect(m.interceptBase * 3).toBeLessThanOrEqual(1);
      expect(m.payload).toBe('conventional');
      expect(m.provenance).toContain('GAO-19-705SP');
      expect(m.batchSize).toBeGreaterThan(0);
      expect(m.inventoryCeiling).toBeGreaterThanOrEqual(m.batchSize);
    }
  });

  it('covers the four families with separate attributes', () => {
    const fam = new Set(MISSILE_TYPES.map((m) => m.family));
    for (const f of ['cruise', 'ballistic', 'hgv', 'hcm']) expect(fam.has(f as never)).toBe(true);
    expect(missileById.get('msl_hgv')!.flightFamily).toBe('boost-glide system');
  });

  it('high speed does not imply better accuracy or damage', () => {
    const cruise = missileById.get('msl_cruise')!;
    for (const m of MISSILE_TYPES.filter((x) => x.speedClass === 'hypersonic')) {
      expect(m.outcomes.arrived_effect, m.id).toBeLessThanOrEqual(cruise.outcomes.arrived_effect);
    }
    const hcm = missileById.get('msl_hcm')!;
    const ballistic = missileById.get('msl_ballistic')!;
    expect(hcm.effect.buildingDamage).toBeLessThan(ballistic.effect.buildingDamage);
  });

  it('maturity sequence is prototype → qualified → in production → ready → expended', () => {
    expect(PROGRAM_MATURITY_ORDER).toEqual(['prototype', 'qualified', 'in_production', 'ready', 'expended']);
  });

  it('hyp_advanced_materials alone unlocks no missile and no program', () => {
    const t = techById.get('hyp_advanced_materials')!;
    expect(t.effects.unlockMissile ?? []).toHaveLength(0);
    expect(t.effects.missileProgram).toBeUndefined();
    expect(t.effects.unlockUnit ?? []).toHaveLength(0);
  });

  /** All transitive prerequisites of a tech. */
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...techById.get(id)!.prereqs];
    while (stack.length) {
      const p = stack.pop()!;
      if (out.has(p)) continue;
      out.add(p);
      stack.push(...techById.get(p)!.prereqs);
    }
    return out;
  };

  it('HGV is a two-step program and HCM is a separate branch not requiring glide techs', () => {
    const hgv = missileById.get('msl_hgv')!;
    const hcm = missileById.get('msl_hcm')!;
    expect(hgv.blueprintTech).toBe('hyp_glide_blueprint');
    expect(hgv.qualifyTech).toBe('hyp_glide_qualified');
    expect(hcm.blueprintTech).toBe('hyp_cruise_blueprint');
    expect(hcm.qualifyTech).toBe('hyp_cruise_qualified');
    expect(techById.get('hyp_glide_blueprint')!.effects.unlockMissile ?? []).toHaveLength(0);
    expect(techById.get('hyp_cruise_blueprint')!.effects.unlockMissile ?? []).toHaveLength(0);
    const hcmAnc = ancestors('hyp_cruise_qualified');
    expect(hcmAnc.has('hyp_advanced_materials')).toBe(true);
    expect(hcmAnc.has('hyp_glide_blueprint')).toBe(false);
    expect(hcmAnc.has('hyp_glide_qualified')).toBe(false);
    const hgvAnc = ancestors('hyp_glide_qualified');
    expect(hgvAnc.has('hyp_advanced_materials')).toBe(true);
    expect(hgvAnc.has('hyp_cruise_blueprint')).toBe(false);
    // Each missile is unlocked for production only by its own final tech.
    for (const m of MISSILE_TYPES) {
      const unlockers = TECH_NODES.filter((t) => t.effects.unlockMissile?.includes(m.id)).map((t) => t.id);
      expect(unlockers, m.id).toEqual([m.qualifyTech ?? m.blueprintTech]);
    }
  });

  it('a hypersonic branch is reachable by a peer within the campaign (sequential chain fits before day 180)', () => {
    for (const final of ['hyp_glide_qualified', 'hyp_cruise_qualified']) {
      // Earliest finish with unlimited slots: longest path by max(dayGate, prereq finish) + hours.
      const finish = new Map<string, number>();
      const f = (id: string): number => {
        if (finish.has(id)) return finish.get(id)!;
        const t = techById.get(id)!;
        const start = Math.max((t.dayAvailable - 1) * 24, ...t.prereqs.map(f));
        const v = start + t.hours;
        finish.set(id, v);
        return v;
      };
      expect(f(final) / 24, final).toBeLessThan(170);
    }
  });

  it('the catalog object exposes every collection', () => {
    expect(CATALOG.units).toBe(UNIT_TYPES);
    expect(CATALOG.techs).toBe(TECH_NODES);
    expect(CATALOG.missiles.length).toBeGreaterThanOrEqual(4);
    expect(CATALOG.resources.length).toBe(7);
  });
});
