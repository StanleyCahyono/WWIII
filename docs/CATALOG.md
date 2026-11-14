# Catalog — World Command: World 120

_Owner: catalog agent. Source of truth: `src/data/catalog/**` (typed against `src/engine/data-types.ts`).
Tables below were generated from the live data on 2026-11-14; if they disagree with the code, the code wins.
All names are original and all numbers are fictional game-balance values._

| Module | Export | Count |
| --- | --- | ---: |
| `resources.ts` | `RESOURCE_DEFS`, `referenceValue()` | 7 resources |
| `units.ts` | `UNIT_TYPES`, `DIRECTORY_GROUPS` | 55 unit types |
| `buildings.ts` | `BUILDING_TYPES`, `RURAL_BUILDING_IDS` | 20 buildings (14 city, 6 rural) |
| `tech.ts` | `TECH_NODES`, `TECH_BRANCHES`, `MAX_NATIONAL_RESEARCH_SLOTS` | 195 nodes (82 authored, 113 generated level nodes) |
| `missiles.ts` | `MISSILE_TYPES`, `PROGRAM_MATURITY_ORDER`, `EXCLUDED_WARHEADS`, `flightMinutes()` | 5 missile types |
| `sidc.ts` | `SYMBOL_CROSSWALK`, `buildSidc()`, `resolveSymbol()`, `validateSidc()` | 72 symbol entries |
| `symbol-render.ts` | `renderSymbolSvg()`, `renderSymbol()`, `isRenderable()` (only module importing milsymbol) | — |
| `index.ts` | `CATALOG`, `unitById`, `techById`, `buildingById`, `missileById`, `resourceById`, `symbolByKey`, `STARTER_UNITS` | — |

`index.ts` is dependency-free apart from the data contract, so the engine and its Web Worker import the
catalog without pulling in the renderer.

## Resources and economic scale

| Resource | Ref. price | Role |
| --- | ---: | --- |
| supplies | 3 | Rations, ammunition, stores: infantry mobilization, all upkeep, construction. |
| components | 6 | Parts and steel: armor, artillery, ships, buildings. |
| electronics | 12 | Sensors, avionics, guidance: aircraft, radars, air defence, missiles, research. |
| fuel | 5 | Mostly upkeep (vehicles, aircraft, ships) plus lift and long transfers. |
| rare | 20 | Specialty alloys/rare earths: advanced units, stealth, missiles, hypersonics. |
| manpower | 4 | Recruits and crews; infantry-heavy. |
| money | 1 | Wages, procurement, research, market trades. |

Reference prices are fixed published values (money = 1) used only by the opening power index and AI valuation.
`referenceValue(vec)` prices a resource vector with this basket.

**Scale guide for profile authors.** A motorized infantry battalion costs ≈615 reference value and ≈18/day upkeep;
a fleet carrier ≈14,450 and ≈300/day. Default unit upkeep is derived from mobilization cost (supplies 4%, components 1%,
electronics 1%, fuel 12%, manpower 2%, money 2% per day; rare materials have no upkeep), with authored exceptions
(militia cheap, contractors money-heavy, officers flat 10 money). A mid-size country producing roughly 600 supplies,
300 components, 150 electronics, 300 fuel, 60 rare, 400 manpower and 2,000 money per day can field and sustain a
regional force; a full research run of the tree costs ≈503,000 money plus electronics, components and rare materials.

## Units

Directory groups (SPEC Annex B) map to catalog families: Infantry → `infantry`; Armored → `armor`;
Support → `support` (artillery), `air_defense` (AA gun, SAM, theatre defence) and `recon` (mobile radar, broad-area
reconnaissance aircraft); Helicopters → `helicopter`; Fighters → `fighter`; Heavies → `heavy`; Naval → `naval`;
Submarines → `submarine`; Missiles → `missile_launcher` (+ missile tokens in `missiles.ts`); Officers → `officer`;
Deployables → `deployable`.

| Family | Units | Role |
| --- | ---: | --- |
| infantry | 7 | Occupiers. Motorized and militia are starters; marines land from the sea; air assault rebases by air; commandos are low-observable scouts; contractors trade money for manpower. |
| armor | 5 | Front-line punch. Light AFV is a starter; scout car identifies contacts; MBT breaks through in open terrain; tank hunter counters armor; amphibious carrier crosses short coastal hops. |
| support | 3 | Indirect fire from range (towed starter, self-propelled, rocket). Rear echelon, cannot capture. |
| air_defense | 3 | AA gun (anti-helicopter), mobile SAM, theatre defence (the only land unit with missile interception). |
| recon | 2 | Mobile radar (land/sea/air picture) and the broad-area reconnaissance aircraft (U.S. observation family). |
| helicopter | 3 | Gunship, attack (anti-armor), ASW (sonar, carrier-capable). |
| fighter | 7 | Air superiority (starter), carrier fighter, stealth interceptor, strike, carrier striker, stealth striker, combat drone. |
| heavy | 7 | Maritime patrol, AEW, carrier AEW, heavy bomber, stealth bomber, strategic airlifter (+lift), aerial tanker. |
| naval | 5 | Corvette (starter), frigate (ASW), destroyer, cruiser (missile interception), carrier (8 slots for carrier-capable aircraft). |
| submarine | 2 | Attack (signature 2) and ballistic-missile (signature 3, launch platform). |
| missile_launcher | 2 | Land-mobile cruise and ballistic launchers (`launch` order; they launch inventory, never create it). |
| officer | 7 | Infantry, airborne, armored, helicopter, fighter, naval, submarine. `officerBonus` applies to eligible families in the same stack; **one active officer per officer type per stack**. |
| deployable | 2 | Unmanned ground vehicle (2 uses, breach) and swarm drones (1 use, saturation strike). |

