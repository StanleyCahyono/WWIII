/**
 * AI planner types — persisted strategic memory (JSON, saved by the engine in state.ai.memory),
 * difficulty profiles and decision records. Everything here is plain JSON.
 */
import type { CountryId, NodeId, Resource } from '../engine/data-types';

export type AiDifficulty = 'easy' | 'normal' | 'hard';
export type Geography = 'landlocked' | 'maritime' | 'coastal';
export type Layer = 'strategic' | 'economic' | 'diplomatic' | 'operational' | 'reply';

/** Planning effort by difficulty. No resource handicap at any level (see docs/AI.md). */
export interface DifficultyProfile {
  /** Max route previews (A* pathfinding) per operational review. */
  pathBudget: number;
  /** Strategic re-plan interval in game days (objective re-targeting cadence). */
  strategicEveryDays: number;
  /** Lookahead (hours) used for economic forecasts / shortage prediction. */
  forecastHours: number;
  /** Required local force ratio before an attack is ordered. */
  attackRatio: number;
  /** Whether wake triggers (war declared, territory change) cause an immediate operational replan. */
  reactToWakes: boolean;
  /** Intel spending enabled (reports/agents) when uncertainty is high. */
  intel: boolean;
  /** Max candidate targets scored per strategic pass. */
  targetCandidates: number;
  /** Concentrate forces (merge co-located stacks before an attack). */
  concentrate: boolean;
}

export const DIFFICULTY: Record<AiDifficulty, DifficultyProfile> = {
  easy: { pathBudget: 2, strategicEveryDays: 2, forecastHours: 24, attackRatio: 1.6, reactToWakes: false, intel: false, targetCandidates: 3, concentrate: false },
  normal: { pathBudget: 4, strategicEveryDays: 1, forecastHours: 48, attackRatio: 1.3, reactToWakes: true, intel: true, targetCandidates: 6, concentrate: true },
  hard: { pathBudget: 8, strategicEveryDays: 1, forecastHours: 72, attackRatio: 1.15, reactToWakes: true, intel: true, targetCandidates: 10, concentrate: true },
};

export interface Objective {
  target: CountryId | null;
  node: NodeId | null;
  value: number;
  reason: string;
  setAt: number;
  /** Commitment window: no re-target before this tick unless a trigger fires. */
  commitUntil: number;
  /** Snapshot used to detect re-target triggers. */
  ports: number;
  grants: number;
  observedAt: number;
}

export interface Procurement {
  missile: string;
  status: 'proposed' | 'ordered' | 'cancelled';
  proposedAt: number;
  /** Trade-position index when proposed (coverage of the missile's inputs, days). */
  tradeIndex: number;
  value: number;
  altValue: number;
  job?: string;
  reason: string;
}

export interface OfferDecision {
  offer: string;
  from: CountryId;
  accept: boolean;
  reason: string;
  score: number;
  at: number;
}

export interface AiMemory {
  v: 1;
  /** Seeded per-country variation (drawn once from the ctx RNG). */
  jitter: number;
  geography: Geography | null;
  lastStrategic: number;
  /** Strategic plan summary (re-derived each strategic pass). */
  plan: {
    researchFocus: string[];
    shortages: Resource[];
    garrison: number;
    stance: 'expand' | 'defend' | 'consolidate';
    hypersonic: boolean;
  };
  objective: Objective | null;
  /** Decaying memory of hostile acts (per counterpart) and favours. */
  grievance: Record<CountryId, number>;
  favour: Record<CountryId, number>;
  /** Proposal cooldowns: key `${to}:${kind}` → tick when a repeat is allowed. */
  cooldown: Record<string, number>;
  /** Offers answered (decision metadata used for reply text; bounded). */
  decisions: OfferDecision[];
  /** Pending intel requests: node + tick; resolved when a report arrives. */
  intel: { node: NodeId; country: CountryId; at: number; reportSeen?: boolean }[];
  procurement: Procurement | null;
  /** Diplomacy attempted before considering war (small-state rule). */
  soughtDiplomacy: number;
  /** Last journal event id processed (numeric part). */
  journalCursor: number;
  /** Useful decisions by command type (submitted & previewed ok). */
  counters: Record<string, number>;
  /** Consecutive economic reviews without a single command. */
  idleEconomic: number;
  /** Stack tasks to avoid oscillation: stack → { dest, until }. */
  tasks: Record<string, { dest: NodeId; until: number; kind: string }>;
  /** Replies to human/bot operation requests already handled (message ids). */
  handledMessages: string[];
  warStartedAt: Record<CountryId, number>;
  /** Current coalition and when we joined (commitment window for the leave rules). */
  coalition: { id: string; since: number } | null;
  capitalsLost: number;
  lastOperational?: number;
}

export interface DecisionEntry {
  tick: number;
  layer: Layer;
  kind: string;
  detail: string;
  reason: string;
  /** Command type issued (if any). */
  command?: string;
}
