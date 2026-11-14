/**
 * Research tree — World Command: World 120.
 *
 * Authored nodes (unlocks, national capabilities, missile programs) plus generated unit
 * LEVEL nodes (one per unit level ≥ 2, id `${unitId}_l${level}` unless the unit names an
 * authored node for that level). Level nodes inherit the branch of the unit's unlock node.
 *
 * Opportunity cost: the full tree needs far more research-hours than any country can run
 * in a 180-day campaign with its limited research slots (tested in tests/catalog), so every
 * country must specialize.
 *
 * Missile programs: a `missileProgram` step records program maturity (blueprint → qualified);
 * `unlockMissile` authorizes PRODUCTION. Research never creates inventory — only a completed
 * production job does. `hyp_advanced_materials` is a common prerequisite that grants
 * neither hypersonic family.
 *
 * All costs, hours and day gates are fictional balance values.
 */
import type { ResVec, TechBranch, TechId, TechNode, UnitFamily, UnitType } from '../../engine/data-types';
import { referenceValue } from './resources';
import { UNIT_TYPES } from './units';

type Effects = TechNode['effects'];

function node(
  id: TechId,
  name: string,
  branch: TechBranch,
  tier: number,
  dayAvailable: number,
  prereqs: TechId[],
  cost: ResVec,
  hours: number,
  effects: Effects,
  description: string,
  extra: Partial<Pick<TechNode, 'doctrine' | 'requiresLabLevel'>> = {},
): TechNode {
  return { id, name, branch, tier, dayAvailable, prereqs, cost, hours, effects, description, ...extra };
}

const mod = (key: string, value: number, description: string) => ({ key, value, description });

// ───────────────────────────── authored nodes ─────────────────────────────

