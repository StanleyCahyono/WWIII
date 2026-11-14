/**
 * RUNTIME CAMPAIGN STATE — plain JSON-serializable data. No class instances, Maps, Sets,
 * functions, Infinity or NaN. All resource quantities are integer milli-units (see fixed.ts).
 * All times are integer game minutes since campaign start ("tick").
 */
import type {
  BuildingTypeId,
  CityKey,
  CountryId,
  Doctrine,
  Domain,
  FirePolicy,
  MissileOutcome,
  MissileTypeId,
  NodeId,
  Personality,
  ProgramMaturity,
  Resource,
  TechId,
  UnitTypeId,
  CityFunction,
} from './data-types';
import type { ResM } from './fixed';

/** v2: `blockades` section, optional offer haggling fields, optional air-mobile order marker. */
export const SCHEMA_VERSION = 2;

export type Difficulty = 'easy' | 'normal' | 'hard';
export type TerritoryStatus = 'homeland' | 'occupied' | 'annexed';
export type DiploLevel = 'peace' | 'right_of_way' | 'shared_intel';
/** The four documented statuses (per direction). */
export type DiploStatus = 'war' | DiploLevel;

// ───────────────────────────── Map control ─────────────────────────────

export interface BuildingInstance {
  type: BuildingTypeId;
  level: number;
  /** 0..100 operating condition. */
  condition: number;
}

export interface ProvinceState {
  node: NodeId;
  homeland: CountryId | null;
  /** Current owner; null when rebel-controlled or outside campaign. */
  owner: CountryId | null;
  /** Map control flag — rebels are a control state, never a diplomatic seat. */
  control: 'country' | 'rebel' | 'outside';
  status: TerritoryStatus;
  /** Rural population (thousands). */
  population: number;
  morale: number;
  buildings: BuildingInstance[];
  /** Tick ownership last changed. */
  changedAt: number;
}

export interface MoraleFactor {
  key: string;
  label: string;
  value: number;
}

export interface CityState {
  key: CityKey;
  node: NodeId;
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  /** Original capital flag (a capital stays a capital for scoring whoever holds it). */
  capital: boolean;
  port: boolean;
  functions: CityFunction[];
  /** Urban population (thousands) — mutable economic population; distinct from fixed VP tier. */
  population: number;
  populationStart: number;
  /** Population lost recently (thousands) — decays daily; feeds morale. */
  recentLosses: number;
  morale: number;
  targetMorale: number;
  moraleFactors: MoraleFactor[];
  /** 0..100 city condition (damage from bombardment/missiles/sabotage). */
  condition: number;
  buildings: BuildingInstance[];
  /** Base output per day (milli) before buildings/morale/condition/status. */
  baseOutput: ResM;
  rally: NodeId | null;
  /** Shortage flag set by last economy pass (feeds morale). */
  shortage: boolean;
}

// ───────────────────────────── Forces ─────────────────────────────

export interface Unit {
  id: string;
  type: UnitTypeId;
  level: number;
  /** Hit points in hundredths. */
  hp: number;
  maxHp: number;
  /** 0..100 */
  readiness: number;
  kills: number;
  /** Remaining uses for deployables. */
  uses?: number;
  cooldownUntil?: number;
}

export type MoveClass = 'ground' | 'naval' | 'air';
export type MoveMode = 'land' | 'embarked' | 'naval' | 'air';

export type StackPos =
  | { kind: 'node'; node: NodeId }
  | { kind: 'edge'; from: NodeId; to: NodeId; edge: number; progress: number; length: number }
  | { kind: 'air'; from: [number, number]; to: [number, number]; depart: number; arrive: number };

export interface RouteSegment {
  from: NodeId;
  to: NodeId;
  edge: number;
  mode: MoveMode;
}

export interface MoveOrder {
  kind: 'move';
  /** Remaining segments (first = current or next edge). */
  route: RouteSegment[];
  dest: NodeId;
  waypoints: NodeId[];
  /** Countries whose territory the issuer explicitly accepted entering as an act of war. */
  warConfirmed: CountryId[];
  attack?: { targetStack?: string; targetNode?: NodeId };
  retreat?: boolean;
  issuedAt: number;
  /** (additive, v2) Air-mobile lift in flight: the stack is in an `air` position until it lands at `dest`. */
  airmobile?: { from: NodeId; launchedAt: number; arriveAt: number; km: number };
}
export interface AttackOrder {
  kind: 'attack';
  targetStack: string | null;
  targetNode: NodeId | null;
  warConfirmed: CountryId[];
  issuedAt: number;
}
export type StackOrder = MoveOrder | AttackOrder;

