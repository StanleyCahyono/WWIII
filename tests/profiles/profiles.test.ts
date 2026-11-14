/** Static integrity of the 120 authored country profiles (owner: profiles agent). */
import { describe, expect, it } from 'vitest';
import type { CountryProfile, TechId } from '../../src/engine/data-types';
import { RESOURCES } from '../../src/engine/data-types';
import { MANIFEST } from '../../src/data/countries';
import { loadMapData } from '../../src/data/map-index';
import { CATALOG, buildingById, techById, unitById } from '../../src/data/catalog/index';
import { PROFILES, PROFILE_ISSUES, PROFILE_SPECS, profileById } from '../../src/data/profiles/index';
import { buildProfile } from '../../src/data/profiles/build';
import { TEMPLATES } from '../../src/data/profiles/templates';

const MAP = loadMapData();
const cityByKey = new Map(MAP.cities.map((c) => [c.key, c]));
const countryDef = new Map(MAP.countries.map((c) => [c.id, c]));
const SCREENS = new Set(['research', 'economy', 'cities', 'diplomacy', 'forces', 'market', 'map']);
const naval = (unit: string) => {
  const u = unitById.get(unit);
  return !!u && (u.domain === 'sea' || u.domain === 'subsurface');
};
const LANDLOCKED_SAMPLES = ['MNG', 'BOL', 'PRY', 'NPL', 'LAO'];
const ARCHIPELAGOS = ['IDN', 'PHL', 'JPN'];

describe('profile roster', () => {
  it('has no authoring issues', () => {
    expect(PROFILE_ISSUES).toEqual([]);
  });
  it('has exactly 120 profiles matching the manifest, in manifest order', () => {
    expect(PROFILES).toHaveLength(120);
    expect(PROFILES.map((p) => p.id)).toEqual(MANIFEST.map((m) => m.id));
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(120);
    for (const p of PROFILES) {
      const m = MANIFEST.find((x) => x.id === p.id)!;
      expect(p.name).toBe(m.name);
      expect(p.region).toBe(m.region);
      expect(profileById.get(p.id)).toBe(p);
    }
  });
  it('uses known templates, doctrines and difficulties', () => {
    for (const p of PROFILES) {
      expect(Object.keys(TEMPLATES)).toContain(p.template);
      expect(['western', 'eastern', 'european']).toContain(p.doctrine);
      expect(['easy', 'moderate', 'hard']).toContain(p.startDifficulty);
      expect(p.summary.length).toBeGreaterThan(30);
    }
  });
  it('is deterministic (rebuilding a spec yields an identical profile)', () => {
    for (const s of PROFILE_SPECS) expect(buildProfile(s).profile).toEqual(profileById.get(s.id));
  });
});