const AUTHORED: TechNode[] = [
  // ── Land ──
  node('land_mech_infantry', 'Mechanized Infantry', 'land', 1, 1, [], { money: 1200, components: 60, electronics: 20 }, 48,
    { unlockUnit: ['inf_mechanized'] }, 'Armored carriers for line infantry.'),
  node('land_mbt', 'Main Battle Tanks', 'land', 1, 3, [], { money: 1800, components: 120, electronics: 30 }, 72,
    { unlockUnit: ['arm_mbt'] }, 'Heavy tank production lines.',
    { doctrine: { eastern: { dayAvailable: 1, costMult: 0.85 } } }),
  node('land_marines', 'Naval Infantry', 'land', 2, 6, ['land_mech_infantry'], { money: 1500, components: 80, electronics: 20 }, 60,
    { unlockUnit: ['inf_marine'] }, 'Amphibious assault training for infantry.'),
  node('land_airmobile', 'Air Assault Infantry', 'land', 2, 8, ['land_mech_infantry', 'avi_gunship'], { money: 1700, components: 60, electronics: 40 }, 72,
    { unlockUnit: ['inf_airmobile'] }, 'Helicopter-borne light infantry.'),
  node('land_amphibious_armor', 'Amphibious Armor', 'land', 2, 10, ['land_marines'], { money: 1700, components: 120, electronics: 30 }, 72,
    { unlockUnit: ['arm_amphibious'] }, 'Swimming armored vehicles for landings.'),
  node('land_contractors', 'Contract Forces', 'land', 2, 10, [], { money: 2000, supplies: 100 }, 48,
    { unlockUnit: ['inf_mercenary'] }, 'Legal framework and payroll to hire contract infantry.',
    { doctrine: { western: { costMult: 0.9 } } }),
  node('land_tank_destroyer', 'Tank Hunters', 'land', 2, 12, ['land_mbt'], { money: 1900, components: 120, electronics: 50 }, 72,
    { unlockUnit: ['arm_tank_destroyer'] }, 'Missile-armed anti-armor vehicles.'),
  node('land_special_forces', 'Special Operations', 'land', 3, 20, ['land_airmobile'], { money: 2600, electronics: 60, rare: 6 }, 96,
    { unlockUnit: ['inf_special_forces'] }, 'Elite raid and reconnaissance teams.'),
  node('land_combined_arms', 'Combined Arms Doctrine', 'land', 3, 30, ['land_mbt', 'sup_sp_artillery'], { money: 3000, components: 120, electronics: 80 }, 120,
    { modifiers: [mod('land_attack_mult', 1.05, '+5% attack for land units in mixed stacks of infantry, armor and support')] },
    'Integrated manoeuvre of infantry, armor and fires.'),
  node('land_urban_warfare', 'Urban Warfare', 'land', 3, 40, ['land_special_forces'], { money: 3200, supplies: 200, electronics: 60 }, 120,
    { modifiers: [mod('urban_defense_mult', 1.1, '+10% defence for infantry in urban and suburban provinces')] },
    'Training and equipment for fighting in cities.'),

  // ── Support ──
  node('sup_aa_gun', 'Mobile Anti-Aircraft Guns', 'support', 1, 1, [], { money: 1000, components: 60, electronics: 30 }, 48,
    { unlockUnit: ['sup_aa_gun'] }, 'Self-propelled anti-aircraft guns.'),
  node('sup_sp_artillery', 'Self-Propelled Artillery', 'support', 1, 3, [], { money: 1500, components: 100, electronics: 20 }, 60,
    { unlockUnit: ['sup_sp_artillery'] }, 'Armored howitzers on tracked chassis.'),
  node('sup_mobile_sam', 'Mobile SAM Systems', 'support', 2, 8, ['sup_aa_gun'], { money: 2200, components: 80, electronics: 90, rare: 4 }, 84,
    { unlockUnit: ['sup_sam'] }, 'Road-mobile surface-to-air missiles with search radar.',
    { doctrine: { eastern: { dayAvailable: 5, costMult: 0.9 } } }),
  node('sup_rocket_artillery', 'Rocket Artillery', 'support', 2, 10, ['sup_sp_artillery'], { money: 2200, components: 120, electronics: 50, rare: 4 }, 84,
    { unlockUnit: ['sup_rocket_artillery'] }, 'Multiple rocket launchers.'),
  node('sup_counter_battery', 'Counter-Battery Fire', 'support', 3, 25, ['sup_rocket_artillery', 'rec_mobile_radar'], { money: 2800, components: 80, electronics: 120 }, 108,
    { modifiers: [mod('artillery_range_mult', 1.1, '+10% range for artillery and rocket units')] }, 'Radar-cued artillery fire.'),
  node('sup_theatre_defense', 'Theatre Air and Missile Defence', 'support', 4, 40, ['sup_mobile_sam', 'rec_mobile_radar'], { money: 5200, components: 200, electronics: 260, rare: 30 }, 168,
    { unlockUnit: ['sup_theatre_defense'] }, 'Long-range area air defence with missile interception.', { requiresLabLevel: 4 }),

  // ── Aviation ──
  node('avi_gunship', 'Armed Helicopters', 'aviation', 1, 2, [], { money: 1400, components: 80, electronics: 50 }, 60,
    { unlockUnit: ['heli_gunship'] }, 'Armed utility helicopters.'),
  node('avi_strike_fighter', 'Strike Fighters', 'aviation', 1, 4, [], { money: 2000, components: 100, electronics: 90, rare: 4 }, 84,
    { unlockUnit: ['ftr_strike'] }, 'Multirole ground-attack jets.'),
  node('avi_attack_helicopter', 'Attack Helicopters', 'aviation', 2, 10, ['avi_gunship'], { money: 2400, components: 100, electronics: 100, rare: 6 }, 96,
    { unlockUnit: ['heli_attack'] }, 'Dedicated anti-armor helicopters.'),
  node('avi_maritime_patrol', 'Maritime Patrol Aviation', 'aviation', 2, 10, ['avi_strike_fighter'], { money: 2400, components: 120, electronics: 120, rare: 4 }, 96,
    { unlockUnit: ['hvy_maritime_patrol'] }, 'Long-range anti-submarine patrol aircraft.'),
  node('avi_air_combat_doctrine', 'Air Combat Doctrine', 'aviation', 2, 15, [], { money: 2200, electronics: 80, fuel: 100 }, 84,
    { modifiers: [mod('air_attack_mult', 1.05, '+5% attack for fighters against aircraft and helicopters')] }, 'Tactics and training for air combat.'),
  node('avi_heavy_bomber', 'Heavy Bombers', 'aviation', 3, 25, ['avi_strike_fighter'], { money: 3600, components: 220, electronics: 140, rare: 10 }, 132,
    { unlockUnit: ['hvy_bomber'] }, 'Long-range strategic bombers.'),
  node('avi_stealth_fighter', 'Stealth Air Superiority', 'aviation', 4, 50, ['avi_strike_fighter', 'ind_advanced_electronics_2'], { money: 6500, components: 220, electronics: 380, rare: 60 }, 216,
    { unlockUnit: ['ftr_stealth_air_superiority'] }, 'Low-observable fighter airframes.',
    { requiresLabLevel: 5, doctrine: { western: { dayAvailable: 40 }, eastern: { dayAvailable: 55 } } }),
  node('avi_stealth_strike', 'Stealth Strike Aircraft', 'aviation', 5, 65, ['avi_stealth_fighter'], { money: 6800, components: 240, electronics: 400, rare: 70 }, 216,
    { unlockUnit: ['ftr_stealth_strike'] }, 'Low-observable strike aircraft.', { requiresLabLevel: 5 }),
  node('avi_stealth_bomber', 'Stealth Bombers', 'aviation', 6, 90, ['avi_heavy_bomber', 'avi_stealth_strike'], { money: 8500, components: 320, electronics: 450, rare: 90 }, 264,
    { unlockUnit: ['hvy_stealth_bomber'] }, 'Low-observable intercontinental bombers.',
    { requiresLabLevel: 6, doctrine: { eastern: { hoursMult: 1.15 } } }),

  // ── Naval ──
  node('nav_frigate', 'Ocean Escorts', 'naval', 1, 2, [], { money: 1800, components: 160, electronics: 60 }, 72,
    { unlockUnit: ['nav_frigate'] }, 'Anti-submarine frigates.'),
  node('nav_attack_submarine', 'Attack Submarines', 'naval', 1, 3, [], { money: 2400, components: 200, electronics: 90, rare: 6 }, 96,
    { unlockUnit: ['sub_attack'] }, 'Hunter-killer submarines.'),
  node('nav_destroyer', 'Guided-Missile Destroyers', 'naval', 2, 10, ['nav_frigate'], { money: 3000, components: 260, electronics: 140, rare: 8 }, 120,
    { unlockUnit: ['nav_destroyer'] }, 'Multi-purpose destroyers.'),
  node('nav_asw_helicopter', 'Shipborne ASW Helicopters', 'naval', 2, 12, ['nav_frigate', 'avi_gunship'], { money: 2000, components: 80, electronics: 100 }, 72,
    { unlockUnit: ['heli_asw'] }, 'Sonar-equipped helicopters.'),
  node('nav_fleet_logistics', 'Fleet Logistics', 'naval', 2, 15, ['nav_frigate'], { money: 2400, components: 120, fuel: 150 }, 84,
    { modifiers: [mod('naval_hp_regen_mult', 1.15, '+15% repair rate for ships at sea and in port')] }, 'Replenishment at sea.'),
  node('nav_cruiser', 'Missile Cruisers', 'naval', 3, 30, ['nav_destroyer'], { money: 4800, components: 400, electronics: 220, rare: 16 }, 168,
    { unlockUnit: ['nav_cruiser'] }, 'Large missile cruisers.'),
  node('nav_carrier', 'Fleet Carriers', 'naval', 3, 35, ['nav_destroyer'], { money: 6500, components: 600, electronics: 260, rare: 24 }, 216,
    { unlockUnit: ['nav_carrier'] }, 'Fleet aircraft carriers. A carrier needs the carrier-aviation branch to field an air wing.',
    { doctrine: { western: { costMult: 0.9 }, eastern: { dayAvailable: 45 } } }),
  node('nav_carrier_aviation', 'Carrier-Qualified Naval Aviation', 'naval', 3, 38, ['nav_carrier', 'avi_strike_fighter'], { money: 4200, components: 200, electronics: 240, rare: 12 }, 168,
    {
      unlockUnit: ['ftr_naval_air_superiority', 'ftr_naval_strike'],
      modifiers: [mod('carrier_ops', 1, 'Carrier groups launch and recover patrols at sea; the air wing keeps its own maintenance queue')],
    },
    'Carrier-qualified pilots, deck crews and naval fighters.'),
  node('nav_carrier_aew', 'Carrier Early Warning', 'naval', 4, 50, ['nav_carrier_aviation', 'rec_awacs'], { money: 3800, components: 140, electronics: 260, rare: 10 }, 144,
    { unlockUnit: ['hvy_naval_aew'] }, 'Carrier-based early warning aircraft.'),
  node('nav_ballistic_submarine', 'Strategic Missile Submarines', 'naval', 4, 60, ['nav_attack_submarine', 'str_ballistic_missile_2'], { money: 6000, components: 420, electronics: 260, rare: 30 }, 216,
    { unlockUnit: ['sub_ballistic'] }, 'Quiet submarines that launch ballistic-missile tokens.', { requiresLabLevel: 4 }),

  // ── Reconnaissance ──
  node('rec_scout_vehicle', 'Scout Vehicles', 'recon', 1, 1, [], { money: 900, components: 40, electronics: 30 }, 36,
    { unlockUnit: ['arm_recon'] }, 'Wheeled reconnaissance vehicles.'),
  node('rec_mobile_radar', 'Mobile Radar', 'recon', 1, 4, [], { money: 1500, components: 60, electronics: 100 }, 60,
    { unlockUnit: ['sup_mobile_radar'] }, 'Truck-mounted surveillance radar.'),
  node('rec_uav', 'Combat Drones', 'recon', 2, 10, ['rec_mobile_radar'], { money: 2000, components: 60, electronics: 120, rare: 4 }, 84,
    { unlockUnit: ['ftr_uav'] }, 'Armed long-endurance drones.'),
  node('rec_awacs', 'Airborne Early Warning', 'recon', 3, 28, ['rec_uav', 'avi_strike_fighter'], { money: 3800, components: 150, electronics: 260, rare: 12 }, 144,
    { unlockUnit: ['hvy_awacs'] }, 'Airborne radar and control aircraft.'),
  node('rec_track_comparison', 'Historical Track Comparison', 'recon', 3, 30, ['rec_uav'], { money: 2600, electronics: 160 }, 108,
    { modifiers: [mod('track_history', 1, 'Intel screen can compare a contact\'s dated reports along its observed track')] },
    'Analysis tools that compare a contact\'s past observations. Never creates a new observation.'),
  node('rec_report_processing', 'Team Report Processing', 'recon', 3, 35, ['rec_mobile_radar', 'ind_systems_integration_1'], { money: 2800, electronics: 180 }, 108,
    { modifiers: [mod('report_age_mult', 0.75, 'Dated reports from valid sensors are processed faster (shown fresher by 25%)')] },
    'Faster fusion of reports from valid sensors and treaty partners.'),
  node('rec_broad_area_recon', 'Broad-Area Reconnaissance', 'recon', 4, 45, ['rec_awacs'], { money: 5200, components: 180, electronics: 340, rare: 30 }, 192,
    { unlockUnit: ['rec_broad_area'] }, 'High-altitude long-endurance reconnaissance aircraft.',
    { doctrine: { western: { dayAvailable: 32 } } }),

  // ── Officers ──
  node('off_command_school', 'Command School', 'officer', 1, 5, [], { money: 1500, supplies: 100 }, 48,
    { unlockUnit: ['off_infantry', 'off_armored'] }, 'Trains field commanders for land formations.'),
  node('off_aviation_command', 'Aviation Command', 'officer', 2, 15, ['off_command_school'], { money: 2200, electronics: 60 }, 72,
    { unlockUnit: ['off_helicopter', 'off_fighter'] }, 'Trains helicopter and fighter wing leaders.'),
  node('off_naval_command', 'Naval Command', 'officer', 2, 15, ['off_command_school', 'nav_frigate'], { money: 2200, electronics: 60 }, 72,
    { unlockUnit: ['off_naval', 'off_submarine'] }, 'Trains surface and submarine flotilla commanders.'),
  node('off_airborne_command', 'Airborne Command', 'officer', 2, 18, ['off_command_school', 'land_airmobile'], { money: 2200, supplies: 100 }, 72,
    { unlockUnit: ['off_airborne'] }, 'Trains air-assault leaders.'),
  node('off_staff_college', 'Staff College', 'officer', 3, 40, ['off_command_school'], { money: 3600, electronics: 80 }, 120,
    { modifiers: [mod('officer_bonus_mult', 1.1, 'Officer bonuses are 10% stronger (applied to the bonus portion only)')] }, 'Advanced staff training.'),

  // ── Strategic ──
  node('str_missile_complex', 'Missile Complex', 'strategic', 2, 12, [], { money: 2500, components: 200, electronics: 100, rare: 6 }, 96,
    { unlockBuilding: ['missile_complex'] }, 'Facilities to assemble, store and launch strategic missile tokens.'),
  node('str_cruise_missile_1', 'Conventional Cruise Missiles', 'strategic', 2, 15, ['str_missile_complex'], { money: 3000, components: 160, electronics: 160, rare: 8 }, 120,
    { unlockMissile: ['msl_cruise'], missileProgram: { missile: 'msl_cruise', stage: 'blueprint' }, unlockUnit: ['msl_cruise_launcher'] },
    'A mature powered cruise-missile design: blueprint and production authority in one step, plus a road-mobile launcher.'),
  node('str_cruise_missile_2', 'Extended-Range Cruise Missiles', 'strategic', 3, 35, ['str_cruise_missile_1'], { money: 4000, components: 200, electronics: 220, rare: 14 }, 144,
    { unlockMissile: ['msl_cruise_er'], missileProgram: { missile: 'msl_cruise_er', stage: 'blueprint' }, unitLevel: [{ unit: 'msl_cruise_launcher', level: 2 }] },
    'Longer-range cruise missile and an improved launcher.'),
  node('str_ballistic_missile_1', 'Ballistic Missile Blueprint', 'strategic', 3, 25, ['str_missile_complex', 'ind_systems_integration_1'], { money: 4200, components: 260, electronics: 200, rare: 16 }, 144,
    { missileProgram: { missile: 'msl_ballistic', stage: 'blueprint' } },
    'Design work for an abstract ballistic strategic token. Creates a blueprint only; production needs qualification.'),
  node('str_ballistic_missile_2', 'Ballistic Missile Qualification', 'strategic', 4, 45, ['str_ballistic_missile_1'], { money: 5200, components: 300, electronics: 240, rare: 24 }, 168,
    { missileProgram: { missile: 'msl_ballistic', stage: 'qualified' }, unlockMissile: ['msl_ballistic'], unlockUnit: ['msl_ballistic_launcher'] },
    'Qualification trials. Authorizes production of the ballistic token and its mobile launcher.', { requiresLabLevel: 3 }),
  node('str_unmanned_ground', 'Unmanned Ground Vehicles', 'strategic', 3, 30, ['land_mech_infantry', 'ind_advanced_electronics_1'], { money: 2600, components: 120, electronics: 140 }, 96,
    { unlockUnit: ['dep_ugv'] }, 'Remote breaching vehicles (limited-use deployable).'),
  node('str_swarm_drones', 'Swarm Drones', 'strategic', 4, 45, ['rec_uav', 'ind_advanced_electronics_2'], { money: 3600, components: 100, electronics: 240, rare: 16 }, 132,
    { unlockUnit: ['dep_swarm_uav'] }, 'Expendable drone swarms (limited-use deployable).'),
  node('str_missile_defense_net', 'Integrated Missile Defence', 'strategic', 5, 80, ['sup_theatre_defense', 'rec_report_processing'], { money: 6000, components: 200, electronics: 380, rare: 40 }, 216,
    { modifiers: [mod('missile_defense_rating_bonus', 0.5, '+0.5 missile defence rating in sectors covered by a theatre defence system or missile cruiser')] },
    'Networked sensors and interceptors.', { requiresLabLevel: 5 }),

  // ── Mobility ──
  node('mob_lift_1', 'Strategic Lift I', 'mobility', 1, 1, [], { money: 1500, components: 100, electronics: 30, fuel: 80 }, 60,
    { unlockUnit: ['hvy_strategic_transport'], liftCapacity: 4 }, 'First-tier strategic transport aircraft and +4 abstract lift.'),
  node('mob_sealift_1', 'Sealift I', 'mobility', 1, 1, [], { money: 1400, components: 140, fuel: 60 }, 60,
    { liftCapacity: 4, modifiers: [mod('embark_time_mult', 0.8, 'Embarking and disembarking take 20% less time')] }, 'Chartered and naval transports.'),
  node('mob_rail_logistics', 'Rail Logistics', 'mobility', 2, 10, ['mob_lift_1'], { money: 2000, components: 160, fuel: 60 }, 84,
    { modifiers: [mod('land_speed_mult_own', 1.1, '+10% land movement speed inside own and annexed territory')] }, 'Military rail and road networks.'),
  node('mob_refuel_support', 'Aerial Refuelling Support', 'mobility', 3, 28, ['mob_lift_1', 'avi_strike_fighter'], { money: 3600, components: 180, electronics: 100, fuel: 200 }, 132,
    {
      unlockUnit: ['hvy_tanker'],
      modifiers: [
        mod('air_operational_range_mult', 1.2, '+20% operational range for fighters and heavies'),
        mod('air_endurance_mult', 1.25, '+25% patrol endurance for fighters and heavies'),
      ],
    },
    'Tanker aircraft and refuelling procedures that extend aircraft range and endurance.'),
  node('mob_strategic_airlift_2', 'Strategic Airlift II', 'mobility', 3, 30, ['mob_lift_1'], { money: 3800, components: 240, electronics: 100, fuel: 160 }, 144,
    { unitLevel: [{ unit: 'hvy_strategic_transport', level: 2 }], liftCapacity: 8 }, 'Second-tier strategic transport and +8 abstract lift.'),
  node('mob_sealift_2', 'Sealift II', 'mobility', 3, 35, ['mob_sealift_1'], { money: 3200, components: 300, fuel: 120 }, 120,
    { liftCapacity: 6 }, 'Dedicated roll-on/roll-off transports: +6 abstract lift.'),
  node('mob_forward_basing', 'Forward Basing', 'mobility', 4, 50, ['mob_refuel_support'], { money: 4200, components: 260, fuel: 200 }, 156,
    { modifiers: [mod('rebase_time_mult', 0.8, 'Aircraft rebase 20% faster'), mod('receiving_capacity_mult', 1.25, '+25% receiving capacity for long transfers')] },
    'Pre-positioned stocks and expeditionary airfields.'),
  node('mob_strategic_airlift_3', 'Strategic Airlift III', 'mobility', 5, 75, ['mob_strategic_airlift_2'], { money: 5600, components: 320, electronics: 160, fuel: 240 }, 192,
    { unitLevel: [{ unit: 'hvy_strategic_transport', level: 3 }], liftCapacity: 10 }, 'Third-tier strategic transport and +10 abstract lift.'),

  // ── Industry ──
  node('ind_production_1', 'Industrial Methods I', 'industry', 1, 2, [], { money: 1600, components: 80 }, 60,
    { modifiers: [mod('industrial_output_mult', 1.05, '+5% city resource output')] }, 'Process improvements in national industry.'),
  node('ind_systems_integration_1', 'Systems Integration I', 'industry', 1, 1, [], { money: 1800, components: 60, electronics: 80 }, 72,
    { modifiers: [mod('research_speed_mult', 1.05, '+5% research speed')] }, 'Engineering teams that integrate subsystems into platforms.'),
  node('ind_advanced_electronics_1', 'Advanced Electronics I', 'industry', 1, 3, [], { money: 1800, components: 80, electronics: 60, rare: 4 }, 72,
    { modifiers: [mod('electronics_output_mult', 1.08, '+8% electronics output')] }, 'Modern fabrication of sensors and circuits.'),
  node('ind_extraction_1', 'Resource Extraction I', 'industry', 1, 1, [], { money: 1400, components: 100 }, 60,
    { modifiers: [mod('rural_output_mult', 1.1, '+10% output from rural deposits')] }, 'Better mining and drilling.'),
  node('ind_sustainment_1', 'Industrial Sustainment I', 'industry', 2, 1, [], { money: 2000, components: 120, electronics: 30 }, 72,
    { maintenanceSlots: 2, modifiers: [mod('refit_speed_mult', 1.1, 'Refits restore readiness 10% faster')] }, '+2 national maintenance slots.'),
  node('ind_fuel_efficiency', 'Fuel Efficiency', 'industry', 2, 15, ['ind_production_1'], { money: 2400, components: 100, electronics: 60 }, 84,
    { modifiers: [mod('fuel_upkeep_mult', 0.9, '-10% fuel upkeep for all units')] }, 'Efficient engines and logistics.'),
  node('ind_systems_integration_2', 'Systems Integration II', 'industry', 2, 20, ['ind_systems_integration_1'], { money: 3200, components: 80, electronics: 160, rare: 8 }, 120,
    { modifiers: [mod('research_speed_mult', 1.05, '+5% research speed (stacks)'), mod('unit_electronics_cost_mult', 0.95, '-5% electronics in unit costs')] },
    'Model-based engineering across programs.'),
  node('ind_production_2', 'Industrial Methods II', 'industry', 2, 20, ['ind_production_1'], { money: 2800, components: 160 }, 108,
    { modifiers: [mod('industrial_output_mult', 1.05, '+5% city resource output (stacks)')] }, 'Automated lines.'),
  node('ind_advanced_electronics_2', 'Advanced Electronics II', 'industry', 2, 25, ['ind_advanced_electronics_1'], { money: 3400, components: 100, electronics: 140, rare: 12 }, 132,
    { modifiers: [mod('electronics_output_mult', 1.08, '+8% electronics output (stacks)'), mod('radar_range_mult', 1.05, '+5% radar range')] },
    'Advanced semiconductors and sensor processing.'),
  node('ind_sustainment_2', 'Industrial Sustainment II', 'industry', 3, 35, ['ind_sustainment_1'], { money: 3600, components: 220, electronics: 80 }, 132,
    { maintenanceSlots: 3, modifiers: [mod('refit_speed_mult', 1.2, 'Refits restore readiness 20% faster (replaces tier I)')] }, '+3 national maintenance slots.'),
  node('ind_extraction_2', 'Resource Extraction II', 'industry', 3, 40, ['ind_extraction_1'], { money: 2800, components: 200 }, 108,
    { modifiers: [mod('rural_output_mult', 1.1, '+10% output from rural deposits (stacks)')] }, 'Deep extraction.'),
  node('ind_production_3', 'Industrial Methods III', 'industry', 4, 55, ['ind_production_2'], { money: 4600, components: 260, electronics: 80 }, 168,
    { modifiers: [mod('industrial_output_mult', 1.05, '+5% city resource output (stacks)')] }, 'Flexible manufacturing.'),
  node('ind_systems_integration_3', 'Systems Integration III', 'industry', 4, 60, ['ind_systems_integration_2'], { money: 5500, components: 120, electronics: 300, rare: 25 }, 192,
    { modifiers: [mod('research_speed_mult', 1.05, '+5% research speed (stacks)'), mod('unit_electronics_cost_mult', 0.95, '-5% electronics in unit costs (stacks)')] },
    'Digital engineering across the defence industry.', { requiresLabLevel: 6 }),
  node('ind_advanced_electronics_3', 'Advanced Electronics III', 'industry', 4, 65, ['ind_advanced_electronics_2', 'ind_systems_integration_2'], { money: 5800, components: 140, electronics: 280, rare: 30 }, 204,
    { modifiers: [mod('electronics_output_mult', 1.08, '+8% electronics output (stacks)'), mod('radar_range_mult', 1.05, '+5% radar range (stacks)')] },
    'Next-generation sensors and processors.', { requiresLabLevel: 6 }),

  // ── Hypersonic ──
  node('hyp_advanced_materials', 'Advanced High-Temperature Materials', 'hypersonic', 4, 40, ['ind_advanced_electronics_1', 'ind_systems_integration_1'], { money: 5000, components: 200, electronics: 200, rare: 50 }, 192,
    {}, 'Common prerequisite for BOTH hypersonic families. Grants neither family by itself.', { requiresLabLevel: 4 }),
  node('hyp_glide_blueprint', 'Boost-Glide Blueprint', 'hypersonic', 5, 70, ['hyp_advanced_materials', 'str_ballistic_missile_1'], { money: 7000, components: 260, electronics: 300, rare: 80 }, 216,
    { missileProgram: { missile: 'msl_hgv', stage: 'blueprint' } },
    'Step 1 of 2 for the boost-glide system: a blueprint only, no production authority.', { requiresLabLevel: 5 }),
  node('hyp_glide_qualified', 'Boost-Glide Qualification', 'hypersonic', 6, 95, ['hyp_glide_blueprint'], { money: 8000, components: 300, electronics: 320, rare: 90 }, 240,
    { missileProgram: { missile: 'msl_hgv', stage: 'qualified' }, unlockMissile: ['msl_hgv'] },
    'Step 2 of 2: qualification authorizes small-batch production. Inventory exists only after production completes.', { requiresLabLevel: 5 }),
  node('hyp_cruise_blueprint', 'Hypersonic Cruise Blueprint', 'hypersonic', 6, 100, ['hyp_advanced_materials', 'str_cruise_missile_1', 'ind_advanced_electronics_2'], { money: 7500, components: 180, electronics: 380, rare: 90, fuel: 150 }, 216,
    { missileProgram: { missile: 'msl_hcm', stage: 'blueprint' } },
    'Separate late branch for an air-breathing hypersonic cruise missile. Does not require the glide program.', { requiresLabLevel: 5 }),
  node('hyp_cruise_qualified', 'Hypersonic Cruise Qualification', 'hypersonic', 7, 125, ['hyp_cruise_blueprint'], { money: 8500, components: 200, electronics: 400, rare: 100, fuel: 180 }, 240,
    { missileProgram: { missile: 'msl_hcm', stage: 'qualified' }, unlockMissile: ['msl_hcm'] },
    'Qualification authorizes production of the hypersonic cruise missile.', { requiresLabLevel: 6 }),
];

