/**
 * Profile builder (owner: profiles agent). Expands an authored `CountrySpec` into the engine's
 * `CountryProfile`. Deterministic and pure: same inputs ⇒ same profile.
 *
 * Steps
 *  1. Every map city of the seat gets a CityProfile: authored key cities use their functions and
 *     buildings; the rest derive functions from tier, port and the province deposit.
 *  2. Formations: the authored roster, or the template recipe (+ authored additions). Stationing
 *     cities are raised to the facility levels the formation's unit type requires. Naval units
 *     only at the seat's own port cities; none at all for landlocked seats.
 *  3. Technologies: template seeds + authored seeds + unlock/level techs of fielded units, closed
 *     over prerequisites. Licensed techs keep the 'licensed' lineage.
 *  4. Balance (QUANTITIES ONLY — reference prices are never read): conservative daily production
 *     (no building production multipliers, opening morale) must cover authored upkeep by ≥ 15 %
 *     for every resource except the declared trade needs, which are held at a visible deficit.
 *     Any shortfall is added to the base output of cities whose functions produce that resource.
 *  5. Reserve: `stockDays` of consumption (deficits of trade needs covered for ≥ 45 days).
 */
import {
  RESOURCES,
  type BuildingTypeId,
  type CityDef,
  type CityFunction,
  type CityProfile,
  type CountryProfile,
  type ForceEntry,
  type MapCountryDef,
  type Personality,
  type Resource,
  type ResVec,
  type TechId,
} from '../../engine/data-types';
import { MANPOWER_PER_KPOP, MONEY_PER_KPOP, MORALE, RURAL_DEPOSIT_OUTPUT } from '../../engine/rules';
import { buildingById, techById, unitById } from '../catalog/index';
import { loadMapData } from '../map-index';
import { manifestById } from '../countries';
import { CITY_BASE_OUTPUT, FUNCTION_OUTPUT, TEMPLATES, UNIT_NOUN, type TemplateDef } from './templates';
import type { CountrySpec, ForceSpec } from './types';
import { relationsFor } from './relations';

const MAP = loadMapData();
const CITIES_BY_COUNTRY = new Map<string, CityDef[]>();
for (const c of MAP.cities) {
  const l = CITIES_BY_COUNTRY.get(c.country) ?? [];
  l.push(c);
  CITIES_BY_COUNTRY.set(c.country, l);
}
const COUNTRY_DEF = new Map<string, MapCountryDef>(MAP.countries.map((c) => [c.id, c]));

/** Opening morale factors (city morale 75, province morale 70) used as the planning assumption. */
const CITY_F = MORALE.moraleFloorFactor + (1 - MORALE.moraleFloorFactor) * 0.75;
const RURAL_F = MORALE.moraleFloorFactor + (1 - MORALE.moraleFloorFactor) * 0.7;
/** Required cover of upkeep by conservative production for non-trade resources. */
export const BALANCE_MARGIN = 1.15;
/** Trade needs are held at or below this share of consumption (visible import pressure). */
export const TRADE_NEED_SHARE = 0.85;

const NAVAL_BUILDINGS = new Set<BuildingTypeId>(['naval_base', 'coastal_pontoon']);

const PREFERRED_FN: Record<Resource, CityFunction[]> = {
  supplies: ['agriculture', 'logistics', 'port', 'industrial'],
  components: ['industrial', 'shipbuilding', 'mining', 'aerospace'],
  electronics: ['electronics', 'research', 'aerospace'],
  fuel: ['energy', 'logistics', 'port'],
  rare: ['mining'],
  manpower: ['military', 'agriculture'],
  money: ['finance', 'port'],
};

export interface BuildResult {
  profile: CountryProfile;
  issues: string[];
  /** Conservative planning numbers (whole units/day) used by the balancer; documentation only. */
  plan: { production: Required<ResVec>; consumption: Required<ResVec> };
}

