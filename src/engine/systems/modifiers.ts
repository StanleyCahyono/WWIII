/**
 * National modifiers granted by technologies (`TechNode.effects.modifiers`).
 * Keys containing a `_mult` segment are MULTIPLIERS (1 = no change) and stack multiplicatively; other keys
 * are additive bonuses/flags. Every key used by the catalog is either consumed below or listed
 * in UNUSED_MODIFIERS (documented, no simulation effect yet).
 */
import type { CountryId } from '../data-types';
import type { GameState } from '../state';

export const CONSUMED_MODIFIERS: Record<string, string> = {
  research_speed_mult: 'research duration ÷ value (systems/research.ts)',
  industrial_output_mult: 'city resource output × value (systems/economy.ts)',
  electronics_output_mult: 'electronics output (city + rural) × value',
  rural_output_mult: 'rural deposit output × value',
  fuel_upkeep_mult: 'unit fuel upkeep × value',
  unit_electronics_cost_mult: 'electronics in unit mobilization cost × value',
  radar_range_mult: 'radar range of own stacks and city radars × value',
  refit_speed_mult: 'readiness gained in refit × value',
  naval_hp_regen_mult: 'HP regeneration of naval units × value',
  embark_time_mult: 'embark/disembark time × value',
  land_speed_mult_own: 'ground speed inside own/annexed territory × value',
  rebase_time_mult: 'rebasing flight time × value',
  air_endurance_mult: 'aircraft endurance × value',
  air_operational_range_mult: 'aircraft operational range × value',
  air_attack_mult: 'fighter/heavy attack vs airplane & helicopter × value',
  land_attack_mult: 'land-domain unit attack × value',
  urban_defense_mult: 'infantry defence in urban/suburban provinces × value',
  artillery_range_mult: 'support / missile-launcher range × value',
  officer_bonus_mult: 'officer bonus portion (mult − 1) × value',
  missile_defense_rating_bonus: 'added to missile-defence rating where own air-defence covers the target',
};
export const UNUSED_MODIFIERS: Record<string, string> = {
  report_age_mult: 'UI presentation only (report freshness display)',
  receiving_capacity_mult: 'no receiving-capacity model yet',
  carrier_ops: 'flag; carriers already operate aircraft',
  track_history: 'flag for UI track comparison',
};

/** Modifier value for a country (multipliers default to 1, bonuses to 0). */
export function cmod(state: GameState, c: CountryId | null | undefined, key: string): number {
  const v = c ? state.countries[c]?.modifiers[key] : undefined;
  return v ?? (isMultKey(key) ? 1 : 0);
}
/** Apply a granted modifier (multiplicative for `_mult` keys, additive otherwise). */
export function applyModifier(mods: Record<string, number>, key: string, value: number): void {
  if (isMultKey(key)) mods[key] = Math.round((mods[key] ?? 1) * value * 1e6) / 1e6;
  else mods[key] = Math.round(((mods[key] ?? 0) + value) * 1e6) / 1e6;
}
/** `_mult` anywhere as a word segment marks a multiplier (e.g. `land_speed_mult_own`). */
export function isMultKey(key: string): boolean {
  return /(^|_)mult(_|$)/.test(key);
}
