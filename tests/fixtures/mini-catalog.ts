/** TEST-ONLY mini catalog (fictional values). Never shipped in the product. */
import type { BuildingType, MissileType, ResourceDef, TechNode, UnitLevelStats, UnitType } from '../../src/engine/data-types';
import type { Catalog } from '../../src/engine/scenario/types';

const R: ResourceDef[] = [
  { id: 'supplies', name: 'Supplies', role: 'Feeds formations and cities.', referencePrice: 1 },
  { id: 'components', name: 'Components', role: 'Industrial parts.', referencePrice: 2 },
  { id: 'electronics', name: 'Electronics', role: 'Advanced systems and research.', referencePrice: 4 },
  { id: 'fuel', name: 'Fuel', role: 'Mobility and aircraft.', referencePrice: 1.5 },
  { id: 'rare', name: 'Rare materials', role: 'High-end programs.', referencePrice: 5 },
  { id: 'manpower', name: 'Manpower', role: 'Recruitment.', referencePrice: 1 },
  { id: 'money', name: 'Money', role: 'Universal currency.', referencePrice: 1 },
];

function lvl(level: number, tech: string | null, s: Partial<UnitLevelStats>): UnitLevelStats {
  return { level, tech, hp: 10, attack: {}, defense: {}, speedKmh: 30, rangeKm: 0, sightKm: 40, radarKm: 0, signature: 1, ...s };
}
function unit(u: Partial<UnitType> & Pick<UnitType, 'id' | 'name' | 'family' | 'domain' | 'targetClass'>): UnitType {
  return {
    echelon: 1,
    capture: false,
    cost: { money: 100 },
    upkeepPerDay: { money: 4, supplies: 2 },
    buildHours: 12,
    requires: [],
    unlockTech: null,
    levels: [lvl(1, null, {})],
    terrain: {},
    orders: ['move', 'attack', 'stop', 'split', 'merge', 'fire_policy'],
    features: [],
    symbol: `land.${u.family}`,
    description: 'Test unit.',
    ...u,
  };
}