Echelon: infantry, armor, front-line ships, fighters and attack helicopters are echelon 1 (take damage first);
tank hunters, strike aircraft, cruisers are 2; artillery, air defence, radar, launchers, heavies, carriers,
officers are 3. `capture` is true only for land infantry and armor. Stealth airframes have signature 3; submarines 2–3
and are detected only by sensors whose `radarDetects` includes `subsurface` (all of which carry the "Sonar / ASW"
feature). Late levels of AEW, broad-area recon, mobile radar and theatre defence reach radar sensitivity 3 and can
detect stealth. Doctrine variations: eastern cheaper armor and stronger air defence/artillery, western better air
attack (electronics) at higher cost, European balanced. Level growth: +15% HP, +18% attack, +15% defence,
+8% sight per level.

Additive fields used: `carrierCapable` (only these aircraft use carrier `carries` slots) and `liftCapacity`
(abstract lift added by a fielded transport). See "Contract changes".

| Family | Id | Name | Domain / class | Ech. | Capture | Unlock | Lv | HP L1 | Speed | Cost (ref. value) | Build h | Requires |
| --- | --- | --- | --- | ---: | :---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| infantry | `inf_motorized` | Wayfarer Motor Rifles | land / unarmored | 1 | yes | starter | 4 | 18 | 45 | 615 | 18 | army_base 1 |
| infantry | `inf_mechanized` | Bulwark Mechanized Infantry | land / armored | 1 | yes | `land_mech_infantry` | 4 | 24 | 50 | 1145 | 30 | army_base 2 |
| infantry | `inf_marine` | Tidewall Marines | land / unarmored | 1 | yes | `land_marines` | 3 | 20 | 42 | 920 | 28 | army_base 2, naval_base 1 |
| infantry | `inf_airmobile` | Skylance Air Assault | land / unarmored | 1 | yes | `land_airmobile` | 3 | 18 | 55 | 1081 | 30 | army_base 2, air_base 1 |
| infantry | `inf_special_forces` | Nightglass Commandos | land / unarmored | 1 | yes | `land_special_forces` | 3 | 16 | 48 | 1170 | 36 | army_base 3 |
| infantry | `inf_militia` | Hearthguard Militia | land / unarmored | 1 | yes | starter | 3 | 16 | 35 | 444 | 12 | army_base 1 |
| infantry | `inf_mercenary` | Freeblade Contractors | land / unarmored | 1 | yes | `land_contractors` | 3 | 16 | 45 | 840 | 8 | army_base 1 |
| armor | `arm_recon` | Pathfinder Scout Car | land / armored | 1 | yes | `rec_scout_vehicle` | 3 | 16 | 70 | 895 | 24 | army_base 1 |
| armor | `arm_afv` | Ironhide Armored Carrier | land / armored | 1 | yes | starter | 4 | 22 | 55 | 1003 | 30 | army_base 1 |
| armor | `arm_amphibious` | Surfrider Amphibious Carrier | land / armored | 1 | yes | `land_amphibious_armor` | 3 | 22 | 50 | 1216 | 34 | army_base 2, naval_base 1 |
| armor | `arm_mbt` | Warden Battle Tank | land / armored | 1 | yes | `land_mbt` | 4 | 32 | 45 | 1900 | 44 | army_base 3 |
| armor | `arm_tank_destroyer` | Hornet Tank Hunter | land / armored | 2 | yes | `land_tank_destroyer` | 3 | 24 | 48 | 1610 | 38 | army_base 3 |
| support | `sup_towed_artillery` | Longbow Field Gun | land / unarmored | 3 | — | starter | 4 | 14 | 30 | 835 | 24 | army_base 1 |
| support | `sup_sp_artillery` | Thunderclap Self-Propelled Gun | land / armored | 3 | — | `sup_sp_artillery` | 4 | 20 | 45 | 1530 | 40 | army_base 2 |
| support | `sup_rocket_artillery` | Hailstorm Rocket Battery | land / unarmored | 3 | — | `sup_rocket_artillery` | 3 | 16 | 45 | 1720 | 40 | army_base 3 |
| air_defense | `sup_aa_gun` | Skyshield Gun Carrier | land / armored | 3 | — | `sup_aa_gun` | 4 | 18 | 50 | 1170 | 30 | army_base 1 |
| air_defense | `sup_sam` | Lancet Mobile SAM | land / armored | 3 | — | `sup_mobile_sam` | 4 | 16 | 45 | 1885 | 40 | army_base 2 |
| air_defense | `sup_theatre_defense` | Bastion Theatre Defence System | land / armored | 3 | — | `sup_theatre_defense` | 3 | 20 | 35 | 3785 | 72 | army_base 3 |
| recon | `sup_mobile_radar` | Watchtower Mobile Radar | land / unarmored | 3 | — | `rec_mobile_radar` | 3 | 10 | 45 | 1630 | 36 | army_base 2 |
| recon | `rec_broad_area` | Highwatch Broad-Area Reconnaissance Aircraft | air / airplane | 3 | — | `rec_broad_area_recon` | 3 | 20 | 750 | 5157 | 80 | air_base 3 |
| helicopter | `heli_gunship` | Rotorhawk Gunship | air / helicopter | 1 | — | `avi_gunship` | 3 | 18 | 260 | 1510 | 36 | air_base 1 |
| helicopter | `heli_attack` | Talonblade Attack Helicopter | air / helicopter | 1 | — | `avi_attack_helicopter` | 4 | 20 | 280 | 2065 | 44 | air_base 2 |
| helicopter | `heli_asw` | Seawhirl ASW Helicopter | air / helicopter | 2 | — | `nav_asw_helicopter` | 3 | 16 | 250 | 1970 | 40 | air_base 1 |
| fighter | `ftr_air_superiority` | Falconet Air Superiority Fighter | air / airplane | 1 | — | starter | 4 | 22 | 1300 | 2540 | 48 | air_base 2 |
| fighter | `ftr_naval_air_superiority` | Petrel Carrier Fighter | air / airplane | 1 | — | `nav_carrier_aviation` | 3 | 22 | 1250 | 2915 | 52 | air_base 2 |
| fighter | `ftr_stealth_air_superiority` | Shade Stealth Interceptor | air / airplane | 1 | — | `avi_stealth_fighter` | 3 | 24 | 1450 | 4750 | 72 | air_base 4 |
| fighter | `ftr_strike` | Harrow Strike Fighter | air / airplane | 2 | — | `avi_strike_fighter` | 4 | 22 | 1150 | 2710 | 50 | air_base 2 |
| fighter | `ftr_naval_strike` | Wavecrest Carrier Striker | air / airplane | 2 | — | `nav_carrier_aviation` | 3 | 22 | 1100 | 3085 | 54 | air_base 2 |
| fighter | `ftr_stealth_strike` | Duskveil Stealth Striker | air / airplane | 2 | — | `avi_stealth_strike` | 3 | 24 | 1250 | 5160 | 76 | air_base 4 |
| fighter | `ftr_uav` | Farsight Combat Drone | air / airplane | 2 | — | `rec_uav` | 3 | 10 | 400 | 1377 | 30 | air_base 1 |
| heavy | `hvy_maritime_patrol` | Tidewatcher Maritime Patrol Aircraft | air / airplane | 3 | — | `avi_maritime_patrol` | 3 | 26 | 750 | 3288 | 60 | air_base 3 |
| heavy | `hvy_awacs` | Skyloom Airborne Early Warning | air / airplane | 3 | — | `rec_awacs` | 3 | 26 | 800 | 4668 | 72 | air_base 3 |
| heavy | `hvy_naval_aew` | Deckeye Carrier Early Warning | air / airplane | 3 | — | `nav_carrier_aew` | 3 | 22 | 650 | 3755 | 64 | air_base 2 |
| heavy | `hvy_bomber` | Stormbringer Heavy Bomber | air / airplane | 3 | — | `avi_heavy_bomber` | 3 | 36 | 900 | 4640 | 84 | air_base 3 |
| heavy | `hvy_stealth_bomber` | Nightfall Stealth Bomber | air / airplane | 3 | — | `avi_stealth_bomber` | 3 | 36 | 950 | 7870 | 120 | air_base 4 |
| heavy | `hvy_strategic_transport` | Longhaul Strategic Airlifter | air / airplane | 3 | — | `mob_lift_1` | 3 | 30 | 800 | 3498 | 72 | air_base 3 |
| heavy | `hvy_tanker` | Wellspring Aerial Tanker | air / airplane | 3 | — | `mob_refuel_support` | 3 | 28 | 850 | 3473 | 70 | air_base 3 |
| naval | `nav_corvette` | Wavecutter Corvette | sea / ship | 1 | — | starter | 4 | 30 | 50 | 2330 | 60 | naval_base 1 |
| naval | `nav_frigate` | Keelguard Frigate | sea / ship | 1 | — | `nav_frigate` | 4 | 40 | 50 | 3665 | 84 | naval_base 2 |
| naval | `nav_destroyer` | Riptide Destroyer | sea / ship | 1 | — | `nav_destroyer` | 4 | 52 | 55 | 5735 | 110 | naval_base 3 |
| naval | `nav_cruiser` | Monolith Guided-Missile Cruiser | sea / ship | 2 | — | `nav_cruiser` | 3 | 70 | 50 | 8400 | 140 | naval_base 4 |
| naval | `nav_carrier` | Skyharbor Fleet Carrier | sea / ship | 3 | — | `nav_carrier` | 3 | 110 | 45 | 14450 | 220 | naval_base 5 |
| submarine | `sub_attack` | Deepstalker Attack Submarine | subsurface / submarine | 1 | — | `nav_attack_submarine` | 4 | 40 | 40 | 4570 | 110 | naval_base 2 |
| submarine | `sub_ballistic` | Abyssal Strategic Submarine | subsurface / submarine | 3 | — | `nav_ballistic_submarine` | 3 | 50 | 35 | 7970 | 170 | naval_base 4 |
| missile_launcher | `msl_cruise_launcher` | Arrowhead Cruise Launcher | land / armored | 3 | — | `str_cruise_missile_1` | 3 | 14 | 45 | 1785 | 40 | army_base 2 |
| missile_launcher | `msl_ballistic_launcher` | Spireheart Ballistic Launcher | land / armored | 3 | — | `str_ballistic_missile_2` | 3 | 16 | 40 | 2905 | 56 | army_base 3 |
| officer | `off_infantry` | Line Infantry Commander | land / unarmored | 3 | — | `off_command_school` | 2 | 8 | 50 | 740 | 24 | army_base 2 |
| officer | `off_airborne` | Airborne Commander | land / unarmored | 3 | — | `off_airborne_command` | 2 | 8 | 55 | 740 | 24 | army_base 3 |
| officer | `off_armored` | Armored Commander | land / armored | 3 | — | `off_command_school` | 2 | 8 | 50 | 740 | 24 | army_base 2 |
| officer | `off_helicopter` | Rotary Wing Commander | air / helicopter | 3 | — | `off_aviation_command` | 2 | 8 | 260 | 740 | 24 | air_base 2 |
| officer | `off_fighter` | Air Wing Commander | air / airplane | 3 | — | `off_aviation_command` | 2 | 8 | 1100 | 740 | 24 | air_base 2 |
| officer | `off_naval` | Flotilla Commander | sea / ship | 3 | — | `off_naval_command` | 2 | 8 | 50 | 740 | 24 | naval_base 2 |
| officer | `off_submarine` | Undersea Commander | subsurface / submarine | 3 | — | `off_naval_command` | 2 | 8 | 40 | 740 | 24 | naval_base 2 |
| deployable | `dep_ugv` | Groundhog Unmanned Ground Vehicle | land / armored | 1 | — | `str_unmanned_ground` | 2 | 8 | 35 | 835 | 16 | army_base 2 |
| deployable | `dep_swarm_uav` | Hivecloud Swarm Drones | air / airplane | 2 | — | `str_swarm_drones` | 2 | 6 | 300 | 980 | 16 | air_base 1 |

