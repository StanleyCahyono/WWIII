/**
 * Building catalog — World Command: World 120.
 *
 * City buildings (scope 'city') and the documented rural province improvements
 * (scope 'rural': outpost, airfield, field hospital, local industry, military logistics,
 * coastal pontoon). Annexation is an engine action, not a building.
 *
 * Effects listed on a level are the TOTAL effect of a building at that level (not an
 * increment over the previous level). Costs and hours are for upgrading INTO that level.
 * All numbers are fictional balance values.
 */
import type { BuildingLevel, BuildingType, ResVec } from '../../engine/data-types';

type Effects = BuildingLevel['effects'];

function scale(v: ResVec, f: number): ResVec {
  const out: ResVec = {};
  for (const [k, q] of Object.entries(v)) if (q) out[k as keyof ResVec] = Math.round(q * f);
  return out;
}

/**
 * Build a level ladder: cost grows by `costGrowth` per level, hours by `hoursStep`,
 * upkeep by `upkeepGrowth`. `effects[i]` is the total effect at level i+1.
 */
function ladder(
  baseCost: ResVec,
  baseHours: number,
  baseUpkeep: ResVec,
  effects: Effects[],
  costGrowth = 1.6,
  hoursStep = 12,
  upkeepGrowth = 1.35,
): BuildingLevel[] {
  return effects.map((e, i) => ({
    level: i + 1,
    cost: scale(baseCost, Math.pow(costGrowth, i)),
    buildHours: baseHours + hoursStep * i,
    upkeepPerDay: scale(baseUpkeep, Math.pow(upkeepGrowth, i)),
    effects: e,
  }));
}