export const MINI_UNITS: UnitType[] = [
  unit({ id: 'inf', name: 'Line Infantry', family: 'infantry', domain: 'land', targetClass: 'unarmored', echelon: 1, capture: true, cost: { money: 100, manpower: 50, supplies: 30 }, upkeepPerDay: { money: 5, supplies: 3, manpower: 1 }, levels: [lvl(1, null, { hp: 15, attack: { unarmored: 3, armored: 1.5, building: 1, helicopter: 1 }, defense: { unarmored: 4, armored: 2.5, helicopter: 1, airplane: 0.5 }, speedKmh: 30, sightKm: 40 }), lvl(2, 'land_infantry_2', { hp: 20, attack: { unarmored: 4, armored: 2, building: 1 }, defense: { unarmored: 5, armored: 3, airplane: 0.5 }, speedKmh: 32, sightKm: 45 })] }),
  unit({ id: 'tank', name: 'Battle Tank', family: 'armor', domain: 'land', targetClass: 'armored', echelon: 1, capture: true, cost: { money: 300, components: 80, fuel: 40, manpower: 30 }, upkeepPerDay: { money: 12, fuel: 4 }, requires: [{ building: 'barracks', level: 1 }], buildHours: 24, levels: [lvl(1, null, { hp: 25, attack: { unarmored: 5, armored: 5, building: 2 }, defense: { unarmored: 4, armored: 5 }, speedKmh: 45, sightKm: 30 })], terrain: { mountains: { speed: 0.4, attack: 0.7 }, forest: { speed: 0.6 } } }),
  unit({ id: 'arty', name: 'Field Battery', family: 'support', domain: 'land', targetClass: 'unarmored', echelon: 3, capture: false, cost: { money: 150, components: 30, manpower: 20 }, levels: [lvl(1, null, { hp: 10, attack: { unarmored: 4, armored: 3, building: 3 }, defense: { unarmored: 1.5, armored: 1 }, speedKmh: 25, rangeKm: 260, sightKm: 30 })] }),
  unit({ id: 'scout', name: 'Scout Car', family: 'recon', domain: 'land', targetClass: 'armored', echelon: 2, capture: false, cost: { money: 120, components: 20 }, levels: [lvl(1, null, { hp: 10, attack: { unarmored: 1.5 }, defense: { unarmored: 1.5, armored: 1 }, speedKmh: 60, sightKm: 240 })] }),
  unit({ id: 'sam', name: 'Area Defence Battery', family: 'air_defense', domain: 'land', targetClass: 'armored', echelon: 3, capture: false, cost: { money: 250, electronics: 40 }, levels: [lvl(1, null, { hp: 12, attack: { airplane: 6, helicopter: 6 }, defense: { airplane: 8, helicopter: 7, unarmored: 1 }, speedKmh: 30, rangeKm: 120, sightKm: 40, radarKm: 220, radarDetects: ['air'], radarSensitivity: 2 })] }),
  unit({ id: 'heli', name: 'Gunship', family: 'helicopter', domain: 'air', targetClass: 'helicopter', echelon: 2, capture: false, cost: { money: 220, fuel: 40 }, levels: [lvl(1, null, { hp: 12, attack: { unarmored: 4, armored: 4 }, defense: { unarmored: 2, helicopter: 2 }, speedKmh: 150, sightKm: 60 })] }),
  unit({ id: 'fighter', name: 'Interceptor', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 1, capture: false, cost: { money: 400, electronics: 60, fuel: 50 }, upkeepPerDay: { money: 15, fuel: 6 }, levels: [lvl(1, null, { hp: 12, attack: { airplane: 6, helicopter: 5, unarmored: 1.5, armored: 1 }, defense: { airplane: 5, helicopter: 2 }, speedKmh: 800, sightKm: 100, radarKm: 150, radarDetects: ['air'], radarSensitivity: 2, signature: 1, enduranceMin: 240, operationalRangeKm: 1500 })], orders: ['patrol', 'rebase', 'stop', 'fire_policy'] }),
  unit({ id: 'bomber', name: 'Strike Bomber', family: 'heavy', domain: 'air', targetClass: 'airplane', echelon: 1, capture: false, cost: { money: 600, electronics: 80, fuel: 80 }, levels: [lvl(1, null, { hp: 16, attack: { unarmored: 6, armored: 5, building: 8, ship: 4 }, defense: { airplane: 2 }, speedKmh: 600, sightKm: 60, signature: 2, enduranceMin: 480, operationalRangeKm: 3000 })], orders: ['patrol', 'rebase', 'stop'] }),
  unit({ id: 'stealth', name: 'Shadow Fighter', family: 'fighter', domain: 'air', targetClass: 'airplane', echelon: 1, capture: false, unlockTech: 'avi_stealth', cost: { money: 900, electronics: 150, rare: 40 }, levels: [lvl(1, 'avi_stealth', { hp: 12, attack: { airplane: 8, unarmored: 2 }, defense: { airplane: 6 }, speedKmh: 900, sightKm: 100, signature: 3, enduranceMin: 240, operationalRangeKm: 1800 })] }),
  unit({ id: 'frigate', name: 'Escort Frigate', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 1, capture: false, cost: { money: 500, components: 150, fuel: 60 }, upkeepPerDay: { money: 18, fuel: 6 }, buildHours: 48, levels: [lvl(1, null, { hp: 25, attack: { ship: 5, submarine: 3, airplane: 3, unarmored: 2, building: 2 }, defense: { ship: 5, airplane: 4, submarine: 3 }, speedKmh: 40, rangeKm: 40, sightKm: 60, radarKm: 150, radarDetects: ['air', 'sea'], radarSensitivity: 1 })] }),
  unit({ id: 'sub', name: 'Hunter Submarine', family: 'submarine', domain: 'subsurface', targetClass: 'submarine', echelon: 1, capture: false, cost: { money: 600, components: 160 }, levels: [lvl(1, null, { hp: 20, attack: { ship: 7, submarine: 4 }, defense: { ship: 3, submarine: 4 }, speedKmh: 30, sightKm: 40, signature: 2 })] }),
  unit({ id: 'carrier', name: 'Fleet Carrier', family: 'naval', domain: 'sea', targetClass: 'ship', echelon: 2, capture: false, unlockTech: 'nav_carrier_aviation', cost: { money: 1500, components: 400 }, carries: { families: ['fighter'], slots: 4 }, levels: [lvl(1, 'nav_carrier_aviation', { hp: 40, attack: { airplane: 2 }, defense: { ship: 4, airplane: 5 }, speedKmh: 35, sightKm: 60, radarKm: 200, radarDetects: ['air', 'sea'], radarSensitivity: 2 })] }),
  unit({ id: 'launcher', name: 'Rocket Launcher Vehicle', family: 'missile_launcher', domain: 'land', targetClass: 'armored', echelon: 3, capture: false, cost: { money: 350, components: 60 }, levels: [lvl(1, null, { hp: 10, attack: {}, defense: { unarmored: 1 }, speedKmh: 30 })] }),
  unit({ id: 'officer', name: 'Field Staff', family: 'officer', domain: 'land', targetClass: 'unarmored', echelon: 3, capture: false, unlockTech: 'off_staff', officerBonus: { appliesTo: ['infantry', 'armor'], attackMult: 1.2, defenseMult: 1.1 }, levels: [lvl(1, 'off_staff', { hp: 8, defense: { unarmored: 1 }, speedKmh: 40 })] }),
  unit({ id: 'drone', name: 'Loitering Swarm', family: 'deployable', domain: 'land', targetClass: 'unarmored', echelon: 3, capture: false, deployable: { uses: 2, effect: 'strike', cooldownMin: 120 }, levels: [lvl(1, null, { hp: 4, speedKmh: 40, rangeKm: 300 })] }),
];