describe('referential integrity', () => {
  it('profiles every map city of the seat, and only those', () => {
    for (const p of PROFILES) {
      const mapKeys = MAP.cities.filter((c) => c.country === p.id).map((c) => c.key).sort();
      expect(p.cities.map((c) => c.city).sort(), p.id).toEqual(mapKeys);
    }
  });
  it('references only existing units, buildings, techs and cities', () => {
    for (const p of PROFILES) {
      for (const c of p.cities) {
        expect(cityByKey.get(c.city)?.country, c.city).toBe(p.id);
        for (const b of c.buildings) {
          const bt = buildingById.get(b.type);
          expect(bt, `${p.id} ${b.type}`).toBeDefined();
          expect(bt!.scope).toBe('city');
          expect(b.level).toBeGreaterThanOrEqual(1);
          expect(b.level).toBeLessThanOrEqual(bt!.maxLevel);
        }
        for (const r of Object.keys(c.output)) expect(RESOURCES as readonly string[]).toContain(r);
        for (const v of Object.values(c.output)) expect(Number.isInteger(v) && (v as number) >= 0).toBe(true);
      }
      for (const rb of p.ruralBuildings ?? []) {
        const n = MAP.nodes.find((x) => x.key === rb.node);
        expect(n?.country, rb.node).toBe(p.id);
        expect(buildingById.get(rb.type)?.scope).toBe('rural');
        if (buildingById.get(rb.type)?.needsDeposit) expect(n?.deposit).toBeTruthy();
      }
      for (const f of p.forces) {
        expect(unitById.get(f.unit), `${p.id} ${f.unit}`).toBeDefined();
        expect(cityByKey.get(f.at)?.country, `${p.id} ${f.at}`).toBe(p.id);
        expect(f.count).toBeGreaterThan(0);
        expect(f.designation && f.designation.length > 3).toBe(true);
        if (f.readiness !== undefined) expect(f.readiness >= 0 && f.readiness <= 100).toBe(true);
      }
      for (const t of [...p.techs, ...(p.licensed ?? [])]) expect(techById.get(t), `${p.id} ${t}`).toBeDefined();
    }
  });
  it('lists every prerequisite of every starting tech (techs ∪ licensed is prerequisite-closed)', () => {
    for (const p of PROFILES) {
      const held = new Set<TechId>([...p.techs, ...(p.licensed ?? [])]);
      for (const t of held) for (const pre of techById.get(t)!.prereqs) expect(held.has(pre), `${p.id}: ${t} needs ${pre}`).toBe(true);
      for (const t of p.licensed ?? []) expect(p.techs.includes(t), `${p.id}: ${t} both common and licensed`).toBe(false);
    }
  });
  it('holds the unlock (and level) technology of every fielded unit', () => {
    for (const p of PROFILES) {
      const held = new Set<TechId>([...p.techs, ...(p.licensed ?? [])]);
      for (const f of p.forces) {
        const u = unitById.get(f.unit)!;
        if (u.unlockTech) expect(held.has(u.unlockTech), `${p.id} ${f.unit} needs ${u.unlockTech}`).toBe(true);
        for (const l of u.levels) if (f.level && l.level <= f.level && l.tech) expect(held.has(l.tech)).toBe(true);
        if (u.doctrine?.[p.doctrine]?.available === false) throw new Error(`${p.id}: ${f.unit} unavailable to ${p.doctrine}`);
      }
    }
  });
  it('stations every formation at a city that has the facilities its unit type requires', () => {
    for (const p of PROFILES) {
      for (const f of p.forces) {
        const city = p.cities.find((c) => c.city === f.at)!;
        for (const req of unitById.get(f.unit)!.requires) {
          const lvl = city.buildings.find((b) => b.type === req.building)?.level ?? 0;
          expect(lvl, `${p.id} ${f.designation} at ${f.at} needs ${req.building} ${req.level}`).toBeGreaterThanOrEqual(req.level);
        }
      }
    }
  });
});