### Upgrade rule

**Existing and newly produced units obey one rule: a completed level tech applies to all existing and future units
of that type at the next tick.** A unit in production when the tech completes is delivered at the new level; the
research charge is taken once, at research start (see below). Level 1 is granted by `unlockTech` (`null` = starter).

## Research

Ten branches. Authored nodes cover blueprints, national capabilities and missile programs; every unit level ≥ 2 has a
generated node `<unitId>_l<level>` (except transport L2/L3 = `mob_strategic_airlift_2/3`, cruise launcher L2 =
`str_cruise_missile_2`) inheriting the branch of the unit's unlock node, with `dayAvailable` = unlock day +10/+25/+45
and cost/hours scaled from the unit's reference value.

| Branch | Nodes | Authored | Generated level nodes | Research hours |
| --- | ---: | ---: | ---: | ---: |
| land | 36 | 10 | 26 | 4839 |
| support | 22 | 6 | 16 | 3270 |
| aviation | 30 | 9 | 21 | 5174 |
| naval | 36 | 10 | 26 | 6656 |
| recon | 17 | 7 | 10 | 2392 |
| officer | 12 | 5 | 7 | 1217 |
| strategic | 13 | 8 | 5 | 1870 |
| mobility | 10 | 8 | 2 | 1298 |
| industry | 14 | 14 | 0 | 1584 |
| hypersonic | 5 | 5 | 0 | 1104 |
| **total** | **195** | | | **29404** |

