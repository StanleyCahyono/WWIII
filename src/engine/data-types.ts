/**
 * STATIC DATA CONTRACT — World Command: World 120
 *
 * These types describe authored/generated scenario data (map, catalog, profiles).
 * Runtime (mutable) campaign state lives in `state.ts`.
 *
 * Rules for collaborators (Claude agents, ChatGPT/Codex):
 *  - Changes here must be ADDITIVE (new optional fields / new union members) unless
 *    every consumer is updated in the same commit. Record changes in docs/HANDOFF.md.
 *  - All numbers here are fictional game-balance values.
 *  - Quantities of resources in data files are whole units. The engine converts to
 *    fixed-point milli-units (x1000) internally (see engine/fixed.ts).
 */

// ───────────────────────────── Identifiers ─────────────────────────────

/** ISO-3166 alpha-3 style stable scenario key, e.g. "USA", "IDN". Exactly 120 are playable. */
export type CountryId = string;
/** Index into MapData.nodes. Stable for a given MapData.version. */
export type NodeId = number;
/** Stable city key: `${CountryId}-${slug}` e.g. "IDN-jakarta". Stable across map versions. */
export type CityKey = string;
export type UnitTypeId = string;
export type BuildingTypeId = string;
export type TechId = string;
export type MissileTypeId = string;

export type RegionFilter =
  | 'Americas'
  | 'Europe'
  | 'Africa'
  | 'West and Central Asia'
  | 'South, East and Southeast Asia'
  | 'Oceania';

// ───────────────────────────── Economy ─────────────────────────────

export const RESOURCES = ['supplies', 'components', 'electronics', 'fuel', 'rare', 'manpower', 'money'] as const;
export type Resource = (typeof RESOURCES)[number];
/** A resource vector. Missing keys mean zero. */
export type ResVec = Partial<Record<Resource, number>>;

export interface ResourceDef {
  id: Resource;
  name: string;
  /** Why this material exists (shown in help + ledger). */
  role: string;
  /** Fixed published reference price in money per unit (used by the opening power index and AI valuation). */
  referencePrice: number;
}

// ───────────────────────────── Terrain ─────────────────────────────

/** The ten documented terrain types. */
export const TERRAINS = [
  'open',
  'mountains',
  'forest',
  'urban',
  'suburban',
  'jungle',
  'tundra',
  'desert',
  'high_seas',
  'coastal_waters',
] as const;
export type Terrain = (typeof TERRAINS)[number];

// ───────────────────────────── Map ─────────────────────────────

export type NodeKind = 'land' | 'sea';

/**
 * A map node is either a land province (has a control node at `center`) or a sea zone.
 * Outside-campaign land (excluded states, Antarctica) is kept as land nodes with
 * `outside: true`; they are impassable, produce nothing and score nothing.
 */
export interface MapNode {
  id: NodeId;
  /** Stable key: land "p:IDN:007", sea "s:0123", outside "x:GRL:0". */
  key: string;
  kind: NodeKind;
  name: string;
  /** Homeland country of a playable land province. null for sea and outside nodes. */
  country: CountryId | null;
  /** For outside nodes: the ISO-ish code/name of the territory as drawn on the base map. */
  territory?: { code: string; name: string; status: 'outside_campaign' | 'dependent' | 'disputed' | 'antarctica' };
  outside?: boolean;
  terrain: Terrain;
  /** Control node / label anchor [lon, lat] in degrees. */
  center: [number, number];
  /** True if the land province touches the sea (has at least one 'coast' edge). */
  coastal: boolean;
  /** Rural resource deposit, null if none. Rural resource improvements only work where non-null. */
  deposit: Resource | null;
  /** Rural population (thousands) excluding the city. */
  population: number;
  /** Approximate area (km^2). */
  areaKm2: number;
  /** City anchored in this province, if any. */
  city?: CityKey;
  /** Index into MapGeometry.shapes. */
  shape: number;
  /** Island group / landmass id: land nodes with the same value are connected by land edges. */
  landmass?: number;
  /** Sea basin id for sea nodes. */
  basin?: number;
}