function zeroVec(): Required<ResVec> {
  return { supplies: 0, components: 0, electronics: 0, fuel: 0, rare: 0, manpower: 0, money: 0 };
}
function addInto(a: Required<ResVec>, b: ResVec | undefined, k = 1): void {
  if (!b) return;
  for (const r of RESOURCES) if (b[r]) a[r] += (b[r] as number) * k;
}
export function slugOf(key: string): string {
  return key.slice(key.indexOf('-') + 1);
}
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Math.round(x * 100) / 100));
}

/** Prerequisite closure of a tech list (unknown ids are reported, not kept). */
export function closeTechs(seeds: Iterable<TechId>, issues?: string[]): Set<TechId> {
  const out = new Set<TechId>();
  const stack = [...seeds];
  while (stack.length) {
    const t = stack.pop() as TechId;
    if (out.has(t)) continue;
    const node = techById.get(t);
    if (!node) {
      issues?.push(`unknown tech ${t}`);
      continue;
    }
    out.add(t);
    for (const p of node.prereqs) stack.push(p);
  }
  return out;
}

function defaultFunctions(city: CityDef): CityFunction[] {
  const node = MAP.nodes[city.node];
  const f: CityFunction[] = [];
  if (city.tier >= 4) f.push('industrial', 'finance');
  else if (city.tier === 3) f.push('industrial');
  if (city.port) f.push('port');
  switch (node?.deposit) {
    case 'fuel':
      f.push('energy');
      break;
    case 'rare':
      f.push('mining');
      break;
    case 'components':
      if (!f.includes('industrial')) f.push('industrial');
      break;
    case 'electronics':
      f.push('electronics');
      break;
    case 'supplies':
    case 'manpower':
      f.push('agriculture');
      break;
    default:
      break;
  }
  if (!f.length) f.push('agriculture');
  return f;
}

function functionOutput(tier: number, intensity: number, fns: CityFunction[]): Required<ResVec> {
  const v = zeroVec();
  addInto(v, CITY_BASE_OUTPUT);
  for (const f of fns) addInto(v, FUNCTION_OUTPUT[f]);
  for (const r of RESOURCES) v[r] = Math.round(v[r] * tier * intensity);
  return v;
}

function levelEffects(type: BuildingTypeId, level: number) {
  const bt = buildingById.get(type);
  if (!bt) return null;
  let best = bt.levels[0];
  for (const l of bt.levels) if (l.level <= level && l.level >= best.level) best = l;
  return best;
}

interface CityWork {
  def: CityDef;
  slug: string;
  fns: CityFunction[];
  tier: 1 | 2 | 3 | 4 | 5;
  b: Map<BuildingTypeId, number>;
  out: Required<ResVec>;
  authored: boolean;
}

// ───────────────────────────── force recipe ─────────────────────────────