**Opportunity cost.** The tree needs 29,404 research-hours. The required sanity bound is 180 days × 3 slots × 24 h =
12,960 h. Suggested engine rule: national research slots = 1 + Σ `research_lab.researchSlots`, capped at
`MAX_NATIONAL_RESEARCH_SLOTS` = 4; even at the best lab speed (×1.35) with all systems-integration bonuses (×1.05³)
a country gets ≈27,000 h in 180 days, before day gates and prerequisite chains. Nobody researches everything.

**U.S. package node ids** (referenced by profiles): `mob_lift_1`, `mob_strategic_airlift_2`, `mob_refuel_support`,
`nav_carrier_aviation`, `rec_broad_area_recon` (plus `rec_track_comparison`, `rec_report_processing`),
`ind_systems_integration_1/2/3`, `ind_advanced_electronics_1/2/3`, `ind_sustainment_1/2`, `hyp_advanced_materials`.
A profile that starts with a node must also list its prerequisites.

**Hypersonic programs.** `hyp_advanced_materials` is the common prerequisite and grants neither family.
HGV: `hyp_glide_blueprint` (blueprint only) → `hyp_glide_qualified` (production authority); also needs
`str_ballistic_missile_1` (booster). HCM: `hyp_cruise_blueprint` → `hyp_cruise_qualified`, a separate late branch that
needs `str_cruise_missile_1` and `ind_advanced_electronics_2` but no glide node. Earliest finish with unlimited slots:
both before day 170 (tested), so peers can complete either branch in a legal playthrough.

### Authored nodes