function bl(level: number, cost: Record<string, number>, buildHours: number, effects: BuildingType['levels'][number]['effects'], upkeep: Record<string, number> = { money: 2 }) {
  return { level, cost, buildHours, upkeepPerDay: upkeep, effects };
}
export const MINI_BUILDINGS: BuildingType[] = [
  { id: 'barracks', name: 'Barracks', scope: 'city', unlockTech: null, maxLevel: 3, description: '', levels: [1, 2, 3].map((l) => bl(l, { money: 200 * l, supplies: 100 }, 12, { recruitSpeedMult: 1 + 0.25 * l })) },
  { id: 'factory', name: 'Factory', scope: 'city', unlockTech: null, maxLevel: 3, description: '', levels: [1, 2, 3].map((l) => bl(l, { money: 400 * l, components: 100 }, 24, { productionMult: 1 + 0.2 * l })) },
  { id: 'lab', name: 'Research Lab', scope: 'city', unlockTech: null, maxLevel: 3, description: '', levels: [1, 2, 3].map((l) => bl(l, { money: 600 * l, electronics: 50 }, 36, { researchSlots: l, researchSpeedMult: 1 + 0.1 * l })) },
  { id: 'airfield', name: 'Airfield', scope: 'rural', unlockTech: null, maxLevel: 2, description: '', levels: [1, 2].map((l) => bl(l, { money: 300 * l }, 24, { airSlots: 4 * l })) },
  { id: 'naval_base', name: 'Naval Base', scope: 'city', coastalOnly: true, unlockTech: null, maxLevel: 2, description: '', levels: [1, 2].map((l) => bl(l, { money: 500 * l }, 24, { navalSlots: 4 * l })) },
  { id: 'hospital', name: 'Hospital', scope: 'city', unlockTech: null, maxLevel: 2, description: '', levels: [1, 2].map((l) => bl(l, { money: 300 * l }, 24, { hpRecoveryPerDay: 10 * l, moraleDelta: 5 * l })) },
  { id: 'bunker', name: 'Bunker Line', scope: 'city', unlockTech: null, maxLevel: 3, description: '', levels: [1, 2, 3].map((l) => bl(l, { money: 250 * l }, 18, { defenseMult: 1 + 0.25 * l })) },
  { id: 'radar', name: 'Radar Station', scope: 'city', unlockTech: null, maxLevel: 2, description: '', levels: [1, 2].map((l) => bl(l, { money: 300 * l, electronics: 40 }, 24, { radarKm: 250 * l, radarSensitivity: 2 })) },
  { id: 'missile_complex', name: 'Launch Complex', scope: 'city', unlockTech: 'str_missile_complex', maxLevel: 2, description: '', levels: [1, 2].map((l) => bl(l, { money: 800 * l, components: 200 }, 48, { missileSlots: l })) },
  { id: 'mine', name: 'Extraction Site', scope: 'rural', needsDeposit: true, unlockTech: null, maxLevel: 3, description: '', levels: [1, 2, 3].map((l) => bl(l, { money: 200 * l }, 12, { productionMult: 1 + 1 * l })) },
  { id: 'workshop', name: 'Maintenance Depot', scope: 'city', unlockTech: null, maxLevel: 2, description: '', levels: [1, 2].map((l) => bl(l, { money: 300 * l }, 24, { maintenanceSlots: 2 * l })) },
  { id: 'logistics', name: 'Logistics Hub', scope: 'rural', unlockTech: null, maxLevel: 1, description: '', levels: [bl(1, { money: 250 }, 12, { speedMult: 1.25 })] },
];

