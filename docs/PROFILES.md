# Country profiles — World Command: World 120

_Owner: profiles agent. Source of truth: `src/data/profiles/**` (typed against `CountryProfile` in
`src/engine/data-types.ts`). Tables were generated from the live data on 2026-11-14; if they disagree with the code,
the code wins. All numbers are fictional game-balance values._

| File | Contents |
| --- | --- |
| `src/data/profiles/index.ts` | `PROFILES` (120 `CountryProfile`, manifest order — the engine's `loadWorld120` reads this export), `profileById`, `PROFILE_SPECS`, `PROFILE_ISSUES` (must be empty), `PROFILE_PLANS` |
| `src/data/profiles/types.ts` | Authoring types: `CountrySpec`, `CitySpec`, `ForceSpec`, `TemplateId` |
| `src/data/profiles/templates.ts` | 16 templates, the city output table (`CITY_BASE_OUTPUT`, `FUNCTION_OUTPUT`), tech seed sets, designation nouns |
| `src/data/profiles/build.ts` | `buildProfile(spec)` — expands a spec into a full `CountryProfile` |
| `src/data/profiles/relations.ts` | Fictional blocs and bilateral pairs → symmetric initial relations and trust |
| `americas.ts`, `europe.ts`, `africa.ts`, `west-central-asia.ts`, `asia.ts`, `oceania.ts` | The 120 authored specs (22 + 34 + 18 + 22 + 21 + 3) |
| `scripts/opening-power-report.ts` | `npm run report:power` → `docs/reports/opening-power.md` / `.json` |
| `tests/profiles/*.test.ts` | Data integrity (26 tests) and opening-save checks W03/W04/W08 (15 tests) |

## How a profile is built

Each seat is an authored `CountrySpec`: template, doctrine, difficulty, summary, key cities (functions + buildings),
the formation roster (or recipe sizes plus authored formations), technology seeds, licensed technologies, lift,
maintenance slots, trade needs, 2–3 opening decisions and personality. `buildProfile` then:

1. **Cities.** Every map city of the seat receives a `CityProfile` (1,015 cities in total). Authored key cities keep
   their functions and buildings; the others derive functions from tier, port and the province deposit and get the
   template's facility defaults. Base output per day = `round(tier × intensity × (CITY_BASE_OUTPUT + Σ FUNCTION_OUTPUT))`.
   `intensity` is an authoring input only — the stored profile contains plain whole-unit outputs per city.
2. **Formations.** The authored roster, or the template recipe (maneuver units, artillery, air defence, helicopters,
   fighters, warships scaled by Σ city tiers / Σ port tiers) plus authored additions. Every formation has a designation.
   The stationing city is raised to the facility levels its unit type requires (e.g. a carrier needs Naval Base 5).
   Naval units are accepted only at the seat's own **port** cities and never for a **landlocked** seat; naval bases are
   removed from landlocked seats and non-port cities.
3. **Technologies.** Template seeds (naval seeds dropped when landlocked) + authored seeds + the unlock/level tech of
   every fielded unit, **closed over prerequisites**. Licensed techs keep the `licensed` lineage.
4. **Balance — quantities only.** Conservative daily production (opening morale, no building or tech output multipliers, √population yields as in the engine)
   must cover the authored unit + building upkeep by ≥ 15 % for every resource except declared trade needs. A shortfall
   is added to the base output of cities whose functions produce that resource. Trade needs are held at ≤ 85 % of
   upkeep even under the engine's (larger) multiplier reading, so the deficit is visible in the opening forecast.
   **Reference prices are never read**: a change to the basket cannot move any force, output or stockpile
   (tested by mutating the supplies price by +1 and rebuilding all 120 profiles and the opening save).
5. **Reserve.** `stockDays` × max(upkeep, ¼ production) per resource, minimum floors, and ≥ 45 days of any trade-need
   deficit.

Relations come from `relations.ts`: every authored pair is written in both directions with the same status and trust;
no seat starts at war.

## Templates

Templates set technology seeds, recipe densities, facility defaults, reserve depth, personality and default difficulty
(see `TEMPLATES` for the numbers). Distribution across the 120 seats:

| Template | Seats | Members |
| --- | ---: | --- |
| `medium_balanced` | 19 | ARG, CHL, COL, PER, BEL, BGR, HRV, DNK, PRT, ROU, KEN, MAR, TUN, JOR, BGD, MYS, MMR, THA, VNM |
| `small_agrarian` | 18 | ECU, SLV, GTM, GUY, HND, NIC, ALB, BIH, CMR, CIV, COD, GHA, MOZ, SEN, SDN, TZA, YEM, KHM |
| `frontier_state` | 13 | EST, FIN, GRC, LVA, LTU, POL, UKR, GEO, ISR, SYR, PRK, PAK, TWN |
| `landlocked_plains` | 12 | PRY, BLR, CZE, HUN, MDA, SRB, SVK, AZE, KAZ, TKM, UZB, MNG |
| `petrostate` | 12 | VEN, NOR, DZA, AGO, LBY, NGA, IRQ, KWT, OMN, QAT, SAU, ARE |
| `landlocked_highland` | 10 | BOL, AUT, CHE, ETH, ARM, KGZ, TJK, AFG, LAO, NPL |
| `regional_industrial` | 10 | CAN, MEX, ITA, ESP, SWE, EGY, ZAF, IRN, TUR, AUS |
| `small_trade_hub` | 8 | CRI, PAN, URY, IRL, SVN, BHR, LBN, SGP |
| `island_state` | 4 | CUB, DOM, LKA, NZL |
| `major_industrial` | 3 | DEU, CHN, KOR |
| `archipelago` | 3 | IDN, PHL, PNG |
| `continental_scale` | 2 | BRA, IND |
| `expeditionary_power` | 2 | FRA, GBR |
| `maritime_tech` | 2 | NLD, JPN |
| `superpower` | 1 | USA |
| `major_land_power` | 1 | RUS |

`superpower` (USA): global reach, broad production, carrier aviation, strategic lift, heavy maintenance load.
`major_industrial`: dense manufacturing, arms industries in every tier-3+ city. `major_land_power`: heavy armour,
artillery, interior lines. `maritime_tech`: high-technology industry on a constrained base, import-dependent.
`expeditionary_power`: advanced but small rosters, overseas ports. `continental_scale`: huge population and territory,
long internal routes. `regional_industrial`, `medium_balanced`: balanced industry and compact all-arms forces.
`frontier_state`: high-readiness army on a contested border. `petrostate`: fuel and money surplus, imported
equipment. `small_trade_hub`: compact, wealthy, port/finance centred. `small_agrarian`: farm economy, militia-heavy.
`landlocked_highland` / `landlocked_plains`: no navy, trade through neighbours. `archipelago`: distributed ports and an
inter-island transport problem. `island_state`: single island or compact group.

## How the notable contrasts are expressed

Every contrast is carried by city and inventory records, not by multipliers.

| Seat | Contrast | Records that express it |
| --- | --- | --- |
| CHN | Deep industrial opening | Arms Industry 3 at Shanghai, Guangzhou, Chongqing; Arms Industry 2 at Tianjin, Wuhan, Chengdu, Shenyang, Shenzhen; Electronics Plant 4 at Shenzhen; Refinery 3 at Daqing; Local Industry on 3 rare and 4 component deposits; logistics hubs at Shanghai, Guangzhou, Wuhan, Hong Kong, six maintenance depots, Sealift I–II, a strategic airlift division. Leads industry (143,672) and mobility (463,498) among all seats, including the U.S. The Qingdao **Training Carrier Group** sails without carrier aviation (decision: research Carrier Aviation). |
| RUS | Strong land forces | 1st Guards Tank Army and 4th Guards Tank Division (Moscow), tank divisions at Rostov, Volgograd, Yekaterinburg, Khabarovsk, St Petersburg, Kaliningrad (24 battle tanks), 24 mechanized battalions, 6 air-assault battalions, 8 self-propelled + 6 rocket artillery, 10 SAM + theatre defence, 6 heavy bombers. Leads ready formations among peers (300,872). Four separate fleets (Murmansk Naval Base 4, Vladivostok, Sevastopol, Kaliningrad). Tyumen Refinery 3, Norilsk/Yakutsk mining. |
| IND | Scale and competing infrastructure | Large manpower base (≈7,000/day, second only to China); Mumbai Naval Base 5 (carrier, no air wing), Bengaluru Research Lab 2 + Electronics Plant 2, two frontier corps (14th Mountain Corps at Leh, 11th Corps at Amritsar); a declared **fuel** trade need. Decisions trade Mumbai naval base vs Bengaluru lab vs northern logistics. |
| JPN | Technologically capable maritime start | Tokyo Research Lab 3 + Kyoto Research Lab 2, Electronics Plants at Tokyo/Fukuoka, Yokohama Naval Base 4 + Maintenance Depot 2, Hiroshima Naval Base 3, destroyers/submarines/ASW helicopters, theatre defence at Tokyo, Amphibious Rapid Deployment Brigade at Naha. **Fuel** trade need. |
| FRA / GBR | Advanced but smaller rosters | ≈35 units each (vs 152–172 for CHN/RUS/USA) but 32–35 starting techs, Research Lab 3 in the capital, one carrier each: FRA at Toulon (Naval Base 5) with a domestic carrier air group; GBR at Portsmouth (Naval Base 5) with **licensed** carrier aviation (`licensed: ['nav_carrier_aviation']`). Strategic airlift (Lift II) and commando units. |
| TUR | Balanced regional industry | Arms Industry at Istanbul (2), Izmir, Bursa, Ankara; Bursa Electronics Plant; Ankara Research Lab; Istanbul Naval Base 3 on the Straits; combat drones (`rec_uav`), marines, submarines; 42 units. |
| BRA | Depth across long internal routes | 20 cities; logistics hubs at Brasília and Manaus, a forward brigade at Manaus; São Paulo is the only research city; Rio de Janeiro Naval Base 3 + Refinery 2; decision: logistics hub at Cuiabá vs forward garrison. |
| EGY | Transit and supply constraints | Port Said Logistics Hub 2, Suez Refinery + Naval Base, Ismailia Army Base 2 on the canal; a declared **supplies** trade need (the Nile valley cannot feed Cairo and Alexandria). |
| ZAF | Southern maritime position | Cape Town Naval Base 3 + Maintenance Depot, Durban Naval Base 2, submarines and maritime patrol; Johannesburg/Polokwane mining and a rural rare-material improvement. |
| IDN | Distributed ports, inter-island transport | Jakarta (finance, industrial, port; Arms Industry 2, Army Base 3), **Surabaya** (port, shipbuilding, military; Naval Base 2), Balikpapan and Samarinda energy (Refinery 2), Palembang refinery, Batam/Medan on Malacca; regional battalions at Makassar, Jayapura, Balikpapan; Sealift I. Decision: Surabaya Naval Base 3 vs Jakarta Arms Industry 3. |
| SGP | Compact trade-heavy position | One tier-5 city with five functions (finance, port, logistics, electronics, energy): Naval Base 2, Refinery 2, Electronics Plant 2, Logistics Hub 2, Research Lab; small ready force (14 units); declared **supplies** trade need. |
| KOR / TWN | Industrial front-line states | Seoul Electronics Plant 3 + Bunker 3; Hsinchu Electronics Plant 4 (TWN sells electronics the U.S. imports); both declare **fuel** trade needs. |

## U.S. technology package → data

| SPEC family | Data in the U.S. profile / opening save | Decision in the save |
| --- | --- | --- |
| Air mobility and support | Techs `mob_lift_1`, `mob_strategic_airlift_2` (2nd-tier transport node), `mob_refuel_support`; profile lift 40 + 12 from techs + 8 from logistics hubs + 21 from fielded airlifters = **81 effective lift** (highest; China 64, France/UK 28); 60th and 62nd Airlift Wings (7 airlifters), 6th and 168th Air Refueling Wings (5 tankers). | "Allocate strategic lift" (forces): lift to a partner delays the Detroit/Chicago reinforcement. |
| Naval aviation | Techs `nav_carrier`, `nav_carrier_aviation` (+ `nav_destroyer`, `avi_strike_fighter` prereqs), `nav_cruiser`, `nav_fleet_logistics`. **4 carriers** (Carrier Strike Groups 2 and 8 at Norfolk, 3 and 9 at San Diego, both Naval Base 5), Carrier Air Wings 1 and 2 (6 carrier fighters + 6 carrier strikers), ASW helicopter wings, 4 cruisers, 10 destroyers, 4 frigates, 8 attack submarines. Ships (naval bases), air wings (air bases) and refits (maintenance depots) are separate facilities and queues. | "Fund fleet readiness or close the electronics gap" (economy). |
| Research and systems integration | `ind_systems_integration_1/2` and `ind_advanced_electronics_1/2` — **one node ahead** (no other seat holds a level-2 node of either branch). Paid throughput: Research Labs San Francisco 4, Boston 4, Austin 3, Washington 2 (electronics + money upkeep); 9 research slots. | "Choose the research priority" (research): SI III / AE III / glide blueprint; labs compete for imported electronics. |
| Observation and coordination | `rec_broad_area_recon` (+ `rec_awacs`, `rec_uav`, `rec_mobile_radar`), `rec_track_comparison`, `rec_report_processing`; 9th Broad-Area Reconnaissance Wing (2 aircraft) at San Francisco, 552nd Early Warning Wing, Northern Radar Group. | — (sensors still need valid observation). |
| Industrial sustainment | Broad production across 30 cities (second only to China in net industrial value); maintenance capacity **50** slots, the highest (profile 6 + base 2 + `ind_sustainment_1` 2 + Maintenance Depots 40 at Norfolk 5, San Diego 4, Seattle 4, Dallas 3, Houston 3, Los Angeles 3, Philadelphia 3, and level 2 at Washington, New York, Chicago, Detroit, Tampa, Anchorage, Honolulu) with their component and money upkeep; total unit + building upkeep ≈ 5,000 money and 1,200 fuel per day. **Import pressure: electronics** (`tradeNeeds: ['electronics']`, opening net ≈ −37/day, reserve > 100 days). | Electronics deficit forces a choice between research, fleet readiness and trade. |
| Hypersonic research | `hyp_advanced_materials` (common prerequisite, with `ind_advanced_electronics_1` and `ind_systems_integration_1`). **No** `hyp_glide_*` or `hyp_cruise_*` node for any seat; no missile inventory exists anywhere at start (tested on the save). | Glide blueprint is a visible next unlock in the research decision. |

No U.S.-only field, multiplier or bonus exists in the data: the tests reject any profile key outside the contract and
any nested key matching `mult|multiplier|bonus|factor|strength|handicap`. The same profile is used when a human or a
bot holds the seat, at every difficulty (tested: identical composite for human/hard and observer/easy).

## Opening power result

From `docs/reports/opening-power.md` (engine `computeOpeningPower` after the engine fixes listed below; seed 120,
observer seat):

**United States 117.98; nearest rival China 100.00; U.S. lead 17.98 %** (targets: 118, band 115–121, lead 15–21 %).

| # | Seat | Composite | Industrial | Formations | Research | Mobility | Resilience |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | USA | 117.98 | 128,285 | 472,697 | 419,683 | 431,335 | 1.00 |
| 2 | CHN | 100.00 | **143,672** | 287,659 | **317,030** | **463,498** | 1.00 |
| 3 | RUS | 61.10 | 49,961 | **300,872** | 177,990 | 127,724 | 1.00 |
| 4 | IND | 48.83 | 58,664 | 101,705 | 154,140 | 229,707 | 1.00 |
| 5 | FRA | 41.20 | 32,211 | 81,941 | 213,280 | 112,964 | 1.00 |
| 6 | JPN | 40.32 | 41,257 | 91,388 | 173,380 | 96,667 | 1.00 |
| 7 | GBR | 39.76 | 29,532 | 81,099 | 202,220 | 108,754 | 1.00 |
| 8 | DEU | 34.45 | 34,750 | 61,839 | 138,400 | 96,323 | 1.00 |
| 9 | BRA | 32.89 | 39,476 | 55,888 | 93,280 | 118,824 | 1.00 |
| 10 | KOR | 31.57 | 23,025 | 72,108 | 135,480 | 62,044 | 1.00 |

Bold = normalization constant (highest non-U.S. raw). Peers lead individual dimensions: China leads industry,
research and mobility among peers and **out-produces and out-moves the U.S.** (industrial 0.89×, mobility 0.93× China);
Russia leads ready formations among peers. The U.S. lead comes from ready formations (1.57× Russia: four carriers and
their air wings) and paid research (1.32× China). U.S. effective lift 81 = profile/tech 52 + logistics hubs 8 + fielded
airlifters 21 (China 64, France/UK 28).

**Cross-check.** The report contains an independent *aggregation* cross-check (normalization constants, weights,
rescale and ranking re-derived from the engine's raw values; maximum composite difference 0.00). The earlier
independent re-implementation of the raw dimensions was dropped once the engine started applying national tech
modifiers (`industrial_output_mult`, `electronics_output_mult`, `research_speed_mult`, `unit_electronics_cost_mult`,
`fuel_upkeep_mult`, `rural_output_mult`) and derived lift in many places: a second raw implementation would drift.
Raw values are therefore the engine's only.

## Engine notes

Reported during the first tuning pass and since **fixed by the engine agent** (profiles were retuned afterwards):

1. Building `*Mult` effects are now combined as `1 + Σ(mult − 1) × condition` (Arms Industry 1 = ×1.1, a level-1 lab
   adds no speed, Local Industry 1 = ×1.5 deposit).
2. Tech `_mult` modifiers are multiplicative and consumed (`research_speed_mult` etc.).
3. Lift = profile/tech lift + `liftCapacity` of buildings + fielded airlift units (`liftBreakdown`). Profiles do not
   pre-add building or unit lift.
4. Population yields are sublinear: manpower = 1.5 × √pop(k), money = 4 × √pop(k) per city (rural manpower × 0.5).
   The profile balancer uses the same formula; the old linear constants are not used anywhere in profiles or scripts.
5. Default profile synthesis now fields starter units (irrelevant here: all 120 profiles are authored).

Balance consequence: with sublinear population yields, China's and India's index no longer rests on raw manpower, so
China's industrial lead is carried by city records (intensity 1.6 on 62 cities, Arms Industry 3 at Shanghai,
Guangzhou, Chongqing, Electronics Plant 4 at Shenzhen) and its mobility lead by logistics hubs (Shanghai, Guangzhou,
Wuhan, Hong Kong), six maintenance depots, Sealift I–II, Lift I and the 1st Strategic Airlift Division at Xi'an.

## Landlocked and island viability

| Seat | Situation | Why it is viable |
| --- | --- | --- |
| MNG | Landlocked steppe between Russia and China | Ulaanbaatar holds army base, air base and logistics hub; Gobi rare materials (Dalanzadgad + a rural Local Industry) to sell; positive net in every resource; 5 units incl. armour; decisions: sell rare materials, trade agreement with a neighbour. |
| BOL | Landlocked Andes | Right of way with Peru (authored); Santa Cruz refinery gives a fuel surplus; 4 units; capture-capable infantry at La Paz. |
| PRY | Landlocked river economy | Southern Cone Pact right of way with Brazil, Argentina, Uruguay; Ciudad del Este energy and logistics; 4 units. |
| NPL | Himalayan, landlocked | Right of way with India; Pokhara energy; mountain terrain defence; 4 units. |
| LAO | Landlocked Mekong | Right of way with China; hydro energy at Vientiane/Pakse; 4 units. |
| AUT, CHE, CZE, SVK, HUN, SRB, BLR, MDA, ETH, ARM, AZE, KAZ, KGZ, TJK, TKM, UZB, AFG | Landlocked | No naval units or naval bases (AZE/KAZ/TKM have Caspian "port" cities but are flagged landlocked); land forces, recruiting in the capital, positive flows. |
| IDN | Archipelago | 29 cities, 25 of them ports, on every major island; Naval Bases at Jakarta, Surabaya, Makassar; Sealift I; corvettes/frigates at Jakarta and Surabaya; regional battalions on Sulawesi, Borneo and Papua. |
| PHL | Archipelago | Naval Bases at Manila and Cebu; Batangas refinery; inter-island decision (Cebu naval base vs Sealift II). |
| JPN | Island chain | Naval Bases at Tokyo, Yokohama (4), Kobe, Hiroshima (3), Naha; fuel import pressure. |

Every seat passes, on the actual opening save: non-negative net flow in every resource except declared trade needs;
trade-need reserves ≥ 30 days; at least one capture-capable formation; a legal `mobilize` order (validated by the
engine's `validateCommand`).

## Regenerating

- `npm run report:power` — rebuilds the opening save and rewrites `docs/reports/opening-power.md` and `.json`.
- `npx vitest run tests/profiles` — 41 tests (roster, referential integrity, prerequisite closure, geography, economy,
  decisions, relations, U.S. package, no multipliers, W03/W04/W08 on the save).
- After a map rebuild, `PROFILE_ISSUES` lists any authored city slug that no longer exists (the game still loads).

## Every country

| Seat | Country | Template | Difficulty | Doctrine | Capital | Opening decisions (screen) |
| --- | --- | --- | --- | --- | --- | --- |
| ARG | Argentina | medium_balanced | moderate | western | Buenos Aires | Export Pampas grain (market); Cover Patagonia (forces) |
| BOL | Bolivia | landlocked_highland | hard | western | La Paz | Secure a route to the sea (diplomacy); Use Santa Cruz energy (economy) |
| BRA | Brazil | continental_scale | moderate | western | Brasília | Shorten the interior routes (map); Fund Rio offshore energy (cities); Grow the São Paulo industrial base (research) |
| CAN | Canada | regional_industrial | moderate | western | Ottawa | Garrison the Arctic approaches (map); Sell Alberta fuel (market) |
| CHL | Chile | medium_balanced | moderate | western | Santiago | Sell northern rare materials (market); Link the south by sea (forces) |
| COL | Colombia | medium_balanced | moderate | western | Bogotá | Use the helicopter arm (forces); Pick a coast (cities) |
| CRI | Costa Rica | small_trade_hub | hard | western | San José | Grow San José electronics (cities); Find a protector (diplomacy) |
| CUB | Cuba | island_state | hard | eastern | Havana | Import fuel (market); Coastal defence (forces) |
| DOM | Dominican Republic | island_state | hard | western | Santo Domingo | Industrialize Santiago (cities); Trade for components (market) |
| ECU | Ecuador | small_agrarian | hard | western | Quito | Invest in Guayaquil (cities); Hold Puerto Ayora (map) |
| SLV | El Salvador | small_agrarian | hard | western | San Salvador | Recruit from a dense population (forces); Open Acajutla (cities) |
| GTM | Guatemala | small_agrarian | hard | western | Guatemala City | Build up Puerto Barrios (cities); Keep Honduras close (diplomacy) |
| GUY | Guyana | small_agrarian | hard | western | Georgetown | Bank offshore energy (economy); Manage the western border (diplomacy) |
| HND | Honduras | small_agrarian | hard | western | Tegucigalpa | Back San Pedro Sula (cities); Use the northern corridor (diplomacy) |
| MEX | Mexico | regional_industrial | moderate | western | Mexico City | Build up the northern corridor (cities); Protect Gulf energy (economy) |
| NIC | Nicaragua | small_agrarian | hard | eastern | Managua | Reach the Caribbean coast (map); Seek a sponsor (diplomacy) |
| PAN | Panama | small_trade_hub | hard | western | Panama City | Guard the canal (map); Sell transit services (market) |
| PRY | Paraguay | landlocked_plains | moderate | western | Asunción | Build on Ciudad del Este (cities); Rely on the Southern Cone Pact (diplomacy) |
| PER | Peru | medium_balanced | moderate | western | Lima | Expand Andean mining (cities); Reach Iquitos (map) |
| USA | United States | superpower | easy | western | Washington | Allocate strategic lift (forces); Choose the research priority (research); Fund fleet readiness or close the electronics gap (economy) |
| URY | Uruguay | small_trade_hub | hard | western | Montevideo | Run Montevideo as a trade hub (market); Lean on the Southern Cone Pact (diplomacy) |
| VEN | Venezuela | petrostate | moderate | eastern | Caracas | Trade oil for components (market); Lean on Havana (diplomacy) |
| ALB | Albania | small_agrarian | hard | european | Tirana | Develop Durrës (cities); Rely on the Compact (diplomacy) |
| AUT | Austria | landlocked_highland | moderate | european | Vienna | Linz steel (cities); Keep transit open (diplomacy) |
| BLR | Belarus | landlocked_plains | moderate | eastern | Minsk | Minsk vehicle plants (cities); Lean on the Eurasian Accord (diplomacy) |
| BEL | Belgium | medium_balanced | moderate | european | Brussels | Expand Antwerp (cities); Use the Compact (diplomacy) |
| BIH | Bosnia and Herzegovina | small_agrarian | hard | european | Sarajevo | Tuzla energy (cities); Trade through Croatia (diplomacy) |
| BGR | Bulgaria | medium_balanced | moderate | european | Sofia | Develop Varna (cities); Plovdiv industry (cities) |
| HRV | Croatia | medium_balanced | moderate | european | Zagreb | Patrol the Adriatic (forces); Grow Zagreb (cities) |
| CZE | Czechia | landlocked_plains | moderate | european | Prague | Export from Brno (cities); Lean on the Compact (diplomacy) |
| DNK | Denmark | medium_balanced | moderate | european | Copenhagen | Watch the Danish straits (forces); Supply Nuuk (map) |
| EST | Estonia | frontier_state | hard | european | Tallinn | Exploit Tallinn electronics (research); Call on Baltic partners (diplomacy) |
| FIN | Finland | frontier_state | moderate | european | Helsinki | Defend the eastern border (forces); Use Helsinki electronics (cities) |
| FRA | France | expeditionary_power | moderate | european | Paris | Deploy the Toulon carrier group (forces); Hold the overseas ports (map); Lead in research (research) |
| DEU | Germany | major_industrial | moderate | european | Berlin | Cover the fuel deficit (market); Rebuild the army or the economy (cities) |
| GRC | Greece | frontier_state | moderate | european | Athens | Garrison the Aegean islands (map); Frigates or submarines (forces) |
| HUN | Hungary | landlocked_plains | moderate | european | Budapest | Concentrate on Budapest (cities); Plains defence (forces) |
| IRL | Ireland | small_trade_hub | hard | european | Dublin | Sell Dublin electronics (market); Neutral partner (diplomacy) |
| ITA | Italy | regional_industrial | moderate | european | Rome | Patrol the central Mediterranean (forces); Import fuel (market) |
| LVA | Latvia | frontier_state | hard | european | Riga | Riga logistics (cities); Watch Daugavpils (forces) |
| LTU | Lithuania | frontier_state | hard | european | Vilnius | Hold the land corridor (map); Klaipėda energy terminal (economy) |
| MDA | Moldova | landlocked_plains | hard | european | Chișinău | Secure Tiraspol (forces); Keep the Ukrainian route (diplomacy) |
| NLD | Netherlands | maritime_tech | moderate | european | The Hague | Run the Rotterdam hub (market); Import rare materials (economy) |
| NOR | Norway | petrostate | moderate | european | Oslo | Watch the Arctic border (map); Spend the energy reserve (economy) |
| POL | Poland | frontier_state | moderate | european | Warsaw | Man the eastern line (forces); Silesian industry (cities) |
| PRT | Portugal | medium_balanced | moderate | european | Lisbon | Link the Atlantic islands (map); Industrialize Porto (cities) |
| ROU | Romania | medium_balanced | moderate | european | Bucharest | Black Sea patrol (forces); Use Constanța energy (economy) |
| RUS | Russia | major_land_power | easy | eastern | Moscow | Commit the tank armies (forces); Four fleets, no shortcut (map); Develop Siberian resources (cities) |
| SRB | Serbia | landlocked_plains | moderate | eastern | Belgrade | Kragujevac arms (cities); Balance between blocs (diplomacy) |
| SVK | Slovakia | landlocked_plains | moderate | european | Bratislava | Use Košice steel (cities); Stay close to Prague (diplomacy) |
| SVN | Slovenia | small_trade_hub | hard | european | Ljubljana | Koper port (cities); Compact membership (diplomacy) |
| ESP | Spain | regional_industrial | moderate | european | Madrid | Cover the islands (map); Barcelona or Bilbao (cities) |
| SWE | Sweden | regional_industrial | moderate | european | Stockholm | Garrison Visby (forces); Exploit domestic aerospace (research) |
| CHE | Switzerland | landlocked_highland | moderate | european | Bern | Fund Zurich research (research); Stay neutral, trade with all (diplomacy) |
| UKR | Ukraine | frontier_state | hard | eastern | Kyiv | Hold the eastern front (forces); Scale the drone arm (research); Keep the western route open (diplomacy) |
| GBR | United Kingdom | expeditionary_power | moderate | european | London | Crew the Portsmouth carrier (forces); Use North Sea energy (economy); Keep the Northern Watch close (diplomacy) |
| DZA | Algeria | petrostate | moderate | eastern | Algiers | Export Saharan energy (market); Manage the western border (diplomacy) |
| AGO | Angola | petrostate | moderate | eastern | Luanda | Hold the Cabinda exclave (map); Sell rare materials (market) |
| CMR | Cameroon | small_agrarian | hard | european | Yaoundé | Invest in Douala (cities); Northern security (forces) |
| CIV | Côte d’Ivoire | small_agrarian | hard | european | Abidjan | Export agriculture (market); Develop Abidjan (cities) |
| COD | Democratic Republic of the Congo | small_agrarian | hard | european | Kinshasa | Sell Katanga rare materials (market); Stabilize the east (forces) |
| EGY | Egypt | regional_industrial | moderate | western | Cairo | Control the Suez Canal (map); Import supplies for the cities (market); Invest in Port Said logistics (cities) |
| ETH | Ethiopia | landlocked_highland | hard | eastern | Addis Ababa | Bahir Dar hydro power (cities); Find a port (diplomacy) |
| GHA | Ghana | small_agrarian | hard | western | Accra | Use Takoradi energy (economy); Kumasi mining (cities) |
| KEN | Kenya | medium_balanced | moderate | western | Nairobi | Mombasa–Nairobi corridor (cities); Garrison Garissa (forces) |
| LBY | Libya | petrostate | hard | eastern | Tripoli | Unify the coast road (map); Sell oil for stability (market) |
| MAR | Morocco | medium_balanced | moderate | european | Rabat | Watch the Strait of Gibraltar (map); Industrialize Casablanca (cities) |
| MOZ | Mozambique | small_agrarian | hard | eastern | Maputo | Develop northern gas (economy); Cover the coast (forces) |
| NGA | Nigeria | petrostate | moderate | western | Abuja | Protect Delta oil (economy); Secure the north-east (forces); Build an electronics base in Lagos (cities) |
| SEN | Senegal | small_agrarian | hard | european | Dakar | Dakar port (cities); Reach Ziguinchor (map) |
| ZAF | South Africa | regional_industrial | moderate | western | Pretoria | Patrol the Cape route (forces); Sell rare materials (market) |
| SDN | Sudan | small_agrarian | hard | eastern | Khartoum | Port Sudan lifeline (cities); Darfur garrison (forces) |
| TZA | Tanzania | small_agrarian | hard | western | Dodoma | Build up Dar es Salaam (cities); Lake Victoria trade (map) |
| TUN | Tunisia | medium_balanced | moderate | european | Tunis | Bizerte naval base (forces); Develop Sfax (cities) |
| ARM | Armenia | landlocked_highland | hard | eastern | Yerevan | Eastern border (forces); Keep a route open (diplomacy) |
| AZE | Azerbaijan | landlocked_plains | moderate | eastern | Baku | Export Baku oil (market); Supply Nakhchivan (map) |
| BHR | Bahrain | small_trade_hub | hard | western | Manama | Trade from Manama (market); Gulf Council (diplomacy) |
| GEO | Georgia | frontier_state | hard | western | Tbilisi | Transit corridor (cities); Northern border (forces) |
| IRN | Iran | regional_industrial | moderate | eastern | Tehran | Strait of Hormuz (map); Missile programme (research) |
| IRQ | Iraq | petrostate | hard | eastern | Baghdad | Basra oil revenue (economy); Umm Qasr (cities) |
| ISR | Israel | frontier_state | moderate | western | Jerusalem | Layered air defence (forces); Tel Aviv research lead (research) |
| JOR | Jordan | medium_balanced | moderate | western | Amman | Import fuel (market); Aqaba port (cities) |
| KAZ | Kazakhstan | landlocked_plains | moderate | eastern | Astana | Steppe distances (map); Export Caspian oil (market) |
| KWT | Kuwait | petrostate | hard | western | Kuwait City | Fund defence with oil (market); Seek protection (diplomacy) |
| KGZ | Kyrgyzstan | landlocked_highland | hard | eastern | Bishkek | Sell gold and rare materials (market); Fergana border (forces) |
| LBN | Lebanon | small_trade_hub | hard | european | Beirut | Rebuild Beirut trade (market); Southern border (forces) |
| OMN | Oman | petrostate | moderate | western | Muscat | Khasab on Hormuz (map); Develop Duqm (cities) |
| QAT | Qatar | petrostate | hard | western | Doha | Export gas (market); Gulf Council ties (diplomacy) |
| SAU | Saudi Arabia | petrostate | moderate | western | Riyadh | Set the oil price (market); Southern border (forces) |
| SYR | Syria | frontier_state | hard | eastern | Damascus | Rebuild Aleppo (cities); Lean on partners (diplomacy) |
| TJK | Tajikistan | landlocked_highland | hard | eastern | Dushanbe | Hydro power (economy); Southern border (forces) |
| TUR | Türkiye | regional_industrial | easy | western | Ankara | Hold the Turkish Straits (map); Balance Bursa and Ankara (cities); Grow the drone arm (research) |
| TKM | Turkmenistan | landlocked_plains | moderate | eastern | Ashgabat | Sell gas (market); Neutrality (diplomacy) |
| ARE | United Arab Emirates | petrostate | moderate | western | Abu Dhabi | Run the Dubai hub (market); Bypass Hormuz (map) |
| UZB | Uzbekistan | landlocked_plains | moderate | eastern | Tashkent | Tashkent industry (cities); Trade through neighbours (diplomacy) |
| YEM | Yemen | small_agrarian | hard | eastern | Sana’a | Bab el-Mandeb (map); Marib energy (cities) |
| AFG | Afghanistan | landlocked_highland | hard | eastern | Kabul | Mountain defence (map); Find a trade route (diplomacy) |
| BGD | Bangladesh | medium_balanced | moderate | eastern | Dhaka | Export from Dhaka (market); Large manpower pool (forces) |
| KHM | Cambodia | small_agrarian | hard | eastern | Phnom Penh | Sihanoukville (cities); Lean on China (diplomacy) |
| CHN | China | major_industrial | easy | eastern | Beijing | Qualify a carrier air wing (research); Pick the next industrial push (cities); Posture opposite Taiwan (forces) |
| IND | India | continental_scale | easy | eastern | New Delhi | Two frontiers (forces); Competing infrastructure (cities); Import fuel (market) |
| IDN | Indonesia | archipelago | moderate | western | Jakarta | Fund inter-island lift (cities); Move Borneo energy to Java (economy); Watch the Malacca Strait (map) |
| JPN | Japan | maritime_tech | moderate | western | Tokyo | Secure fuel imports (market); Technology lead at sea (research); Southwest islands (forces) |
| LAO | Laos | landlocked_highland | hard | eastern | Vientiane | Sell hydro power (market); Routes to the sea (diplomacy) |
| MYS | Malaysia | medium_balanced | moderate | western | Putrajaya | Link Borneo (map); Penang electronics (cities) |
| MNG | Mongolia | landlocked_plains | hard | eastern | Ulaanbaatar | Sell Gobi rare materials (market); Balance the neighbours (diplomacy) |
| MMR | Myanmar | medium_balanced | hard | eastern | Naypyidaw | Northern insurgency (forces); Yangon port (cities) |
| NPL | Nepal | landlocked_highland | hard | western | Kathmandu | Indian trade route (diplomacy); Pokhara hydro (cities) |
| PRK | North Korea | frontier_state | hard | eastern | Pyongyang | Ration fuel (economy); Missile qualification (research) |
| PAK | Pakistan | frontier_state | moderate | eastern | Islamabad | Eastern border (forces); Partner with China (diplomacy) |
| PHL | Philippines | archipelago | moderate | western | Manila | Inter-island ferries (cities); Use the U.S. partnership (diplomacy) |
| SGP | Singapore | small_trade_hub | hard | western | Singapore | Import supplies, export services (market); Guard the strait (forces) |
| KOR | South Korea | major_industrial | moderate | western | Seoul | Hold the northern border (forces); Import fuel (market) |
| LKA | Sri Lanka | island_state | hard | western | Colombo | Colombo transhipment (market); Trincomalee harbour (cities) |
| TWN | Taiwan | frontier_state | moderate | western | Taipei | Sell Hsinchu electronics (market); Defend the west coast (forces) |
| THA | Thailand | medium_balanced | moderate | western | Bangkok | Eastern seaboard (cities); Calm the borders (diplomacy) |
| VNM | Vietnam | medium_balanced | moderate | eastern | Hanoi | Defend the coast (forces); Ho Chi Minh City electronics (cities) |
| AUS | Australia | regional_industrial | moderate | western | Canberra | Bridge the distances (map); Export Pilbara rare materials (market); Pacific partners (diplomacy) |
| NZL | New Zealand | island_state | hard | western | Wellington | Export agriculture (market); Lean on Australia (diplomacy) |
| PNG | Papua New Guinea | archipelago | hard | western | Port Moresby | Everything moves by sea (forces); Sell Tabubil resources (market) |