| Id | Branch | Tier | Day | Prereqs | Hours | Effect |
| --- | --- | ---: | ---: | --- | ---: | --- |
| `land_mech_infantry` | land | 1 | 1 | — | 48 | units: inf_mechanized |
| `land_mbt` | land | 1 | 3 | — | 72 | units: arm_mbt |
| `land_marines` | land | 2 | 6 | land_mech_infantry | 60 | units: inf_marine |
| `land_airmobile` | land | 2 | 8 | land_mech_infantry, avi_gunship | 72 | units: inf_airmobile |
| `land_amphibious_armor` | land | 2 | 10 | land_marines | 72 | units: arm_amphibious |
| `land_contractors` | land | 2 | 10 | — | 48 | units: inf_mercenary |
| `land_tank_destroyer` | land | 2 | 12 | land_mbt | 72 | units: arm_tank_destroyer |
| `land_special_forces` | land | 3 | 20 | land_airmobile | 96 | units: inf_special_forces |
| `land_combined_arms` | land | 3 | 30 | land_mbt, sup_sp_artillery | 120 | land_attack_mult 1.05 |
| `land_urban_warfare` | land | 3 | 40 | land_special_forces | 120 | urban_defense_mult 1.1 |
| `sup_aa_gun` | support | 1 | 1 | — | 48 | units: sup_aa_gun |
| `sup_sp_artillery` | support | 1 | 3 | — | 60 | units: sup_sp_artillery |
| `sup_mobile_sam` | support | 2 | 8 | sup_aa_gun | 84 | units: sup_sam |
| `sup_rocket_artillery` | support | 2 | 10 | sup_sp_artillery | 84 | units: sup_rocket_artillery |
| `sup_counter_battery` | support | 3 | 25 | sup_rocket_artillery, rec_mobile_radar | 108 | artillery_range_mult 1.1 |
| `sup_theatre_defense` | support | 4 | 40 | sup_mobile_sam, rec_mobile_radar | 168 | units: sup_theatre_defense |
| `avi_gunship` | aviation | 1 | 2 | — | 60 | units: heli_gunship |
| `avi_strike_fighter` | aviation | 1 | 4 | — | 84 | units: ftr_strike |
| `avi_attack_helicopter` | aviation | 2 | 10 | avi_gunship | 96 | units: heli_attack |
| `avi_maritime_patrol` | aviation | 2 | 10 | avi_strike_fighter | 96 | units: hvy_maritime_patrol |
| `avi_air_combat_doctrine` | aviation | 2 | 15 | — | 84 | air_attack_mult 1.05 |
| `avi_heavy_bomber` | aviation | 3 | 25 | avi_strike_fighter | 132 | units: hvy_bomber |
| `avi_stealth_fighter` | aviation | 4 | 50 | avi_strike_fighter, ind_advanced_electronics_2 | 216 | units: ftr_stealth_air_superiority |
| `avi_stealth_strike` | aviation | 5 | 65 | avi_stealth_fighter | 216 | units: ftr_stealth_strike |
| `avi_stealth_bomber` | aviation | 6 | 90 | avi_heavy_bomber, avi_stealth_strike | 264 | units: hvy_stealth_bomber |
| `nav_frigate` | naval | 1 | 2 | — | 72 | units: nav_frigate |
| `nav_attack_submarine` | naval | 1 | 3 | — | 96 | units: sub_attack |
| `nav_destroyer` | naval | 2 | 10 | nav_frigate | 120 | units: nav_destroyer |
| `nav_asw_helicopter` | naval | 2 | 12 | nav_frigate, avi_gunship | 72 | units: heli_asw |
| `nav_fleet_logistics` | naval | 2 | 15 | nav_frigate | 84 | naval_hp_regen_mult 1.15 |
| `nav_cruiser` | naval | 3 | 30 | nav_destroyer | 168 | units: nav_cruiser |
| `nav_carrier` | naval | 3 | 35 | nav_destroyer | 216 | units: nav_carrier |
| `nav_carrier_aviation` | naval | 3 | 38 | nav_carrier, avi_strike_fighter | 168 | units: ftr_naval_air_superiority, ftr_naval_strike; carrier_ops 1 |
| `nav_carrier_aew` | naval | 4 | 50 | nav_carrier_aviation, rec_awacs | 144 | units: hvy_naval_aew |
| `nav_ballistic_submarine` | naval | 4 | 60 | nav_attack_submarine, str_ballistic_missile_2 | 216 | units: sub_ballistic |
| `rec_scout_vehicle` | recon | 1 | 1 | — | 36 | units: arm_recon |
| `rec_mobile_radar` | recon | 1 | 4 | — | 60 | units: sup_mobile_radar |
| `rec_uav` | recon | 2 | 10 | rec_mobile_radar | 84 | units: ftr_uav |
| `rec_awacs` | recon | 3 | 28 | rec_uav, avi_strike_fighter | 144 | units: hvy_awacs |
| `rec_track_comparison` | recon | 3 | 30 | rec_uav | 108 | track_history 1 |
| `rec_report_processing` | recon | 3 | 35 | rec_mobile_radar, ind_systems_integration_1 | 108 | report_age_mult 0.75 |
| `rec_broad_area_recon` | recon | 4 | 45 | rec_awacs | 192 | units: rec_broad_area |
| `off_command_school` | officer | 1 | 5 | — | 48 | units: off_infantry, off_armored |
| `off_aviation_command` | officer | 2 | 15 | off_command_school | 72 | units: off_helicopter, off_fighter |
| `off_naval_command` | officer | 2 | 15 | off_command_school, nav_frigate | 72 | units: off_naval, off_submarine |
| `off_airborne_command` | officer | 2 | 18 | off_command_school, land_airmobile | 72 | units: off_airborne |
| `off_staff_college` | officer | 3 | 40 | off_command_school | 120 | officer_bonus_mult 1.1 |
| `str_missile_complex` | strategic | 2 | 12 | — | 96 | building: missile_complex |
| `str_cruise_missile_1` | strategic | 2 | 15 | str_missile_complex | 120 | units: msl_cruise_launcher; program: msl_cruise blueprint; production: msl_cruise |
| `str_cruise_missile_2` | strategic | 3 | 35 | str_cruise_missile_1 | 144 | levels: msl_cruise_launcher L2; program: msl_cruise_er blueprint; production: msl_cruise_er |
| `str_ballistic_missile_1` | strategic | 3 | 25 | str_missile_complex, ind_systems_integration_1 | 144 | program: msl_ballistic blueprint |
| `str_ballistic_missile_2` | strategic | 4 | 45 | str_ballistic_missile_1 | 168 | units: msl_ballistic_launcher; program: msl_ballistic qualified; production: msl_ballistic |
| `str_unmanned_ground` | strategic | 3 | 30 | land_mech_infantry, ind_advanced_electronics_1 | 96 | units: dep_ugv |
| `str_swarm_drones` | strategic | 4 | 45 | rec_uav, ind_advanced_electronics_2 | 132 | units: dep_swarm_uav |
| `str_missile_defense_net` | strategic | 5 | 80 | sup_theatre_defense, rec_report_processing | 216 | missile_defense_rating_bonus 0.5 |
| `mob_lift_1` | mobility | 1 | 1 | — | 60 | units: hvy_strategic_transport; lift +4 |
| `mob_sealift_1` | mobility | 1 | 4 | — | 60 | lift +4; embark_time_mult 0.8 |
| `mob_rail_logistics` | mobility | 2 | 10 | mob_lift_1 | 84 | land_speed_mult_own 1.1 |
| `mob_refuel_support` | mobility | 3 | 28 | mob_lift_1, avi_strike_fighter | 132 | units: hvy_tanker; air_operational_range_mult 1.2, air_endurance_mult 1.25 |
| `mob_strategic_airlift_2` | mobility | 3 | 30 | mob_lift_1 | 144 | levels: hvy_strategic_transport L2; lift +8 |
| `mob_sealift_2` | mobility | 3 | 35 | mob_sealift_1 | 120 | lift +6 |
| `mob_forward_basing` | mobility | 4 | 50 | mob_refuel_support | 156 | rebase_time_mult 0.8, receiving_capacity_mult 1.25 |
| `mob_strategic_airlift_3` | mobility | 5 | 75 | mob_strategic_airlift_2 | 192 | levels: hvy_strategic_transport L3; lift +10 |
| `ind_production_1` | industry | 1 | 2 | — | 60 | industrial_output_mult 1.05 |
| `ind_systems_integration_1` | industry | 1 | 1 | — | 72 | research_speed_mult 1.05 |
| `ind_advanced_electronics_1` | industry | 1 | 3 | — | 72 | electronics_output_mult 1.08 |
| `ind_extraction_1` | industry | 1 | 5 | — | 60 | rural_output_mult 1.1 |
| `ind_sustainment_1` | industry | 2 | 8 | — | 72 | maint. +2; refit_speed_mult 1.1 |
| `ind_fuel_efficiency` | industry | 2 | 15 | ind_production_1 | 84 | fuel_upkeep_mult 0.9 |
| `ind_systems_integration_2` | industry | 2 | 20 | ind_systems_integration_1 | 120 | research_speed_mult 1.05, unit_electronics_cost_mult 0.95 |
| `ind_production_2` | industry | 2 | 20 | ind_production_1 | 108 | industrial_output_mult 1.05 |
| `ind_advanced_electronics_2` | industry | 2 | 25 | ind_advanced_electronics_1 | 132 | electronics_output_mult 1.08, radar_range_mult 1.05 |
| `ind_sustainment_2` | industry | 3 | 35 | ind_sustainment_1 | 132 | maint. +3; refit_speed_mult 1.2 |
| `ind_extraction_2` | industry | 3 | 40 | ind_extraction_1 | 108 | rural_output_mult 1.1 |
| `ind_production_3` | industry | 4 | 55 | ind_production_2 | 168 | industrial_output_mult 1.05 |
| `ind_systems_integration_3` | industry | 4 | 60 | ind_systems_integration_2 | 192 | research_speed_mult 1.05, unit_electronics_cost_mult 0.95 |
| `ind_advanced_electronics_3` | industry | 4 | 65 | ind_advanced_electronics_2, ind_systems_integration_2 | 204 | electronics_output_mult 1.08, radar_range_mult 1.05 |
| `hyp_advanced_materials` | hypersonic | 4 | 40 | ind_advanced_electronics_1, ind_systems_integration_1 | 192 | — (prerequisite only) |
| `hyp_glide_blueprint` | hypersonic | 5 | 70 | hyp_advanced_materials, str_ballistic_missile_1 | 216 | program: msl_hgv blueprint |
| `hyp_glide_qualified` | hypersonic | 6 | 95 | hyp_glide_blueprint | 240 | program: msl_hgv qualified; production: msl_hgv |
| `hyp_cruise_blueprint` | hypersonic | 6 | 100 | hyp_advanced_materials, str_cruise_missile_1, ind_advanced_electronics_2 | 216 | program: msl_hcm blueprint |
| `hyp_cruise_qualified` | hypersonic | 7 | 125 | hyp_cruise_blueprint | 240 | program: msl_hcm qualified; production: msl_hcm |