function tech(t: Partial<TechNode> & Pick<TechNode, 'id' | 'name' | 'branch'>): TechNode {
  return { tier: 1, dayAvailable: 1, prereqs: [], cost: { money: 300, electronics: 20 }, hours: 24, effects: {}, description: '', ...t };
}
export const MINI_TECHS: TechNode[] = [
  tech({ id: 'land_infantry_2', name: 'Infantry Kit II', branch: 'land', effects: { unitLevel: [{ unit: 'inf', level: 2 }] } }),
  tech({ id: 'land_armor_doctrine', name: 'Combined Arms', branch: 'land', tier: 2, dayAvailable: 5, prereqs: ['land_infantry_2'] }),
  tech({ id: 'avi_stealth', name: 'Low Observables', branch: 'aviation', tier: 3, dayAvailable: 20, cost: { money: 1500, electronics: 200, rare: 50 }, effects: { unlockUnit: ['stealth'] } }),
  tech({ id: 'nav_carrier_aviation', name: 'Carrier Aviation', branch: 'naval', tier: 2, effects: { unlockUnit: ['carrier'] } }),
  tech({ id: 'off_staff', name: 'Field Staff College', branch: 'officer', effects: { unlockUnit: ['officer'] } }),
  tech({ id: 'str_missile_complex', name: 'Launch Complexes', branch: 'strategic', effects: { unlockBuilding: ['missile_complex'] } }),
  tech({ id: 'str_cruise_blueprint', name: 'Cruise Program', branch: 'strategic', effects: { missileProgram: { missile: 'cruise_x', stage: 'blueprint' } } }),
  tech({ id: 'str_ballistic_blueprint', name: 'Ballistic Program', branch: 'strategic', effects: { missileProgram: { missile: 'ballistic_x', stage: 'blueprint' } } }),
  tech({ id: 'str_ballistic_qualified', name: 'Ballistic Qualification', branch: 'strategic', prereqs: ['str_ballistic_blueprint'], effects: { missileProgram: { missile: 'ballistic_x', stage: 'qualified' } } }),
  tech({ id: 'hyp_advanced_materials', name: 'Advanced Materials', branch: 'hypersonic', cost: { money: 500, rare: 20 } }),
  tech({ id: 'hyp_glide_blueprint', name: 'Glide Vehicle Blueprint', branch: 'hypersonic', tier: 2, prereqs: ['hyp_advanced_materials'], effects: { missileProgram: { missile: 'hgv_x', stage: 'blueprint' } } }),
  tech({ id: 'hyp_glide_qualified', name: 'Glide Vehicle Qualification', branch: 'hypersonic', tier: 3, prereqs: ['hyp_glide_blueprint'], effects: { missileProgram: { missile: 'hgv_x', stage: 'qualified' } } }),
  tech({ id: 'hyp_cruise_blueprint', name: 'Hypersonic Cruise Blueprint', branch: 'hypersonic', tier: 2, prereqs: ['hyp_advanced_materials'], effects: { missileProgram: { missile: 'hcm_x', stage: 'blueprint' } } }),
  tech({ id: 'hyp_cruise_qualified', name: 'Hypersonic Cruise Qualification', branch: 'hypersonic', tier: 3, prereqs: ['hyp_cruise_blueprint'], effects: { missileProgram: { missile: 'hcm_x', stage: 'qualified' } } }),
  tech({ id: 'ind_automation', name: 'Automation', branch: 'industry', effects: { modifiers: [{ key: 'research_speed_mult', value: 1.1, description: '+10% research speed' }] } }),
  tech({ id: 'mob_strategic_airlift_2', name: 'Strategic Airlift II', branch: 'mobility', effects: { liftCapacity: 2 } }),
  tech({ id: 'mob_refuel_support', name: 'Refuel Support', branch: 'mobility', effects: { maintenanceSlots: 1 } }),
  tech({ id: 'rec_broad_area_recon', name: 'Broad Area Recon', branch: 'recon' }),
  tech({ id: 'late_tech', name: 'Late Program', branch: 'support', dayAvailable: 30 }),
  tech({ id: 'east_only', name: 'Mass Mobilisation', branch: 'land', doctrine: { western: { unavailable: true }, european: { dayAvailable: 10 } } }),
  tech({ id: 'lab_gated', name: 'Lab-Gated Program', branch: 'support', requiresLabLevel: 2 }),
];

