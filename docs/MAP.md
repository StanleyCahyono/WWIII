# World 120 map — provenance, pipeline and policies

Owner: map agent. Regenerate with `npm run map:build` (≈20 s, deterministic). Validate with
`npx vitest run tests/map`.

| Output | Contents | Size |
| --- | --- | --- |
| `src/data/generated/map.json` | `MapData`: nodes, edges, cities, countries, disputed areas, stats | ≈1.0 MB |
| `src/data/generated/geometry.json` | `MapGeometry`: one shape per node + 241 base-map outlines | ≈3.1 MB |
| `src/data/map-index.ts` | dependency-free typed loader (`loadMapData`, `getMapIndex`, `nodeByKey`, `cityByKey`, `neighbours`, `provincesOf`) | — |

Current build (`w120-map-2026-11-14-…`): **120 countries, 1,693 playable land provinces, 587 sea
zones, 83 outside-campaign nodes, 1,018 cities (492 ports)**, 6,162 edges (land 3,206 · coast 1,522 ·
sea 1,406 · strait 23 · canal 5; 46 edges cross the dateline with `wraps: true`), 20 disputed-area
records, 313 landmasses. The engine never needs geometry.json.

## Provenance

- **Source:** Natural Earth 1:50m Cultural Vectors, *Admin 0 – Countries*, as packaged by
  [`world-atlas@2.0.2`](https://github.com/topojson/world-atlas) (`countries-50m.json`, TopoJSON,
  241 features). Installed as a pinned dev dependency, bundled locally — no network access.
- **License:** Natural Earth is public domain; world-atlas packaging is ISC.
- **Acquired:** 2026-11-14 (recorded in `MapData.provenance`).
- **Boundaries:** Natural Earth draws *de facto* boundaries. Where that matters (Crimea, Golan,
  Kashmir, the Moroccan-administered part of Western Sahara, breakaway regions) the game keeps the
  source line and adds an explicit `DisputedArea` record (see below). No position is implied.
- **Cities:** authored in `src/data/cities.ts` (approximate real coordinates and metro populations,
  fictional economic tiers).

## Pipeline (`scripts/build-map.ts` + `scripts/map/*`)

1. **Source & simplification** (`map/source.ts`). TopoJSON arcs are decoded and simplified *once per
   arc* (Douglas–Peucker, 0.01°, x scaled by cos lat), so borders shared by two countries stay
   identical on both sides. Rings are unwrapped to continuous longitudes (the source jumps ±360° at
   the antimeridian). Coastline vertices (arcs used by exactly one feature) are indexed for coast
   detection; shared arcs are kept for cross-border adjacency.
2. **Territory manifest** (`src/data/territory-manifest.ts`, `map/owners.ts`). Every one of the 241
   features is matched by exact `properties.name` and cross-checked against its numeric ISO id
   (world-atlas has 5 features without an id and a duplicated `036`). The build fails on any
   unmatched/duplicate feature. Parts of playable owners touching the antimeridian (Russia's
   Chukotka, Wrangel) are stitched with a polygon union.
3. **Provinces** (`map/provinces.ts`). Per owner:
   - Cities are placed in their landmass part; points that fall up to 60 km offshore in the 1:50m
     coastline are nudged onto land (no city moved > 25 km in the current build).
   - Parts are *eligible* for provinces if ≥ 1,500 km² (≥ 5,000 km² poleward of 60°) or if they hold
     a city. Smaller islets are attached to the nearest province of the same owner within 80 km
     **as extra drawing polygons only** (no adjacency effect); remote islets ≥ 40 km² become their own
     province; 19 tiny remote islets are drawn in the outlines only.
   - Budget: `T = round(0.6 · (0.0125·√area + 1.4·√population_M))`; each eligible part gets
     `max(1, cities)`, then `max(T, base + ⌈0.3·T⌉)` provinces are allocated by largest area deficit
     (so big landmasses get rural provinces between cities). Total ≈ 1,690 (design budget 1,200–2,000).
   - Each part is cut by a Voronoi diagram in a per-part azimuthal equal-area projection (km). Seeds
     = its cities + Halton candidates chosen by farthest-point sampling, relaxed by 5 Lloyd
     iterations (cities fixed). Cells are clipped to the part polygon (`polygon-clipping`); clip
     fragments not containing their seed are reassigned to the land-adjacent province sharing the
     longest border. **Parts are never merged across water.**
   - Intra-part `land` edges come from sampling every Voronoi edge every 1.5 km on both sides: a
     pair is adjacent only where both sides are land at the same point. Cross-border `land` edges
     come from sampling every shared topology arc every 4 km with ±0.003° offsets. Coastlines never
     create land edges.