// ───────────────────────────── generated level nodes ─────────────────────────────

const FAMILY_BRANCH: Record<UnitFamily, TechBranch> = {
  infantry: 'land',
  armor: 'land',
  support: 'support',
  air_defense: 'support',
  recon: 'recon',
  helicopter: 'aviation',
  fighter: 'aviation',
  heavy: 'aviation',
  naval: 'naval',
  submarine: 'naval',
  missile_launcher: 'strategic',
  officer: 'officer',
  deployable: 'strategic',
};

/** Day offset of level N relative to the unit's unlock day. */
const LEVEL_DAY_OFFSET = [0, 0, 10, 25, 45];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

function round50(n: number): number {
  return Math.max(50, Math.round(n / 50) * 50);
}

function levelNodes(units: UnitType[], authored: Map<TechId, TechNode>): TechNode[] {
  const out: TechNode[] = [];
  const known = new Map(authored);
  for (const u of units) {
    const unlock = u.unlockTech ? known.get(u.unlockTech) : undefined;
    const unlockDay = unlock?.dayAvailable ?? 1;
    const unlockTier = unlock?.tier ?? 1;
    const branch = unlock?.branch ?? FAMILY_BRANCH[u.family];
    const v = referenceValue(u.cost);
    for (const lvl of u.levels) {
      if (lvl.level < 2 || !lvl.tech || known.has(lvl.tech)) continue;
      const k = lvl.level - 1;
      const prev = u.levels[lvl.level - 2].tech ?? u.unlockTech;
      const prereqs = prev ? [prev] : [];
      const prereqDay = Math.max(0, ...prereqs.map((p) => known.get(p)?.dayAvailable ?? 1));
      const day = Math.min(160, Math.max(prereqDay, unlockDay + LEVEL_DAY_OFFSET[Math.min(4, lvl.level)]));
      const cost: ResVec = {
        money: round50((400 + v * 0.35) * Math.pow(k, 0.8)),
        components: Math.round(v * 0.012 * k),
        electronics: Math.round(v * 0.012 * k),
      };
      if (u.cost.rare) cost.rare = Math.max(1, Math.round(u.cost.rare * 0.5 * k));
      const n = node(
        lvl.tech,
        `${u.name} ${ROMAN[lvl.level]}`,
        branch,
        unlockTier + k,
        day,
        prereqs,
        cost,
        66 + 44 * k + Math.min(144, Math.round(v / 80)),
        { unitLevel: [{ unit: u.id, level: lvl.level }] },
        `Upgrades every existing and future ${u.name} to level ${lvl.level} at the next tick after completion.`,
      );
      known.set(n.id, n);
      out.push(n);
    }
  }
  return out;
}

