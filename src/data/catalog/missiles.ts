/**
 * Missile catalog — World Command: World 120.
 *
 * Fictional, turn-scale strategic game tokens. Terminology (cruise / ballistic / boost-glide /
 * hypersonic cruise) follows public terminology after GAO-19-705SP; every name, cost, timing,
 * probability and effect is an original game-balance value with no calibration against real
 * systems, cities or defences. Payload is always 'conventional' (abstract game effect).
 *
 * Attributes are deliberately separate: speedClass, flight family, payload, program maturity,
 * availability (research), cost and game accuracy. A higher speed class does NOT imply better
 * accuracy, damage or report certainty (compare the outcome tables below).
 *
 * Outcome semantics: `outcomes` are exclusive terminal probabilities BEFORE target defences
 * and sum to exactly 1. Interception is a separate seeded draw that converts an arrived_*
 * result into 'intercepted' with probability interceptBase × sector defence rating, so the
 * catalog value of `intercepted` is 0. The UI "accuracy" label is conditional on arrival:
 *   accuracy = arrived_effect / (arrived_effect + arrived_limited)
 * while the headline useful-effect chance includes the earlier failure states:
 *   P(useful effect) = arrived_effect × (1 − interceptBase × defenceRating).
 */
import type { MissileType, ProgramMaturity } from '../../engine/data-types';

export const PROVENANCE = 'fictional campaign catalog; terminology after GAO-19-705SP';

/** Program maturity sequence (engine enforces transitions in this order). */
export const PROGRAM_MATURITY_ORDER: ProgramMaturity[] = ['prototype', 'qualified', 'in_production', 'ready', 'expended'];

/** Warhead disposition for this campaign: abstract conventional effects only. */
export const EXCLUDED_WARHEADS: { id: string; name: string; disposition: 'excluded'; reason: string }[] = [
  { id: 'nuclear', name: 'Nuclear warhead', disposition: 'excluded', reason: 'Abstract-only campaign: no nuclear payloads exist in the World 120 catalog.' },
  { id: 'chemical', name: 'Chemical warhead', disposition: 'excluded', reason: 'Abstract-only campaign: no chemical payloads exist; contamination is never simulated as a real substance.' },
];