export type EdgeKind =
  /** Shared land border between two land provinces. */
  | 'land'
  /** Short fixed crossing between land provinces (tunnel/bridge/narrow strait), explicitly reviewed. */
  | 'strait'
  /** Land province <-> adjacent sea zone (embark/disembark; only from coastal provinces). */
  | 'coast'
  /** Sea zone <-> sea zone. */
  | 'sea'
  /** Canal: sea<->sea passage that crosses a land province; controlled by `via` province owner. */
  | 'canal';

export interface MapEdge {
  a: NodeId;
  b: NodeId;
  kind: EdgeKind;
  /** Great-circle distance between node centers (km), possibly adjusted for routing. */
  km: number;
  /** For canals/straits: the land province whose owner controls passage. */
  via?: NodeId;
  /** Human label for reviewed crossings ("Suez Canal", "Bosporus", "Channel Tunnel"). */
  label?: string;
  /** True if this edge crosses the antimeridian. */
  wraps?: boolean;
}

export interface CityDef {
  key: CityKey;
  name: string;
  country: CountryId;
  /** [lon, lat] degrees — a city never moves when ownership changes. */
  lonlat: [number, number];
  /** Province (node) the settlement is anchored to. Filled by the map pipeline. */
  node: NodeId;
  /** Urban population (thousands). */
  population: number;
  capital: boolean;
  /** Has a harbour usable as a naval base (must be in a coastal province). */
  port: boolean;
  /** Fixed initial economic tier 1..5 → city score adds 2..6 VP (tier+1). */
  tier: 1 | 2 | 3 | 4 | 5;
}

export interface MapCountryDef {
  id: CountryId;
  name: string;
  region: RegionFilter;
  capital: CityKey;
  /** Land node ids that are this country's homeland at start. */
  provinces: NodeId[];
  /** Neighbouring playable countries by land/strait edge. */
  landNeighbors: CountryId[];
  coastal: boolean;
  landlocked: boolean;
  /** Small states need an offset label + list entry at world zoom. */
  small?: boolean;
  /** Label anchor [lon, lat]. */
  labelAt: [number, number];
}

export interface DisputedArea {
  id: string;
  name: string;
  nodes: NodeId[];
  /** Which game administration controls it at start. */
  administeredBy: CountryId | null;
  source: string;
  displayPolicy: string;
}

export interface MapData {
  version: string;
  provenance: { source: string; license: string; acquired: string; notes: string };
  nodes: MapNode[];
  edges: MapEdge[];
  cities: CityDef[];
  countries: MapCountryDef[];
  disputed: DisputedArea[];
  /** Precomputed score denominator inputs (engine recomputes and asserts). */
  stats: { landProvinces: number; seaZones: number; outsideNodes: number; cities: number };
}

/**
 * Render geometry, kept separate from MapData so the engine never loads polygons.
 * Coordinates are [lon, lat] degrees rounded to 3 decimals; rings are closed.
 * Shapes that cross the antimeridian are pre-split.
 */
export interface MapGeometry {
  version: string;
  shapes: { node: NodeId; polygons: number[][][][] /* polygon -> ring -> [lon,lat] */; bbox: [number, number, number, number] }[];
  /** Country/territory outlines for borders + base map (includes outside territories, coastlines). */
  outlines: { code: string; name: string; playable: boolean; polygons: number[][][][] }[];
}

// ───────────────────────────── Combat categories ─────────────────────────────

/** Target categories (what a unit IS for incoming fire, and what it can hit). */
export const TARGET_CLASSES = ['unarmored', 'armored', 'helicopter', 'airplane', 'ship', 'submarine', 'building'] as const;
export type TargetClass = (typeof TARGET_CLASSES)[number];

export type Domain = 'land' | 'air' | 'sea' | 'subsurface' | 'strategic';

export type UnitFamily =
  | 'infantry'
  | 'armor'
  | 'support'
  | 'air_defense'
  | 'recon'
  | 'helicopter'
  | 'fighter'
  | 'heavy'
  | 'naval'
  | 'submarine'
  | 'missile_launcher'
  | 'officer'
  | 'deployable';

