/**
 * Message protocol between the UI sim host (main thread) and the simulation worker.
 * Everything crossing this boundary is structured-clone safe plain data.
 */
import type { Command, CountryView, Difficulty, PlanningDrawing } from '../../engine/index';

export type ViewNoRules = Omit<CountryView, 'rules'> & {
  /** Bilateral diplomacy thread key per counterpart, from the engine's `threadFor(viewer, c)`. */
  threadKeys: Record<string, string>;
};

export interface FrameMeta {
  campaignId: string | null;
  campaignName: string;
  seed: number;
  difficulty: Difficulty;
  humanCountry: string | null;
  startDate: string;
  saveRevision: number;
  scenarioVersion: string;
  formatVersion: number;
  reviewMode: boolean;
  readOnly: boolean;
}

export interface ClockState {
  paused: boolean;
  /** Requested speed multiplier (1× = SPEED_BASE game minutes per real second). */
  speed: number;
  /** Measured game minutes per real second over the last second (0 when paused). */
  effective: number;
  /** True when the worker cannot keep up with the requested speed. */
  behind: boolean;
}

export interface Frame {
  view: ViewNoRules;
  drawings: PlanningDrawing[];
  /** UI-private save preferences (tutorial progress etc.) — excluded from the sim hash. */
  uiPrefs: Record<string, string | number | boolean>;
  meta: FrameMeta;
  clock: ClockState;
  /** Monotonic frame counter. */
  seq: number;
}

export interface SaveInfo {
  ok: boolean;
  at: number; // wall clock ms
  revision: number;
  bytes: number;
  ms: number;
  reason: string;
  error?: string;
  conflict?: { storedRevision: number; myRevision: number; recoveryId: string };
}

export interface InterruptPrefs {
  war: boolean;
  capital: boolean;
  end: boolean;
  other: boolean;
}

export interface CountryPreview {
  id: string;
  name: string;
  region: string;
  capital: { key: string; name: string; lonlat: [number, number] } | null;
  cities: { key: string; name: string; tier: number; port: boolean; capital: boolean }[];
  provinces: number;
  doctrine: string;
  coastal: boolean;
  landlocked: boolean;
  small: boolean;
  neighbours: string[];
  startDifficulty: string;
  summary: string;
  stockpile: Record<string, number>;
  dailyOutput: Record<string, number>;
  forces: { unit: string; name: string; count: number }[];
  formations: number;
  tradeNeeds: string[];
  openingDecisions: { id: string; title: string; detail: string; screen: string }[];
  power: { composite: number; rank: number; raw: Record<string, number> } | null;
  synthesized: boolean;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  version: string;
  seats: string[];
  notes: string[];
  modes: { id: string; name: string }[];
  denominator: number | null;
  soloThreshold: number | null;
  coalitionThresholds: Record<number, number> | null;
  powerMeta: { weights: Record<string, number>; normalization: Record<string, number>; leader: string; nearestRival: string | null; rescale: number } | null;
  previewError: string | null;
}

export type UiAction =
  | { kind: 'addDrawing'; drawing: Omit<PlanningDrawing, 'id' | 'createdAt' | 'hidden' | 'author'> & { hidden?: boolean } }
  | { kind: 'renameDrawing'; id: string; name: string }
  | { kind: 'hideDrawing'; id: string; hidden: boolean }
  | { kind: 'deleteDrawing'; id: string }
  | { kind: 'setPref'; key: string; value: string | number | boolean };

export type Request =
  | { op: 'init' }
  | { op: 'previews' }
  | { op: 'newGame'; country: string; seed: number; difficulty: Difficulty; campaignId: string; name: string }
  | { op: 'open'; campaignId: string; readOnly?: boolean; catchUpMinutes?: number }
  | { op: 'importJson'; json: string; campaignId: string; name: string }
  | { op: 'validateJson'; json: string }
  | { op: 'close' }
  | { op: 'command'; cmd: Command }
  | { op: 'preview'; cmd: Command }
  | { op: 'query'; name: QueryName; args?: unknown[] }
  | { op: 'clock'; paused?: boolean; speed?: number; interrupts?: InterruptPrefs }
  | { op: 'step'; minutes: number }
  | { op: 'nextEvent'; maxMinutes?: number }
  | { op: 'save'; reason: string; force?: boolean }
  | { op: 'export' }
  | { op: 'ui'; action: UiAction }
  | { op: 'hash' }
  | { op: 'setReadOnly'; readOnly: boolean }
  | { op: 'perf'; stacks?: number }
  /** Test-only (enabled by ?e2e=1): inject a radar-only contact over a real hidden foreign stack. */
  | { op: 'debugEnable' }
  | { op: 'debugContact' }
  | { op: 'debugMissileSetup'; missile?: string }
  | { op: 'debugEngage'; stack?: string; strongest?: boolean }
  /** Test-only: a computer country submits an ordinary validated market order (same command path as every bot). */
  | { op: 'debugMarketOrder'; side: 'buy' | 'sell'; resource: string; qty: number; price: number }
  /** Test-only: computer country `by` submits an ordinary validated `declareWar` on the human once the running clock reaches tick+inMinutes. */
  | { op: 'debugScheduleWar'; by: string; inMinutes: number }
  /** Test-only (features pass): an air-mobile helicopter group at the capital, or an enemy warship off a port. */
  | { op: 'debugFeature'; what: 'airlift' | 'blockade' };

export type QueryName =
  | 'cityList'
  | 'provinceInspector'
  | 'researchTree'
  | 'researchRefund'
  | 'scoreBreakdown'
  | 'ledgerModel'
  | 'shortageBreakdown'
  | 'newspaper'
  | 'journal'
  | 'marketView'
  | 'forceModel'
  | 'planRoute'
  | 'cityDetail'
  | 'buildOptions'
  | 'unitOptions'
  | 'publicProvince'
  | 'eventDetail'
  | 'hashInfo'
  | 'profile'
  | 'airInfo'
  | 'missileInfo'
  | 'career'
  | 'stackOptions'
  | 'rules';

export type Envelope = { id: number } & Request;

export type Push =
  | { type: 'frame'; frame: Frame }
  | { type: 'saved'; info: SaveInfo }
  | { type: 'interrupt'; events: { id: string; kind: string; text: string; node: number | null }[] }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'fatal'; message: string };

export type Response = { type: 'response'; id: number; ok: true; result: unknown } | { type: 'response'; id: number; ok: false; error: string; code?: string; details?: unknown };

export type WorkerMessage = Push | Response;

/** Game minutes advanced per real second at speed 1×. */
export const SPEED_BASE = 1;
export const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;