4. **Sea zones** (`map/sea.ts`). A 0.05° raster (7200×3600) marks land (any source polygon, plus the
   polar cap below 85°S because the source clips Antarctica there). The Bosporus and Dardanelles are
   closed in the raster so the Black Sea / Marmara / Aegean connect **only** through TUR-controlled
   canal edges. Seeds come from a 42,000-point Fibonacci sphere visited in a hash-shuffled order with
   a Poisson-like spacing of `min(2000, 390 + 1.8·d)` km (`d` = distance to land; 1,200 km base near
   Antarctica), so zones are dense along coasts and large offshore. Every water component ≥ 2,000 km²
   gets a seed. Water cells take the nearest seed (great circle), then a connectivity pass keeps
   only the part of each zone connected through its own water to its seed (a zone never spans an
   isthmus) and regrows orphans from neighbouring zones. Two Lloyd iterations follow. Zone shapes
   are vectorised topologically (each boundary chain between two zones is simplified once, 0.1°)
   and extend 6 cells under the land so coastlines drawn on top hide the raster.
5. **Edges.** `coast`: every province coastline vertex looks up labelled water within 2 cells (8 as a
   fallback for bays closed at raster resolution). `sea`: raster adjacency (x wraps → dateline links).
   Reviewed `strait`/`canal`/sea links from `map/crossings.ts`. Remaining enclosed basins (raster-closed
   narrows: Gulf of Corinth, an Amazon estuary pocket) are auto-linked to the nearest zone across the
   smallest raster water gap (≤ 80 km) with label "Narrows (auto-linked)"; the Caspian is excluded.
   Every edge has great-circle `km` between node centres and `wraps: true` when it crosses 180°.
6. **Attributes.** `landmass` = components over land+strait; `basin` = components over sea+canal.
   Terrain: authored boxes (Himalaya/Tibet, Andes, Alps, Rockies, Sahara, Arabia, Gobi, Australian
   interior, Amazon, Congo, maritime SE Asia, Siberian/Canadian Arctic …) then a deterministic
   latitude/hash heuristic; city provinces are `urban` (≥ 1.5 M) or `suburban` (≥ 300 k). Sea zones
   are `coastal_waters` when they touch any land cell, else `high_seas`. Deposits: hash roll (≈ 30 %
   of non-urban provinces) with terrain weights and regional bias boxes (Gulf/Siberia/Venezuela/Niger
   delta fuel; Katanga/Inner Mongolia/Andes/Australia rare; breadbaskets supplies …) plus ~90 authored
   key sites (`KEY_DEPOSITS`, e.g. Ghawar, Burgan, Samotlor, Katanga, Bayan Obo, Escondida, Pilbara)
   that override the roll. Rural population = national population minus city population,
   distributed by area × terrain density.
