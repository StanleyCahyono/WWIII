/**
 * Unit catalog — World Command: World 120.
 *
 * Original, fictional unit names. All ratings, costs and timings are game-balance values;
 * none is calibrated against a real platform.
 *
 * Conventions
 *  - attack/defense vectors are by target class (unarmored, armored, helicopter, airplane,
 *    ship, submarine, building). A missing class means "cannot engage" (shown as an
 *    explicit unavailable cell in the dossier).
 *  - Level 1 is granted by `unlockTech` (null = starter blueprint available to all).
 *    Level N (N ≥ 2) is granted by `levels[N-1].tech`. UPGRADE RULE: a completed level tech
 *    applies to all existing and future units of that type at the next tick.
 *  - `requires` lists the building (and minimum level) needed in the producing city.
 *  - Officers: one active officer per officer TYPE per stack (a second identical officer
 *    in the same stack gives no extra bonus).
 */
import type {
  Domain,
  OrderKind,
  ResVec,
  TargetClass,
  TechId,
  UnitFamily,
  UnitLevelStats,
  UnitType,
} from '../../engine/data-types';

// ───────────────────────────── helpers ─────────────────────────────

/** [unarmored, armored, helicopter, airplane, ship, submarine, building] */
type V7 = [number, number, number, number, number, number, number];
const TC_ORDER: TargetClass[] = ['unarmored', 'armored', 'helicopter', 'airplane', 'ship', 'submarine', 'building'];

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function vec(v: V7, mult: number): Partial<Record<TargetClass, number>> {
  const out: Partial<Record<TargetClass, number>> = {};
  v.forEach((x, i) => {
    if (x > 0) out[TC_ORDER[i]] = r1(x * mult);
  });
  return out;
}

interface BaseStats {
  hp: number;
  atk: V7;
  def: V7;
  speed: number;
  range: number;
  sight: number;
  radarKm?: number;
  radarDetects?: Domain[];
  radarSens?: number;
  signature: number;
  endurance?: number;
  opRange?: number;
  /** Final level gains +1 radar sensitivity (max 3). */
  sensUp?: boolean;
}

/** Per-level growth: hp +15%, attack +18%, defense +15%, sight/radar/range of aircraft +8-10%. */
function buildLevels(id: string, unlockTech: TechId | null, n: number, b: BaseStats, override?: (TechId | null)[]): UnitLevelStats[] {
  const out: UnitLevelStats[] = [];
  for (let i = 0; i < n; i++) {
    const level = i + 1;
    const tech = level === 1 ? unlockTech : (override?.[i] ?? `${id}_l${level}`);
    const s: UnitLevelStats = {
      level,
      tech,
      hp: Math.round(b.hp * (1 + 0.15 * i)),
      attack: vec(b.atk, 1 + 0.18 * i),
      defense: vec(b.def, 1 + 0.15 * i),
      speedKmh: Math.round(b.speed * (1 + 0.02 * i)),
      rangeKm: Math.round(b.range * (1 + 0.08 * i)),
      sightKm: Math.round(b.sight * (1 + 0.08 * i)),
      radarKm: Math.round((b.radarKm ?? 0) * (1 + 0.1 * i)),
      signature: b.signature,
    };
    if (b.radarKm && b.radarDetects) {
      s.radarDetects = b.radarDetects;
      s.radarSensitivity = Math.min(3, (b.radarSens ?? 1) + (b.sensUp && level === n && n > 1 ? 1 : 0));
    }
    if (b.endurance !== undefined) s.enduranceMin = Math.round(b.endurance * (1 + 0.1 * i));
    if (b.opRange !== undefined) s.operationalRangeKm = Math.round(b.opRange * (1 + 0.1 * i));
    out.push(s);
  }
  return out;
}

/** Default upkeep per game day derived from mobilization cost (fuel is mostly an upkeep input). */
function upkeepFrom(c: ResVec): ResVec {
  const rate: Record<string, number> = {
    supplies: 0.04,
    components: 0.01,
    electronics: 0.01,
    fuel: 0.12,
    rare: 0,
    manpower: 0.02,
    money: 0.02,
  };
  const out: ResVec = {};
  for (const [k, q] of Object.entries(c)) {
    const v = Math.round((q ?? 0) * (rate[k] ?? 0));
    if (v > 0) out[k as keyof ResVec] = v;
  }
  if (!out.money) out.money = 1;
  return out;
}

// ───────────────────────────── features ─────────────────────────────

const FEATURES = {
  occupier: { name: 'Occupier', description: 'Can capture provinces and cities by holding the control node.' },
  entrench: { name: 'Entrenches', description: 'Gains the province-centre defence bonus while stationary at a control node.' },
  amphibious_assault: { name: 'Amphibious assault', description: 'No attack penalty when landing directly from the sea into a contested province.' },
  amphibious: { name: 'Amphibious', description: 'Can make short coastal hops without separate sea lift.' },
  air_assault: { name: 'Air assault', description: 'Can be rebased between friendly air bases and airfields using national lift.' },
  low_observable_ground: { name: 'Low observable', description: 'Harder to see: signature 2, and hidden from sight in forest, jungle and urban terrain until adjacent.' },
  home_defense: { name: 'Home defence', description: '+25% defence while inside its own homeland provinces.' },
  contract_force: { name: 'Contract force', description: 'Hired, not conscripted: little manpower, very short mobilization, high money upkeep.' },
  scout: { name: 'Scout', description: 'Identifies contacts within sight range (unit type and approximate strength).' },
  indirect_fire: { name: 'Indirect fire', description: 'Attacks targets within range without receiving return fire from units that lack the range.' },
  air_defense: { name: 'Air defence', description: 'Engages hostile aircraft and helicopters entering its range, on a separate cooldown from its area coverage.' },
  missile_intercept: { name: 'Missile interception', description: 'Adds defence rating against missile events targeting its sector (resolved as a separate seeded draw).' },
  radar: { name: 'Radar', description: 'Detects contacts in the listed domains whose signature does not exceed its sensitivity. Radar-only contacts show a domain marker.' },
  sonar: { name: 'Sonar / ASW sensors', description: 'Detects subsurface contacts within radar range up to its sensitivity.' },
  air_patrol: { name: 'Air patrol', description: 'Patrols an area for its endurance, then returns to its home base to refuel.' },
  carrier_capable: { name: 'Carrier-qualified', description: 'Can embark on an aircraft carrier\'s flight deck and operate from it.' },
  stealth_air: { name: 'Stealth airframe', description: 'Signature 3: only sensitivity-3 sensors detect it before it attacks.' },
  long_loiter: { name: 'Long loiter', description: 'Very long endurance on patrol; ideal for persistent observation.' },
  strategic_bombing: { name: 'Strategic bombing', description: 'Damages buildings and lowers city condition in the target province.' },
  airlift: { name: 'Strategic airlift', description: 'Adds abstract lift capacity while fielded and ready; long transfers consume lift and fuel.' },
  aerial_refuel: { name: 'Aerial refuelling', description: 'Friendly aircraft patrolling within its operational radius gain extra endurance.' },
  broad_area_recon: { name: 'Broad-area reconnaissance', description: 'Produces dated wide-area reports. Every observation still needs this sensor (or a treaty) in range.' },
  shore_bombardment: { name: 'Shore bombardment', description: 'Can attack coastal provinces from adjacent sea zones and reduce city condition.' },
  flight_deck: { name: 'Flight deck', description: 'Carries carrier-qualified aircraft; the air wing has its own maintenance queue.' },
  submerged: { name: 'Submerged', description: 'Operates below the surface; only sonar/ASW sensors with sufficient sensitivity detect it.' },
  missile_launch: { name: 'Missile launch', description: 'Can launch ready missile tokens from national inventory at eligible sectors.' },
  command_aura: { name: 'Command aura', description: 'Applies its bonus to eligible units in the same stack. One active officer per officer type per stack.' },
  deployable: { name: 'Limited-use deployable', description: 'Consumed after its listed uses; has its own stock and cooldown.' },
  naval_strike: { name: 'Anti-ship strike', description: 'Specialized weapons for attacking surface ships.' },
  asw: { name: 'Anti-submarine warfare', description: 'Specialized weapons for attacking submarines.' },
} as const;
type FeatureId = keyof typeof FEATURES;
function feats(...ids: FeatureId[]): UnitType['features'] {
  return ids.map((id) => ({ id, name: FEATURES[id].name, description: FEATURES[id].description }));
}

