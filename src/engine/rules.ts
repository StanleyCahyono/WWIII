/**
 * RULES — every tunable game constant lives here (one place, visible to UI/AI/docs).
 * All values are fictional game-balance numbers. Changing a constant changes the ruleset
 * version (`RULESET_VERSION`) so saves can record which rules they were played under.
 */
import type { Resource, Terrain } from './data-types';

export const RULESET_ID = 'world120';
export const RULESET_VERSION = '1.0.0';

// ───────────── Time ─────────────
export const STEP_MIN = 15; // fixed simulation step (game minutes)
export const DAY_MIN = 1440;
export const HOUR_MIN = 60;
/** Campaign tick 0 is day 1 at 06:00 game UTC. */
export const START_MINUTE_OF_DAY = 360;
export const START_DATE = '2031-04-01';
export const CAMPAIGN_DAYS = 180;
/** Combat rounds resolve on every whole game hour. */
export const COMBAT_ROUND_MIN = 60;

// ───────────── Scoring (World 120 rule) ─────────────
export const SCORING = {
  provinceCenter: 1,
  /** A city adds tier + cityTierOffset (tier 1..5 → 2..6). */
  cityTierOffset: 1,
  capitalBonus: 4,
  soloThreshold: 0.24,
  /** Coalition thresholds by member count. */
  coalitionThreshold: { 2: 0.4, 3: 0.48, 4: 0.55, 5: 0.6 } as Record<number, number>,
} as const;
export const COALITION_MAX_MEMBERS = 5;
export const COALITION_DEPARTURE_NOTICE_MIN = 24 * 60;

// ───────────── Territory / government ─────────────
export const TERRITORY_FACTOR = { homeland: 1, annexed: 0.5, occupied: 0.25 } as const;
export const ANNEX_COST_PER_TIER: Record<Resource, number> = {
  supplies: 0, components: 0, electronics: 0, fuel: 0, rare: 0, manpower: 0, money: 400,
};
export const ANNEX_BASE_COST: Partial<Record<Resource, number>> = { money: 600, supplies: 200 };
export const ANNEX_HOURS = 24;
export const MORALE = {
  baseHomeland: 75,
  occupiedPenalty: -30,
  annexedPenalty: -12,
  warPenaltyPerEnemy: -3,
  warPenaltyCap: -12,
  shortagePenalty: -10,
  distancePer1000Km: -2,
  distanceCap: -12,
  hostileNeighborEach: -3,
  hostileNeighborCap: -12,
  populationLossPer1Pct: -2,
  populationLossCap: -15,
  capitalBonus: 5,
  dailyStep: 5,
  /** output multiplier = moraleFloorFactor + (1 - moraleFloorFactor) * morale/100 */
  moraleFloorFactor: 0.4,
} as const;
/** Revolt check at day change: probability per band (morale strictly below `below`). */
export const REVOLT_BANDS: { below: number; p: number }[] = [
  { below: 15, p: 0.3 },
  { below: 25, p: 0.15 },
  { below: 33, p: 0.06 },
];
/** Rebel strength (attack points vs garrison) by city tier; per tier. */
export const REBEL_STRENGTH_PER_TIER = 6;
export const POP_GROWTH_PER_DAY = 0.001; // 0.1%/day when morale >= 50
export const POP_DECLINE_PER_DAY = 0.002; // when morale < 25
export const CAPTURE_CONDITION_LOSS = 10; // building condition lost on capture
export const OCCUPATION_UPKEEP_PER_TIER: Partial<Record<Resource, number>> = { money: 20, supplies: 10 };

// ───────────── Economy ─────────────
/** Rural deposit output per day (whole units) before modifiers. */
export const RURAL_DEPOSIT_OUTPUT = 40;
/** Manpower per day per 1,000 (thousand) population in a city (+ rural provinces). */
export const MANPOWER_PER_KPOP = 0.02;
export const MONEY_PER_KPOP = 0.05;
export const LEDGER_DAYS_KEPT = 14;
/** Essential resources for shortage morale/readiness effects + economic resilience. */
export const ESSENTIAL: Resource[] = ['supplies', 'fuel', 'components'];