export type Doctrine = 'western' | 'eastern' | 'european';

export type OrderKind =
  | 'move'
  | 'attack'
  | 'stop'
  | 'waypoints'
  | 'delay'
  | 'split'
  | 'merge'
  | 'patrol'
  | 'rebase'
  | 'embark'
  | 'disembark'
  | 'retreat'
  | 'fire_policy'
  | 'launch'
  | 'capture';

export type FirePolicy = 'hold' | 'return_fire' | 'engage';

export interface UnitLevelStats {
  level: number;
  /** Tech that grants this level (level 1 granted by unlock tech). */
  tech: TechId | null;
  hp: number;
  attack: Partial<Record<TargetClass, number>>;
  defense: Partial<Record<TargetClass, number>>;
  /** km/h on open terrain. */
  speedKmh: number;
  /** Combat range in km (0 = must share location / melee at node). */
  rangeKm: number;
  /** Visual sight radius km. */
  sightKm: number;
  /** Radar radius km (0 = none) and which domains it detects. */
  radarKm: number;
  radarDetects?: Domain[];
  /** Radar sensitivity 0..3; detects signatures <= sensitivity. */
  radarSensitivity?: number;
  /** Stealth signature 0..3 (0 = trivially detected, 3 = stealth). */
  signature: number;
  /** Air units: endurance minutes on patrol before returning. */
  enduranceMin?: number;
  /** Air units: max rebase/patrol distance km. */
  operationalRangeKm?: number;
}

export interface UnitType {
  id: UnitTypeId;
  /** Original game name, never a real platform name. */
  name: string;
  family: UnitFamily;
  domain: Domain;
  targetClass: TargetClass;
  /** Combat echelon for damage distribution: 1 = front line (takes damage first), 3 = rear. */
  echelon: 1 | 2 | 3;
  /** Can capture provinces/cities by occupying the control node. */
  capture: boolean;
  /** Mobilization cost (whole units). */
  cost: ResVec;
  /** Upkeep per game day (whole units). */
  upkeepPerDay: ResVec;
  buildHours: number;
  /** Building required in the producing city (type + min level). */
  requires: { building: BuildingTypeId; level: number }[];
  /** Tech that unlocks the blueprint. null = available from start to all. */
  unlockTech: TechId | null;
  levels: UnitLevelStats[];
  /** Terrain modifiers (multipliers; 1 = neutral). Missing terrain = 1. */
  terrain: Partial<Record<Terrain, { attack?: number; defense?: number; speed?: number; sight?: number }>>;
  orders: OrderKind[];
  /** Additional catalog features (readable names shown in the dossier). */
  features: { id: string; name: string; description: string }[];
  /** Officer: modifiers applied to eligible units in the same stack (one active per officer type). */
  officerBonus?: { appliesTo: UnitFamily[]; attackMult?: number; defenseMult?: number; speedMult?: number; hpRegenMult?: number };
  /** Carrier/transport capacity. */
  carries?: { families: UnitFamily[]; slots: number };
  /** (additive, catalog) Aircraft that may embark on a carrier's `carries` slots. Only these units use carrier slots. */
  carrierCapable?: boolean;
  /** (additive, catalog) Abstract lift units this unit adds to national lift while fielded and ready (transports). */
  liftCapacity?: number;
  /**
   * (additive, engine features pass) Air-mobile lift: how many light-infantry units this unit can carry
   * in an air-mobile hop (rotary-wing utility/transport helicopters). An infantry type with a value
   * lifts itself (organic helicopter lift). Not part of national `lift`.
   */
  airmobileCapacity?: number;
  /** Limited-use deployable (consumed on use). */
  deployable?: { uses: number; effect: string; cooldownMin: number };
  /** Symbology entity key → crosswalk (see catalog/sidc.ts). */
  symbol: SymbolEntityKey;
  doctrine?: Partial<Record<Doctrine, { costMult?: number; hpMult?: number; attackMult?: number; available?: boolean }>>;
  description: string;
}

// ───────────────────────────── Buildings ─────────────────────────────

