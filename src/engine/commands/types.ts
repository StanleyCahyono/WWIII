/**
 * ONE discriminated union for every game command. Human UI and AI controllers submit exactly the
 * same objects through `submitCommand`, validated by the single `validateCommand`.
 * Common fields: `country` (issuer), optional `nonce` (idempotency — a repeated nonce is a no-op
 * duplicate), optional `reason` (logged decision text; bots use it for replies/debugging).
 */
import type { CityKey, CountryId, FirePolicy, MissileTypeId, NodeId, Resource, TechId, UnitTypeId, BuildingTypeId } from '../data-types';
import type { DiploLevel, OfferTerm } from '../state';

interface Base {
  country: CountryId;
  nonce?: string;
  reason?: string;
}
export type AirBase = { node: NodeId } | { stack: string };

export type Command =
  | (Base & { type: 'move'; stack: string; dest: NodeId; waypoints?: NodeId[]; confirmActOfWar?: CountryId[] | boolean })
  | (Base & { type: 'attack'; stack: string; targetContact?: string; targetNode?: NodeId; confirmActOfWar?: CountryId[] | boolean })
  | (Base & { type: 'stop'; stack: string })
  | (Base & { type: 'delay'; stack: string; minutes: number })
  | (Base & { type: 'split'; stack: string; units: string[] })
  | (Base & { type: 'merge'; stacks: string[] })
  | (Base & { type: 'setFirePolicy'; stack: string; policy: FirePolicy })
  | (Base & { type: 'patrol'; stack: string; center: NodeId; radiusKm?: number })
  | (Base & { type: 'rebase'; stack: string; base: AirBase })
  | (Base & { type: 'ferry'; stack: string; dest: NodeId; confirmActOfWar?: CountryId[] | boolean })
  | (Base & { type: 'embark'; stack: string; sea: NodeId })
  | (Base & { type: 'disembark'; stack: string; land: NodeId; confirmActOfWar?: CountryId[] | boolean })
  | (Base & { type: 'retreat'; stack: string; dest: NodeId })
  | (Base & { type: 'setRefit'; stack: string; refit: boolean })
  | (Base & { type: 'build'; building: BuildingTypeId; targets: (CityKey | NodeId)[]; previewToken?: string })
  | (Base & { type: 'cancelJob'; job: string })
  | (Base & { type: 'demolish'; target: CityKey | NodeId; building: BuildingTypeId })
  | (Base & { type: 'annex'; city: CityKey })
  | (Base & { type: 'mobilize'; unit: UnitTypeId; cities: CityKey[]; previewToken?: string })
  | (Base & { type: 'setRally'; city: CityKey; node: NodeId | null })
  | (Base & { type: 'startResearch'; tech: TechId })
  | (Base & { type: 'cancelResearch'; tech: TechId })
  | (Base & { type: 'marketOrder'; side: 'buy' | 'sell'; resource: Resource; qty: number; price: number })
  | (Base & { type: 'cancelMarketOrder'; order: string })
  | (Base & { type: 'proposeOffer'; to: CountryId; give: OfferTerm[]; receive: OfferTerm[]; expiresInMin?: number; text?: string })
  | (Base & { type: 'respondOffer'; offer: string; accept: boolean })
  | (Base & { type: 'withdrawOffer'; offer: string })
  | (Base & { type: 'revokeGrant'; to: CountryId; level: DiploLevel })
  | (Base & { type: 'declareWar'; target: CountryId })
  | (Base & { type: 'createCoalition'; name: string; description?: string; emblem?: string })
  | (Base & { type: 'applyCoalition'; coalition: string })
  | (Base & { type: 'respondApplication'; coalition: string; applicant: CountryId; accept: boolean })
  | (Base & { type: 'leaveCoalition' })
  | (Base & { type: 'launchMissile'; missile: MissileTypeId; from: AirBase; target: NodeId; confirmActOfWar?: CountryId[] | boolean })
  | (Base & { type: 'produceMissile'; missile: MissileTypeId; batches?: number })
  | (Base & { type: 'assignAgent'; city: CityKey; mission: 'information' | 'sabotage' | 'corruption' })
  | (Base & { type: 'recallAgent'; agent: string })
  | (Base & { type: 'buyIntelReport'; node: NodeId })
  | (Base & { type: 'publishArticle'; headline: string; body: string; anonymous?: boolean })
  | (Base & { type: 'sendMessage'; to: CountryId | 'coalition'; text?: string; intent?: string })
  | (Base & { type: 'useDeployable'; stack: string; unit: string; target: NodeId });

export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export type ErrorCode =
  | 'unknown_command'
  | 'game_over'
  | 'not_owner'
  | 'unknown_stack'
  | 'unknown_target'
  | 'invalid_domain'
  | 'invalid_argument'
  | 'unreachable'
  | 'no_access'
  | 'missing_facility'
  | 'outside_campaign'
  | 'act_of_war'
  | 'insufficient_resources'
  | 'insufficient_range'
  | 'insufficient_stock'
  | 'unsuitable_port'
  | 'city_occupied'
  | 'locked_tech'
  | 'stale_preview'
  | 'already_resolved'
  | 'not_recipient'
  | 'busy'
  | 'refueling'
  | 'grounded'
  | 'eliminated'
  | string;

export type Validation<P = unknown> =
  | { ok: true; preview: P; warnings?: string[] }
  | { ok: false; code: ErrorCode; reason: string; details?: unknown };

export type CommandResult<P = unknown> =
  | { ok: true; preview: P; result: unknown; duplicate?: boolean; warnings?: string[] }
  | { ok: false; code: ErrorCode; reason: string; details?: unknown };
