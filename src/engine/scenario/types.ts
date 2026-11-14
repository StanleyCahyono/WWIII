/** Scenario = static data the engine runs on (never stored in the save; referenced by id+version). */
import type {
  BuildingType,
  CountryId,
  CountryProfile,
  MapData,
  MissileType,
  ResourceDef,
  TechNode,
  UnitType,
} from '../data-types';

export interface Catalog {
  resources: ResourceDef[];
  units: UnitType[];
  buildings: BuildingType[];
  techs: TechNode[];
  missiles: MissileType[];
}

export interface Scenario {
  id: string;
  version: string;
  name: string;
  map: MapData;
  catalog: Catalog;
  /** Profiles keyed by country id. Every seat must have one (synthesize defaults if missing). */
  profiles: Record<CountryId, CountryProfile>;
  /** Playable seats, in stable order. */
  seats: CountryId[];
  startDate: string;
  /** True for compact test fixtures (never offered in the product). */
  testOnly?: boolean;
  /** Notes about synthesized data (e.g. default profiles), surfaced to the UI. */
  notes?: string[];
}