const AUTHORED_MAP = new Map(AUTHORED.map((n) => [n.id, n]));

export const TECH_NODES: TechNode[] = [...AUTHORED, ...levelNodes(UNIT_TYPES, AUTHORED_MAP)];

/**
 * Suggested engine rule (documented in docs/CATALOG.md): national research slots =
 * 1 + Σ research_lab researchSlots, capped at MAX_NATIONAL_RESEARCH_SLOTS. With the best lab
 * speed (×1.35) and all systems-integration bonuses (×1.05³) a country still cannot finish
 * the tree in 180 days (asserted in tests/catalog).
 */
export const MAX_NATIONAL_RESEARCH_SLOTS = 4;
export const CAMPAIGN_DAYS = 180;

/** Branch display order for the research screen. */
export const TECH_BRANCHES: { id: TechBranch; name: string; description: string }[] = [
  { id: 'land', name: 'Land Forces', description: 'Infantry and armor blueprints, levels and land doctrine.' },
  { id: 'support', name: 'Support & Air Defence', description: 'Artillery, rocket artillery and layered air and missile defence.' },
  { id: 'aviation', name: 'Aviation', description: 'Helicopters, fighters, bombers and patrol aircraft.' },
  { id: 'naval', name: 'Naval', description: 'Surface fleet, submarines and carrier-qualified naval aviation.' },
  { id: 'recon', name: 'Reconnaissance', description: 'Scouts, radars, drones, early warning and broad-area reconnaissance.' },
  { id: 'officer', name: 'Officers', description: 'Field commanders that boost eligible units in their stack.' },
  { id: 'strategic', name: 'Strategic', description: 'Missile complexes, cruise and ballistic tokens, deployables.' },
  { id: 'industry', name: 'Industry', description: 'Output, electronics, systems integration and sustainment.' },
  { id: 'mobility', name: 'Mobility', description: 'Strategic lift, sealift, refuelling support and basing.' },
  { id: 'hypersonic', name: 'Hypersonic', description: 'Advanced materials and the separate glide and cruise programs.' },
];