function recipeForces(spec: CountrySpec, tpl: TemplateDef, cities: CityWork[], ports: CityWork[], techs: Set<TechId>): ForceSpec[] {
  const T = cities.reduce((a, c) => a + c.tier, 0);
  const PT = ports.reduce((a, c) => a + c.tier, 0);
  const out: ForceSpec[] = [];
  const counters = new Map<string, number>();
  const name = (unit: string, count: number, city: CityWork) => {
    const k = UNIT_NOUN[unit] ? unit : 'x';
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    const noun = UNIT_NOUN[unit]?.[count > 1 ? 1 : 0] ?? 'Group';
    return `${ordinal(n)} ${city.def.name} ${noun}`;
  };
  const place = (unit: string, total: number, where: CityWork[], size: number, readiness: number) => {
    if (total <= 0 || !where.length) return;
    let i = 0;
    let left = total;
    while (left > 0) {
      const n = Math.min(size, left);
      const city = where[i % where.length];
      out.push([unit, n, city.slug, name(unit, n, city), readiness]);
      left -= n;
      i++;
    }
  };
  const has = (t: TechId) => techs.has(t);
  const A = spec.army ?? Math.max(2, Math.min(80, Math.round(tpl.armyPerTier * T)));
  const nArmor = A >= 4 ? Math.max(1, Math.round(A * 0.2)) : 0;
  const nArt = A >= 6 ? Math.round(A / 7) : 0;
  const ad = has('sup_mobile_sam') ? 'sup_sam' : has('sup_aa_gun') ? 'sup_aa_gun' : null;
  const nAD = ad && A >= 6 ? Math.max(1, Math.round(A / 9)) : 0;
  const heli = has('avi_attack_helicopter') ? 'heli_attack' : has('avi_gunship') ? 'heli_gunship' : null;
  const nHeli = heli && A >= 8 ? Math.round(A / 10) : 0;
  const nInf = Math.max(1, A - nArmor - nArt - nAD - nHeli);
  const nMil = Math.round(nInf * tpl.militiaShare);
  const nMech = has('land_mech_infantry') ? Math.round((nInf - nMil) * 0.4) : 0;
  const nMot = nInf - nMil - nMech;
  const K = Math.max(1, Math.min(cities.length, Math.ceil(nInf / 3)));
  const top = cities.slice(0, K);
  const r = tpl.readiness;
  place('inf_motorized', nMot, top, 3, r);
  place('inf_mechanized', nMech, top, 3, r);
  place('inf_militia', nMil, [...top].reverse(), 3, Math.max(50, r - 10));
  place(has('land_mbt') ? 'arm_mbt' : 'arm_afv', nArmor, cities.slice(0, Math.min(2, cities.length)), 3, r);
  place(has('sup_sp_artillery') ? 'sup_sp_artillery' : 'sup_towed_artillery', nArt, cities.slice(0, Math.min(2, cities.length)), 2, r);
  if (ad) place(ad, nAD, cities.slice(0, Math.min(2, cities.length)), 2, r);
  if (heli) place(heli, nHeli, cities.slice(0, 1), 2, r);
  const F = spec.air ?? Math.round(tpl.airPerTier * T);
  if (F > 0) {
    const nStrike = has('avi_strike_fighter') ? Math.round(F * 0.4) : 0;
    const airCities = cities.filter((c) => c.tier >= 2).slice(0, 2);
    const bases = airCities.length ? airCities : cities.slice(0, 1);
    place('ftr_air_superiority', F - nStrike, bases, 4, r);
    place('ftr_strike', nStrike, bases, 4, r);
  }
  if (ports.length) {
    const N = spec.navy ?? Math.round(tpl.navyPerPortTier * PT);
    if (N > 0) {
      const nSub = has('nav_attack_submarine') ? Math.round(N * 0.15) : 0;
      const nDD = has('nav_destroyer') ? Math.round(N * 0.2) : 0;
      const nFF = has('nav_frigate') ? Math.round(N * 0.3) : 0;
      const nCv = Math.max(0, N - nSub - nDD - nFF);
      const hp = ports.slice(0, Math.min(3, ports.length));
      const nr = Math.max(50, r - 5);
      place('nav_corvette', nCv, hp, 3, nr);
      place('nav_frigate', nFF, hp, 3, nr);
      place('nav_destroyer', nDD, hp, 3, nr);
      place('sub_attack', nSub, hp, 2, nr);
    }
  }
  return out;
}

// ───────────────────────────── builder ─────────────────────────────