// ───────────── Production ─────────────
export const CITY_QUEUE_MAX = 6;
/** Concurrency per city: one construction + one mobilization at the same time. */
export const CITY_CONCURRENCY = { construct: 1, mobilize: 1 } as const;
/** Cancel refund: queued (not started) = 100 %; active = remaining fraction × this. */
export const ACTIVE_JOB_REFUND_FACTOR = 0.75;
export const RESEARCH_BASE_SLOTS = 2;
export const RESEARCH_CANCEL_REFUND_FACTOR = 0.8;
export const MISSILE_BASE_SLOTS = 1;
export const DEMOLISH_REFUND_FACTOR = 0.25;

// ───────────── Movement ─────────────
export const EMBARKED_SPEED_KMH = 18;
/** Embark/disembark time penalty (minutes) added to coast edges. */
export const EMBARK_MIN = 120;
export const DEFAULT_LAND_SPEED_KMH = 30;
export const REVALIDATE_EVERY_STEP = true;
export const PATH_MAX_EXPANSIONS = 20000;

// ───────────── Combat ─────────────
export const ROUND_DAMAGE_FACTOR = 0.45;
export const OVERSTACK_LIMIT = 10;
export const OVERSTACK_PENALTY_PER_UNIT = 0.04;
export const OVERSTACK_MIN_EFFICIENCY = 0.5;
export const ENTRENCH_AFTER_MIN = 120;
export const ENTRENCH_DEFENSE_MULT = 1.25;
export const VARIANCE = 0.1; // ± seeded variance per round
export const READINESS_STRENGTH_FLOOR = 0.5; // strength mult at 0 readiness
export const REFIT_STRENGTH_MULT = 0.5;
export const RETREAT_HP_COST = 0.1; // fraction of current HP
export const ECHELON_ORDER = [1, 2, 3] as const;
export const COMBAT_READINESS_LOSS = 2; // per round fought
export const CAPTURE_REQUIRES_NO_DEFENDERS = true;

// ───────────── Readiness / maintenance ─────────────
export const READINESS_RECOVERY_PER_DAY = 10;
export const READINESS_LOSS_OUT_OF_SUPPLY_PER_DAY = 8;
export const READINESS_LOSS_SHORTAGE_PER_DAY = 6;
export const READY_THRESHOLD = 70;
export const HP_REGEN_PER_DAY = 0.05; // fraction of max in supplied friendly node
export const REFIT_HP_REGEN_PER_DAY = 0.2;
export const REFIT_READINESS_PER_DAY = 20;
export const BASE_MAINTENANCE_SLOTS = 2;

// ───────────── Air ─────────────
export const DEFAULT_ENDURANCE_MIN = 240;
export const DEFAULT_OPERATIONAL_RANGE_KM = 1500;
export const REFUEL_MIN = 60;
export const DEFAULT_PATROL_RADIUS_KM = 150;
/** Aircraft whose base city condition falls below this are grounded / cannot land. */
export const BASE_DISABLED_CONDITION = 25;
/** Every owned city acts as an airstrip with this many slots by tier (plus airSlots buildings). */
export const CITY_AIR_SLOTS_BY_TIER = [0, 2, 3, 4, 6, 8];
export const AIR_LOSS_RULE = 'no legal base within remaining range → aircraft lost (crash) with event';

// ───────────── Visibility ─────────────
export const CITY_SIGHT_KM = 80;
export const TERRITORY_SIGHT = true; // stacks at nodes you own are visually observed
export const IDENTIFY_FRACTION = 0.5; // visual within this fraction of sight radius identifies
export const STALE_KEEP_MIN = 24 * 60;
export const STEALTH_VISUAL_FRACTION = 0.34; // signature 3 seen visually only within this fraction
export const INTEL_REPORT_TTL_MIN = 24 * 60;
export const INTEL_REPORT_COST: Partial<Record<Resource, number>> = { money: 150 };
export const SPATIAL_BIN_DEG = 3;
/** Observation tables are recomputed on this cadence (minutes) and after relation changes. */
export const VISIBILITY_INTERVAL_MIN = 30;

// ───────────── Intel agents ─────────────
export const AGENT_COST: Partial<Record<Resource, number>> = { money: 200 };
export const AGENT_REPORT_INTERVAL_MIN = 12 * 60;
export const AGENT_SUCCESS: Record<'information' | 'sabotage' | 'corruption', number> = {
  information: 0.8,
  sabotage: 0.45,
  corruption: 0.55,
};
export const SABOTAGE_CONDITION_DAMAGE = 15;
export const CORRUPTION_DRAIN_MONEY = 120;
export const MAX_AGENTS = 4;