describe('geography', () => {
  it('bases naval formations only at the seat’s own port cities; none for landlocked seats', () => {
    for (const p of PROFILES) {
      const landlocked = countryDef.get(p.id)!.landlocked;
      for (const f of p.forces) {
        if (!naval(f.unit)) continue;
        expect(landlocked, `${p.id} is landlocked but fields ${f.unit}`).toBe(false);
        expect(cityByKey.get(f.at)!.port, `${p.id} ${f.unit} at non-port ${f.at}`).toBe(true);
      }
    }
  });
  it('gives landlocked seats no naval facilities and non-port cities no naval base', () => {
    for (const p of PROFILES) {
      const landlocked = countryDef.get(p.id)!.landlocked;
      for (const c of p.cities) {
        const hasNaval = c.buildings.some((b) => b.type === 'naval_base');
        if (landlocked || !cityByKey.get(c.city)!.port) expect(hasNaval, `${c.city}`).toBe(false);
      }
    }
  });
  it('makes the named landlocked starts viable without a navy', () => {
    for (const id of LANDLOCKED_SAMPLES) {
      const p = profileById.get(id)!;
      expect(countryDef.get(id)!.landlocked).toBe(true);
      expect(p.forces.some((f) => naval(f.unit))).toBe(false);
      expect(p.forces.some((f) => unitById.get(f.unit)!.capture)).toBe(true);
      expect(p.openingDecisions.some((d) => d.screen === 'diplomacy' || d.screen === 'market' || d.screen === 'cities')).toBe(true);
    }
  });
  it('gives archipelagic starts ports, naval bases and sea forces', () => {
    for (const id of ARCHIPELAGOS) {
      const p = profileById.get(id)!;
      expect(p.cities.filter((c) => c.buildings.some((b) => b.type === 'naval_base')).length).toBeGreaterThanOrEqual(2);
      expect(p.forces.filter((f) => naval(f.unit)).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('profiles Jakarta and Surabaya as authored key cities of Indonesia', () => {
    const idn = profileById.get('IDN')!;
    const jakarta = idn.cities.find((c) => c.city === 'IDN-jakarta')!;
    const surabaya = idn.cities.find((c) => c.city === 'IDN-surabaya')!;
    expect(jakarta.functions).toEqual(expect.arrayContaining(['finance', 'industrial']));
    expect(surabaya.functions).toEqual(expect.arrayContaining(['port', 'shipbuilding']));
    expect(surabaya.buildings.find((b) => b.type === 'naval_base')?.level).toBeGreaterThanOrEqual(2);
    expect(idn.cities.find((c) => c.city === 'IDN-balikpapan')!.functions).toContain('energy');
    expect(idn.forces.some((f) => f.at === 'IDN-surabaya' && naval(f.unit))).toBe(true);
  });
});

describe('economy, forces and openings', () => {
  it('gives every seat a capture-capable formation and a city that can recruit', () => {
    for (const p of PROFILES) {
      expect(p.forces.some((f) => unitById.get(f.unit)!.capture), p.id).toBe(true);
      const recruiters = p.cities.filter((c) => (c.buildings.find((b) => b.type === 'army_base')?.level ?? 0) >= 1);
      expect(recruiters.length, p.id).toBeGreaterThan(0);
    }
  });
  it('lets the opening stockpile pay for at least one starter recruit and one building', () => {
    const militia = unitById.get('inf_militia')!;
    const office = buildingById.get('recruiting_office')!.levels[0];
    for (const p of PROFILES) {
      for (const [r, v] of Object.entries(militia.cost)) expect(p.stockpile[r as keyof typeof p.stockpile] ?? 0, `${p.id} ${r}`).toBeGreaterThanOrEqual(v as number);
      for (const [r, v] of Object.entries(office.cost)) expect(p.stockpile[r as keyof typeof p.stockpile] ?? 0, `${p.id} ${r}`).toBeGreaterThanOrEqual(v as number);
    }
  });
  it('declares trade needs from the resource list and covers each with a reserve', () => {
    for (const p of PROFILES) for (const r of p.tradeNeeds) {
      expect(RESOURCES as readonly string[]).toContain(r);
      expect(p.stockpile[r] ?? 0).toBeGreaterThan(0);
    }
  });
  it('has two or three distinctive opening decisions linked to screens and to concrete things in the save', () => {
    const countryNames = MANIFEST.map((m) => m.name);
    const catalogNames = [...CATALOG.buildings.map((b) => b.name), ...CATALOG.techs.map((t) => t.name), ...CATALOG.units.map((u) => u.name)];
    const allIds = new Set<string>();
    const vague: string[] = [];
    for (const p of PROFILES) {
      expect(p.openingDecisions.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.openingDecisions.length, p.id).toBeLessThanOrEqual(3);
      const cityNames = MAP.cities.filter((c) => c.country === p.id).map((c) => c.name);
      const designations = p.forces.map((f) => f.designation ?? '');
      for (const d of p.openingDecisions) {
        expect(SCREENS.has(d.screen), `${p.id} ${d.screen}`).toBe(true);
        expect(allIds.has(d.id), `duplicate decision id ${d.id}`).toBe(false);
        allIds.add(d.id);
        const text = `${d.title} ${d.detail}`.toLowerCase();
        const concrete = [...cityNames, ...countryNames, ...designations, ...catalogNames].some((n) => n && text.includes(n.toLowerCase()));
        const generic = /\b(cit(y|ies)|ports?|lab|refiner(y|ies)|arms[- ]industry|naval base|logistics hub|electronics plant|recruiting office|research|fuel|supplies|components|electronics|rare materials|money|market|trade|right of way|shared reports|agreement|coalition|bloc|army|fleet|garrison|formation|brigade|battalion|corvettes?|frigates?|destroyers?|submarines?|carrier|marines|armou?r|artillery|air defence|patrol|outpost|border|front|energy|oil|gas|hydro|mining|mines|upkeep|readiness|missile|strait|canal|route|lift|exclave|islands?|squadrons?|helicopters?|aircraft|drones?|navy|tank)\b/.test(text);
        if (!(concrete && generic)) vague.push(`${p.id}: "${d.title}"`);
      }
    }
    expect(vague, 'decisions must reference concrete things in the save').toEqual([]);
  });
  it('keeps personality weights in [0, 1]', () => {
    for (const p of PROFILES) for (const v of Object.values(p.personality)) expect(v >= 0 && v <= 1, p.id).toBe(true);
  });
  it('authors symmetric relations with valid partners and no opening wars', () => {
    const ids = new Set(MANIFEST.map((m) => m.id));
    for (const p of PROFILES) {
      for (const r of p.relations ?? []) {
        expect(ids.has(r.with), `${p.id} → ${r.with}`).toBe(true);
        expect(r.with).not.toBe(p.id);
        expect(r.status).not.toBe('war');
        const back = profileById.get(r.with)!.relations?.find((x) => x.with === p.id);
        expect(back, `${r.with} lacks reverse relation to ${p.id}`).toBeDefined();
        expect(back!.status).toBe(r.status);
        expect(back!.trust).toBe(r.trust);
        if (r.trust !== undefined) expect(r.trust >= -100 && r.trust <= 100).toBe(true);
      }
    }
  });
});

describe('U.S. technology package (data)', () => {
  const usa = profileById.get('USA') as CountryProfile;
  const held = new Set([...usa.techs, ...(usa.licensed ?? [])]);
  it('starts with lift, refuelling, carrier aviation, broad-area recon and the advanced-materials prerequisite', () => {
    for (const t of ['mob_lift_1', 'mob_strategic_airlift_2', 'mob_refuel_support', 'nav_carrier', 'nav_carrier_aviation', 'rec_broad_area_recon', 'rec_track_comparison', 'rec_report_processing', 'ind_sustainment_1', 'hyp_advanced_materials'])
      expect(held.has(t), t).toBe(true);
  });
  it('is exactly one node ahead in Systems Integration and Advanced Electronics', () => {
    for (const t of ['ind_systems_integration_2', 'ind_advanced_electronics_2']) {
      expect(held.has(t)).toBe(true);
      for (const p of PROFILES) if (p.id !== 'USA') expect([...p.techs, ...(p.licensed ?? [])].includes(t), `${p.id} holds ${t}`).toBe(false);
    }
    expect(held.has('ind_systems_integration_3')).toBe(false);
    expect(held.has('ind_advanced_electronics_3')).toBe(false);
  });
  it('fields carriers with carrier-capable aircraft, airlifters, tankers and broad-area recon on the map', () => {
    const units = (pred: (id: string) => boolean) => usa.forces.filter((f) => pred(f.unit)).reduce((a, f) => a + f.count, 0);
    expect(units((u) => u === 'nav_carrier')).toBeGreaterThanOrEqual(2);
    expect(units((u) => !!unitById.get(u)!.carrierCapable)).toBeGreaterThanOrEqual(4);
    expect(units((u) => u === 'hvy_strategic_transport')).toBeGreaterThan(0);
    expect(units((u) => u === 'hvy_tanker')).toBeGreaterThan(0);
    expect(units((u) => u === 'rec_broad_area')).toBeGreaterThan(0);
  });
  it('has separate maintenance capacity (depots) and paid research labs', () => {
    const lv = (type: string) => usa.cities.reduce((a, c) => a + (c.buildings.find((b) => b.type === type)?.level ?? 0), 0);
    const depotSlots = (p: CountryProfile) =>
      p.cities.reduce((a, c) => {
        const b = c.buildings.find((x) => x.type === 'maintenance_depot');
        return a + (b ? buildingById.get('maintenance_depot')!.levels[b.level - 1].effects.maintenanceSlots ?? 0 : 0);
      }, 0) + p.maintenanceSlots;
    expect(lv('research_lab')).toBeGreaterThanOrEqual(8);
    for (const p of PROFILES) if (p.id !== 'USA') expect(depotSlots(usa)).toBeGreaterThan(depotSlots(p));
    expect(usa.tradeNeeds.length).toBeGreaterThanOrEqual(1);
  });
  it('has no hypersonic blueprint or qualification anywhere at start', () => {
    for (const p of PROFILES) for (const t of [...p.techs, ...(p.licensed ?? [])]) expect(/^hyp_(glide|cruise)_/.test(t), `${p.id} ${t}`).toBe(false);
  });
});

describe('no hidden multipliers', () => {
  const ALLOWED = new Set(['id', 'name', 'region', 'doctrine', 'template', 'startDifficulty', 'summary', 'cities', 'ruralBuildings', 'stockpile', 'forces', 'techs', 'licensed', 'lift', 'maintenanceSlots', 'tradeNeeds', 'openingDecisions', 'personality', 'relations']);
  const scan = (o: unknown, path: string, out: string[]) => {
    if (Array.isArray(o)) o.forEach((x, i) => scan(x, `${path}[${i}]`, out));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
      if (/mult|multiplier|bonus|factor|strength|handicap/i.test(k)) out.push(`${path}.${k}`);
      scan(v, `${path}.${k}`, out);
    }
  };
  it('profiles carry only contract fields and no per-country multiplier of any kind', () => {
    for (const p of PROFILES) {
      for (const k of Object.keys(p)) expect(ALLOWED.has(k), `${p.id}.${k}`).toBe(true);
      const bad: string[] = [];
      scan(p, p.id, bad);
      expect(bad).toEqual([]);
    }
  });
});