7. **Names.** City provinces take the city name. Others: "<compass> <nearest city>" within a radius
   scaled by country size; island parts without cities use `ISLAND_NAMES` ("Baffin Island", "North
   Sakhalin"); remaining mainland areas use `REGION_NAMES` ("Rub’ al Khali", "Labrador"); last resort
   "<Country> — <direction>". Names are unique per country. Sea zones use `NAMED_SEAS` (with compass
   suffixes when a sea has several zones) or "<Ocean> 35°N 40°W".
8. **Geometry.** Shapes are split at ±180°, densified to ≤ 1° segments (safe for d3-geo great-circle
   interpolation), rounded to 3 decimals, closed, and wound like world-atlas (exterior clockwise in
   lon/lat, holes counter-clockwise — the d3-geo convention). Outlines exist for all 241 features
   (`playable` = owned by a seat directly or via the manifest). A final pass moves any centre/city
   whose rounded point fell outside its rounded shape inward (6 in the current build).
9. **Validation.** The build exits non-zero on: unmatched manifest entries, unresolved crossings, an
   Indonesian strait, ports in non-coastal provinces, isolated provinces, empty shapes, land edges on
   outside nodes, province count outside 1,200–2,000, unlinked basins, or capitals ≠ 1 per country.
   Same input ⇒ byte-identical output (verified by hashing two consecutive builds).
   Micro-states that degenerate under simplification (the Vatican) keep their raw source geometry.

## Reviewed crossings (`scripts/map/crossings.ts`)

**Straits (land links across water, 23 active):** Channel Tunnel (GBR–FRA), Øresund Bridge (DNK–SWE),
Great Belt and Little Belt (DNK), Strait of Messina ferry link (ITA), Kanmon, Seikan, Great Seto and
Akashi Kaikyō bridges (JPN), Bosporus crossings and 1915 Çanakkale Bridge (TUR), Kerch Bridge (RUS,
physical infrastructure; Crimea has a DisputedArea record), Johor–Singapore Causeway (SGP–MYS), King
Fahd Causeway (BHR–SAU), Penang Bridge (MYS), Confederation Bridge, Canso Causeway and Montreal island
bridges (CAN), New York bridges to Long Island (USA), Chalkida bridges to Euboea (GRC), San Juanico
Bridge Samar–Leyte (PHL), Sarasin Bridge to Phuket (THA), Hong Kong–Zhuhai–Macau Bridge (CHN).
Listed but skipped because the island is attached to the same province (islet): Storstrøm/Farø,
Fehmarn, Rügen, Öland, Menai/Anglesey.
**Indonesian islands are never linked by land** (not even Java–Madura); the build and tests assert it.

**Canals (sea↔sea, controlled by the owner of `via`):** Suez (via an EGY province), Panama (via a PAN
province), Bosporus and Dardanelles (via TUR provinces; the straits are closed in the raster so these
are the only Black Sea exits), Kiel (DEU, optional — skipped if both ends fall in one zone).
**Natural narrows** (Gibraltar, Øresund/Great Belt, Kerch Strait, Messina, Singapore Strait,
Bab-el-Mandeb, Hormuz, Bering) are checked; they are open water at raster resolution in this build.

## Caspian Sea

The Caspian is the only inland water body in the source (lakes such as the Great Lakes are land in
Natural Earth admin-0). It is modelled as an **enclosed sea basin** of 4 zones with coast edges for
AZE, IRN, KAZ, RUS and TKM — fleets can operate there but it has no connection to the world ocean
(the Volga–Don canal is not modelled). Countries whose only coast is the Caspian (AZE, KAZ, TKM) have
`coastal: true` but `landlocked: true` (no world-ocean coast).

## Territory manifest summary (`src/data/territory-manifest.ts`)

241 features: **120 playable**, **38 dependent** (inheriting a playable parent), **76 outside
campaign**, **6 disputed** (drawn separately, outside), **1 Antarctica** → 83 outside nodes.

- Dependents → parent: Greenland, Faroe → DNK; Puerto Rico, Guam, US Virgin Islands, Northern
  Mariana Islands, American Samoa → USA; Isle of Man, Jersey, Guernsey, Falklands, South Georgia,
  BIOT, Bermuda, Cayman, Turks and Caicos, BVI, Anguilla, Montserrat, Saint Helena, Pitcairn → GBR;
  New Caledonia, French Polynesia, Saint Pierre and Miquelon, Wallis and Futuna, Saint Martin, Saint
  Barthélemy, French Southern Lands → FRA; Aruba, Curaçao, Sint Maarten → NLD; Åland → FIN; Hong
  Kong, Macau (SARs) → CHN; Indian Ocean Territories, Norfolk, Heard & McDonald, Ashmore & Cartier
  → AUS. Their provinces carry `territory.status = 'dependent'`. Five tiny dependents have no
  province of their own: Guernsey and Saint Barthélemy are drawn as islets of the Jersey / Saint
  Martin provinces; Sint Maarten, Pitcairn and Ashmore & Cartier (< 40 km² and remote) are drawn in
  the outlines only.
- Parts tagged dependent inside a playable feature (`PART_TAGS`): French Guiana, Guadeloupe,
  Martinique, Réunion, Mayotte (FRA overseas departments) and the Caribbean Netherlands.
- Cook Islands and Niue (free association with NZ) are kept **outside**, as are all non-roster
  independent states (Iceland, Luxembourg, Somalia, Zambia, Fiji, Haiti, Cyprus …) and micro-states.
- Outside-campaign nodes (`x:CODE:0`, one per feature) keep their own name, have `outside: true`,
  `country: null`, no city, no deposit, zero population, and **no edges at all** — they block land
  transit; sea lanes around them stay open.

## Disputed-area policy

`MapData.disputed` has 20 explicit records, each with `source` (incl. claimants) and `displayPolicy`:

- **Drawn separately, outside the campaign, never granted to a neighbour:** Western Sahara (east of
  the berm), Kosovo, Northern Cyprus, Somaliland, Siachen Glacier, Palestinian territories.
- **Inside a playable feature per the source's de facto line (administered by that seat, dispute
  shown in the inspector):** Western Sahara west of the berm (MAR; regional province names, no city
  placed), Crimea (RUS), Golan Heights (ISR), Indian- and Pakistani-administered Kashmir, Aksai Chin
  (CHN), Arunachal Pradesh (IND), Southern Kurils (RUS), Falklands and South Georgia (GBR), Chagos
  (GBR), Abkhazia and South Ossetia (GEO), Transnistria (MDA).