export type BuildingScope = 'city' | 'rural';

export interface BuildingLevel {
  level: number;
  cost: ResVec;
  buildHours: number;
  upkeepPerDay: ResVec;
  /** Effects at this level (all optional). */
  effects: {
    productionMult?: number; // multiplies city/province resource output
    produces?: ResVec; // flat output per day
    manpowerPerDay?: number;
    recruitSpeedMult?: number;
    defenseMult?: number; // garrison/bunker defense multiplier at the node
    populationShield?: number; // fraction of population protected
    hpRecoveryPerDay?: number; // for units at this location
    moraleDelta?: number;
    radarKm?: number;
    radarSensitivity?: number;
    airSlots?: number;
    navalSlots?: number;
    researchSlots?: number;
    researchSpeedMult?: number;
    speedMult?: number; // logistics: unit speed in/around this node
    maintenanceSlots?: number;
    liftCapacity?: number; // abstract air/sea lift units
    missileSlots?: number;
  };
}

export interface BuildingType {
  id: BuildingTypeId;
  name: string;
  scope: BuildingScope;
  /** Requires coastal province / port city. */
  coastalOnly?: boolean;
  /** Rural improvement that only works on a province with a deposit. */
  needsDeposit?: boolean;
  unlockTech: TechId | null;
  maxLevel: number;
  levels: BuildingLevel[];
  description: string;
}

// ───────────────────────────── Research ─────────────────────────────

export type TechBranch =
  | 'land'
  | 'support'
  | 'aviation'
  | 'naval'
  | 'recon'
  | 'officer'
  | 'strategic'
  | 'industry'
  | 'mobility'
  | 'hypersonic';

export type TechLineage = 'domestic' | 'licensed' | 'common';

export interface TechNode {
  id: TechId;
  name: string;
  branch: TechBranch;
  tier: number;
  /** Earliest campaign day this can be started. */
  dayAvailable: number;
  prereqs: TechId[];
  cost: ResVec;
  hours: number;
  /** Required national research facility level (sum of research_lab levels). */
  requiresLabLevel?: number;
  effects: {
    unlockUnit?: UnitTypeId[];
    unitLevel?: { unit: UnitTypeId; level: number }[];
    unlockBuilding?: BuildingTypeId[];
    unlockMissile?: MissileTypeId[];
    /** Program step for missiles (prototype → qualified). */
    missileProgram?: { missile: MissileTypeId; stage: 'blueprint' | 'qualified' };
    /** National modifiers. */
    modifiers?: { key: string; value: number; description: string }[];
    liftCapacity?: number;
    maintenanceSlots?: number;
  };
  doctrine?: Partial<Record<Doctrine, { dayAvailable?: number; costMult?: number; hoursMult?: number; unavailable?: boolean }>>;
  description: string;
}

// ───────────────────────────── Missiles ─────────────────────────────

export type MissileFamily = 'cruise' | 'ballistic' | 'hgv' | 'hcm';
export type SpeedClass = 'subsonic' | 'supersonic' | 'hypersonic';
export type ProgramMaturity = 'prototype' | 'qualified' | 'in_production' | 'ready' | 'expended';
export type MissileOutcome = 'arrived_effect' | 'arrived_limited' | 'intercepted' | 'failed';

export interface MissileType {
  id: MissileTypeId;
  name: string;
  family: MissileFamily;
  speedClass: SpeedClass;
  /** Flight family description used in UI (e.g. "powered cruise", "boost-glide system"). */
  flightFamily: string;
  payload: 'conventional';
  /** Research needed: blueprint tech then qualification tech. */
  blueprintTech: TechId;
  qualifyTech: TechId | null;
  cost: ResVec;
  batchSize: number;
  buildHours: number;
  inventoryCeiling: number;
  /** Required launch facility / launcher unit family. */
  launchFrom: ('missile_complex' | 'missile_launcher' | 'submarine' | 'heavy' | 'naval')[];
  rangeKm: number;
  /** Flight time = baseMin + km / kmPerMin, rounded to whole minutes. */
  flight: { baseMin: number; kmPerMin: number };
  /**
   * Exclusive terminal probabilities BEFORE target defenses are applied. Must sum to 1.
   * Defense (interception) is resolved as a separate seeded draw that converts an
   * "arrived_*" outcome into "intercepted" with probability `interceptBase * defenseRating`.
   */
  outcomes: Record<MissileOutcome, number>;
  /** Base interceptability per unit of defender rating (0..1). Speed class does NOT imply better accuracy. */
  interceptBase: number;
  /** Abstract effects on arrival. */
  effect: { buildingDamage: number; unitDamage: number; moraleDelta: number; conditionDelta: number };
  /** Campaign era + provenance (fictional). */
  era: string;
  provenance: string;
  description: string;
}