### Suggested cost reservation rule (for the engine)

- Research, construction and mobilization **reserve the full cost at enqueue** (moved from spendable to reserved in the
  ledger); the charge becomes final when the job starts. This makes the "two orders on one tick" check deterministic.
- Cancellation before start refunds 100%; after start refunds `floor(cost × (1 − progress) × 0.8)` per resource,
  quoted exactly in the cancellation preview.
- Missile production: one batch per `missile_complex` slot; batch cost reserved at enqueue; inventory is created only
  when the batch completes, and never above `inventoryCeiling`.
- Upkeep is charged per game day from `upkeepPerDay`; building effects listed on a level are the total at that level.

## Buildings

Effects listed on a level are the **total** effect at that level (not increments). Costs and hours are for upgrading
into that level. `annex` is an engine action, not a building. Rural set is exactly: outpost, airfield, field hospital,
local industry (needs a deposit — zero output otherwise), military logistics, coastal pontoon (coastal only).

| Id | Name | Scope | Max lv | Unlock | L1 cost | L1 effects | Top-level effects |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| `arms_industry` | Arms Industry | city | 5 | — | 120 supplies, 160 components, 900 money | productionMult:1.1, recruitSpeedMult:1.05 | productionMult:1.5, recruitSpeedMult:1.25 |
| `recruiting_office` | Recruiting Office | city | 5 | — | 80 supplies, 30 components, 500 money | manpowerPerDay:15, recruitSpeedMult:1.05 | manpowerPerDay:80, recruitSpeedMult:1.25 |
| `army_base` | Army Base | city | 5 | — | 150 supplies, 120 components, 700 money | defenseMult:1.05, hpRecoveryPerDay:4 | defenseMult:1.25, hpRecoveryPerDay:12 |
| `air_base` | Air Base | city | 5 | — | 120 supplies, 180 components, 40 electronics, 900 money | airSlots:4, hpRecoveryPerDay:5 | airSlots:22, hpRecoveryPerDay:13 |
| `naval_base` | Naval Base | city (coastal) | 5 | — | 140 supplies, 220 components, 1000 money | navalSlots:3, hpRecoveryPerDay:5 | navalSlots:16, hpRecoveryPerDay:13 |
| `bunker` | Bunker Network | city | 5 | — | 160 supplies, 140 components, 500 money | defenseMult:1.15, populationShield:0.1 | defenseMult:1.75, populationShield:0.5 |
| `hospital` | Hospital | city | 5 | — | 140 supplies, 60 components, 10 electronics, 600 money | hpRecoveryPerDay:5, moraleDelta:2, manpowerPerDay:3 | hpRecoveryPerDay:17, moraleDelta:6, manpowerPerDay:12 |
| `radar_station` | Radar Station | city | 5 | — | 80 components, 60 electronics, 700 money | radarKm:250, radarSensitivity:0 | radarKm:650, radarSensitivity:2 |
| `research_lab` | Research Laboratory | city | 5 | — | 60 components, 80 electronics, 1200 money | researchSlots:1, researchSpeedMult:1 | researchSlots:3, researchSpeedMult:1.35 |
| `logistics_hub` | Logistics Hub | city | 5 | — | 120 supplies, 100 components, 40 fuel, 600 money | speedMult:1.05, liftCapacity:1 | speedMult:1.25, liftCapacity:6 |
| `maintenance_depot` | Maintenance Depot | city | 5 | — | 80 supplies, 160 components, 30 electronics, 800 money | maintenanceSlots:1, hpRecoveryPerDay:3 | maintenanceSlots:6, hpRecoveryPerDay:8 |
| `missile_complex` | Missile Complex | city | 3 | str_missile_complex | 240 components, 120 electronics, 10 rare, 1800 money | missileSlots:1 | missileSlots:4 |
| `electronics_plant` | Electronics Plant | city | 5 | — | 140 components, 4 rare, 1100 money | produces:electronics:8 | produces:electronics:45 |
| `refinery` | Refinery | city | 5 | — | 60 supplies, 180 components, 900 money | produces:fuel:15 | produces:fuel:80 |
| `outpost` | Outpost | rural | 3 | — | 60 supplies, 30 components, 200 money | defenseMult:1.1, radarKm:60 | defenseMult:1.3, radarKm:120 |
| `airfield` | Airfield | rural | 3 | — | 60 supplies, 80 components, 20 fuel, 300 money | airSlots:2 | airSlots:6 |
| `field_hospital` | Field Hospital | rural | 3 | — | 70 supplies, 20 components, 200 money | hpRecoveryPerDay:4 | hpRecoveryPerDay:10 |
| `local_industry` | Local Industry | rural (deposit) | 3 | — | 80 supplies, 90 components, 350 money | productionMult:1.5 | productionMult:2.5 |
| `military_logistics` | Military Logistics | rural | 3 | — | 70 supplies, 60 components, 20 fuel, 250 money | speedMult:1.1 | speedMult:1.3, liftCapacity:1 |
| `coastal_pontoon` | Coastal Pontoon | rural (coastal) | 3 | — | 60 supplies, 70 components, 250 money | navalSlots:1, speedMult:1.1 | navalSlots:3, speedMult:1.3 |