export const BUILDING_TYPES: BuildingType[] = [
  // ───────────── City buildings ─────────────
  {
    id: 'arms_industry',
    name: 'Arms Industry',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 120, components: 160, money: 900 }, 24, { money: 15, components: 2 }, [
      { productionMult: 1.1, recruitSpeedMult: 1.05 },
      { productionMult: 1.2, recruitSpeedMult: 1.1 },
      { productionMult: 1.3, recruitSpeedMult: 1.15 },
      { productionMult: 1.4, recruitSpeedMult: 1.2 },
      { productionMult: 1.5, recruitSpeedMult: 1.25 },
    ]),
    description:
      'Factories and assembly halls. Multiplies the city\'s resource output and shortens mobilization in this city. The main lever for a broad industrial base, at a steady money upkeep.',
  },
  {
    id: 'recruiting_office',
    name: 'Recruiting Office',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 80, components: 30, money: 500 }, 18, { money: 8 }, [
      { manpowerPerDay: 15, recruitSpeedMult: 1.05 },
      { manpowerPerDay: 30, recruitSpeedMult: 1.1 },
      { manpowerPerDay: 45, recruitSpeedMult: 1.15 },
      { manpowerPerDay: 60, recruitSpeedMult: 1.2 },
      { manpowerPerDay: 80, recruitSpeedMult: 1.25 },
    ]),
    description:
      'Turns urban population into trained recruits. Adds manpower per day and speeds infantry mobilization. Output scales with city morale in the engine.',
  },
  {
    id: 'army_base',
    name: 'Army Base',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 150, components: 120, money: 700 }, 24, { supplies: 6, money: 10 }, [
      { defenseMult: 1.05, hpRecoveryPerDay: 4 },
      { defenseMult: 1.1, hpRecoveryPerDay: 6 },
      { defenseMult: 1.15, hpRecoveryPerDay: 8 },
      { defenseMult: 1.2, hpRecoveryPerDay: 10 },
      { defenseMult: 1.25, hpRecoveryPerDay: 12 },
    ]),
    description:
      'Barracks, depots and vehicle parks. Required to mobilize land units (higher levels for heavier equipment). Ground units at the base recover faster and defend slightly better.',
  },
  {
    id: 'air_base',
    name: 'Air Base',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 120, components: 180, electronics: 40, money: 900 }, 30, { fuel: 6, money: 12 }, [
      { airSlots: 4, hpRecoveryPerDay: 5 },
      { airSlots: 8, hpRecoveryPerDay: 7 },
      { airSlots: 12, hpRecoveryPerDay: 9 },
      { airSlots: 16, hpRecoveryPerDay: 11 },
      { airSlots: 22, hpRecoveryPerDay: 13 },
    ]),
    description:
      'Runways, hangars and fuel farms. Required to build aircraft (fast jets need level 2+, heavies level 3+, stealth airframes level 4). Air slots cap the aircraft that can be stationed here.',
  },
  {
    id: 'naval_base',
    name: 'Naval Base',
    scope: 'city',
    coastalOnly: true,
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 140, components: 220, money: 1000 }, 36, { fuel: 5, money: 12 }, [
      { navalSlots: 3, hpRecoveryPerDay: 5 },
      { navalSlots: 6, hpRecoveryPerDay: 7 },
      { navalSlots: 9, hpRecoveryPerDay: 9 },
      { navalSlots: 12, hpRecoveryPerDay: 11 },
      { navalSlots: 16, hpRecoveryPerDay: 13 },
    ]),
    description:
      'Harbour, dry docks and shipyard. Port cities only. Required to build ships and submarines (cruisers level 4, carriers level 5). Naval slots cap ships based here.',
  },
  {
    id: 'bunker',
    name: 'Bunker Network',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 160, components: 140, money: 500 }, 24, { supplies: 3, money: 4 }, [
      { defenseMult: 1.15, populationShield: 0.1 },
      { defenseMult: 1.3, populationShield: 0.2 },
      { defenseMult: 1.45, populationShield: 0.3 },
      { defenseMult: 1.6, populationShield: 0.4 },
      { defenseMult: 1.75, populationShield: 0.5 },
    ]),
    description:
      'Hardened shelters and fighting positions. Raises the defence of a garrison at the city centre and shields part of the population from bombardment and missile effects.',
  },
  {
    id: 'hospital',
    name: 'Hospital',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 140, components: 60, electronics: 10, money: 600 }, 24, { supplies: 4, money: 8 }, [
      { hpRecoveryPerDay: 5, moraleDelta: 2, manpowerPerDay: 3 },
      { hpRecoveryPerDay: 8, moraleDelta: 3, manpowerPerDay: 5 },
      { hpRecoveryPerDay: 11, moraleDelta: 4, manpowerPerDay: 7 },
      { hpRecoveryPerDay: 14, moraleDelta: 5, manpowerPerDay: 9 },
      { hpRecoveryPerDay: 17, moraleDelta: 6, manpowerPerDay: 12 },
    ]),
    description:
      'Civil and military medical care. Units in the city recover faster, local morale target rises and some wounded return to service as manpower.',
  },
  {
    id: 'radar_station',
    name: 'Radar Station',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ components: 80, electronics: 60, money: 700 }, 24, { electronics: 1, money: 8 }, [
      { radarKm: 250, radarSensitivity: 0 },
      { radarKm: 350, radarSensitivity: 1 },
      { radarKm: 450, radarSensitivity: 1 },
      { radarKm: 550, radarSensitivity: 2 },
      { radarKm: 650, radarSensitivity: 2 },
    ]),
    description:
      'Fixed surveillance radar. Detects air and surface contacts whose signature does not exceed its sensitivity. A radar contact shows only a domain marker until identified by sight.',
  },
  {
    id: 'research_lab',
    name: 'Research Laboratory',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ components: 60, electronics: 80, money: 1200 }, 36, { electronics: 2, money: 20 }, [
      { researchSlots: 1, researchSpeedMult: 1.0 },
      { researchSlots: 1, researchSpeedMult: 1.1 },
      { researchSlots: 2, researchSpeedMult: 1.15 },
      { researchSlots: 2, researchSpeedMult: 1.25 },
      { researchSlots: 3, researchSpeedMult: 1.35 },
    ]),
    description:
      'Staffed laboratories. Adds national research slots and research speed. Advanced nodes also check the national total of laboratory levels. Expensive to staff: high money and electronics upkeep.',
  },
  {
    id: 'logistics_hub',
    name: 'Logistics Hub',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 120, components: 100, fuel: 40, money: 600 }, 24, { fuel: 4, money: 8 }, [
      { speedMult: 1.05, liftCapacity: 1 },
      { speedMult: 1.1, liftCapacity: 2 },
      { speedMult: 1.15, liftCapacity: 3 },
      { speedMult: 1.2, liftCapacity: 4 },
      { speedMult: 1.25, liftCapacity: 6 },
    ]),
    description:
      'Rail yards, depots and an air/sea terminal. Speeds friendly movement around the city and adds abstract lift capacity and receiving capacity for long transfers.',
  },
  {
    id: 'maintenance_depot',
    name: 'Maintenance Depot',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 80, components: 160, electronics: 30, money: 800 }, 30, { components: 3, money: 14 }, [
      { maintenanceSlots: 1, hpRecoveryPerDay: 3 },
      { maintenanceSlots: 2, hpRecoveryPerDay: 4 },
      { maintenanceSlots: 3, hpRecoveryPerDay: 5 },
      { maintenanceSlots: 4, hpRecoveryPerDay: 6 },
      { maintenanceSlots: 6, hpRecoveryPerDay: 8 },
    ]),
    description:
      'Workshops for refits and overhauls. Each maintenance slot can restore one formation\'s readiness at a time. A large fleet without depots looks strong on paper but is unavailable this week.',
  },
  {
    id: 'missile_complex',
    name: 'Missile Complex',
    scope: 'city',
    unlockTech: 'str_missile_complex',
    maxLevel: 3,
    levels: ladder({ components: 240, electronics: 120, rare: 10, money: 1800 }, 48, { electronics: 2, money: 25 }, [
      { missileSlots: 1 },
      { missileSlots: 2 },
      { missileSlots: 4 },
    ], 1.7, 24),
    description:
      'Assembly, storage and launch facility for strategic missile tokens. Each slot runs one missile production batch at a time and stores ready inventory up to the type\'s ceiling.',
  },
  {
    id: 'electronics_plant',
    name: 'Electronics Plant',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ components: 140, rare: 4, money: 1100 }, 30, { rare: 1, money: 12 }, [
      { produces: { electronics: 8 } },
      { produces: { electronics: 16 } },
      { produces: { electronics: 25 } },
      { produces: { electronics: 34 } },
      { produces: { electronics: 45 } },
    ]),
    description:
      'Fabrication lines for sensors and circuit assemblies. Adds flat electronics output but consumes rare materials as upkeep — trading a scarce import for a modernization input.',
  },
  {
    id: 'refinery',
    name: 'Refinery',
    scope: 'city',
    unlockTech: null,
    maxLevel: 5,
    levels: ladder({ supplies: 60, components: 180, money: 900 }, 30, { components: 2, money: 10 }, [
      { produces: { fuel: 15 } },
      { produces: { fuel: 30 } },
      { produces: { fuel: 45 } },
      { produces: { fuel: 60 } },
      { produces: { fuel: 80 } },
    ]),
    description:
      'Processes crude into usable fuel. Adds flat fuel output for components upkeep. Countries without fuel deposits use refineries and trade to keep air wings flying.',
  },

  // ───────────── Rural province improvements ─────────────
  {
    id: 'outpost',
    name: 'Outpost',
    scope: 'rural',
    unlockTech: null,
    maxLevel: 3,
    levels: ladder({ supplies: 60, components: 30, money: 200 }, 12, { supplies: 1, money: 2 }, [
      { defenseMult: 1.1, radarKm: 60 },
      { defenseMult: 1.2, radarKm: 90 },
      { defenseMult: 1.3, radarKm: 120 },
    ], 1.5, 6),
    description:
      'Fortified watch post at the province control node. Improves the defence of units holding the centre and adds a short surveillance radius.',
  },
  {
    id: 'airfield',
    name: 'Airfield',
    scope: 'rural',
    unlockTech: null,
    maxLevel: 3,
    levels: ladder({ supplies: 60, components: 80, fuel: 20, money: 300 }, 18, { fuel: 2, money: 3 }, [
      { airSlots: 2 },
      { airSlots: 4 },
      { airSlots: 6 },
    ], 1.5, 8),
    description:
      'Forward strip with fuel and arming points. Aircraft can rebase and patrol from here, but nothing is built here.',
  },
  {
    id: 'field_hospital',
    name: 'Field Hospital',
    scope: 'rural',
    unlockTech: null,
    maxLevel: 3,
    levels: ladder({ supplies: 70, components: 20, money: 200 }, 12, { supplies: 2, money: 2 }, [
      { hpRecoveryPerDay: 4 },
      { hpRecoveryPerDay: 7 },
      { hpRecoveryPerDay: 10 },
    ], 1.5, 6),
    description: 'Tented medical station. Units in the province recover hit points faster away from cities.',
  },
  {
    id: 'local_industry',
    name: 'Local Industry',
    scope: 'rural',
    needsDeposit: true,
    unlockTech: null,
    maxLevel: 3,
    levels: ladder({ supplies: 80, components: 90, money: 350 }, 18, { money: 4 }, [
      { productionMult: 1.5 },
      { productionMult: 2.0 },
      { productionMult: 2.5 },
    ], 1.5, 8),
    description:
      'Mine, well or plantation working the province deposit. Multiplies the deposit\'s output. On a province with no deposit it produces nothing (the build preview shows a zero-output warning).',
  },
  {
    id: 'military_logistics',
    name: 'Military Logistics',
    scope: 'rural',
    unlockTech: null,
    maxLevel: 3,
    levels: ladder({ supplies: 70, components: 60, fuel: 20, money: 250 }, 12, { fuel: 1, money: 2 }, [
      { speedMult: 1.1 },
      { speedMult: 1.2, liftCapacity: 1 },
      { speedMult: 1.3, liftCapacity: 1 },
    ], 1.5, 6),
    description: 'Roads, rail sidings and supply dumps. Friendly units move faster through the province.',
  },
  {
    id: 'coastal_pontoon',
    name: 'Coastal Pontoon',
    scope: 'rural',
    coastalOnly: true,
    unlockTech: null,
    maxLevel: 3,
    levels: ladder({ supplies: 60, components: 70, money: 250 }, 12, { money: 2 }, [
      { navalSlots: 1, speedMult: 1.1 },
      { navalSlots: 2, speedMult: 1.2 },
      { navalSlots: 3, speedMult: 1.3 },
    ], 1.5, 6),
    description:
      'Floating piers on a coastal province. Speeds embarkation and disembarkation and gives a few ships a place to shelter, without shipbuilding.',
  },
];

/** The exact documented rural set (SPEC Annex B, province facilities). */
export const RURAL_BUILDING_IDS = [
  'outpost',
  'airfield',
  'field_hospital',
  'local_industry',
  'military_logistics',
  'coastal_pontoon',
] as const;