// ───────────────────────────── Symbology ─────────────────────────────

/** Internal stable entity key for symbology (decoupled from SIDC). e.g. "land.infantry.motorized". */
export type SymbolEntityKey = string;

export interface SymbolCrosswalkEntry {
  key: SymbolEntityKey;
  /** APP-6 E / 2525E 20-character SIDC template string with placeholders for affiliation/status/echelon.
   * Placeholders: positions 4 (standard identity) and 7 (status) and 9-10 (echelon/amplifier) are
   * substituted at render time. Always kept as a string (leading zeroes preserved). */
  sidc: string;
  domain: Domain | 'installation' | 'contact';
  meaning: string;
}

// ───────────────────────────── Country profiles ─────────────────────────────

export type CityFunction =
  | 'industrial'
  | 'electronics'
  | 'energy'
  | 'agriculture'
  | 'mining'
  | 'finance'
  | 'research'
  | 'port'
  | 'military'
  | 'logistics'
  | 'shipbuilding'
  | 'aerospace';

export interface CityProfile {
  city: CityKey;
  functions: CityFunction[];
  /** Override map tier if the profile author decided differently. */
  tier?: 1 | 2 | 3 | 4 | 5;
  buildings: { type: BuildingTypeId; level: number }[];
  /** Base output per day before morale/status/building multipliers (whole units). */
  output: ResVec;
}

export interface ForceEntry {
  unit: UnitTypeId;
  count: number;
  /** City where the formation starts (or sea zone near a port for naval). */
  at: CityKey;
  level?: number;
  /** Starting readiness 0..100. */
  readiness?: number;
  /** Formation designation (shown in roster). */
  designation?: string;
}

export interface OpeningDecision {
  id: string;
  title: string;
  detail: string;
  /** UI destination: 'research' | 'economy' | 'cities' | 'diplomacy' | 'forces' | 'market' | 'map'. */
  screen: string;
}

export interface Personality {
  aggression: number; // 0..1
  caution: number; // 0..1
  trade: number; // 0..1 propensity to trade / seek agreements
  loyalty: number; // 0..1 keeps agreements
  expansion: number; // 0..1 territorial ambition
  research: number; // 0..1 tech focus
}

export interface CountryProfile {
  id: CountryId;
  name: string;
  region: RegionFilter;
  doctrine: Doctrine;
  /** Template the profile started from (documentation only). */
  template: string;
  startDifficulty: 'easy' | 'moderate' | 'hard';
  summary: string;
  cities: CityProfile[];
  /** Rural province buildings at start (by node key). */
  ruralBuildings?: { node: string; type: BuildingTypeId; level: number }[];
  stockpile: ResVec;
  forces: ForceEntry[];
  techs: TechId[];
  /** Techs obtained by licensed procurement (lineage 'licensed'). */
  licensed?: TechId[];
  /** Abstract lift capacity at start (air/sea transport). */
  lift: number;
  /** Maintenance slots for refits. */
  maintenanceSlots: number;
  tradeNeeds: Resource[];
  /** Two or three distinctive opening decisions. */
  openingDecisions: OpeningDecision[];
  /** Base personality; seed varies within ±0.15, clamped. */
  personality: Personality;
  /** Initial diplomatic stance toward specific countries (authored). */
  relations?: { with: CountryId; status: 'peace' | 'right_of_way' | 'shared_intel' | 'war'; trust?: number }[];
}
