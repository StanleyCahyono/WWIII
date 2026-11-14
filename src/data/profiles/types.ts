/**
 * Authoring types for World 120 country profiles (owner: profiles agent).
 *
 * A `CountrySpec` is the hand-authored record for one seat. `build.ts` expands it into the
 * engine's `CountryProfile` (src/engine/data-types.ts): every map city gets a `CityProfile`,
 * technologies are closed over prerequisites, stationing cities receive the facilities their
 * formations require, and outputs are balanced against the authored upkeep (quantities only —
 * reference prices are never read, so a basket price change cannot move any force or output).
 */
import type {
  BuildingTypeId,
  CityFunction,
  CountryId,
  Doctrine,
  OpeningDecision,
  Personality,
  Resource,
  ResVec,
  TechId,
  UnitTypeId,
} from '../../engine/data-types';

export type TemplateId =
  | 'superpower'
  | 'major_industrial'
  | 'major_land_power'
  | 'maritime_tech'
  | 'expeditionary_power'
  | 'continental_scale'
  | 'regional_industrial'
  | 'medium_balanced'
  | 'frontier_state'
  | 'petrostate'
  | 'small_trade_hub'
  | 'small_agrarian'
  | 'landlocked_highland'
  | 'landlocked_plains'
  | 'archipelago'
  | 'island_state';

export interface CitySpec {
  /** Economic functions of the city (drive the base output table in templates.ts). */
  fn?: CityFunction[];
  /** Buildings at start: type → level. */
  b?: Partial<Record<BuildingTypeId, number>>;
  /** Extra base output per day added on top of the function table (whole units). */
  out?: ResVec;
  tier?: 1 | 2 | 3 | 4 | 5;
}

/** [unit, count, city slug (key without "CCC-"), designation, readiness?, level?] */
export type ForceSpec = [UnitTypeId, number, string, string, number?, number?];

export interface RuralSpec {
  /** Deposit resource whose provinces receive the improvement (largest-population first). */
  deposit: Resource;
  type: BuildingTypeId;
  level: number;
  /** Maximum number of provinces improved. */
  max: number;
}

export interface CountrySpec {
  id: CountryId;
  template: TemplateId;
  doctrine: Doctrine;
  difficulty?: 'easy' | 'moderate' | 'hard';
  summary: string;
  /** Output intensity used ONLY to author city outputs at build time (never stored in the profile). */
  intensity?: number;
  /** Key cities by slug (city key without the "CCC-" prefix). */
  cities?: Record<string, CitySpec>;
  /** Full authored roster. When given, the template recipe is not used. */
  forces?: ForceSpec[];
  /** Formations appended to the template recipe. */
  addForces?: ForceSpec[];
  /** Recipe size overrides (maneuver units, combat aircraft, warships). */
  army?: number;
  air?: number;
  navy?: number;
  /** Technology seeds (closed over prerequisites at build time). Added to the template set. */
  techs?: TechId[];
  /** Template techs to drop. */
  dropTechs?: TechId[];
  /** Technologies held under licence (lineage 'licensed'). */
  licensed?: TechId[];
  lift?: number;
  maint?: number;
  tradeNeeds?: Resource[];
  decisions: OpeningDecision[];
  personality?: Partial<Personality>;
  /** Extra starting stock on top of the computed reserve. */
  stock?: ResVec;
  rural?: RuralSpec[];
}