export type AirState = 'landed' | 'outbound' | 'on_station' | 'returning' | 'refueling' | 'rebasing';
export interface AirInfo {
  /** Home base: a land node (airstrip) or a carrier stack id. */
  home: { node: NodeId } | { stack: string };
  state: AirState;
  airborneSince: number | null;
  refuelUntil: number | null;
  patrol: { center: [number, number]; node: NodeId | null; radiusKm: number; until: number } | null;
  /** Destination of current flight (for rebasing/returning). */
  dest: { node: NodeId } | { stack: string } | null;
  grounded: boolean;
}

export interface Stack {
  id: string;
  owner: CountryId;
  name: string;
  units: Unit[];
  pos: StackPos;
  moveClass: MoveClass;
  mode: MoveMode;
  order: StackOrder | null;
  firePolicy: FirePolicy;
  /** Tick it became stationary at its current node (entrenchment). */
  stationarySince: number;
  delayUntil: number | null;
  air: AirInfo | null;
  /** Aboard a carrier stack (air units only). */
  aboard: string | null;
  refit: boolean;
  supply: 'supplied' | 'limited' | 'out';
  engagement: string | null;
  createdAt: number;
  /** Last tick this stack fought (any round). */
  lastCombatAt: number | null;
}

export interface Engagement {
  id: string;
  /** Node where it happens (or anchor node for air/ranged). */
  node: NodeId;
  kind: 'node' | 'ranged' | 'air';
  startedAt: number;
  lastRoundAt: number;
  rounds: number;
  /** stackIds per country (every stack that ever took part). */
  participants: Record<CountryId, string[]>;
  /** Unit losses per country (count). */
  losses: Record<CountryId, number>;
  damage: Record<CountryId, number>;
  /** Who used attack vs defense tables. */
  tables: Record<CountryId, 'attack' | 'defense'>;
  open: boolean;
  closedAt: number | null;
  outcome: string | null;
}

// ───────────────────────────── Economy / production ─────────────────────────────

export type LedgerCategory =
  | 'production'
  | 'upkeep'
  | 'occupation'
  | 'construction'
  | 'recruitment'
  | 'research'
  | 'missile_production'
  | 'market_escrow'
  | 'market_fill'
  | 'refund'
  | 'loot'
  | 'corruption'
  | 'treaty_transfer'
  | 'intel'
  | 'annex'
  | 'operations'
  | 'initial';

export interface LedgerDay {
  day: number;
  cats: Partial<Record<LedgerCategory, ResM>>;
}
export interface Ledger {
  initial: ResM;
  totals: Partial<Record<LedgerCategory, ResM>>;
  days: LedgerDay[];
  /** Shortfalls (unpaid upkeep) per resource, cumulative, for display. */
  unpaid: ResM;
}

export type JobKind = 'construct' | 'mobilize' | 'annex' | 'missile';
export interface Job {
  id: string;
  kind: JobKind;
  country: CountryId;
  /** City where the job runs (null for rural/missile jobs anchored to a node or the nation). */
  city: CityKey | null;
  node: NodeId;
  building?: BuildingTypeId;
  level?: number;
  unit?: UnitTypeId;
  missile?: MissileTypeId;
  batch?: number;
  /** Charged at enqueue (milli). */
  cost: ResM;
  durationMin: number;
  enqueuedAt: number;
  startedAt: number | null;
  endsAt: number | null;
  slot: 'construct' | 'mobilize' | 'missile';
  reason?: string;
}

export interface ActiveResearch {
  tech: TechId;
  startedAt: number;
  endsAt: number;
  cost: ResM;
  durationMin: number;
}

export interface MissileInventory {
  maturity: ProgramMaturity;
  ready: number;
  expended: number;
  produced: number;
  launched: number;
}