- Taiwan (TWN) is a playable seat with its own administration (incl. Kinmen and Penghu).
- Rebel events may change control flags but never create a 121st seat.

## Capital choices

One capital per country (`CAPITAL_NOTES` in `cities.ts`): where the seat of government differs, the
administrative capital is used — La Paz (BOL), The Hague (NLD), Abidjan (CIV), Putrajaya (MYS),
Colombo (LKA), Dodoma (TZA), Pretoria (ZAF), Jerusalem (ISR, seat of government; recognition note),
Sana’a (YEM, constitutional capital; note on Aden), Jakarta (IDN; Nusantara not modelled). The
constitutional/commercial capitals are also listed as cities.

## Known limitations

- Province shapes follow a simplified 1:50m coastline (≈1 km tolerance); tiny islets attached to a
  neighbouring province make that province's drawing span a few km of water (adjacency unaffected).
- Sea-zone borders are raster-derived (0.05° ≈ 5.5 km, simplified at 0.1°); a few narrow channels
  (Gulf of Corinth, Amazon estuary pocket) rely on auto-linked narrows.
- Terrain and deposits are heuristic (boxes + hashes + authored key sites), not elevation/biome
  data; population figures are approximate game values.
- Seikan/Kanmon etc. are modelled as `strait` land links between the provinces nearest the crossing;
  `km` is centre-to-centre.
- AZE's Nakhchivan exclave has no coast; it reaches Baku only by transit through a neighbour
  (tests document this single exception).
- Only Natural Earth's de facto line is drawn; claimed lines are documented as metadata only.

## How to regenerate

```
npm install
npm run map:build          # writes src/data/generated/{map,geometry}.json and prints a report
npx vitest run tests/map   # map invariants (counts, capitals, ports, connectivity, canals, dateline…)
```

Tuning knobs live in `CONFIG` at the top of `scripts/build-map.ts` (province scale, sea spacing,
simplification). Authored tables: `src/data/cities.ts`, `src/data/territory-manifest.ts`,
`scripts/map/crossings.ts`, `scripts/map/regions.ts` (populations, terrain boxes, deposit biases,
key deposits, named seas, island and region names).