export function buildProfile(spec: CountrySpec): BuildResult {
  const issues: string[] = [];
  const tpl = TEMPLATES[spec.template];
  const mc = COUNTRY_DEF.get(spec.id);
  const man = manifestById.get(spec.id);
  if (!mc) issues.push(`${spec.id}: not in map data`);
  if (!man) issues.push(`${spec.id}: not in manifest`);
  const landlocked = !!mc?.landlocked;
  const intensity = spec.intensity ?? tpl.intensity;
  const mapCities = [...(CITIES_BY_COUNTRY.get(spec.id) ?? [])];
  const known = new Set(mapCities.map((c) => slugOf(c.key)));
  for (const s of Object.keys(spec.cities ?? {})) if (!known.has(s)) issues.push(`${spec.id}: authored city "${s}" is not a map city of this country`);

  // 1. cities
  const cities: CityWork[] = mapCities.map((def) => {
    const slug = slugOf(def.key);
    const cs = spec.cities?.[slug];
    const tier = (cs?.tier ?? def.tier) as 1 | 2 | 3 | 4 | 5;
    const fns = cs?.fn ?? defaultFunctions(def);
    const out = functionOutput(tier, intensity, fns);
    addInto(out, cs?.out);
    const b = new Map<BuildingTypeId, number>();
    const put = (rec: Partial<Record<BuildingTypeId, number>>) => {
      for (const [k, v] of Object.entries(rec)) if (typeof v === 'number') b.set(k, Math.max(b.get(k) ?? 0, v));
    };
    if (def.capital) put(tpl.capitalBuildings);
    else if (tier >= 3) put(tpl.majorCityBuildings);
    if (def.port && !landlocked && tier >= 2) put(tpl.portBuildings);
    if (cs?.b) for (const [k, v] of Object.entries(cs.b)) if (typeof v === 'number') b.set(k, v);
    return { def, slug, fns, tier, b, out, authored: !!cs };
  });
  cities.sort((a, b) => Number(b.def.capital) - Number(a.def.capital) || b.tier - a.tier || b.def.population - a.def.population || (a.def.key < b.def.key ? -1 : 1));
  const bySlug = new Map(cities.map((c) => [c.slug, c]));
  const ports = cities.filter((c) => c.def.port && !landlocked).sort((a, b) => b.tier - a.tier || b.def.population - a.def.population || (a.def.key < b.def.key ? -1 : 1));

  // 3a. tech seeds (before forces so the recipe can see them)
  const licensedSeeds = new Set(spec.licensed ?? []);
  const licensedClosure = closeTechs(licensedSeeds, issues);
  const seeds = new Set<TechId>([...tpl.techs, ...(landlocked ? [] : tpl.navalTechs), ...(spec.techs ?? [])]);
  for (const d of spec.dropTechs ?? []) seeds.delete(d);
  let common = closeTechs(seeds, issues);

  // 2. forces
  const fspecs = spec.forces ? [...spec.forces] : [...recipeForces(spec, tpl, cities, ports, new Set([...common, ...licensedClosure])), ...(spec.addForces ?? [])];
  const forces: ForceEntry[] = [];
  for (const [unit, count, slug, designation, readiness, level] of fspecs) {
    const ut = unitById.get(unit);
    const city = bySlug.get(slug);
    if (!ut) {
      issues.push(`${spec.id}: unknown unit ${unit}`);
      continue;
    }
    if (!city) {
      issues.push(`${spec.id}: force "${designation}" stationed at unknown city "${slug}"`);
      continue;
    }
    if (count <= 0) continue;
    const naval = ut.domain === 'sea' || ut.domain === 'subsurface';
    if (naval && (landlocked || !city.def.port)) {
      issues.push(`${spec.id}: naval formation "${designation}" cannot be based at ${city.def.name} (${landlocked ? 'landlocked seat' : 'not a port'})`);
      continue;
    }
    for (const req of ut.requires) {
      if (NAVAL_BUILDINGS.has(req.building) && (landlocked || !city.def.port)) continue;
      city.b.set(req.building, Math.max(city.b.get(req.building) ?? 0, req.level));
    }
    if (ut.unlockTech && !licensedClosure.has(ut.unlockTech)) seeds.add(ut.unlockTech);
    if (level && level > 1) {
      for (const l of ut.levels) if (l.level <= level && l.tech && !licensedClosure.has(l.tech)) seeds.add(l.tech);
    }
    const fe: ForceEntry = { unit, count, at: city.def.key, readiness: readiness ?? tpl.readiness, designation };
    if (level && level > 1) fe.level = level;
    forces.push(fe);
  }
  common = closeTechs(seeds, issues);
  const licensed = [...licensedClosure].filter((t) => !common.has(t)).sort();
  const techs = [...common].sort();

  // building hygiene: landlocked / non-port cities have no naval facilities; clamp levels
  for (const c of cities) {
    for (const [k, v] of [...c.b]) {
      const bt = buildingById.get(k);
      if (!bt) {
        issues.push(`${spec.id}: unknown building ${k} at ${c.def.name}`);
        c.b.delete(k);
        continue;
      }
      if (bt.scope !== 'city') {
        issues.push(`${spec.id}: ${k} is not a city building`);
        c.b.delete(k);
        continue;
      }
      if ((NAVAL_BUILDINGS.has(k) || bt.coastalOnly) && (landlocked || !c.def.port)) c.b.delete(k);
      else if (v <= 0) c.b.delete(k);
      else c.b.set(k, Math.min(v, bt.maxLevel));
      if (bt.unlockTech && c.b.has(k) && !common.has(bt.unlockTech) && !licensedClosure.has(bt.unlockTech)) issues.push(`${spec.id}: ${k} requires ${bt.unlockTech}`);
    }
  }

  // rural improvements
  const ruralBuildings: NonNullable<CountryProfile['ruralBuildings']> = [];
  for (const rs of spec.rural ?? []) {
    const nodes = (mc?.provinces ?? [])
      .map((id) => MAP.nodes[id])
      .filter((n) => n && n.deposit === rs.deposit && !n.city)
      .sort((a, b) => b.population - a.population || (a.key < b.key ? -1 : 1))
      .slice(0, rs.max);
    for (const n of nodes) ruralBuildings.push({ node: n.key, type: rs.type, level: rs.level });
  }

  // 4. balance
  const cons = zeroVec();
  for (const f of forces) addInto(cons, unitById.get(f.unit)?.upkeepPerDay, f.count);
  for (const c of cities) for (const [k, v] of c.b) addInto(cons, levelEffects(k, v)?.upkeepPerDay);
  for (const rb of ruralBuildings) addInto(cons, levelEffects(rb.type, rb.level)?.upkeepPerDay);

  const floors = zeroVec(); // production not tied to base output (flat building output, population, deposits)
  for (const c of cities) {
    for (const [k, v] of c.b) {
      const e = levelEffects(k, v)?.effects;
      addInto(floors, e?.produces, CITY_F);
      if (e?.manpowerPerDay) floors.manpower += e.manpowerPerDay * CITY_F;
    }
    floors.manpower += c.def.population * MANPOWER_PER_KPOP * CITY_F;
    floors.money += c.def.population * MONEY_PER_KPOP * CITY_F;
  }
  for (const id of mc?.provinces ?? []) {
    const n = MAP.nodes[id];
    if (!n || n.outside) continue;
    if (n.deposit) floors[n.deposit] += RURAL_DEPOSIT_OUTPUT * RURAL_F;
    floors.manpower += n.population * MANPOWER_PER_KPOP * RURAL_F;
  }
  const multOf = (c: CityWork) => {
    let m = 1;
    for (const [k, v] of c.b) m += levelEffects(k, v)?.effects.productionMult ?? 0;
    return m;
  };
  const tradeNeeds = [...new Set(spec.tradeNeeds ?? [])];
  for (const r of RESOURCES) {
    const baseSum = cities.reduce((a, c) => a + c.out[r], 0);
    if (tradeNeeds.includes(r)) {
      // Upper bound of production (any additive building multiplier) must stay below TRADE_NEED_SHARE × upkeep.
      const upperBase = cities.reduce((a, c) => a + c.out[r] * multOf(c) * CITY_F, 0);
      const target = TRADE_NEED_SHARE * cons[r] - floors[r];
      if (cons[r] <= 0 || target < 0) {
        issues.push(`${spec.id}: trade need "${r}" is not a visible deficit (upkeep ${Math.round(cons[r])}, fixed output ${Math.round(floors[r])})`);
        continue;
      }
      if (upperBase > target) {
        const k = upperBase > 0 ? target / upperBase : 0;
        for (const c of cities) c.out[r] = Math.floor(c.out[r] * k);
      }
      continue;
    }
    const prod = baseSum * CITY_F + floors[r];
    const need = cons[r] * BALANCE_MARGIN + (cons[r] > 0 ? 2 : 0);
    if (prod >= need) continue;
    const add = (need - prod) / CITY_F;
    let pool = cities.filter((c) => c.fns.some((f) => PREFERRED_FN[r].includes(f)));
    if (!pool.length) pool = cities;
    const w = pool.reduce((a, c) => a + c.tier, 0);
    for (const c of pool) c.out[r] += Math.ceil((add * c.tier) / w);
  }
  const prodPlan = zeroVec();
  for (const c of cities) addInto(prodPlan, c.out, CITY_F);
  addInto(prodPlan, floors);

  // 5. reserve
  const stockpile: ResVec = {};
  const MIN: Required<ResVec> = { supplies: 600, components: 300, electronics: 80, fuel: 300, rare: 30, manpower: 400, money: 4000 };
  for (const r of RESOURCES) {
    let s = Math.max(MIN[r], tpl.stockDays * Math.max(cons[r], 0.25 * prodPlan[r]));
    if (tradeNeeds.includes(r)) s = Math.max(s, 45 * Math.max(0, cons[r] - prodPlan[r]) + MIN[r]);
    s += spec.stock?.[r] ?? 0;
    stockpile[r] = Math.round(s / 10) * 10;
  }

  const cityProfiles: CityProfile[] = [...cities]
    .sort((a, b) => (a.def.key < b.def.key ? -1 : 1))
    .map((c) => {
      const output: ResVec = {};
      for (const r of RESOURCES) if (c.out[r] > 0) output[r] = c.out[r];
      const cp: CityProfile = {
        city: c.def.key,
        functions: [...c.fns],
        buildings: [...c.b].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([type, level]) => ({ type, level })),
        output,
      };
      if (c.tier !== c.def.tier) cp.tier = c.tier;
      return cp;
    });

  const pers: Personality = { ...tpl.personality, ...(spec.personality ?? {}) };
  for (const k of Object.keys(pers) as (keyof Personality)[]) pers[k] = clamp01(pers[k]);

  if (!forces.some((f) => unitById.get(f.unit)?.capture)) issues.push(`${spec.id}: no capture-capable formation`);
  if (!cityProfiles.some((c) => c.buildings.some((b) => b.type === 'army_base'))) issues.push(`${spec.id}: no army base (cannot recruit)`);
  const nd = spec.decisions.length;
  if (nd < 2 || nd > 3) issues.push(`${spec.id}: ${nd} opening decisions (need 2–3)`);

  const profile: CountryProfile = {
    id: spec.id,
    name: man?.name ?? mc?.name ?? spec.id,
    region: man?.region ?? mc?.region ?? 'Europe',
    doctrine: spec.doctrine,
    template: spec.template,
    startDifficulty: spec.difficulty ?? tpl.difficulty,
    summary: spec.summary,
    cities: cityProfiles,
    stockpile,
    forces,
    techs,
    lift: spec.lift ?? tpl.lift,
    maintenanceSlots: spec.maint ?? tpl.maint,
    tradeNeeds,
    openingDecisions: spec.decisions.map((d) => ({ ...d })),
    personality: pers,
    relations: relationsFor(spec.id),
  };
  if (licensed.length) profile.licensed = licensed;
  if (ruralBuildings.length) profile.ruralBuildings = ruralBuildings;
  const round = (v: Required<ResVec>) => {
    const o = zeroVec();
    for (const r of RESOURCES) o[r] = Math.round(v[r]);
    return o;
  };
  return { profile, issues, plan: { production: round(prodPlan), consumption: round(cons) } };
}