export const MISSILE_TYPES: MissileType[] = [
  {
    id: 'msl_cruise',
    name: 'Pikeline Cruise Missile',
    family: 'cruise',
    speedClass: 'subsonic',
    flightFamily: 'powered cruise',
    payload: 'conventional',
    blueprintTech: 'str_cruise_missile_1',
    qualifyTech: null,
    cost: { components: 60, electronics: 40, fuel: 20, rare: 4, money: 600 },
    batchSize: 4,
    buildHours: 24,
    inventoryCeiling: 24,
    launchFrom: ['missile_complex', 'missile_launcher', 'naval', 'heavy', 'submarine'],
    rangeKm: 1600,
    flight: { baseMin: 6, kmPerMin: 14 },
    outcomes: { arrived_effect: 0.7, arrived_limited: 0.15, intercepted: 0, failed: 0.15 },
    interceptBase: 0.3,
    effect: { buildingDamage: 25, unitDamage: 18, moraleDelta: -2, conditionDelta: -6 },
    era: 'Mature (available from campaign start to any country that researches it)',
    provenance: PROVENANCE,
    description:
      'A mature powered cruise-missile family with a conventional payload. Affordable batches of four, a middle-length flight timer and a readable replenishment cycle.',
  },
  {
    id: 'msl_cruise_er',
    name: 'Pikeline-ER Extended-Range Cruise Missile',
    family: 'cruise',
    speedClass: 'subsonic',
    flightFamily: 'powered cruise',
    payload: 'conventional',
    blueprintTech: 'str_cruise_missile_2',
    qualifyTech: null,
    cost: { components: 80, electronics: 60, fuel: 35, rare: 8, money: 900 },
    batchSize: 3,
    buildHours: 30,
    inventoryCeiling: 15,
    launchFrom: ['missile_complex', 'missile_launcher', 'naval', 'heavy'],
    rangeKm: 2800,
    flight: { baseMin: 6, kmPerMin: 14 },
    outcomes: { arrived_effect: 0.68, arrived_limited: 0.17, intercepted: 0, failed: 0.15 },
    interceptBase: 0.3,
    effect: { buildingDamage: 25, unitDamage: 18, moraleDelta: -2, conditionDelta: -6 },
    era: 'Mid-campaign improvement of the mature cruise family',
    provenance: PROVENANCE,
    description: 'Longer-range variant of the cruise family. Same game effect, more fuel and electronics per round, longer flight timer.',
  },
  {
    id: 'msl_ballistic',
    name: 'Obelisk Ballistic Missile',
    family: 'ballistic',
    speedClass: 'hypersonic',
    flightFamily: 'ballistic',
    payload: 'conventional',
    blueprintTech: 'str_ballistic_missile_1',
    qualifyTech: 'str_ballistic_missile_2',
    cost: { components: 160, electronics: 90, fuel: 80, rare: 20, money: 1800 },
    batchSize: 2,
    buildHours: 72,
    inventoryCeiling: 10,
    launchFrom: ['missile_complex', 'missile_launcher', 'submarine'],
    rangeKm: 3500,
    flight: { baseMin: 4, kmPerMin: 120 },
    outcomes: { arrived_effect: 0.62, arrived_limited: 0.2, intercepted: 0, failed: 0.18 },
    interceptBase: 0.22,
    effect: { buildingDamage: 45, unitDamage: 30, moraleDelta: -5, conditionDelta: -12 },
    era: 'Mid campaign (separately researched strategic token)',
    provenance: PROVENANCE,
    description:
      'An abstract ballistic strategic token. Its terminal speed is in the hypersonic class, but it remains a BALLISTIC family item — speed alone does not make it a glide vehicle. Larger production commitment, distinct event icon.',
  },
  {
    id: 'msl_hgv',
    name: 'Skein Boost-Glide System',
    family: 'hgv',
    speedClass: 'hypersonic',
    flightFamily: 'boost-glide system',
    payload: 'conventional',
    blueprintTech: 'hyp_glide_blueprint',
    qualifyTech: 'hyp_glide_qualified',
    cost: { components: 220, electronics: 160, fuel: 60, rare: 70, money: 4200 },
    batchSize: 1,
    buildHours: 120,
    inventoryCeiling: 4,
    launchFrom: ['missile_complex', 'missile_launcher'],
    rangeKm: 5000,
    flight: { baseMin: 5, kmPerMin: 100 },
    outcomes: { arrived_effect: 0.6, arrived_limited: 0.18, intercepted: 0, failed: 0.22 },
    interceptBase: 0.1,
    effect: { buildingDamage: 40, unitDamage: 25, moraleDelta: -4, conditionDelta: -10 },
    era: 'Late campaign (two-step program; no opening stockpile anywhere)',
    provenance: PROVENANCE,
    description:
      'A fictional boost-glide system: a booster carries a glide vehicle before its glide phase. Hard to intercept, but less reliable than mature cruise missiles and very expensive — each shot is a budget decision. Schematic phase labels show only where visible to the viewer.',
  },
  {
    id: 'msl_hcm',
    name: 'Quillfire Hypersonic Cruise Missile',
    family: 'hcm',
    speedClass: 'hypersonic',
    flightFamily: 'powered air-breathing hypersonic cruise',
    payload: 'conventional',
    blueprintTech: 'hyp_cruise_blueprint',
    qualifyTech: 'hyp_cruise_qualified',
    cost: { components: 140, electronics: 180, fuel: 120, rare: 90, money: 3600 },
    batchSize: 2,
    buildHours: 96,
    inventoryCeiling: 6,
    launchFrom: ['missile_complex', 'heavy', 'naval'],
    rangeKm: 1200,
    flight: { baseMin: 2, kmPerMin: 95 },
    outcomes: { arrived_effect: 0.58, arrived_limited: 0.2, intercepted: 0, failed: 0.22 },
    interceptBase: 0.15,
    effect: { buildingDamage: 30, unitDamage: 22, moraleDelta: -3, conditionDelta: -8 },
    era: 'Late campaign (separate branch; no opening stockpile anywhere)',
    provenance: PROVENANCE,
    description:
      'A fictional powered, air-breathing hypersonic cruise missile. Separate late research branch with a fuel-, electronics- and rare-heavy input mix and the shortest flight timer in the catalog. Speed does not buy accuracy: its outcome table is no better than the mature cruise family.',
  },
];

/** Flight time in whole game minutes (engine uses the same formula). */
export function flightMinutes(m: MissileType, km: number): number {
  return Math.round(m.flight.baseMin + km / m.flight.kmPerMin);
}