## Missiles

Strategic missile tokens are fictional, turn-scale game events; payload is always `conventional`.
Provenance on every record: "fictional campaign catalog; terminology after GAO-19-705SP".
Speed class, flight family, payload, maturity, availability, cost and accuracy are separate fields.
Maturity sequence: prototype → qualified → in production → ready → expended (`PROGRAM_MATURITY_ORDER`).
Research produces a blueprint/qualification; **only a completed production job creates inventory** — there is no
opening stockpile of hypersonic items for any country.

| Id | Name | Family / speed | Flight family | Research | Batch | Build h | Ceiling | Range km | Flight @ range | Effect / limited / failed | Accuracy (cond. on arrival) | Intercept base |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| `msl_cruise` | Pikeline Cruise Missile | cruise / subsonic | powered cruise | str_cruise_missile_1 | 4 | 24 | 24 | 1600 | 120 min | 0.7 / 0.15 / 0.15 | 0.82 | 0.3 |
| `msl_cruise_er` | Pikeline-ER Extended-Range Cruise Missile | cruise / subsonic | powered cruise | str_cruise_missile_2 | 3 | 30 | 15 | 2800 | 206 min | 0.68 / 0.17 / 0.15 | 0.80 | 0.3 |
| `msl_ballistic` | Obelisk Ballistic Missile | ballistic / hypersonic | ballistic | str_ballistic_missile_1 → str_ballistic_missile_2 | 2 | 72 | 10 | 3500 | 33 min | 0.62 / 0.2 / 0.18 | 0.76 | 0.22 |
| `msl_hgv` | Skein Boost-Glide System | hgv / hypersonic | boost-glide system | hyp_glide_blueprint → hyp_glide_qualified | 1 | 120 | 4 | 5000 | 55 min | 0.6 / 0.18 / 0.22 | 0.77 | 0.1 |
| `msl_hcm` | Quillfire Hypersonic Cruise Missile | hcm / hypersonic | powered air-breathing hypersonic cruise | hyp_cruise_blueprint → hyp_cruise_qualified | 2 | 96 | 6 | 1200 | 15 min | 0.58 / 0.2 / 0.22 | 0.74 | 0.15 |