function missile(m: Partial<MissileType> & Pick<MissileType, 'id' | 'name' | 'family' | 'speedClass' | 'blueprintTech'>): MissileType {
  return {
    flightFamily: 'powered cruise',
    payload: 'conventional',
    qualifyTech: null,
    cost: { money: 200, components: 40, electronics: 20 },
    batchSize: 2,
    buildHours: 24,
    inventoryCeiling: 8,
    launchFrom: ['missile_complex', 'naval', 'submarine', 'missile_launcher'],
    rangeKm: 1500,
    flight: { baseMin: 10, kmPerMin: 12 },
    outcomes: { arrived_effect: 0.6, arrived_limited: 0.15, intercepted: 0.1, failed: 0.15 },
    interceptBase: 0.5,
    effect: { buildingDamage: 20, unitDamage: 4, moraleDelta: -5, conditionDelta: 15 },
    era: 'campaign era',
    provenance: 'fictional test item',
    description: '',
    ...m,
  };
}
export const MINI_MISSILES: MissileType[] = [
  missile({ id: 'cruise_x', name: 'Test Cruise', family: 'cruise', speedClass: 'subsonic', blueprintTech: 'str_cruise_blueprint' }),
  missile({ id: 'ballistic_x', name: 'Test Ballistic', family: 'ballistic', speedClass: 'hypersonic', flightFamily: 'ballistic', blueprintTech: 'str_ballistic_blueprint', qualifyTech: 'str_ballistic_qualified', cost: { money: 500, components: 80, fuel: 50 }, batchSize: 2, rangeKm: 3000, flight: { baseMin: 6, kmPerMin: 60 } }),
  missile({ id: 'hgv_x', name: 'Test Glide', family: 'hgv', speedClass: 'hypersonic', flightFamily: 'boost-glide system', blueprintTech: 'hyp_glide_blueprint', qualifyTech: 'hyp_glide_qualified', cost: { money: 900, rare: 40, electronics: 60 }, batchSize: 1, inventoryCeiling: 4, rangeKm: 4000, flight: { baseMin: 5, kmPerMin: 100 } }),
  missile({ id: 'hcm_x', name: 'Test Hypersonic Cruise', family: 'hcm', speedClass: 'hypersonic', flightFamily: 'air-breathing hypersonic cruise', blueprintTech: 'hyp_cruise_blueprint', qualifyTech: 'hyp_cruise_qualified', cost: { money: 800, rare: 30, fuel: 80 }, batchSize: 1, inventoryCeiling: 4, rangeKm: 2000, flight: { baseMin: 4, kmPerMin: 80 } }),
];

export const MINI_CATALOG: Catalog & { version: string } = { version: 'mini-1', resources: R, units: MINI_UNITS, buildings: MINI_BUILDINGS, techs: MINI_TECHS, missiles: MINI_MISSILES };