export interface CountryState {
  id: CountryId;
  name: string;
  doctrine: Doctrine;
  controller: 'human' | 'ai';
  alive: boolean;
  capitalCity: CityKey | null;
  /** Spendable stock (milli). On-hand = stock + escrow. */
  stock: ResM;
  /** Market escrow held for open orders (milli). */
  escrow: ResM;
  ledger: Ledger;
  techs: Record<TechId, { at: number; lineage: 'domestic' | 'licensed' | 'common' }>;
  research: ActiveResearch[];
  /** Highest researched level per unit type (default 1 when unlocked). */
  unitLevels: Record<UnitTypeId, number>;
  missiles: Record<MissileTypeId, MissileInventory>;
  jobs: Job[];
  lift: number;
  maintenanceSlots: number;
  personality: Personality;
  /** Recent command nonces (idempotency for double submits). */
  nonces: { nonce: string; at: number; result: string }[];
  /** Counters for AI activity / decisions. */
  stats: { accepted: Record<string, number>; rejected: Record<string, number> };
  eliminatedAt: number | null;
  modifiers: Record<string, number>;
  /** Resources with unpaid upkeep in the last economy hour. */
  shortages: Resource[];
}

// ───────────────────────────── Diplomacy / coalitions ─────────────────────────────

export interface PairRelation {
  war: boolean;
  since: number;
  /** Bumped on every change — offers created against an older version are stale. */
  version: number;
  warDeclaredBy: CountryId | null;
}
export interface Grant {
  level: DiploLevel;
  since: number;
}
export interface TrustEntry {
  at: number;
  kind: string;
  delta: number;
  reason: string;
}
export interface TrustState {
  value: number;
  history: TrustEntry[];
}

export type OfferTerm =
  | { kind: 'status'; level: DiploLevel }
  | { kind: 'peace' }
  | { kind: 'coalition_invite'; coalition: string }
  | { kind: 'resource'; resource: Resource; amount: number /* milli */ }
  /** (additive, v2) Cession of a province (and the city at its control node) by the giver — peace settlements only. */
  | { kind: 'territory'; node: NodeId };

export interface Offer {
  id: string;
  from: CountryId;
  to: CountryId;
  /** What `from` gives to `to`. */
  give: OfferTerm[];
  /** What `from` asks from `to`. */
  receive: OfferTerm[];
  createdAt: number;
  expiresAt: number;
  effectiveDelayMin: number;
  relationVersion: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'void' | 'withdrawn';
  resolvedAt: number | null;
  effectiveAt: number | null;
  applied: boolean;
  reason: string | null;
  responseReason: string | null;
  /** (additive, v2) Haggling: the offer this one counters (the countered offer is declined). */
  counterOf?: string | null;
  /** (additive, v2) Negotiation round (1 = opening offer; a counter is previous round + 1). */
  round?: number;
}

/** (v2) A port city under blockade: hostile warships in an adjacent sea zone and no friendly naval presence. */
export interface BlockadeState {
  since: number;
  /** Countries whose warships enforce it (internal; the victim's view does not name them). */
  by: CountryId[];
  /** Adjacent sea zones held by the blockaders. */
  zones: NodeId[];
}

export interface Coalition {
  id: string;
  name: string;
  description: string;
  emblem: string;
  leader: CountryId;
  members: { country: CountryId; joinedAt: number }[];
  applications: { country: CountryId; at: number }[];
  departures: { country: CountryId; announcedAt: number; effectiveAt: number }[];
  history: { country: CountryId; joinedAt: number; leftAt: number | null; reason?: string }[];
  createdAt: number;
  dissolvedAt: number | null;
}

export interface Message {
  id: string;
  at: number;
  from: CountryId;
  thread: string; // `dm:A|B` or `co:<coalitionId>`
  to: CountryId | null;
  text: string;
  intent: string | null;
  reason: string | null;
  offer: string | null;
}

// ───────────────────────────── Market ─────────────────────────────

export interface MarketFill {
  id: string;
  at: number;
  resource: Resource;
  qty: number; // whole units
  price: number; // milli-money per unit
  buyer: CountryId;
  seller: CountryId;
  buyOrder: string;
  sellOrder: string;
}
export interface MarketOrder {
  id: string;
  seq: number;
  country: CountryId;
  side: 'buy' | 'sell';
  resource: Resource;
  /** Whole units ordered. */
  qty: number;
  filled: number;
  /** Limit price, milli-money per unit. */
  price: number;
  createdAt: number;
  status: 'open' | 'filled' | 'cancelled';
  /** Escrow still held for this order (milli of money for buys, milli of resource for sells). */
  escrow: number;
  cancelledQty: number;
  closedAt: number | null;
}