**Probability semantics.** `outcomes` are exclusive terminal probabilities before target defences and sum to exactly 1;
the catalog value of `intercepted` is 0 because interception is a separate seeded draw converting an arrived result
into `intercepted` with probability `interceptBase × defenceRating`. **The accuracy label is conditional on arrival**
(`arrived_effect / (arrived_effect + arrived_limited)`); **the headline useful-effect chance includes earlier failure
states** (`arrived_effect × (1 − interceptBase × defenceRating)`). Both are defined in the tooltip. A higher speed class
confers no automatic improvement in accuracy, damage or report certainty: every hypersonic item has a lower
`arrived_effect` than the mature cruise missile; hypersonic items are mainly harder to intercept and much more
expensive. The ballistic token reaches the hypersonic speed class but is still the ballistic family.

**Warhead disposition.** Nuclear and chemical warheads: **excluded** (`EXCLUDED_WARHEADS`). Abstract-only campaign.

## Symbology

- **Edition:** NATO APP-6 Edition E / MIL-STD-2525E, 20-digit numeric SIDCs, version digits `13`.
  SIDCs are always strings (leading zeroes preserved). Crosswalk version `2026-11-14.1` (`SYMBOL_CROSSWALK_VERSION`).
- **Renderer:** `milsymbol@3.0.5` (MIT), bundled from npm; license at `public/licenses/milsymbol-LICENSE.txt`.
  Its README states that since 3.0 it renders "as closely as possible to MIL-STD-2525E / STANAG APP-6 E / FM 1-02.2";
  its numeric-SIDC metadata maps version `10`–`12` to edition D and `13`–`14` to edition E. We render with the `APP6`
  standard flag. Verified in Node (no DOM needed): every crosswalk entry × 7 standard identities × present/planned/
  damaged validates and reports `isValid() === true` under both APP6 and 2525 flags (`tests/catalog/symbols.test.ts`).
- **Note:** milsymbol's `isValid()` does not reject an out-of-range standard identity digit or an unknown sector
  modifier; `validateSidc()` adds those schema checks (length, digits, version 13, context, identity 0–6, supported
  symbol set 01/02/10/15/20/30/35, status, HQ, land echelon).
- **Fail-safe:** `resolveSymbol()` / `buildSidc()` map an unknown key (or an invalid template) to the generic contact of
  the known domain (key prefix or `opts.domain`) and record an asset-validation error (`getAssetValidationErrors()`).
  Never infantry. `renderSymbol()` does the same for a raw SIDC that fails validation.
- **Contacts** (`contact.land/air/sea/subsurface`) have entity, modifiers, echelon and HQ all zero, so an unknown contact
  never encodes its hidden branch; a surface contact hiding a submarine uses the sea-surface set, never subsurface.
  Echelon is applied only when verified and only to land units; never inferred from stack count.
- **Officers** are the only entries with the HQ indicator. Air officers use land-unit aviation HQ symbols
  (rotary/fixed-wing aviation headquarters); the naval officer uses a navy task-force symbol.
- **Game-only overlays** (composed outside the standardized symbol, never altering frame, fill or icon): external
  selection ring (centred on the frame), age badge for stale reports, muted opacity for historical reports.
  Designation and higher formation are standard amplifiers placed outside the frame by milsymbol.
- **Gallery:** `npm run gallery` writes `docs/gallery/index.html` (offline, inline SVG, 413 samples: every entity ×
  friend/hostile/neutral/unknown; planned, selected, damaged, stale, monochrome and grayscale where semantically allowed;
  extended identities; fail-safe) and `docs/gallery/manifest.json` (id → key → variant → SIDC → meaning → SVG SHA-256).
  A renderer or crosswalk change must come with a reviewed manifest diff.

## Contract changes (additive)

- `UnitType.carrierCapable?: boolean` — aircraft that may use a carrier's `carries` slots.
- `UnitType.liftCapacity?: number` — abstract lift a fielded, ready transport adds to national lift.

## References (acquired 2026-11-14)

| Reference | Used for |
| --- | --- |
| NATO APP-06 Edition E v1 — https://coi.nato.int/EWCOI/EW%20COI%20Shared%20Documents/WGs/NEWWG/EW%20Info%20Exchange%20Requirements%20Panel%20%28IERP%29/01_Governing%20Documents/Publications/APP-06%20NATO%20Symbology/APP-06%20EDE%20V1%20E.pdf | SIDC structure, frames, amplifiers |
| milsymbol — https://github.com/spatialillusions/milsymbol (npm 3.0.5, MIT) | Renderer, supported editions |
| PLANOPS Maps symbol catalog — https://maps.plan-ops.fr/Symbols | Authoring vocabulary (affiliation, status, echelon, designation) |
| GAO-19-705SP hypersonics overview — https://www.gao.gov/products/gao-19-705sp | Missile family terminology only |
| Conflict of Nations wiki — https://wiki.conflictnations.com/Units , /Research , /Provinces , /Officers , /Deployables , /Missiles | Functional category index only; no names, art or balance imported |
| U.S. Air Mobility Command fact sheet — https://www.amc.af.mil/About-Us/Fact-Sheets/Display/Article/1517710/air-mobility-command/ | Broad role of lift/refuelling branch |
| U.S. Navy carrier fact file — https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169795/aircraft-carriers-cvn/ | Broad role of carrier aviation branch |