// ───────────────────────────── presets ─────────────────────────────

type TerrainTable = UnitType['terrain'];
const T_INFANTRY: TerrainTable = {
  forest: { defense: 1.25, speed: 0.8 },
  urban: { attack: 1.1, defense: 1.4, speed: 0.9 },
  suburban: { defense: 1.2 },
  mountains: { defense: 1.35, speed: 0.6 },
  jungle: { defense: 1.25, speed: 0.6, sight: 0.7 },
  desert: { speed: 0.85 },
  tundra: { speed: 0.7, defense: 1.1 },
};
const T_ARMOR: TerrainTable = {
  open: { attack: 1.2 },
  urban: { attack: 0.75, defense: 0.85, speed: 0.8 },
  suburban: { attack: 0.9 },
  forest: { attack: 0.8, speed: 0.7 },
  mountains: { attack: 0.75, defense: 1.1, speed: 0.5 },
  jungle: { attack: 0.7, speed: 0.5, sight: 0.7 },
  desert: { attack: 1.1, speed: 0.9 },
  tundra: { speed: 0.7 },
};
const T_SUPPORT: TerrainTable = {
  open: { attack: 1.1 },
  urban: { defense: 1.1, speed: 0.85 },
  forest: { speed: 0.7, sight: 0.8 },
  mountains: { attack: 0.9, speed: 0.5 },
  jungle: { speed: 0.5, sight: 0.7 },
  desert: { speed: 0.9 },
  tundra: { speed: 0.7 },
};
const T_AIR: TerrainTable = {
  jungle: { sight: 0.8 },
  forest: { sight: 0.9 },
  mountains: { sight: 0.9 },
};
const T_HELI: TerrainTable = {
  mountains: { speed: 0.8, defense: 1.1 },
  urban: { defense: 0.85 },
  jungle: { sight: 0.8 },
  forest: { attack: 0.9 },
};
const T_SHIP: TerrainTable = {
  coastal_waters: { defense: 0.9, sight: 1.1 },
  high_seas: { defense: 1.0 },
};
const T_SUB: TerrainTable = {
  coastal_waters: { defense: 0.8, speed: 0.9 },
  high_seas: { defense: 1.2 },
};

const O_INFANTRY: OrderKind[] = ['move', 'attack', 'stop', 'waypoints', 'delay', 'split', 'merge', 'retreat', 'fire_policy', 'embark', 'disembark', 'capture'];
const O_SUPPORT: OrderKind[] = ['move', 'attack', 'stop', 'waypoints', 'delay', 'split', 'merge', 'retreat', 'fire_policy', 'embark', 'disembark'];
const O_AIR: OrderKind[] = ['patrol', 'rebase', 'attack', 'stop'];
const O_HELI: OrderKind[] = ['move', 'attack', 'stop', 'waypoints', 'split', 'merge', 'fire_policy', 'rebase'];
const O_NAVAL: OrderKind[] = ['move', 'attack', 'stop', 'waypoints', 'delay', 'split', 'merge', 'patrol', 'retreat', 'fire_policy'];
const O_LAUNCHER: OrderKind[] = ['move', 'stop', 'waypoints', 'split', 'merge', 'launch', 'embark', 'disembark'];
const O_OFFICER_LAND: OrderKind[] = ['move', 'stop', 'waypoints', 'split', 'merge', 'embark', 'disembark'];
const O_OFFICER_AIR: OrderKind[] = ['rebase', 'patrol', 'stop'];
const O_OFFICER_SEA: OrderKind[] = ['move', 'stop', 'waypoints', 'split', 'merge'];

type DoctrineTable = UnitType['doctrine'];
const D: Record<string, DoctrineTable> = {
  infantry: { western: { attackMult: 1.05, costMult: 1.05 }, eastern: { costMult: 0.9, hpMult: 1.05 }, european: { hpMult: 1.02 } },
  armor: { western: { hpMult: 1.08, costMult: 1.1 }, eastern: { costMult: 0.88, hpMult: 0.96 }, european: { attackMult: 1.04 } },
  support: { western: { attackMult: 1.03 }, eastern: { attackMult: 1.06, costMult: 0.95 }, european: { costMult: 0.96 } },
  air_defense: { western: { costMult: 1.05 }, eastern: { attackMult: 1.08, costMult: 0.95 }, european: { costMult: 0.97 } },
  air: { western: { attackMult: 1.08, costMult: 1.08 }, eastern: { attackMult: 0.96, costMult: 0.92 }, european: { hpMult: 1.03 } },
  naval: { western: { hpMult: 1.05, costMult: 1.05 }, eastern: { costMult: 0.95 }, european: { attackMult: 1.03 } },
  sensor: { western: { costMult: 1.04 }, eastern: { costMult: 0.96 }, european: {} },
  officer: {},
  strategic: { western: { costMult: 1.05 }, eastern: { costMult: 0.92 }, european: { costMult: 1.0 } },
};

// ───────────────────────────── unit builder ─────────────────────────────

interface Spec {
  id: string;
  name: string;
  family: UnitFamily;
  domain: Domain;
  targetClass: TargetClass;
  echelon: 1 | 2 | 3;
  capture?: boolean;
  cost: ResVec;
  upkeep?: ResVec;
  buildHours: number;
  requires: { building: string; level: number }[];
  unlockTech: TechId | null;
  levels: number;
  levelTechs?: (TechId | null)[];
  base: BaseStats;
  terrain: TerrainTable;
  orders: OrderKind[];
  features: FeatureId[];
  symbol: string;
  doctrine: DoctrineTable;
  description: string;
  extra?: Partial<Pick<UnitType, 'officerBonus' | 'carries' | 'deployable' | 'carrierCapable' | 'liftCapacity'>>;
}

function unit(s: Spec): UnitType {
  const u: UnitType = {
    id: s.id,
    name: s.name,
    family: s.family,
    domain: s.domain,
    targetClass: s.targetClass,
    echelon: s.echelon,
    capture: s.capture ?? false,
    cost: s.cost,
    upkeepPerDay: s.upkeep ?? upkeepFrom(s.cost),
    buildHours: s.buildHours,
    requires: s.requires,
    unlockTech: s.unlockTech,
    levels: buildLevels(s.id, s.unlockTech, s.levels, s.base, s.levelTechs),
    terrain: s.terrain,
    orders: s.orders,
    features: feats(...s.features),
    symbol: s.symbol,
    doctrine: s.doctrine,
    description: s.description,
    ...s.extra,
  };
  return u;
}

const army = (level: number) => [{ building: 'army_base', level }];
const air = (level: number) => [{ building: 'air_base', level }];
const port = (level: number) => [{ building: 'naval_base', level }];

// ───────────────────────────── catalog ─────────────────────────────