// ───────────────────────────── Missiles ─────────────────────────────

export interface MissileLaunch {
  id: string;
  country: CountryId;
  missile: MissileTypeId;
  fromNode: NodeId;
  fromStack: string | null;
  target: NodeId;
  targetOwner: CountryId | null;
  launchedAt: number;
  arriveAt: number;
  resolved: boolean;
  outcome: MissileOutcome | null;
  /** Draws used, for audit. */
  draws: { outcome: number; defense: number | null } | null;
  defenseRating: number | null;
  /** What each involved side knows. */
  knowledge: Record<CountryId, MissileOutcome | 'effect_unconfirmed' | 'in_flight' | 'incoming'>;
}

// ───────────────────────────── Visibility / intel ─────────────────────────────

export type ContactLevel = 'contact' | 'unidentified' | 'identified' | 'stale';
export interface Contact {
  /** Opaque per-viewer contact id (never the real stack id). */
  id: string;
  /** Hidden internal link (never projected into views). */
  stack: string;
  level: ContactLevel;
  /** Best level while current. */
  domain: Domain | 'land';
  lonlat: [number, number];
  node: NodeId | null;
  observedAt: number;
  firstSeenAt: number;
  /** Visible fields — only filled when justified by the observation. */
  owner: CountryId | null;
  /** Detected member count (only for identified/unidentified). */
  count: number | null;
  /** Unit types observed (identified only). */
  /** `i` = index in the observed stack (internal; never projected into views). */
  units: { type: UnitTypeId; hpPct: number; i?: number }[] | null;
  sources: string[];
}

export interface IntelReport {
  id: string;
  country: CountryId;
  source: 'purchase' | 'agent' | 'shared';
  createdAt: number;
  observedAt: number;
  expiresAt: number;
  targetNode: NodeId;
  /** Frozen snapshot: positions pinned to observed coordinates. */
  stacks: {
    ref: string; // opaque
    owner: CountryId;
    lonlat: [number, number];
    node: NodeId | null;
    units: { type: UnitTypeId; count: number }[];
    destination: NodeId | null;
  }[];
  city: { key: CityKey; morale: number; buildings: BuildingInstance[]; condition: number } | null;
  confidence: number;
}

export interface Agent {
  id: string;
  country: CountryId;
  targetCity: CityKey;
  mission: 'information' | 'sabotage' | 'corruption';
  assignedAt: number;
  nextReportAt: number;
  reports: number;
  active: boolean;
}

// ───────────────────────────── Events / news ─────────────────────────────

export type EventCategory = 'economy' | 'research' | 'diplomacy' | 'combat' | 'intel' | 'government' | 'system';
export interface GameEvent {
  id: string;
  at: number;
  kind: string;
  category: EventCategory;
  node: NodeId | null;
  /** Public projection (newspaper). null = private only. */
  public: { headline: string; countries: CountryId[] } | null;
  /** Per-recipient private projection (journal). Only authorized fields. */
  private: Record<CountryId, { text: string; data?: Record<string, string | number | boolean | null> }>;
  /** Interrupt-worthy for these recipients. */
  interrupt: CountryId[];
  /** Routine completion — bundled into the daily digest. */
  routine: boolean;
}

export interface Article {
  id: string;
  at: number;
  day: number;
  author: CountryId;
  anonymous: boolean;
  headline: string;
  body: string;
}

// ───────────────────────────── Scoring ─────────────────────────────

export interface ScoreEntry {
  /** Country id or coalition id. */
  id: string;
  kind: 'solo' | 'coalition';
  members: CountryId[];
  score: number;
  threshold: number;
  fraction: number;
  capitals: number;
  industry: number;
}
export interface ScoreSettlement {
  day: number;
  at: number;
  scores: Record<CountryId, number>;
  entries: ScoreEntry[];
}
export interface CampaignResult {
  at: number;
  day: number;
  reason: 'threshold' | 'final_day';
  winner: ScoreEntry;
  standings: ScoreEntry[];
}

