/** AI plug-in contract. Controllers consume ONLY the filtered CountryView (never raw state). */
import type { CountryId, NodeId } from '../data-types';
import type { Command, Validation } from '../commands/types';
import type { CountryView } from '../view/country-view';
import type { Difficulty, ReviewKind } from '../state';
import type { Catalog } from '../scenario/types';
import type { MapData } from '../data-types';
import type { Rng } from '../rng';
import type { RoutePlan } from '../systems/movement';

export interface PlannerContext {
  now: number;
  /** All review kinds due this call (strategic/economic/diplomatic/operational). */
  reviews: ReviewKind[];
  /** Event triggers that woke this country (e.g. "war_declared:USA", "city_lost:...", "offer:of12"). */
  wake: string[];
  /** Max commands this review may submit (difficulty-dependent planning budget). */
  budget: number;
  difficulty: Difficulty;
  /** Opaque AI memory blob stored in the save (owned by the AI module). */
  memory: unknown;
  setMemory(m: unknown): void;
  /** Validate/preview a command for this country without applying it (same validator). */
  preview(cmd: Command): Validation;
  /** Static, public data (geography + catalog). */
  map: MapData;
  catalog: Catalog;
  /** Static route preview for one of this country's own stacks (respects its rights). */
  route(stackId: string, dest: NodeId): RoutePlan | null;
  /** Seeded RNG stream for this call (deterministic). */
  rng: Rng;
}

export interface CountryController {
  /** Return commands to submit (each goes through submitCommand; invalid ones are rejected and counted). */
  decide(view: CountryView, ctx: PlannerContext): Command[];
}

export type ControllerRegistry = Partial<Record<CountryId, CountryController>> | ((country: CountryId) => CountryController | undefined);

export interface SimHost {
  controllers?: ControllerRegistry;
  /** Default controller for countries with none registered (defaults to IdleController). */
  fallback?: CountryController;
}