export const UNIT_TYPES: UnitType[] = [
  // ════════ Infantry ════════
  unit({
    id: 'inf_motorized', name: 'Wayfarer Motor Rifles', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true,
    cost: { supplies: 60, components: 10, fuel: 5, manpower: 50, money: 150 }, buildHours: 18, requires: army(1), unlockTech: null, levels: 4,
    base: { hp: 18, atk: [6, 2, 1, 0, 0, 0, 2], def: [6, 3, 2, 1, 0, 0, 0], speed: 45, range: 0, sight: 25, signature: 0 },
    terrain: T_INFANTRY, orders: O_INFANTRY, features: ['occupier', 'entrench'], symbol: 'land.infantry.motorized', doctrine: D.infantry,
    description: 'Truck-borne rifle battalions. Cheap, quick to raise and able to hold ground anywhere; the backbone of every army and the standard occupier.',
  }),
  unit({
    id: 'inf_mechanized', name: 'Bulwark Mechanized Infantry', family: 'infantry', domain: 'land', targetClass: 'armored', echelon: 1, capture: true,
    cost: { supplies: 70, components: 60, fuel: 15, manpower: 50, money: 300 }, buildHours: 30, requires: army(2), unlockTech: 'land_mech_infantry', levels: 4,
    base: { hp: 24, atk: [7, 4, 1.5, 0, 0, 0, 2], def: [7, 5, 2, 1, 0, 0, 0], speed: 50, range: 0, sight: 25, signature: 0 },
    terrain: T_INFANTRY, orders: O_INFANTRY, features: ['occupier', 'entrench'], symbol: 'land.infantry.mechanized', doctrine: D.infantry,
    description: 'Infantry riding armored carriers. Counts as armored for incoming fire, keeps pace with tanks and holds captured cities well.',
  }),
  unit({
    id: 'inf_marine', name: 'Tidewall Marines', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true,
    cost: { supplies: 70, components: 30, fuel: 10, manpower: 55, money: 260 }, buildHours: 28, requires: [...army(2), ...port(1)], unlockTech: 'land_marines', levels: 3,
    base: { hp: 20, atk: [7, 2.5, 1, 0, 0.5, 0, 2.5], def: [7, 3, 2, 1, 1, 0, 0], speed: 42, range: 0, sight: 25, signature: 0 },
    terrain: { ...T_INFANTRY, urban: { attack: 1.15, defense: 1.4, speed: 0.9 } }, orders: O_INFANTRY, features: ['occupier', 'entrench', 'amphibious_assault'],
    symbol: 'land.infantry.marine', doctrine: D.infantry,
    description: 'Naval infantry trained for landings. Fights straight off the beach without the usual disembark penalty; the key unit for archipelago campaigns.',
  }),
  unit({
    id: 'inf_airmobile', name: 'Skylance Air Assault', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true,
    cost: { supplies: 70, components: 30, electronics: 8, fuel: 15, manpower: 50, money: 320 }, buildHours: 30, requires: [...army(2), ...air(1)], unlockTech: 'land_airmobile', levels: 3,
    base: { hp: 18, atk: [6.5, 3, 1.5, 0, 0, 0, 2], def: [6, 3, 2, 1, 0, 0, 0], speed: 55, range: 0, sight: 30, signature: 0 },
    terrain: T_INFANTRY, orders: [...O_INFANTRY, 'rebase'], features: ['occupier', 'entrench', 'air_assault'], symbol: 'land.infantry.airmobile', doctrine: D.infantry,
    description: 'Light infantry with organic helicopter lift. Can rebase between friendly airfields to seize objectives far behind the front.',
  }),
  unit({
    id: 'inf_special_forces', name: 'Nightglass Commandos', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true,
    cost: { supplies: 60, components: 20, electronics: 15, fuel: 8, rare: 2, manpower: 40, money: 450 }, buildHours: 36, requires: army(3), unlockTech: 'land_special_forces', levels: 3,
    base: { hp: 16, atk: [9, 4, 1, 0, 0, 0, 4], def: [7, 4, 2, 1, 0, 0, 0], speed: 48, range: 0, sight: 35, signature: 2 },
    terrain: { ...T_INFANTRY, forest: { attack: 1.2, defense: 1.3, speed: 0.9 }, jungle: { attack: 1.2, defense: 1.3, speed: 0.8 } }, orders: O_INFANTRY,
    features: ['occupier', 'entrench', 'low_observable_ground', 'scout'], symbol: 'land.infantry.special_forces', doctrine: D.infantry,
    description: 'Small elite teams for raids and reconnaissance. Hard to spot, strong in close terrain, and able to identify what they see.',
  }),
  unit({
    id: 'inf_militia', name: 'Hearthguard Militia', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true,
    cost: { supplies: 40, components: 4, manpower: 60, money: 60 }, upkeep: { supplies: 2, manpower: 1, money: 1 }, buildHours: 12, requires: army(1), unlockTech: null, levels: 3,
    base: { hp: 16, atk: [4, 1, 0.5, 0, 0, 0, 1], def: [6, 2.5, 1.5, 0.5, 0, 0, 0], speed: 35, range: 0, sight: 25, signature: 0 },
    terrain: { ...T_INFANTRY, urban: { attack: 1.1, defense: 1.5, speed: 0.9 } }, orders: O_INFANTRY, features: ['occupier', 'entrench', 'home_defense'],
    symbol: 'land.infantry.militia', doctrine: D.infantry,
    description: 'National guard and territorial volunteers. Weak in the attack but cheap to keep and stubborn when defending home provinces and cities.',
  }),
  unit({
    id: 'inf_mercenary', name: 'Freeblade Contractors', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true,
    cost: { supplies: 30, components: 10, manpower: 10, money: 650 }, upkeep: { supplies: 2, money: 18 }, buildHours: 8, requires: army(1), unlockTech: 'land_contractors', levels: 3,
    base: { hp: 16, atk: [6.5, 2, 1, 0, 0, 0, 2], def: [5, 2.5, 1.5, 0.5, 0, 0, 0], speed: 45, range: 0, sight: 25, signature: 0 },
    terrain: T_INFANTRY, orders: O_INFANTRY, features: ['occupier', 'contract_force'], symbol: 'land.infantry.mercenary', doctrine: D.infantry,
    description: 'Hired contract infantry. Converts money into fighters within hours when manpower is short, but the payroll keeps running every day.',
  }),

  // ════════ Armor ════════
  unit({
    id: 'arm_recon', name: 'Pathfinder Scout Car', family: 'armor', domain: 'land', targetClass: 'armored', echelon: 1, capture: true,
    cost: { supplies: 30, components: 50, electronics: 10, fuel: 15, manpower: 15, money: 250 }, buildHours: 24, requires: army(1), unlockTech: 'rec_scout_vehicle', levels: 3,
    base: { hp: 16, atk: [4, 2, 1, 0, 0, 0, 1], def: [3, 2.5, 1, 0.5, 0, 0, 0], speed: 70, range: 0, sight: 50, signature: 1 },
    terrain: T_ARMOR, orders: O_INFANTRY, features: ['occupier', 'scout'], symbol: 'land.armor.recon', doctrine: D.armor,
    description: 'Fast wheeled reconnaissance vehicle. Long sight and scout identification make it the eyes of an armored column; too light to slug it out.',
  }),
  unit({
    id: 'arm_afv', name: 'Ironhide Armored Carrier', family: 'armor', domain: 'land', targetClass: 'armored', echelon: 1, capture: true,
    cost: { supplies: 40, components: 70, electronics: 4, fuel: 15, manpower: 20, money: 260 }, buildHours: 30, requires: army(1), unlockTech: null, levels: 4,
    base: { hp: 22, atk: [6, 4, 1, 0, 0, 0, 2], def: [5, 5, 1.5, 0.5, 0, 0, 0], speed: 55, range: 0, sight: 30, signature: 0 },
    terrain: T_ARMOR, orders: O_INFANTRY, features: ['occupier', 'entrench'], symbol: 'land.armor.afv', doctrine: D.armor,
    description: 'Light armored fighting vehicle with an autocannon. Available to every army from day one; a solid all-rounder against infantry and light armor.',
  }),
  unit({
    id: 'arm_amphibious', name: 'Surfrider Amphibious Carrier', family: 'armor', domain: 'land', targetClass: 'armored', echelon: 1, capture: true,
    cost: { supplies: 40, components: 80, electronics: 8, fuel: 20, manpower: 20, money: 340 }, buildHours: 34, requires: [...army(2), ...port(1)], unlockTech: 'land_amphibious_armor', levels: 3,
    base: { hp: 22, atk: [6, 4, 1, 0, 1, 0, 2], def: [5, 5, 1.5, 0.5, 1, 0, 0], speed: 50, range: 0, sight: 30, signature: 0 },
    terrain: { ...T_ARMOR, coastal_waters: { speed: 0.5, defense: 0.8 } }, orders: O_INFANTRY, features: ['occupier', 'amphibious', 'amphibious_assault'],
    symbol: 'land.armor.amphibious', doctrine: D.armor,
    description: 'Armored vehicle that swims short coastal hops and fights on landing. Gives marines armored support across straits.',
  }),
  unit({
    id: 'arm_mbt', name: 'Warden Battle Tank', family: 'armor', domain: 'land', targetClass: 'armored', echelon: 1, capture: true,
    cost: { supplies: 50, components: 130, electronics: 15, fuel: 30, rare: 2, manpower: 20, money: 520 }, buildHours: 44, requires: army(3), unlockTech: 'land_mbt', levels: 4,
    base: { hp: 32, atk: [7, 9, 1.5, 0, 0, 0, 3], def: [6, 9, 2, 1, 0, 0, 0], speed: 45, range: 0, sight: 30, signature: 0 },
    terrain: T_ARMOR, orders: O_INFANTRY, features: ['occupier', 'entrench'], symbol: 'land.armor.mbt', doctrine: D.armor,
    description: 'Heavy main battle tank. Breakthrough unit for open terrain with the best armored attack and defence; fuel-hungry and slow in close terrain.',
  }),
  unit({
    id: 'arm_tank_destroyer', name: 'Hornet Tank Hunter', family: 'armor', domain: 'land', targetClass: 'armored', echelon: 2, capture: true,
    cost: { supplies: 40, components: 100, electronics: 20, fuel: 20, rare: 2, manpower: 15, money: 450 }, buildHours: 38, requires: army(3), unlockTech: 'land_tank_destroyer', levels: 3,
    base: { hp: 24, atk: [4, 11, 2, 0, 0, 0, 1.5], def: [4, 7, 1.5, 0.5, 0, 0, 0], speed: 48, range: 0, sight: 35, signature: 0 },
    terrain: { ...T_ARMOR, forest: { attack: 1.0, defense: 1.15, speed: 0.7 } }, orders: O_INFANTRY, features: ['occupier', 'entrench'], symbol: 'land.armor.tank_destroyer', doctrine: D.armor,
    description: 'Missile-armed tank hunter. Out-hits tanks from ambush positions but is vulnerable to infantry and artillery.',
  }),

  // ════════ Support (artillery) ════════
  unit({
    id: 'sup_towed_artillery', name: 'Longbow Field Gun', family: 'support', domain: 'land', targetClass: 'unarmored', echelon: 3,
    cost: { supplies: 50, components: 60, fuel: 5, manpower: 25, money: 200 }, buildHours: 24, requires: army(1), unlockTech: null, levels: 4,
    base: { hp: 14, atk: [8, 4, 0, 0, 1, 0, 4], def: [2, 1, 0.5, 0.5, 0, 0, 0], speed: 30, range: 40, sight: 25, signature: 0 },
    terrain: T_SUPPORT, orders: O_SUPPORT, features: ['indirect_fire'], symbol: 'land.support.towed_artillery', doctrine: D.support,
    description: 'Towed howitzer battery. Cheap ranged fire support for any army; slow to move and helpless if caught in the open.',
  }),
  unit({
    id: 'sup_sp_artillery', name: 'Thunderclap Self-Propelled Gun', family: 'support', domain: 'land', targetClass: 'armored', echelon: 3,
    cost: { supplies: 50, components: 110, electronics: 10, fuel: 20, manpower: 20, money: 420 }, buildHours: 40, requires: army(2), unlockTech: 'sup_sp_artillery', levels: 4,
    base: { hp: 20, atk: [9, 6, 0, 0, 1.5, 0, 5], def: [3, 3, 1, 0.5, 0, 0, 0], speed: 45, range: 50, sight: 25, signature: 0 },
    terrain: T_SUPPORT, orders: O_SUPPORT, features: ['indirect_fire'], symbol: 'land.support.sp_artillery', doctrine: D.support,
    description: 'Armored self-propelled howitzer. Keeps up with mechanized forces and survives counter-battery fire better than towed guns.',
  }),
  unit({
    id: 'sup_rocket_artillery', name: 'Hailstorm Rocket Battery', family: 'support', domain: 'land', targetClass: 'unarmored', echelon: 3,
    cost: { supplies: 60, components: 100, electronics: 20, fuel: 20, rare: 2, manpower: 20, money: 480 }, buildHours: 40, requires: army(3), unlockTech: 'sup_rocket_artillery', levels: 3,
    base: { hp: 16, atk: [12, 6, 0, 0, 2, 0, 7], def: [2, 2, 0.5, 0.5, 0, 0, 0], speed: 45, range: 80, sight: 25, signature: 0 },
    terrain: T_SUPPORT, orders: O_SUPPORT, features: ['indirect_fire'], symbol: 'land.support.rocket_artillery', doctrine: D.support,
    description: 'Multiple rocket launcher battery. Devastating long-range salvos against massed infantry and buildings; fragile when engaged directly.',
  }),

  // ════════ Air defence ════════
  unit({
    id: 'sup_aa_gun', name: 'Skyshield Gun Carrier', family: 'air_defense', domain: 'land', targetClass: 'armored', echelon: 3,
    cost: { supplies: 30, components: 70, electronics: 20, fuel: 12, manpower: 15, money: 300 }, buildHours: 30, requires: army(1), unlockTech: 'sup_aa_gun', levels: 4,
    base: { hp: 18, atk: [3, 1, 9, 6, 0, 0, 0], def: [3, 3, 7, 5, 0, 0, 0], speed: 50, range: 15, sight: 30, signature: 0 },
    terrain: T_SUPPORT, orders: O_SUPPORT, features: ['air_defense'], symbol: 'land.air_defense.gun', doctrine: D.air_defense,
    description: 'Mobile anti-aircraft gun vehicle. Short-range protection for armored columns, especially effective against helicopters.',
  }),
  unit({
    id: 'sup_sam', name: 'Lancet Mobile SAM', family: 'air_defense', domain: 'land', targetClass: 'armored', echelon: 3,
    cost: { supplies: 30, components: 80, electronics: 50, fuel: 15, rare: 3, manpower: 15, money: 520 }, buildHours: 40, requires: army(2), unlockTech: 'sup_mobile_sam', levels: 4,
    base: { hp: 16, atk: [0, 0, 8, 11, 0, 0, 0], def: [2, 2, 6, 8, 0, 0, 0], speed: 45, range: 60, sight: 25, radarKm: 120, radarDetects: ['air'], radarSens: 1, signature: 0 },
    terrain: T_SUPPORT, orders: O_SUPPORT, features: ['air_defense', 'radar'], symbol: 'land.air_defense.sam', doctrine: D.air_defense,
    description: 'Mobile surface-to-air missile launcher with its own search radar. Denies medium-altitude airspace over the front.',
  }),
  unit({
    id: 'sup_theatre_defense', name: 'Bastion Theatre Defence System', family: 'air_defense', domain: 'land', targetClass: 'armored', echelon: 3,
    cost: { supplies: 40, components: 140, electronics: 110, fuel: 25, rare: 10, manpower: 20, money: 1100 }, buildHours: 72, requires: army(3), unlockTech: 'sup_theatre_defense', levels: 3,
    base: { hp: 20, atk: [0, 0, 6, 14, 0, 0, 0], def: [2, 2, 6, 10, 0, 0, 0], speed: 35, range: 200, sight: 25, radarKm: 300, radarDetects: ['air', 'strategic'], radarSens: 2, signature: 0, sensUp: true },
    terrain: T_SUPPORT, orders: O_SUPPORT, features: ['air_defense', 'missile_intercept', 'radar'], symbol: 'land.air_defense.theatre', doctrine: D.air_defense,
    description: 'Long-range area air and missile defence. The only land unit that adds a defence rating against missile events in its sector; expensive and slow to field.',
  }),

  // ════════ Reconnaissance ════════
  unit({
    id: 'sup_mobile_radar', name: 'Watchtower Mobile Radar', family: 'recon', domain: 'land', targetClass: 'unarmored', echelon: 3,
    cost: { supplies: 20, components: 50, electronics: 60, fuel: 10, rare: 2, manpower: 10, money: 420 }, buildHours: 36, requires: army(2), unlockTech: 'rec_mobile_radar', levels: 3,
    base: { hp: 10, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 1, 1, 0, 0, 0], speed: 45, range: 0, sight: 30, radarKm: 350, radarDetects: ['air', 'land', 'sea'], radarSens: 2, signature: 0, sensUp: true },
    terrain: T_SUPPORT, orders: O_SUPPORT.filter((o) => o !== 'attack' && o !== 'fire_policy'), features: ['radar'], symbol: 'land.recon.radar', doctrine: D.sensor,
    description: 'Truck-mounted surveillance radar. Extends the radar picture over land, sea and air; contacts appear as domain markers until identified.',
  }),
  unit({
    id: 'rec_broad_area', name: 'Highwatch Broad-Area Reconnaissance Aircraft', family: 'recon', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 15, components: 120, electronics: 180, fuel: 60, rare: 15, manpower: 8, money: 1600 }, buildHours: 80, requires: air(3), unlockTech: 'rec_broad_area_recon', levels: 3,
    base: { hp: 20, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 1, 3, 1, 0, 0], speed: 750, range: 0, sight: 120, radarKm: 600, radarDetects: ['land', 'sea', 'air'], radarSens: 2, signature: 1, endurance: 900, opRange: 6000, sensUp: true },
    terrain: T_AIR, orders: ['patrol', 'rebase', 'stop'], features: ['broad_area_recon', 'radar', 'long_loiter', 'air_patrol'], symbol: 'air.recon.broad_area', doctrine: D.sensor,
    description: 'High-altitude, long-endurance reconnaissance aircraft. Produces wide-area dated reports and improves the map picture; every observation still requires the aircraft (or a treaty) in range.',
  }),

  // ════════ Helicopters ════════
  unit({
    id: 'heli_gunship', name: 'Rotorhawk Gunship', family: 'helicopter', domain: 'air', targetClass: 'helicopter', echelon: 1,
    cost: { supplies: 20, components: 70, electronics: 30, fuel: 30, manpower: 10, money: 480 }, buildHours: 36, requires: air(1), unlockTech: 'avi_gunship', levels: 3,
    base: { hp: 18, atk: [8, 5, 2, 0, 1, 0, 2], def: [4, 3, 4, 2, 1, 0, 0], speed: 260, range: 0, sight: 40, signature: 1, opRange: 600 },
    terrain: T_HELI, orders: O_HELI, features: [], symbol: 'air.helicopter.gunship', doctrine: D.air,
    description: 'Armed utility helicopter. Fast fire support against infantry anywhere along the front; cannot hold ground.',
  }),
  unit({
    id: 'heli_attack', name: 'Talonblade Attack Helicopter', family: 'helicopter', domain: 'air', targetClass: 'helicopter', echelon: 1,
    cost: { supplies: 20, components: 80, electronics: 50, fuel: 35, rare: 3, manpower: 10, money: 650 }, buildHours: 44, requires: air(2), unlockTech: 'avi_attack_helicopter', levels: 4,
    base: { hp: 20, atk: [7, 10, 3, 0, 2, 0, 2], def: [4, 4, 5, 2, 1, 0, 0], speed: 280, range: 0, sight: 40, signature: 1, opRange: 650 },
    terrain: T_HELI, orders: O_HELI, features: [], symbol: 'air.helicopter.attack', doctrine: D.air,
    description: 'Dedicated tank-hunting helicopter. The fastest answer to an armored breakthrough, but exposed to mobile air defence.',
  }),
  unit({
    id: 'heli_asw', name: 'Seawhirl ASW Helicopter', family: 'helicopter', domain: 'air', targetClass: 'helicopter', echelon: 2,
    cost: { supplies: 20, components: 70, electronics: 55, fuel: 30, rare: 2, manpower: 10, money: 600 }, buildHours: 40, requires: air(1), unlockTech: 'nav_asw_helicopter', levels: 3,
    base: { hp: 16, atk: [1, 0, 0, 0, 6, 10, 0], def: [2, 1, 3, 1, 3, 4, 0], speed: 250, range: 0, sight: 40, radarKm: 80, radarDetects: ['sea', 'subsurface'], radarSens: 2, signature: 1, opRange: 600 },
    terrain: T_HELI, orders: O_HELI, features: ['sonar', 'asw', 'carrier_capable'], symbol: 'air.helicopter.asw', doctrine: D.air,
    description: 'Anti-submarine helicopter with dipping sonar. Finds and attacks submarines near friendly coasts and fleets; can operate from carriers.',
    extra: { carrierCapable: true },
  }),

  // ════════ Fighters ════════
  unit({
    id: 'ftr_air_superiority', name: 'Falconet Air Superiority Fighter', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 1,
    cost: { supplies: 20, components: 90, electronics: 70, fuel: 40, rare: 3, manpower: 10, money: 800 }, buildHours: 48, requires: air(2), unlockTech: null, levels: 4,
    base: { hp: 22, atk: [1, 0.5, 7, 10, 1, 0, 0.5], def: [2, 2, 6, 9, 2, 0, 0], speed: 1300, range: 0, sight: 60, radarKm: 150, radarDetects: ['air'], radarSens: 1, signature: 1, endurance: 240, opRange: 1600 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'radar'], symbol: 'air.fighter.air_superiority', doctrine: D.air,
    description: 'Basic jet fighter available to every air force. Patrols to win control of the air and intercept bombers and helicopters.',
  }),
  unit({
    id: 'ftr_naval_air_superiority', name: 'Petrel Carrier Fighter', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 1,
    cost: { supplies: 20, components: 100, electronics: 80, fuel: 45, rare: 4, manpower: 10, money: 950 }, buildHours: 52, requires: air(2), unlockTech: 'nav_carrier_aviation', levels: 3,
    base: { hp: 22, atk: [1, 0.5, 7, 10, 2, 0, 0.5], def: [2, 2, 6, 9, 3, 0, 0], speed: 1250, range: 0, sight: 60, radarKm: 150, radarDetects: ['air', 'sea'], radarSens: 1, signature: 1, endurance: 220, opRange: 1400 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'radar', 'carrier_capable'], symbol: 'air.fighter.naval_air_superiority', doctrine: D.air,
    description: 'Carrier-qualified fighter. Defends the fleet and projects air cover far from land bases.',
    extra: { carrierCapable: true },
  }),
  unit({
    id: 'ftr_stealth_air_superiority', name: 'Shade Stealth Interceptor', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 1,
    cost: { supplies: 20, components: 120, electronics: 140, fuel: 50, rare: 20, manpower: 10, money: 1600 }, buildHours: 72, requires: air(4), unlockTech: 'avi_stealth_fighter', levels: 3,
    base: { hp: 24, atk: [1, 0.5, 9, 14, 1, 0, 0.5], def: [2, 2, 8, 12, 2, 0, 0], speed: 1450, range: 0, sight: 60, radarKm: 200, radarDetects: ['air'], radarSens: 2, signature: 3, endurance: 240, opRange: 1800 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'radar', 'stealth_air'], symbol: 'air.fighter.stealth_air_superiority', doctrine: D.air,
    description: 'Low-observable air superiority fighter. Strikes first against anything that cannot see it; very expensive in electronics and rare materials.',
  }),
  unit({
    id: 'ftr_strike', name: 'Harrow Strike Fighter', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 2,
    cost: { supplies: 25, components: 100, electronics: 70, fuel: 45, rare: 4, manpower: 10, money: 850 }, buildHours: 50, requires: air(2), unlockTech: 'avi_strike_fighter', levels: 4,
    base: { hp: 22, atk: [8, 8, 2, 4, 6, 0, 7], def: [2, 2, 4, 6, 2, 0, 0], speed: 1150, range: 0, sight: 50, signature: 1, endurance: 200, opRange: 1500 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol'], symbol: 'air.fighter.strike', doctrine: D.air,
    description: 'Multirole strike fighter. Attacks ground forces, ships and buildings within its operational range; needs escorts against dedicated fighters.',
  }),
  unit({
    id: 'ftr_naval_strike', name: 'Wavecrest Carrier Striker', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 2,
    cost: { supplies: 25, components: 110, electronics: 80, fuel: 50, rare: 5, manpower: 10, money: 1000 }, buildHours: 54, requires: air(2), unlockTech: 'nav_carrier_aviation', levels: 3,
    base: { hp: 22, atk: [6, 6, 2, 4, 10, 1, 6], def: [2, 2, 4, 6, 3, 0, 0], speed: 1100, range: 0, sight: 50, signature: 1, endurance: 200, opRange: 1400 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'carrier_capable', 'naval_strike'], symbol: 'air.fighter.naval_strike', doctrine: D.air,
    description: 'Carrier-qualified strike aircraft specialized against surface ships. The offensive arm of a carrier group.',
    extra: { carrierCapable: true },
  }),
  unit({
    id: 'ftr_stealth_strike', name: 'Duskveil Stealth Striker', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 2,
    cost: { supplies: 25, components: 130, electronics: 150, fuel: 55, rare: 22, manpower: 10, money: 1750 }, buildHours: 76, requires: air(4), unlockTech: 'avi_stealth_strike', levels: 3,
    base: { hp: 24, atk: [10, 10, 2, 6, 8, 0, 10], def: [2, 2, 5, 8, 3, 0, 0], speed: 1250, range: 0, sight: 50, signature: 3, endurance: 220, opRange: 1700 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'stealth_air'], symbol: 'air.fighter.stealth_strike', doctrine: D.air,
    description: 'Low-observable strike aircraft. Penetrates air defences to hit high-value targets; a major rare-materials commitment.',
  }),
  unit({
    id: 'ftr_uav', name: 'Farsight Combat Drone', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 2,
    cost: { supplies: 10, components: 40, electronics: 50, fuel: 15, rare: 2, manpower: 3, money: 380 }, buildHours: 30, requires: air(1), unlockTech: 'rec_uav', levels: 3,
    base: { hp: 10, atk: [5, 4, 0, 0, 2, 0, 3], def: [1, 1, 1, 1, 1, 0, 0], speed: 400, range: 0, sight: 80, signature: 1, endurance: 720, opRange: 2000 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'long_loiter', 'scout'], symbol: 'air.fighter.uav', doctrine: D.air,
    description: 'Armed unmanned aircraft. Long loiter and wide sight for persistent observation, with light strike capability. Fragile against fighters.',
  }),

  // ════════ Heavies ════════
  unit({
    id: 'hvy_maritime_patrol', name: 'Tidewatcher Maritime Patrol Aircraft', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 20, components: 120, electronics: 90, fuel: 60, rare: 4, manpower: 12, money: 1000 }, buildHours: 60, requires: air(3), unlockTech: 'avi_maritime_patrol', levels: 3,
    base: { hp: 26, atk: [0, 0, 0, 0, 7, 10, 0], def: [1, 1, 2, 3, 3, 2, 0], speed: 750, range: 0, sight: 80, radarKm: 300, radarDetects: ['sea', 'subsurface'], radarSens: 2, signature: 0, endurance: 600, opRange: 3500 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'sonar', 'asw', 'radar'], symbol: 'air.heavy.maritime_patrol', doctrine: D.air,
    description: 'Long-range maritime patrol aircraft. Hunts submarines and shadows surface fleets over the open ocean.',
  }),
  unit({
    id: 'hvy_awacs', name: 'Skyloom Airborne Early Warning', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 20, components: 130, electronics: 160, fuel: 60, rare: 8, manpower: 12, money: 1400 }, buildHours: 72, requires: air(3), unlockTech: 'rec_awacs', levels: 3,
    base: { hp: 26, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 2, 3, 1, 0, 0], speed: 800, range: 0, sight: 60, radarKm: 500, radarDetects: ['air', 'sea'], radarSens: 2, signature: 0, endurance: 600, opRange: 3000, sensUp: true },
    terrain: T_AIR, orders: ['patrol', 'rebase', 'stop'], features: ['air_patrol', 'radar'], symbol: 'air.heavy.awacs', doctrine: D.sensor,
    description: 'Airborne early warning and control aircraft. A flying radar picture over air and sea; at full development it can detect stealth aircraft.',
  }),
  unit({
    id: 'hvy_naval_aew', name: 'Deckeye Carrier Early Warning', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 20, components: 100, electronics: 130, fuel: 45, rare: 6, manpower: 10, money: 1150 }, buildHours: 64, requires: air(2), unlockTech: 'nav_carrier_aew', levels: 3,
    base: { hp: 22, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 2, 3, 1, 0, 0], speed: 650, range: 0, sight: 60, radarKm: 350, radarDetects: ['air', 'sea'], radarSens: 2, signature: 0, endurance: 360, opRange: 1600, sensUp: true },
    terrain: T_AIR, orders: ['patrol', 'rebase', 'stop'], features: ['air_patrol', 'radar', 'carrier_capable'], symbol: 'air.heavy.naval_aew', doctrine: D.sensor,
    description: 'Carrier-based early warning aircraft. Gives a carrier group its own air and surface picture.',
    extra: { carrierCapable: true },
  }),
  unit({
    id: 'hvy_bomber', name: 'Stormbringer Heavy Bomber', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 30, components: 180, electronics: 100, fuel: 90, rare: 8, manpower: 15, money: 1600 }, buildHours: 84, requires: air(3), unlockTech: 'avi_heavy_bomber', levels: 3,
    base: { hp: 36, atk: [12, 9, 0, 0, 8, 0, 14], def: [2, 2, 2, 4, 2, 0, 0], speed: 900, range: 0, sight: 50, signature: 0, endurance: 600, opRange: 5000 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'strategic_bombing'], symbol: 'air.heavy.bomber', doctrine: D.air,
    description: 'Long-range heavy bomber. Wrecks buildings and city condition deep in enemy territory; needs escort against fighters.',
  }),
  unit({
    id: 'hvy_stealth_bomber', name: 'Nightfall Stealth Bomber', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 30, components: 220, electronics: 200, fuel: 100, rare: 35, manpower: 15, money: 2800 }, buildHours: 120, requires: air(4), unlockTech: 'avi_stealth_bomber', levels: 3,
    base: { hp: 36, atk: [14, 12, 0, 0, 10, 0, 18], def: [2, 2, 3, 5, 3, 0, 0], speed: 950, range: 0, sight: 50, signature: 3, endurance: 720, opRange: 7000 },
    terrain: T_AIR, orders: O_AIR, features: ['air_patrol', 'strategic_bombing', 'stealth_air'], symbol: 'air.heavy.stealth_bomber', doctrine: D.air,
    description: 'Low-observable intercontinental bomber. The most expensive aircraft in the catalog; strikes deep with little warning.',
  }),
  unit({
    id: 'hvy_strategic_transport', name: 'Longhaul Strategic Airlifter', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 30, components: 160, electronics: 60, fuel: 80, rare: 4, manpower: 12, money: 1200 }, buildHours: 72, requires: air(3), unlockTech: 'mob_lift_1', levels: 3,
    levelTechs: [null, 'mob_strategic_airlift_2', 'mob_strategic_airlift_3'],
    base: { hp: 30, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 1, 2, 0, 0, 0], speed: 800, range: 0, sight: 40, signature: 0, endurance: 600, opRange: 5000 },
    terrain: T_AIR, orders: ['rebase', 'stop'], features: ['airlift'], symbol: 'air.heavy.transport', doctrine: D.strategic,
    description: 'Strategic transport aircraft. Adds abstract lift capacity for long transfers; each sortie consumes fuel and needs receiving capacity at the destination.',
    extra: { liftCapacity: 3 },
  }),
  unit({
    id: 'hvy_tanker', name: 'Wellspring Aerial Tanker', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 3,
    cost: { supplies: 25, components: 150, electronics: 60, fuel: 100, rare: 4, manpower: 12, money: 1150 }, buildHours: 70, requires: air(3), unlockTech: 'mob_refuel_support', levels: 3,
    base: { hp: 28, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 1, 2, 0, 0, 0], speed: 850, range: 0, sight: 40, signature: 0, endurance: 720, opRange: 5000 },
    terrain: T_AIR, orders: ['patrol', 'rebase', 'stop'], features: ['aerial_refuel', 'air_patrol'], symbol: 'air.heavy.tanker', doctrine: D.strategic,
    description: 'Aerial refuelling aircraft. Extends the endurance of friendly patrols within its radius at a steep fuel cost.',
  }),

  // ════════ Naval ════════
  unit({
    id: 'nav_corvette', name: 'Wavecutter Corvette', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 1,
    cost: { supplies: 50, components: 150, electronics: 30, fuel: 40, manpower: 30, money: 600 }, buildHours: 60, requires: port(1), unlockTech: null, levels: 4,
    base: { hp: 30, atk: [2, 1, 2, 2, 6, 4, 3], def: [3, 2, 3, 3, 6, 4, 0], speed: 50, range: 40, sight: 40, radarKm: 120, radarDetects: ['air', 'sea'], radarSens: 1, signature: 1 },
    terrain: T_SHIP, orders: O_NAVAL, features: ['radar'], symbol: 'sea.naval.corvette', doctrine: D.naval,
    description: 'Small coastal warship available to every navy. Patrols home waters and escorts transports; outclassed on the high seas.',
  }),
  unit({
    id: 'nav_frigate', name: 'Keelguard Frigate', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 1,
    cost: { supplies: 60, components: 220, electronics: 60, fuel: 55, rare: 3, manpower: 40, money: 950 }, buildHours: 84, requires: port(2), unlockTech: 'nav_frigate', levels: 4,
    base: { hp: 40, atk: [2, 1, 4, 4, 7, 7, 3], def: [3, 2, 5, 5, 7, 6, 0], speed: 50, range: 60, sight: 45, radarKm: 180, radarDetects: ['air', 'sea', 'subsurface'], radarSens: 2, signature: 0 },
    terrain: T_SHIP, orders: O_NAVAL, features: ['radar', 'sonar', 'asw'], symbol: 'sea.naval.frigate', doctrine: D.naval,
    description: 'Ocean escort with towed sonar. The workhorse anti-submarine ship of a balanced fleet.',
  }),
  unit({
    id: 'nav_destroyer', name: 'Riptide Destroyer', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 1,
    cost: { supplies: 80, components: 320, electronics: 110, fuel: 75, rare: 8, manpower: 55, money: 1500 }, buildHours: 110, requires: port(3), unlockTech: 'nav_destroyer', levels: 4,
    base: { hp: 52, atk: [3, 2, 6, 7, 10, 6, 5], def: [4, 3, 7, 8, 9, 6, 0], speed: 55, range: 90, sight: 45, radarKm: 250, radarDetects: ['air', 'sea', 'subsurface'], radarSens: 2, signature: 0 },
    terrain: T_SHIP, orders: O_NAVAL, features: ['radar', 'sonar', 'shore_bombardment', 'missile_launch'], symbol: 'sea.naval.destroyer', doctrine: D.naval,
    description: 'Multi-purpose guided-missile destroyer. Strong fleet air defence and anti-ship punch; can launch cruise-missile tokens.',
  }),
  unit({
    id: 'nav_cruiser', name: 'Monolith Guided-Missile Cruiser', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 2,
    cost: { supplies: 100, components: 450, electronics: 170, fuel: 100, rare: 14, manpower: 70, money: 2300 }, buildHours: 140, requires: port(4), unlockTech: 'nav_cruiser', levels: 3,
    base: { hp: 70, atk: [4, 3, 7, 10, 13, 4, 8], def: [5, 4, 9, 10, 11, 5, 0], speed: 50, range: 150, sight: 45, radarKm: 350, radarDetects: ['air', 'sea', 'strategic'], radarSens: 2, signature: 0 },
    terrain: T_SHIP, orders: O_NAVAL, features: ['radar', 'shore_bombardment', 'missile_launch', 'missile_intercept'], symbol: 'sea.naval.cruiser', doctrine: D.naval,
    description: 'Large missile cruiser. Long-range strike, fleet area air defence and a modest missile-interception rating; a heavy maintenance commitment.',
  }),
  unit({
    id: 'nav_carrier', name: 'Skyharbor Fleet Carrier', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 3,
    cost: { supplies: 150, components: 800, electronics: 260, fuel: 180, rare: 25, manpower: 120, money: 4200 }, buildHours: 220, requires: port(5), unlockTech: 'nav_carrier', levels: 3,
    base: { hp: 110, atk: [1, 1, 3, 4, 3, 1, 1], def: [4, 3, 6, 7, 8, 4, 0], speed: 45, range: 20, sight: 50, radarKm: 300, radarDetects: ['air', 'sea'], radarSens: 2, signature: 0 },
    terrain: T_SHIP, orders: O_NAVAL, features: ['radar', 'flight_deck'], symbol: 'sea.naval.carrier', doctrine: D.naval,
    description: 'Fleet aircraft carrier. Weak on its own; its value is the carrier-qualified air wing it carries. Ship, air wing and maintenance are separate queues.',
    extra: { carries: { families: ['fighter', 'heavy', 'helicopter'], slots: 8 } },
  }),

  // ════════ Submarines ════════
  unit({
    id: 'sub_attack', name: 'Deepstalker Attack Submarine', family: 'submarine', domain: 'subsurface', targetClass: 'submarine', echelon: 1,
    cost: { supplies: 50, components: 260, electronics: 90, fuel: 40, rare: 8, manpower: 30, money: 1300 }, buildHours: 110, requires: port(2), unlockTech: 'nav_attack_submarine', levels: 4,
    base: { hp: 40, atk: [0, 0, 0, 0, 12, 10, 1], def: [0, 0, 1, 0, 6, 8, 0], speed: 40, range: 40, sight: 30, radarKm: 100, radarDetects: ['sea', 'subsurface'], radarSens: 2, signature: 2 },
    terrain: T_SUB, orders: O_NAVAL, features: ['submerged', 'sonar', 'naval_strike', 'asw', 'missile_launch'], symbol: 'subsurface.submarine.attack', doctrine: D.naval,
    description: 'Hunter-killer submarine. Invisible to ordinary radar; sinks ships and other submarines. Only sonar and ASW sensors can find it.',
  }),
  unit({
    id: 'sub_ballistic', name: 'Abyssal Strategic Submarine', family: 'submarine', domain: 'subsurface', targetClass: 'submarine', echelon: 3,
    cost: { supplies: 70, components: 420, electronics: 150, fuel: 60, rare: 18, manpower: 45, money: 2600 }, buildHours: 170, requires: port(4), unlockTech: 'nav_ballistic_submarine', levels: 3,
    base: { hp: 50, atk: [0, 0, 0, 0, 4, 5, 0], def: [0, 0, 1, 0, 5, 6, 0], speed: 35, range: 20, sight: 25, radarKm: 80, radarDetects: ['sea', 'subsurface'], radarSens: 2, signature: 3 },
    terrain: T_SUB, orders: [...O_NAVAL, 'launch'], features: ['submerged', 'sonar', 'missile_launch'], symbol: 'subsurface.submarine.ballistic', doctrine: D.naval,
    description: 'Very quiet missile submarine. A survivable launch platform for ballistic-missile tokens; nearly helpless in a direct fight.',
  }),

  // ════════ Missile launchers ════════
  unit({
    id: 'msl_cruise_launcher', name: 'Arrowhead Cruise Launcher', family: 'missile_launcher', domain: 'land', targetClass: 'armored', echelon: 3,
    cost: { supplies: 30, components: 90, electronics: 40, fuel: 15, rare: 2, manpower: 15, money: 500 }, buildHours: 40, requires: army(2), unlockTech: 'str_cruise_missile_1', levels: 3,
    levelTechs: [null, 'str_cruise_missile_2', 'msl_cruise_launcher_l3'],
    base: { hp: 14, atk: [0, 0, 0, 0, 0, 0, 0], def: [2, 2, 1, 0.5, 0, 0, 0], speed: 45, range: 0, sight: 20, signature: 0 },
    terrain: T_SUPPORT, orders: O_LAUNCHER, features: ['missile_launch'], symbol: 'land.missile.cruise_launcher', doctrine: D.strategic,
    description: 'Road-mobile launcher for cruise-missile tokens. Launches ready inventory; the launcher itself does not create missiles.',
  }),
  unit({
    id: 'msl_ballistic_launcher', name: 'Spireheart Ballistic Launcher', family: 'missile_launcher', domain: 'land', targetClass: 'armored', echelon: 3,
    cost: { supplies: 40, components: 140, electronics: 60, fuel: 25, rare: 6, manpower: 20, money: 900 }, buildHours: 56, requires: army(3), unlockTech: 'str_ballistic_missile_2', levels: 3,
    base: { hp: 16, atk: [0, 0, 0, 0, 0, 0, 0], def: [2, 2, 1, 0.5, 0, 0, 0], speed: 40, range: 0, sight: 20, signature: 0 },
    terrain: T_SUPPORT, orders: O_LAUNCHER, features: ['missile_launch'], symbol: 'land.missile.ballistic_launcher', doctrine: D.strategic,
    description: 'Transporter-erector-launcher for ballistic-missile and boost-glide tokens. Mobile and hard to target, but each launch reveals its sector.',
  }),

  // ════════ Officers (one active per officer type per stack) ════════
  ...(
    [
      ['off_infantry', 'Line Infantry Commander', 'land', 'unarmored', 'land.officer.infantry', 'off_command_school', { appliesTo: ['infantry'], attackMult: 1.1, defenseMult: 1.15 }, 50, army(2), 'Experienced infantry commander. Infantry in the same stack attack and defend better.'],
      ['off_airborne', 'Airborne Commander', 'land', 'unarmored', 'land.officer.airborne', 'off_airborne_command', { appliesTo: ['infantry'], attackMult: 1.1, speedMult: 1.15 }, 55, army(3), 'Paratroop and air-assault leader. Infantry in the same stack move faster and hit harder.'],
      ['off_armored', 'Armored Commander', 'land', 'armored', 'land.officer.armored', 'off_command_school', { appliesTo: ['armor'], attackMult: 1.15, defenseMult: 1.1 }, 50, army(2), 'Tank commander. Armored units in the same stack gain attack and defence.'],
      ['off_helicopter', 'Rotary Wing Commander', 'air', 'helicopter', 'air.officer.helicopter', 'off_aviation_command', { appliesTo: ['helicopter'], attackMult: 1.15, hpRegenMult: 1.2 }, 260, air(2), 'Helicopter wing leader. Helicopters in the same group strike harder and recover faster.'],
      ['off_fighter', 'Air Wing Commander', 'air', 'airplane', 'air.officer.fighter', 'off_aviation_command', { appliesTo: ['fighter', 'heavy'], attackMult: 1.1, defenseMult: 1.1 }, 1100, air(2), 'Fighter ace and wing leader. Fixed-wing aircraft in the same group gain attack and defence.'],
      ['off_naval', 'Flotilla Commander', 'sea', 'ship', 'sea.officer.naval', 'off_naval_command', { appliesTo: ['naval'], attackMult: 1.1, defenseMult: 1.1, hpRegenMult: 1.15 }, 50, port(2), 'Surface fleet commander. Ships in the same fleet fight better and repair faster.'],
      ['off_submarine', 'Undersea Commander', 'subsurface', 'submarine', 'subsurface.officer.submarine', 'off_naval_command', { appliesTo: ['submarine'], attackMult: 1.15, speedMult: 1.05 }, 40, port(2), 'Submarine flotilla leader. Submarines in the same group attack harder and transit faster.'],
    ] as const
  ).map(([id, name, domain, tc, symbol, tech, bonus, speed, req, description]) =>
    unit({
      id, name, family: 'officer', domain, targetClass: tc, echelon: 3,
      cost: { supplies: 20, electronics: 5, manpower: 5, money: 600 }, upkeep: { money: 10, supplies: 1 }, buildHours: 24, requires: req, unlockTech: tech, levels: 2,
      base: { hp: 8, atk: [0, 0, 0, 0, 0, 0, 0], def: [1, 1, 1, 1, domain === 'sea' ? 1 : 0, domain === 'subsurface' ? 1 : 0, 0], speed, range: 0, sight: 30, signature: domain === 'subsurface' ? 2 : 0, ...(domain === 'air' && tc === 'airplane' ? { endurance: 240, opRange: 1500 } : {}), ...(domain === 'air' && tc === 'helicopter' ? { opRange: 600 } : {}) },
      terrain: domain === 'land' ? T_INFANTRY : domain === 'sea' ? T_SHIP : domain === 'subsurface' ? T_SUB : T_AIR,
      orders: domain === 'land' ? O_OFFICER_LAND : domain === 'air' ? O_OFFICER_AIR : O_OFFICER_SEA,
      features: ['command_aura'], symbol, doctrine: D.officer, description,
      extra: { officerBonus: { ...bonus, appliesTo: [...bonus.appliesTo] } },
    }),
  ),

  // ════════ Deployables ════════
  unit({
    id: 'dep_ugv', name: 'Groundhog Unmanned Ground Vehicle', family: 'deployable', domain: 'land', targetClass: 'armored', echelon: 1,
    cost: { components: 40, electronics: 25, fuel: 5, rare: 1, money: 250 }, upkeep: { fuel: 1, money: 2 }, buildHours: 16, requires: army(2), unlockTech: 'str_unmanned_ground', levels: 2,
    base: { hp: 8, atk: [5, 3, 0, 0, 0, 0, 2], def: [2, 2, 0, 0, 0, 0, 0], speed: 35, range: 0, sight: 20, signature: 1 },
    terrain: T_ARMOR, orders: ['move', 'stop', 'waypoints', 'attack', 'launch', 'embark', 'disembark'], features: ['deployable'], symbol: 'land.deployable.ugv', doctrine: D.strategic,
    description: 'Remote-controlled breaching vehicle. Spent to soften an entrenched province centre before an assault.',
    extra: { deployable: { uses: 2, effect: 'Breach: the stack gains +25% attack against an entrenched province centre for one combat round per use.', cooldownMin: 240 } },
  }),
  unit({
    id: 'dep_swarm_uav', name: 'Hivecloud Swarm Drones', family: 'deployable', domain: 'air', targetClass: 'airplane', echelon: 2,
    cost: { components: 20, electronics: 40, rare: 3, money: 320 }, upkeep: { money: 2 }, buildHours: 16, requires: air(1), unlockTech: 'str_swarm_drones', levels: 2,
    base: { hp: 6, atk: [6, 4, 1, 0, 3, 0, 4], def: [1, 1, 1, 1, 0, 0, 0], speed: 300, range: 0, sight: 30, signature: 1, endurance: 120, opRange: 300 },
    terrain: T_AIR, orders: ['launch', 'rebase', 'stop'], features: ['deployable'], symbol: 'air.deployable.swarm_uav', doctrine: D.strategic,
    description: 'Expendable drone swarm. One saturation strike on a province within 300 km, then consumed.',
    extra: { deployable: { uses: 1, effect: 'Saturation strike: damages units in one province within 300 km and suppresses its air defence for 2 game hours.', cooldownMin: 0 } },
  }),
];

/** Families as listed in the SPEC unit directory → catalog families. */
export const DIRECTORY_GROUPS: Record<string, UnitFamily[]> = {
  Infantry: ['infantry'],
  Armored: ['armor'],
  Support: ['support', 'air_defense', 'recon'],
  Helicopters: ['helicopter'],
  Fighters: ['fighter'],
  Heavies: ['heavy'],
  Naval: ['naval'],
  Submarines: ['submarine'],
  Missiles: ['missile_launcher'],
  Officers: ['officer'],
  Deployables: ['deployable'],
};