// ───────────────────────────── Scheduler ─────────────────────────────

export interface ScheduledEvent {
  seq: number;
  at: number;
  /** Priority class within the same minute (lower first). */
  cls: number;
  kind:
    | 'research_done'
    | 'job_done'
    | 'missile_arrive'
    | 'offer_expire'
    | 'offer_effect'
    | 'coalition_depart'
    | 'agent_report'
    | 'report_expire';
  ref: string;
  country: CountryId | null;
}

// ───────────────────────────── AI ─────────────────────────────

export type ReviewKind = 'strategic' | 'economic' | 'diplomatic' | 'operational';
export interface AiSchedule {
  next: Record<ReviewKind, number>;
  wake: string[];
  lastRunAt: number | null;
  runs: number;
}

// ───────────────────────────── Opening power ─────────────────────────────

export interface OpeningPowerDims {
  industrial: number;
  formations: number;
  research: number;
  mobility: number;
  resilience: number;
}
export interface OpeningPowerResult {
  computedAt: 'creation';
  weights: OpeningPowerDims;
  constants: Record<string, number>;
  /** Highest non-U.S. raw value per dimension (normalization constants). */
  normalization: OpeningPowerDims;
  raw: Record<CountryId, OpeningPowerDims>;
  composite: Record<CountryId, number>;
  rank: CountryId[];
  rescale: number;
  leader: CountryId;
  nearestRival: CountryId | null;
  referenceCountry: CountryId;
}

// ───────────────────────────── UI-private section ─────────────────────────────

export interface PlanningDrawing {
  id: string;
  author: CountryId;
  kind: 'phase_line' | 'area' | 'route' | 'objective' | 'label' | 'bookmark';
  name: string;
  points: [number, number][];
  hidden: boolean;
  createdAt: number;
  expiresAt: number | null;
  note?: string;
}
/** Stored in the save but EXCLUDED from stateHash; never read by the simulation. */
export interface UiSection {
  planning: PlanningDrawing[];
  prefs: Record<string, string | number | boolean>;
  nextDrawingId: number;
}

// ───────────────────────────── Root ─────────────────────────────

export interface GameState {
  schemaVersion: number;
  scenarioId: string;
  scenarioVersion: string;
  rulesetVersion: string;
  seed: number;
  meta: {
    saveRevision: number;
    difficulty: Difficulty;
    humanCountry: CountryId | null;
    startDate: string;
    mode: 'world120' | 'fixture';
    humanRun: 'active' | 'concluded' | 'observer';
  };
  /** lastVisibility: tick of the most recent observation refresh (current contacts are observed then). */
  clock: { tick: number; lastStep: number; lastVisibility?: number };
  rng: { seed: number; counter: number };
  ids: Record<string, number>;
  countryOrder: CountryId[];
  countries: Record<CountryId, CountryState>;
  /** Indexed by NodeId; null for sea nodes. */
  provinces: (ProvinceState | null)[];
  cities: Record<CityKey, CityState>;
  stacks: Record<string, Stack>;
  engagements: Record<string, Engagement>;
  queue: ScheduledEvent[];
  relations: Record<string, PairRelation>;
  grants: Record<string, Grant>;
  trust: Record<string, TrustState>;
  offers: Record<string, Offer>;
  coalitions: Record<string, Coalition>;
  messages: Record<string, Message[]>;
  market: { orders: Record<string, MarketOrder>; fills: MarketFill[]; seq: number; lastPrice: Partial<Record<Resource, number>> };
  launches: Record<string, MissileLaunch>;
  /** (v2) Port blockades by city key, refreshed every game hour before the economy. */
  blockades: Record<CityKey, BlockadeState>;
  contacts: Record<CountryId, Record<string, Contact>>;
  reports: Record<string, IntelReport>;
  agents: Record<string, Agent>;
  events: GameEvent[];
  articles: Article[];
  score: { denominator: number; history: ScoreSettlement[]; result: CampaignResult | null; lastSettledDay: number };
  career: { xp: number; entries: { event: string; kind: string; xp: number; at: number }[] };
  ai: { memory: Record<CountryId, unknown>; schedule: Record<CountryId, AiSchedule>; rr: number; calls: number; wakeCursor: number };
  openingPower: OpeningPowerResult | null;
  ui: UiSection;
}