// ───────────── Diplomacy ─────────────
export const OFFER_DEFAULT_EXPIRY_MIN = 48 * 60;
export const OFFER_EFFECT_DELAY_MIN = 60;
export const TRUST = {
  min: -100,
  max: 100,
  initialVariation: 10,
  decayPerDay: 0.05, // fraction toward 0
  acceptedAgreement: 6,
  fulfilledAgreement: 3,
  brokenAgreement: -15,
  borderIncident: -20,
  warDeclared: -50,
  attacked: -10,
  declinedOffer: -1,
  materialShift: 10,
  historyKept: 40,
} as const;
export const MAX_PENDING_OFFERS_PER_PAIR = 2;
/** A grant revoked within this window after acceptance counts as a broken agreement. */
export const AGREEMENT_FULFILLED_AFTER_MIN = 7 * DAY_MIN;

// ───────────── Market ─────────────
export const MARKET_MAX_OPEN_PER_COUNTRY = 24;
export const MARKET_MAX_PRICE = 1_000_000; // milli-money per unit
/** Execution happens at the RESTING order's price (price improvement goes to the aggressor). */
export const MARKET_EXECUTION = 'resting_price' as const;

// ───────────── Missiles ─────────────
export const MISSILE_INTERCEPT_CAP = 0.9;
export const AD_COVER_KM = 250;
export const AD_RATING_PER_UNIT_LEVEL = 0.15;
export const AD_BUILDING_RATING = 0.1; // per radar/defense building level at target

// ───────────── AI scheduler ─────────────
export const AI_INTERVALS_MIN = { strategic: 24 * 60, economic: 6 * 60, diplomatic: 12 * 60, operational: 2 * 60 } as const;
/** Max controller invocations per step (all countries); unspent wakes roll to next step. */
export const AI_CALLS_PER_STEP = 60;
/** Max commands a controller may submit per review. */
export const AI_COMMANDS_PER_REVIEW: Record<'easy' | 'normal' | 'hard', number> = { easy: 4, normal: 8, hard: 14 };

// ───────────── Opening power index ─────────────
export const OPENING_POWER = {
  weights: { industrial: 0.25, formations: 0.25, research: 0.2, mobility: 0.2, resilience: 0.1 },
  researchHorizonDays: 30,
  researchSlotValuePerDay: 400,
  mobilityHorizonDays: 30,
  liftValue: 1500,
  maintenanceSlotValue: 2500,
  replenishmentValuePerManpower: 1,
  resilienceDays: 30,
  resilienceCap: 1, // coverage fraction capped at 1 (= resilienceDays of essential inputs)
} as const;

// ───────────── Career ─────────────
export const CAREER_XP = { capture: 50, unitDefeated: 10, jobCompleted: 5, research: 15, victory: 500 } as const;

// ───────────── Terrain defaults (used when catalog omits) ─────────────
export const TERRAIN_DEFENSE: Record<Terrain, number> = {
  open: 1,
  mountains: 1.5,
  forest: 1.25,
  urban: 1.4,
  suburban: 1.2,
  jungle: 1.3,
  tundra: 1.1,
  desert: 1,
  high_seas: 1,
  coastal_waters: 1,
};
export const TERRAIN_SPEED: Record<Terrain, number> = {
  open: 1,
  mountains: 0.5,
  forest: 0.75,
  urban: 0.8,
  suburban: 0.9,
  jungle: 0.6,
  tundra: 0.7,
  desert: 0.85,
  high_seas: 1,
  coastal_waters: 1,
};

export const RULES = {
  RULESET_ID,
  RULESET_VERSION,
  STEP_MIN,
  DAY_MIN,
  START_MINUTE_OF_DAY,
  START_DATE,
  CAMPAIGN_DAYS,
  COMBAT_ROUND_MIN,
  SCORING,
  COALITION_MAX_MEMBERS,
  COALITION_DEPARTURE_NOTICE_MIN,
  TERRITORY_FACTOR,
  REVOLT_BANDS,
  MORALE,
  OFFER_EFFECT_DELAY_MIN,
  OFFER_DEFAULT_EXPIRY_MIN,
  ACTIVE_JOB_REFUND_FACTOR,
  RESEARCH_CANCEL_REFUND_FACTOR,
  RESEARCH_BASE_SLOTS,
  CITY_CONCURRENCY,
  OVERSTACK_LIMIT,
  MARKET_EXECUTION,
  AIR_LOSS_RULE,
  OPENING_POWER,
} as const;
