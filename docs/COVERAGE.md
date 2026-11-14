# Coverage matrix — World Command: World 120

_Release audit (SPEC §6.6). Last audited 2026-11-14 by the release-audit agent; statuses updated the same day by the verification agent (new e2e specs: walkthroughs, screens, mobile-touch, visual). Verified by reading
the implementation and the tests, not by trusting other docs. Re-run the commands in
[HANDOFF.md](HANDOFF.md) before changing a status._

## How to read this file

Every row has exactly one status:

| Status | Meaning |
| --- | --- |
| **implemented and tested** | Code exists and an automated test exercises the behaviour named in the row (the only status that counts as "complete"). |
| **implemented awaiting verification** | Code exists (read during this audit) but no automated test exercises it end to end, or the test covers only part of the row (the gap is named). |
| **deferred by stated product choice** | Deliberately not built; the reason is written in the row and in a subsystem doc. |
| **missing** | Required by the SPEC and not implemented (or only a stub). |

Test IDs: `V:` = Vitest (`npm test`), written `file › test name` (prefix of the `it()` title).
`E:` = Playwright (`npm run build && npx playwright test --trace off`), using the short IDs below.

| Short ID | Playwright spec › title |
| --- | --- |
| E-core | `e2e/core.spec.ts` › title → Indonesia → research, build, recruit, move, advance, save, reload, continue |
| E-A01 | `e2e/acceptance.spec.ts` › A01: Indonesia and a landlocked start live in separate slots |
| E-A13 | `e2e/acceptance.spec.ts` › A13/W10: plays offline (no non-loopback requests), export → import into a fresh profile |
| E-A04 | `e2e/acceptance.spec.ts` › A04/W05: an unknown radar contact never exposes hidden type in DOM, aria or search |
| E-W06 | `e2e/acceptance.spec.ts` › W06: planning layer edits never change simulation state; Issue order opens the validated preview |
| E-A15 | `e2e/acceptance.spec.ts` › A15: island port selection, layer switch and inspector keep the camera |
| E-A14 | `e2e/acceptance.spec.ts` › A14: a second tab cannot silently overwrite newer progress |
| E-bulk | `e2e/workflows.spec.ts` › build from several cities: preview per-city eligibility, confirm charges exactly the preview |
| E-nego | `e2e/workflows.spec.ts` › negotiate with a bot: request right of way, see pending offer, advance time, read the reply |
| E-worked | `e2e/workflows.spec.ts` › SPEC worked interaction: Indonesia → Surabaya → maritime formation → private route idea survives Economy → +1 h, no orders → dated report stays put |
| E-A12 | `e2e/mobile-keyboard.spec.ts` › title → new campaign → first orders using only the keyboard (iPhone 13 profile) |
| E-msl | `e2e/military.spec.ts` › missiles: research → production → launch dialog with outcomes → in flight → viewer-scoped report |
| E-clnch | `e2e/military.spec.ts` › contact sheet: launch shortcut opens the validated launch dialog with the sector preselected |
| E-air | `e2e/military.spec.ts` › aircraft: patrol with footprint/endurance preview, then rebase (new home) |
| E-ret | `e2e/military.spec.ts` › retreat: destination and forecast HP cost, then the order is recorded |
| E-intel | `e2e/military.spec.ts` › intelligence: assign an agent mission and buy a dated report |
| E-perf | `e2e/perf.spec.ts` › map input response and pan fps with ~2000 stacks |
| E-W08-USA | `e2e/walkthroughs.spec.ts` › W08 U.S.: mobilize, build, offer, move, carrier patrol, verify outcomes; research opens on day 4 and Sealift I adds lift; save/reload |
| E-W08-BOL | `e2e/walkthroughs.spec.ts` › W08 landlocked Bolivia over five days: economy, market, diplomacy both ways, coalition application, no naval options anywhere |
| E-W08-IDN | `e2e/walkthroughs.spec.ts` › W08 Indonesia over three days: archipelago build-up, fleet to sea, 24/72 h forecasts, newspaper editions, save/reload |
| E-market | `e2e/screens.spec.ts` › Annex A walkthrough 5 — market: inspect upkeep, post a sell order, partial AI fill, cancel the rest, reconcile before and after reload |
| E-coal | `e2e/screens.spec.ts` › coalitions: create with name/description/emblem, details, coalition-only thread, leave with timed notice |
| E-journal | `e2e/screens.spec.ts` › journal, toasts and newspaper: grouped by day, filters, event detail…, jump-to, editions without future days, anonymous statement |
| E-dossier | `e2e/screens.spec.ts` › unit dossier: class, level, HP, upkeep, feature names, combat table by target class, terrain table, unavailable cells, back to the previous screen |
| E-split | `e2e/screens.spec.ts` › split, merge and fire control on a friendly formation: before/after roster, conservation, inspector shows the behaviour |
| E-tut | `e2e/screens.spec.ts` › tutorial: start from the briefing, skip a step, reopen it, auto-complete from real actions, progress saved in the campaign |
| E-archive | `e2e/screens.spec.ts` › home and archives: archive hides from the active list, restore brings it back unchanged, delete asks first |
| E-settings | `e2e/screens.spec.ts` › settings, credits and diagnostics: theme and interruptions persist per device; catch-up is named, capped and summarised |
| E-m-worked | `e2e/mobile-touch.spec.ts` › mobile worked interaction: Indonesia → Surabaya → maritime formation → private route idea survives Economy → +1 h, no orders → dated report stays put (iPhone 13, taps only) |
| E-W10-touch | `e2e/mobile-touch.spec.ts` › W10 touch-only, monochrome: locate a unit by symbol meaning, tell planned from present, inspect a dated contact |
| E-m-dossier | `e2e/mobile-touch.spec.ts` › unit dossier at narrow width: target/terrain selectors with vertically labelled values |
| E-shots | `e2e/visual.spec.ts` › map screenshots: crowded Europe and the port of Surabaya at regional and local zoom (`toHaveScreenshot`, baselines in `e2e/visual.spec.ts-snapshots/`) |
| E-gallery | `e2e/visual.spec.ts` › symbol gallery: the regenerated manifest equals the reviewed docs/gallery/manifest.json |

Reference URLs for Annex rows are the wiki links given in the SPEC section named in the "Spec" column
(e.g. Annex A·H → <https://wiki.conflictnations.com/User_Interface#H_-_Market>).

---

## 1. Campaign, roster and opening (World 120)

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Exactly 120 seats, one human + 119 AI, one capital per seat | World 120 manifest, W01 | `src/data/countries.ts`, `src/engine/scenario/create.ts`, `src/engine/scenario/world120.ts` | V: `tests/engine/world120.test.ts › W01 roster: unique seats/capitals, one human + N−1 AI…`; `tests/map/map.test.ts › has exactly the 120 manifest countries…`, `› exactly one capital per country…`; `tests/profiles/profiles.test.ts › has exactly 120 profiles…`; E-A01 (119 AI in view) | implemented and tested |
| One selectable campaign mode (World 120) | W02, §1 | `src/engine/scenario/registry.ts` (`listCampaignModes`), `src/ui/screens/ChooseCountry.tsx` | V: `tests/engine/world120.test.ts › exposes exactly one campaign mode (W02)`, `› W02: save/reload/replay keep the single ruleset…`; `tests/engine/ai.test.ts › W01/W02 (fixture)…` | implemented and tested |
| Region filters 22/34/18/22/21/3, searchable list, Indonesia featured | World 120, §1 | `src/ui/screens/ChooseCountry.tsx` | E-core, E-A01 (search + select BOL, default IDN preview) — counts not asserted | implemented awaiting verification |
| Preview: capital, cities, resources, doctrine, coastline, neighbours, start difficulty, opening power | §1, Annex A intro | `src/ui/screens/ChooseCountry.tsx`, `src/ui/sim/engine-adapter.ts` (`countryPreviews`) | E-A12 (`preview-capital` = Jakarta); other fields not asserted | implemented awaiting verification |
| Difficulty = AI planning effort only, no resource handicap | World 120, §4 | `src/ai/turn.ts`, `src/engine/ai-host/scheduler.ts`, ChooseCountry difficulty fieldset | V: `tests/profiles/opening-power.test.ts › does not weaken or strengthen the U.S. by controller or difficulty` | implemented and tested |
| Seed varies personalities / market / events within bounds; geography fixed | World 120 | `src/engine/scenario/create.ts`, `src/engine/rng.ts` | V: `tests/engine/determinism.test.ts › same seed reproduces, different seed diverges` | implemented and tested |
| Opening paused at 06:00 UTC, map centred on capital | World 120, §1 | `src/engine/time.ts`, `src/ui/screens/Game.tsx` | E-core (tick 0, camera near Jakarta, pause pressed) | implemented and tested |
| 120 authored profiles (city functions, stockpiles, forces, facilities, techs, trade needs, 2–3 opening decisions) | Asymmetric countries | `src/data/profiles/**` | V: `tests/profiles/profiles.test.ts` (all `describe` blocks) | implemented and tested |
| Indonesia start includes Jakarta and Surabaya; archipelago logistics | §1 | `src/data/cities.ts`, map graph | V: `tests/map/map.test.ts › Indonesia has Jakarta (capital) and Surabaya…`, `› Indonesian islands are never linked by land…`; E-A01, E-worked | implemented and tested |
| Unselected territory: outside-campaign hatch, own names, no income/VP/seat, land transit blocked | World 120 "Unselected territory", W09 | `src/data/territory-manifest.ts`, `src/engine/systems/movement.ts`, `src/ui/map/renderer.ts` (hatch) | V: `tests/map/map.test.ts › no land or strait edge touches an outside-campaign node…`, `› dependent territories are tagged…`; `tests/engine/movement.test.ts › distinguishes unreachable / no access / missing facility / outside campaign` | implemented and tested |
| Disputed areas with source and display policy | World 120, W09 | `src/data/territory-manifest.ts`, `docs/MAP.md` | V: `tests/map/map.test.ts › disputed areas have explicit records…` | implemented and tested |
| Rebel control flag never creates a 121st seat | World 120, W02 | `src/engine/systems/government.ts` | V: `tests/engine/government.test.ts › cross-check 8: undefended city → immediate rebel control…` | implemented and tested |
| Small states (Bahrain, Singapore) selectable at world zoom with offset marker | Geography QA | `src/ui/map/renderer.ts` (small-state markers), map data | V: `tests/map/map.test.ts › small states Bahrain and Singapore have nodes, cities and edges`; marker click not e2e-tested | implemented awaiting verification |
| Canals, dateline, Alaska, connected ocean basins, no false land links | Geography QA, W09 | `scripts/map/**`, `src/data/generated/**` | V: `tests/map/map.test.ts › Panama and Suez canals…`, `› the sea graph crosses the dateline…`, `› sea zones form one connected basin…`, `› land edges connect only provinces of one landmass…` | implemented and tested |
| Every country has a route to a scoring opportunity; landlocked access to own cities | Geography QA | map graph | V: `tests/map/map.test.ts › every playable country has provinces and a route to a scoring opportunity`, `› every province can reach its own capital…`, `› landlocked countries border at least one playable neighbour` | implemented and tested |
| 1,200–2,000 land provinces + sea sectors | Geography QA | `src/data/generated/**` | V: `tests/map/map.test.ts › stats match the data and the province budget is respected` | implemented and tested |

## 2. Title, new campaign, load, settings, credits, diagnostics

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Title: Continue (nation, day, difficulty, score, last save), New, Load, Settings | §1 | `src/ui/screens/Title.tsx` | E-core (Continue card shows Indonesia + Day 1 · 07:00) | implemented and tested |
| Separate save slots, playing one leaves the other intact | A01 | `src/ui/persist/db.ts`, `src/ui/screens/LoadCampaign.tsx` | E-A01 | implemented and tested |
| Active / archived / recovery lists; resume, archive, restore, delete | Annex A "Home and archives" | `src/ui/screens/LoadCampaign.tsx`, `src/ui/persist/db.ts` | E-archive (resume, archive → hidden from Active and listed under Archived, restore → resumes with identical tick/seed/stock/formations, delete with a cancellable confirmation); E-A01 (resume). The Recovery-copies list is not exercised by a test | implemented awaiting verification |
| Export / import JSON, validated, imported as a new campaign | §5, A13 | `src/ui/screens/LoadCampaign.tsx`, `src/workers/sim.worker.ts`, `src/engine/save/**` | E-A13; V: `tests/engine/save.test.ts › A13-style: export/import keeps seed, clock, roster, economy, pending jobs` | implemented and tested |
| Settings: theme, interruption preferences, catch-up (named, max shown), sound | §2, §3, Readability | `src/ui/screens/Menus.tsx`, `src/ui/persist/prefs.ts`, `src/workers/sim.worker.ts` | E-settings (defaults, theme → `data-theme`, interruption, monochrome, sound and catch-up choices persist across reload; in-game Settings dialog shows the same preferences) | implemented and tested |
| Sound effects | Annex A·C | stored preference only (no audio assets); `docs/UI.md` | — | deferred by stated product choice |
| Credits (milsymbol MIT, Natural Earth PD) and diagnostics (versions, last save, copyable error report) | Annex A·C | `src/ui/screens/Menus.tsx`, `public/licenses/` | E-settings (credits: milsymbol MIT text, Natural Earth; diagnostics: application version, save format version, last successful save, "no server", error report text) | implemented and tested |
| Explain when browser storage cannot persist | §5 | `src/ui/screens/Title.tsx`, `src/ui/persist/db.ts` | none | implemented awaiting verification |

## 3. Operations map

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Map ≥ 70 % of 1440×900 with drawers closed | Operations map | `src/ui/screens/Game.tsx`, `src/ui/styles.css` | none (layout not measured by a test) | implemented awaiting verification |
| Pan (drag, WASD/arrows, d-pad on touch), wheel/pinch zoom at pointer, reset to capital, dateline wrap | §2 Main map, Annex A·C | `src/ui/map/MapView.tsx`, `src/ui/map/renderer.ts`, `src/ui/map/projection.ts` | E-perf (wheel + pan probes); E-A15 (camera API) | implemented and tested |
| Three zoom states with label priority (selection/alerts > pinned > capitals) | Operations map | `src/ui/map/renderer.ts` | E-perf (renders all zoom states); label priority not asserted | implemented awaiting verification |
| Primary fill layers (political, terrain, morale, resources, relations, visibility) with patterned legend; restored on reload | §2 Map settings, Annex A·C | `src/ui/map/palette.ts`, `src/ui/map/renderer.ts`, `src/ui/persist/prefs.ts` | E-A15 (terrain legend, camera kept, restored after reload) | implemented and tested |
| Visibility fill from the engine's `observedNodes`; sensor-coverage layer from `StackView.sightKm/radarKm` | §2 Map settings, Annex A·I | `src/ui/map/MapView.tsx` (`buildInput`), engine `src/engine/systems/visibility.ts` | V: `tests/engine/observed-nodes.test.ts` (all); UI drawing not asserted | implemented awaiting verification |
| Independent toggles: borders, names, routes, symbols, sensor coverage, dim | §2, Annex A·C | `src/ui/map/MapView.tsx` (layers popover), `src/ui/map/renderer.ts` | none | implemented awaiting verification |
| Search grouped by army/city/province; same filtered dataset as hit testing and aria | Operations map, Annex A·C | `src/ui/map/objects.ts`, `src/ui/map/MapView.tsx` (`MapSearch`) | E-core, E-A12 (city search selects), E-A04 (family words never return a hidden contact) | implemented and tested |
| Clicking ocean clears selection; empty province click selects province | §2, Annex A·E | `src/ui/map/MapView.tsx` | none | implemented awaiting verification |
| Island port hit testing at continental zoom | A15, W09 | `src/ui/map/renderer.ts` (hit targets) | E-A15 (Ambon) | implemented and tested |
| Cluster chooser (two-step picker for crowded sectors) | Mobile, Operations map | `src/ui/map/MapView.tsx`, `src/ui/screens/Game.tsx` | none | implemented awaiting verification |
| Context menu (Inspect, Locate in roster, Orders, Pin report) by right-click and Shift+F10 | Operations map | `src/ui/map/MapView.tsx` | none | implemented awaiting verification |
| Right-drag lasso, Shift/Ctrl-click multi-select, right-click cancels targeting | Annex A input chart | `src/ui/map/MapView.tsx` | none | implemented awaiting verification |
| Locator arrow for off-screen selection; scale bar | Operations map | `src/ui/map/renderer.ts` | none | implemented awaiting verification |
| Zoom buttons, fullscreen button | Annex A·C | `src/ui/map/MapView.tsx` (`FullscreenButton` added in this audit) | none | implemented awaiting verification |
| Planning layer: draw/rename/hide/delete, no sim change; "Issue order" opens validated preview | Operations map, W06 | `src/ui/components/Planning.tsx`, `src/engine/save/` (UI section) | E-W06, E-worked; V: `tests/engine/save.test.ts › W06: planning drawings live in the UI section…` | implemented and tested |
| Drawings have author, creation time, optional expiry | Operations map | `src/engine/save/` drawing helpers, `Planning.tsx` | V: `tests/engine/save.test.ts › W06…` (fields not all asserted) | implemented awaiting verification |
| Abstract missile origin→sector line without steering | Missiles | `src/ui/map/renderer.ts`, `engine-adapter.ts` (`view` adds `from`) | E-msl (launch has origin while in flight) | implemented and tested |
| Screenshot test: crowded European region + Philippine/Indonesian port at two zoom levels | Symbol gallery paragraph | `e2e/visual.spec.ts` + committed baselines `e2e/visual.spec.ts-snapshots/*.png` (Chromium/Linux, 1440×900) | E-shots (map canvas `toHaveScreenshot`, maxDiffPixelRatio 1 %: Europe with 2,000 deterministic synthetic stacks of all four affiliations at regional z14 and local z40; Surabaya port at regional z16 and local z60) | implemented and tested |
| Desktop **and mobile** recordings of the worked interaction | Worked interaction | `e2e/workflows.spec.ts`, `e2e/mobile-touch.spec.ts` | E-worked (desktop) and E-m-worked (iPhone 13, taps only, same assertions; selection survives opening Planning/Economy on the phone). Automated replays rather than video files (`WC_SHOTS` saves step screenshots) | implemented and tested |

## 4. Top bar, resource strip, time strip, notifications

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| One-line top bar: nation, date/UTC, pause, speed, score/target, save indicator, next event | Top status bar, §2 | `src/ui/components/TopBar.tsx` | E-core (clock, pause, save indicator) | implemented and tested |
| Pause / speed / +1 h / jump to next event; real-time estimate only when running | Annex A·B, §2 Advisor/time | `TopBar.tsx`, `src/workers/sim.worker.ts` | E-core, E-A12 (+1 h by keyboard); next-event not e2e | implemented and tested |
| Resource strip: stock, gross, consumption, committed, net, insufficient vs negative; shortage row with time to depletion; opens market | §2 Resource strip, Annex A·G | `src/ui/components/ResourceStrip.tsx` | V: `tests/engine/economy.test.ts › unpaid upkeep is recorded as a shortage…forecast & breakdown exposed`; UI not e2e | implemented awaiting verification |
| Bottom time strip: arrivals, refits, research deadlines, dated reports; preview without advancing | Bottom time strip | `src/ui/components/TimeStrip.tsx` | none | implemented awaiting verification |
| Toasts identify event + place, jump to object, dismiss without stopping, findable in history | Annex A·D | `src/ui/components/Toasts.tsx`, `src/ui/panels/Journal.tsx` | E-journal (a purchased report raises a placed toast; Go selects the place; the clock state is unchanged; dismiss removes it; the toast and a routine completion are both in Notification history, whose Go selects the recorded node) | implemented and tested |
| Interrupt-and-pause defaults (war on me, capital change, game end); configurable | Readability | engine `GameEvent.interrupt`; `src/workers/sim.worker.ts`; Settings | V: `tests/engine/government.test.ts › human eliminated…` (interrupt flag present); worker pause not tested | implemented awaiting verification |
| Daily digest of routine completions | Readability | `src/engine/sim.ts` (day change digest) | none found | implemented awaiting verification |

## 5. Inspector (right sheet / bottom sheet)

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Friendly stack: country, components/health, activity, strength, speed, efficiency, destination, duration vs arrival, terrain/group modifiers | Annex A·E | `src/ui/components/Inspector.tsx` (`StackSheet`) | E-core, E-worked (position), E-A12 (active order) | implemented and tested |
| Friendly city: category, terrain, population, VP, output, morale + trend, buildings, WIP, prev/next | Annex A·E/F | `Inspector.tsx`, `src/ui/panels/Cities.tsx` (city sheet) | E-core, E-A15 (city sheet opens) | implemented and tested |
| Morale current vs target with signed factors; uprising risk | Annex A·E Territory condition, §3 Conquest | engine `government.ts`; `Cities.tsx` | V: `tests/engine/government.test.ts › morale target exposes signed factors…` | implemented and tested |
| Rural province sheet with own construction catalog, deposits, zero-output warning | Annex A·E, Annex B Territory actions | `Inspector.tsx` (`PlaceSheet`), engine `commands/national.ts` | V: `tests/engine/commands.test.ts › human-readable reasons with codes…`; UI not e2e | implemented awaiting verification |
| Foreign territory: public fields only, observation time | Annex A·E | `Inspector.tsx`, engine `provinceInspector` | V: `tests/engine/visibility.test.ts › a foreign city exposes only public fields`; `tests/engine/commands.test.ts › UI model helpers…inspector privacy…` | implemented and tested |
| Contact sheet shows only observed fields (radar → domain + time) | §2 Workflow 3, A04 | `Inspector.tsx` (`ContactSheet`), `src/ui/map/objects.ts` | E-A04 | implemented and tested |
| Report sheet: frozen snapshot, source, as-of, expiry | Annex A·I | `Inspector.tsx` (`ReportSheet`) | E-intel, E-worked (report frozen after +1 h) | implemented and tested |
| Launch missile at a contact's / report's sector (shortcut added in this audit, validated dialog) | Missiles, Annex A·E Attack | `Inspector.tsx` (`LaunchAtSector`), `Orders.tsx` (`LaunchDialog target`) | E-clnch | implemented and tested |
| Multi-selection: common actions + exceptions (move, merge) | Right inspector | `Inspector.tsx` (`MultiSheet`) | none | implemented awaiting verification |
| Selected object disappears → explanation and graceful recovery | §2 Context inspector | `src/ui/screens/Game.tsx` + `Inspector.tsx` (`lost-selection`) | none | implemented awaiting verification |
| Bottom sheet with visible close on narrow screens | §2 Compact layouts | `Game.tsx`, `styles.css` | E-A12 | implemented and tested |

## 6. Orders and combat

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Move: destination/waypoints, route preview (terrain, mode changes, ETA), cancel costs no time, order line | §2 Workflow 1, Annex A·E | `src/ui/components/MoveOrder.tsx`, engine `systems/movement.ts` | E-core, E-A12; V: `tests/engine/movement.test.ts › route preview lists per-segment terrain, mode changes…` | implemented and tested |
| Act-of-war confirmation before crossing at peace; cancel preserves status | §2 Workflow 1, Annex A·E | `MoveOrder.tsx` (`confirm-war`), engine movement | V: `tests/engine/movement.test.ts › entering a peaceful country without passage requires explicit act-of-war confirmation…`; UI path exercised conditionally in E-core | implemented and tested |
| Re-check legality when rights change mid-route; no teleport | §2 Workflow 1, A03 | engine `movement.ts` | V: `tests/engine/movement.test.ts › A03: multi-waypoint land+strait route…`, `› a stack mid-edge into a newly illegal province turns back…` | implemented and tested |
| Route failure classes (unreachable / no access / missing facility / outside) | §3 travel graph | engine `systems/mapindex.ts`, `movement.ts` | V: `tests/engine/movement.test.ts › distinguishes unreachable / no access…` | implemented and tested |
| Stop | §3 Orders | `Inspector.tsx` (`action-stop`) | E-A12 | implemented and tested |
| Attack (visible targets), delay, embark/disembark | §3 Orders, Annex A·E | `src/ui/components/Orders.tsx` | V: `tests/engine/commands.test.ts › intel agents, articles, deployables and explicit embark/disembark…`; UI not e2e | implemented awaiting verification |
| Retreat with destination and forecast HP cost | Annex A·E, Annex B Engagements | `Orders.tsx` (`RetreatDialog`), engine `combat.ts` | E-ret; V: `tests/engine/combat.test.ts › retreat goes to a real adjacent destination and costs 10 % HP` | implemented and tested |
| Split / merge with before/after roster, conservation | Annex A·E, A07 | `Inspector.tsx` (`SplitDialog`, merge) | V: `tests/engine/combat.test.ts › A07: split/merge conserve…`; E-split (dialog before/after counts, disabled reasons for 0 and all units, split adds a formation in the Forces list at the same node with unit count and HP conserved, Merge here restores the totals) | implemented and tested |
| Fire control (hold / return fire / engage) | Annex A·E, Annex B Membership | `Inspector.tsx` (fire policy select), engine | E-split (Fire control select → `setFirePolicy` → inspector shows "Engage eligible contacts", then "Hold unless ordered") | implemented and tested |
| Combat: hourly rounds, defender table, entrenchment, overstack, echelon allocation, readiness, battle reports | §3 Orders and combat, Annex B Engagements | engine `systems/combat.ts` | V: `tests/engine/combat.test.ts` (echelon, overstack, timed engagement two speeds, no double round, ranged, readiness) | implemented and tested |
| Capture only by eligible occupying unit | §3 Forces, cross-check 4 | engine `government.ts` | V: `tests/engine/combat.test.ts › cross-check 4…` | implemented and tested |
| Offshore bombardment changes city condition | §3 Forces | engine `combat.ts` (ranged vs city) | no dedicated test found | implemented awaiting verification |
| Aircraft: patrol (radius, time on station, home, refuel), rebase/ferry, diversion/loss events | Annex A·E Aircraft, A10 | `Orders.tsx` (`PatrolDialog`, `RebaseDialog`, `AircraftPanel`), engine `systems/air.ts` | E-air; V: `tests/engine/air.test.ts` (all) | implemented and tested |
| Deployables (uses, cooldown, placement range) | §3 Forces, Annex B Special categories | `Orders.tsx` (`DeployableDialog`), engine | V: `tests/engine/commands.test.ts › intel agents, articles, deployables…`; UI not e2e | implemented awaiting verification |
| Officers: one bonus per officer type in the same group | Annex B Special categories | engine `combat.ts` (`officerMult`), catalog | V: `tests/catalog/integrity.test.ts › officers carry an officerBonus…` (data only); combat effect not tested | implemented awaiting verification |
| Helicopter-specific air-mobile embark rules | §3 Orders | helicopters move with ground stacks (`docs/ENGINE.md` known gaps) | — | missing |

## 7. Cities, production and bulk orders

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Cities list: sort by net production, grouping, checkboxes | §2 Workflow 2, Annex A·F | `src/ui/panels/Cities.tsx` | E-bulk | implemented and tested |
| Bulk preview: per-row eligibility + exact reason, queue position, total; confirm charges exactly; stale preview recomputed | §2 Workflow 2, Annex A·F Bulk | `Cities.tsx`, engine `commands/national.ts` (`previewToken`) | E-bulk; V: `tests/engine/commands.test.ts › bulk build: per-city preview, exact charge, stale preview token recomputed` | implemented and tested |
| Single-city build and mobilize from the city sheet | §1 first five minutes | `Cities.tsx`, `Inspector.tsx` | E-core, E-A12 | implemented and tested |
| Occupied cities can build but not mobilize; launch control omitted with explanation | Annex A·F | engine `production.ts`; `Cities.tsx` | V: `tests/engine/government.test.ts › A05…`; `tests/engine/commands.test.ts › human-readable reasons…occupied city…` | implemented and tested |
| Homeland / annexed / occupied output 100/50/25 % | Annex A·F, Annex B Economy | engine `economy.ts` | V: `tests/engine/economy.test.ts › territory factor applied exactly once…` | implemented and tested |
| Reservation at enqueue, cancel refund rule, concurrency per city | §3 Economy | engine `production.ts`, `docs/ENGINE.md` | V: `tests/engine/economy.test.ts › job reservation rule…` | implemented and tested |
| Rally point applies to later mobilizations | Annex A·F | `Cities.tsx`, engine | V: `tests/engine/commands.test.ts › rally point applies to later mobilizations…` | implemented and tested |
| Annexation and demolition with explicit target and consequence preview | Annex A·F | `Cities.tsx`, engine | V: `tests/engine/government.test.ts › A05…` (annex); demolition not tested | implemented awaiting verification |
| Building detail: level, health, effects; repair | §3 Economy, Annex A·F | `Cities.tsx` | none | implemented awaiting verification |
| Optional paid morale action | Annex A·E (reference "optional") | — | — | deferred by stated product choice |

## 8. Research

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Tree by branch: day gate, prerequisites, tier, cost, time, doctrine; locked/available/active/complete + time/prereq/facility/doctrine/unaffordable/busy/slots states | §3 Technology, Annex A Research, Annex B | `src/ui/panels/Research.tsx`, engine `systems/research.ts` | V: `tests/engine/research.test.ts › statuses…`; E-core (start research) | implemented and tested |
| Exact refund preview before cancel | Annex A Research | `Research.tsx`, engine `researchRefund` | V: `tests/engine/research.test.ts › cancel refund is progress-dependent and quoted exactly`; UI not e2e | implemented and tested |
| Current-vs-next comparison, eligible cities after completion | §3 Technology | `Research.tsx` | none | implemented awaiting verification |
| One published upgrade rule for existing and new units; save during research completes once | §3, A08 | engine `research.ts` | V: `tests/engine/research.test.ts › A08 / cross-check 3…` | implemented and tested |
| Specialization opportunity cost | §3 Technology | catalog | V: `tests/catalog/integrity.test.ts › specialization has an opportunity cost…` | implemented and tested |
| Ten branches incl. land, support, aviation, naval, recon, officer, strategic | §3 Technology | `src/data/catalog/**` | V: `tests/catalog/integrity.test.ts › covers all ten branches…` | implemented and tested |

## 9. Forces, readiness and unit dossier

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Forces screen: fielded / ready / committed strength, maintenance | Depth·Readiness | `src/ui/panels/Forces.tsx`, engine `readiness.ts`, `forceModel` | V: `tests/engine/commands.test.ts › UI model helpers…force summary`; `tests/engine/combat.test.ts › readiness lowers strength…`; E-air/E-ret select from Forces list | implemented and tested |
| Unit dossier: class, level, HP, upkeep, feature names, combat table by target class, terrain table, units, unavailable cells; narrow-width selector | Annex A Unit dossier | `Forces.tsx` (`UnitDossier`) | E-dossier (name, family, Hit points, Upkeep, Kills, Sight, Signature, named features, target-class columns, terrain rows, explicit "n/a" cells, level select, ← Previous screen); E-m-dossier (narrow width: target-class and terrain selectors) | implemented and tested |
| Distinct playable classes (infantry … submarines), original names | §3 Forces | `src/data/catalog/units.ts` | V: `tests/catalog/integrity.test.ts › covers every family…`, `› names are original…` | implemented and tested |

## 10. Missiles and hypersonic programs

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Four families with separate speed/flight/payload/maturity/cost/accuracy attributes | Missile gameplay | `src/data/catalog/missiles.ts` | V: `tests/catalog/integrity.test.ts › covers the four families…`, `› high speed does not imply better accuracy…` | implemented and tested |
| Maturity sequence; research → blueprint only; only production creates inventory | Missile gameplay, W04 | engine `systems/missiles.ts`, `research.ts` | V: `tests/engine/missiles.test.ts › maturity sequence…`; `tests/engine/research.test.ts › research grants blueprints only…`; E-msl | implemented and tested |
| Program table: backlog, batch cost, ceiling, replacement time, distinct prototype art | Missile "Why build one?" | `Forces.tsx`, `Orders.tsx` (`MissileProgramTable`, `MaturityBadge`) | E-msl (maturity badge, produce dialog) | implemented and tested |
| Launch dialog: possible outcomes + headline chance before commit, conditional-accuracy tooltip, inventory after commit | Missile resolution/accuracy | `Orders.tsx` (`LaunchDialog`) | E-msl, E-clnch | implemented and tested |
| Each family and each terminal outcome; insufficient stock; double submit; save in flight; accelerated clock | W07 | engine `missiles.ts` | V: `tests/engine/missiles.test.ts` (all incl. statistical 10,000-launch checks) | implemented and tested |
| Viewer-scoped report ("effect unconfirmed") | Missile resolution | engine; `Orders.tsx` strike reports | V: `tests/engine/missiles.test.ts › observed target sector → attacker learns the real outcome`; E-msl | implemented and tested |
| Two peers can complete a hypersonic branch in a legal playthrough | W04 | catalog reachability | V: `tests/catalog/integrity.test.ts › a hypersonic branch is reachable by a peer within the campaign` (static chain only, no playthrough) | implemented awaiting verification |
| Bot cancels a proposed procurement when its trade position deteriorates | Missile "Why build one?" | `src/ai/economic.ts` | V: `tests/ai/economy.test.ts › seeded example: a bot cancels a proposed missile procurement…` | implemented and tested |

## 11. Economy, ledger and market

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Seven resources, each with a role | §3 Economy | catalog `resources` | V: `tests/catalog/integrity.test.ts › defines all seven accounts…`, `› every resource is used…` | implemented and tested |
| Ledger reconciled to stockpile; categories; city-by-city shortages | §3 Economy, Annex B Economy | engine `ledger.ts`, `economy.ts`; `src/ui/panels/Economy.tsx` | V: `tests/engine/economy.test.ts › ledger deltas reconcile…`, `› unpaid upkeep is recorded as a shortage…` | implemented and tested |
| 24 h / 72 h forecast; stock vs spendable vs reserved vs net | Depth·Economy | `Economy.tsx`, engine `forecastModel` | V: `tests/engine/economy.test.ts › unpaid upkeep…forecast & breakdown exposed`; UI not e2e | implemented and tested |
| First economic report explains a nation-specific choice | Depth·Economy | `Economy.tsx` (`economic-report`), profiles | V: `tests/profiles/opening-power.test.ts › shows one identifiable U.S. import pressure…`; UI not e2e | implemented awaiting verification |
| Market: best/all/my trades, price-time priority, partial fills, escrow, cancel remainder once, no self-trade, explained errors | Annex A·H, A06 | engine `systems/market.ts`; `Economy.tsx` (`MarketPanel`) | V: `tests/engine/market.test.ts` (all four); UI not e2e | implemented and tested |
| Market UI flow (post sell, partial AI fill, cancel rest, reconcile after reload) | Annex A walkthrough 5 | `Economy.tsx` | E-market (empty book and invalid amount explained in place; sell 100 rests and reserves exactly 100; a computer bid fills 40 → Filled 40 / Remaining 60, cash +40×price, execution "sold to …"; Abort releases 60; order history keeps the cancelled residual; stock/escrow/orders/fills identical after reload; ledger reconciles); E-W08-BOL (buy crossing a computer ask fills immediately) | implemented and tested |
| Occupation upkeep visible | §3 Conquest | engine | V: `tests/engine/economy.test.ts › occupation upkeep is visible…` | implemented and tested |
| Industrial disruption flows through city and ledger | Depth·Economy | engine (sabotage/condition) | V: `tests/engine/commands.test.ts › intel agents…` (sabotage path); ledger flow not asserted | implemented awaiting verification |

## 12. Diplomacy, offers, messages, coalitions

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Four statuses per direction; passage changes access not affiliation | Annex A Diplomatic relations, Annex B Diplomacy | engine `systems/diplomacy.ts`; `src/ui/panels/Diplomacy.tsx` | V: `tests/engine/diplomacy.test.ts › exactly four statuses per direction…` | implemented and tested |
| Nation list with controller, relationship both directions, pending offers; declaration vs request separated | Annex A Diplomatic relations | `Diplomacy.tsx` | E-nego (nation row, detail, pending) | implemented and tested |
| Offers: recipient-only decisions, idempotent accept/expiry, stale offers cannot override | Annex A Offers, A09 | engine `diplomacy.ts` | V: `tests/engine/diplomacy.test.ts › A09: accept is idempotent…`, `› a stale offer cannot override…` | implemented and tested |
| Bot replies in its thread with a concrete reason matching its logged decision | §2 Workflow 4 | `src/ai/diplomacy.ts`; thread key from engine `threadFor` (switched in this audit) | E-nego; V: `tests/ai/diplomacy.test.ts › refuses a poor offer and replies with a brief concrete reason…` | implemented and tested |
| Two bots reach a treaty without the human | §2 Workflow 4 | `src/ai/diplomacy.ts` | V: `tests/ai/diplomacy.test.ts › two bots reach a treaty without the human`; `tests/engine/diplomacy.test.ts › A09: pending offer survives save/load; two bots…` | implemented and tested |
| On acceptance access, visibility, map styling and orders update together | §2 Workflow 4 | engine + `MapView.tsx` relations fill | V: `tests/engine/visibility.test.ts › shared intel shares vision…`; UI styling not asserted | implemented awaiting verification |
| Trust history per pair with reasons | Depth·Information | engine `diplomacy.ts` | V: `tests/engine/diplomacy.test.ts › peace offers end wars; trust history records reasons` | implemented and tested |
| Coalitions: create (name/description/emblem), apply, accept/decline, leave with timed notice, history, shared transit, capacity | Annex A Coalitions, Annex B Coalition panel | engine `coalitions.ts`; `Diplomacy.tsx` (`CoalitionPanel`) | V: `tests/engine/diplomacy.test.ts › coalitions: capacity, applications…`; `tests/ai/diplomacy.test.ts › AI coalition policy` (2); UI not e2e | implemented and tested |
| Coalition thread to current members only | Annex A·D | engine messages; `Diplomacy.tsx` | V: `tests/engine/diplomacy.test.ts › messages: private threads and coalition thread…` | implemented and tested |
| Bot coalition partner stays independent; defends own capital while declining my operation | Intro, §4 | `src/ai/**` | V: `tests/engine/diplomacy.test.ts › a bot in the human coalition remains an independent controller`; `tests/ai/diplomacy.test.ts › a coalition partner defends its own exposed capital…` | implemented and tested |
| Human free text kept as a note; AI never claims to understand unenforceable promises | Annex B Offers and AI | `src/ai/diplomacy.ts` (intent templates) | V: `tests/engine/diplomacy.test.ts › messages…intent templates` | implemented and tested |

## 13. Intelligence and visibility

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Radar contact = domain only; visual adds owner/count; identified adds types; stale | §2 Workflow 3, Annex B Engagements | engine `systems/visibility.ts`, `view/country-view.ts`; `src/ui/map/objects.ts` | V: `tests/engine/visibility.test.ts › A04: radar-only contact…`, `› mixed stack…`, `› cross-check 7…`; E-A04 | implemented and tested |
| Purchased report = frozen dated snapshot with expiry; old report stays when target moves | §2 Workflow 3, A04 | engine `intel.ts`; `src/ui/panels/Intel.tsx` | V: `tests/engine/visibility.test.ts › A04: purchased report is a frozen snapshot…`; E-intel, E-worked | implemented and tested |
| Agents: recruit/assign information, sabotage, corruption; cost; next report | Annex A·I | engine `intel.ts`; `Intel.tsx` | E-intel; V: `tests/engine/commands.test.ts › intel agents…` | implemented and tested |
| Shared vision via coalition / shared intel; revoke recomputes legitimately | Annex A·I | engine visibility | V: `tests/engine/visibility.test.ts › shared intel shares vision; revoking it refreshes only legitimate fields…`, `› coalition members share vision` | implemented and tested |
| Hidden info never leaks via UI labels, search, tooltips, AI inputs, news | Non-negotiable 3, cross-check 6 | `objects.ts`, engine view, `src/ai` | E-A04; V: `tests/engine/visibility.test.ts › cross-check 6…`; `tests/ai/contract.test.ts` (3 tests); `tests/engine/commands.test.ts › public newspaper never exposes private orders…` | implemented and tested |
| Unknown surface contact never exposes a submarine icon | Symbol table | `src/data/catalog/symbols.ts` | V: `tests/catalog/symbols.test.ts › generic contact SIDCs never encode a hidden branch…` | implemented and tested |
| Bots use the same fog and treaty permissions | §4, Annex A·I | `src/ai` consumes `CountryView` only | V: `tests/ai/contract.test.ts › decide() receives only (CountryView, PlannerContext)…` | implemented and tested |
| Bot spends on a sensor/report and updates its plan | §4 Information gathering | `src/ai/**` | V: `tests/ai/economy.test.ts › information gathering: buys a report…` | implemented and tested |

## 14. Journal, newspaper, events

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| One typed event projected into private journal / public newspaper / inbox | Annex B Three distinct records | engine `events.ts`, `view/queries.ts` | V: `tests/engine/commands.test.ts › public newspaper never exposes private orders or composition; journal and inbox are private` | implemented and tested |
| Journal UI: by day, filters (economy, research, diplomacy, combat, intelligence), opening a past event after the unit is gone | Annex A Private event history | `src/ui/panels/Journal.tsx` | E-journal (day sections, the five category filters show only their category, All restores the count, an event opens with recorded time/place/kind and the "keeps its place…" note); the specific case of opening an event after its unit is destroyed is not exercised | implemented awaiting verification |
| Newspaper UI: editions with day selector (no future editions), ranked index, article composer with anonymous option | Annex A Global newspaper | `Journal.tsx` (`NewsPanel`), engine `newspaper` | E-journal (today's edition, Next disabled = no future edition, Previous/Next, ranked nation index, anonymous plain-text statement shows "Anonymous statement" and markup as text); E-W08-IDN (four editions, Previous disabled on day 1) | implemented and tested |
| Article image attachment | Annex B Three records ("local attachment") | — (text only) | — | missing |

## 15. Score, victory, end and career

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Published scoring rule: province 1, city tier, capital +4; denominator once; thresholds 24/40/48/55/60 % rounded up | World 120 Opening and scoring | engine `systems/score.ts`, `rules.ts` | V: `tests/engine/victory.test.ts › denominator computed once; thresholds rounded up; weights visible` | implemented and tested |
| Settlement at day change; coalition as bloc; day-180 fraction; tie-break | World 120, A11 | engine `score.ts` | V: `tests/engine/victory.test.ts` (all 7) | implemented and tested |
| Reload of a completed save is review mode, never re-awards | §1, A11 | engine `isReviewMode`; `src/ui/session.ts` | V: `tests/engine/victory.test.ts › solo victory crossing the threshold just before day change is recorded once; reload never re-awards…` | implemented and tested |
| Score panel: current/target/next settlement, territory contributions, standings, fixed city score vs mutable population | §1, Annex A·B | `src/ui/panels/Score.tsx` | V: `tests/engine/commands.test.ts › UI model helpers…score breakdown`; UI not e2e | implemented awaiting verification |
| End screen: winner, coalition roster + contributions, score history, territory, research, losses | §1, Annex A·B | `Score.tsx` (`EndPanel`; losses derived from journal kinds) | none | implemented awaiting verification |
| Human eliminated → run concluded, can watch bots finish, still one human | §1, Annex B cross-check 1 | engine `hooks.ts`; `EndPanel` defeat card | V: `tests/engine/government.test.ts › human eliminated with no territory and no recovery force…` | implemented and tested |
| Local career XP, separate from VP, no double award on replay | Annex B Career | engine `career`; `Score.tsx` | none found | implemented awaiting verification |

## 16. Help, briefing and tutorial

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| New-game briefing with three nation-specific decisions linked to screens | Readability | `src/ui/components/Briefing.tsx`, profile `openingDecisions` | V: `tests/profiles/profiles.test.ts › has two or three distinctive opening decisions linked to screens…`; E-core/E-A12 close it | implemented and tested |
| Tutorial lessons (select city, read resource, unlock + mobilize, move, check arrival); skip / reopen; saved in the campaign | Annex A·A | `Briefing.tsx` (tutorial), `state.ui` | E-tut (start from the briefing, Show me focuses the control, Skip step, reopen, select-city and read-resources complete from real actions, close + Reopen tutorial from the game menu, progress in `uiPrefs` survives save/reload) | implemented and tested |
| Advisor/help panel with keyboard chart and current-save examples | Annex A·A, input chart | `src/ui/panels/Help.tsx` | none | implemented awaiting verification |

## 17. Keyboard, touch and accessibility

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Keyboard-only from title to first orders on a narrow screen; Escape closes the right layer and restores focus | A12 | `src/ui/screens/*`, `common.tsx` (`Modal`), `PanelHost.tsx` | E-A12 | implemented and tested |
| WASD/arrows not stolen while typing | Input chart | `common.tsx` (`isTypingTarget`) | E-A12 types into search (indirect) | implemented awaiting verification |
| Previous/next army and city (arrows + buttons) | Input chart | `src/ui/actions.ts` (`cycle`) | none | implemented awaiting verification |
| Disabled actions show a reason | §2 | `common.tsx` (`ActionButton`) | E-A12 ("No active order to stop."), E-clnch ("No ready missiles") | implemented and tested |
| Monochrome / colour-independent encodings (patterns, frames, age badge) | §2, W05, W10 | `palette.ts`, `renderer.ts`, symbol overlays | E-W10-touch (monochrome setting on: renderer `mono`, affiliation/dimension read from SIDC frame digits, planned vs present via APP-6 status digit + "Planned" text, contact age in words); E-gallery (monochrome and planned/damaged/stale gallery variants hash-checked against the reviewed manifest); E-shots | implemented and tested |
| Touch: tap-select, pinch, two-step picker, d-pad | Mobile, W10 | `MapView.tsx` | E-m-worked, E-W10-touch (tap search results, Forces list, roster contacts, bottom sheet More/Less/Close, two map taps to draw); pinch zoom, the two-step cluster picker and the d-pad are not exercised | implemented awaiting verification |

## 18. Persistence and multi-tab

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Named campaigns, autosave, manual save with indicator | §5 | `src/ui/persist/db.ts`, `src/workers/sim.worker.ts`, `TopBar.tsx` | E-core (manual save, reload, Continue) | implemented and tested |
| Save contains schema/scenario version, seed, RNG, tick, events, AI memory, jobs, orders | §3, §5 | engine `save/**` | V: `tests/engine/save.test.ts`, `tests/engine/determinism.test.ts › save/reload mid-run…`, `tests/ai/contract.test.ts › determinism…memory persists through save/reload…` | implemented and tested |
| Validate import (references, finite numbers, ownership, queued work); temporary copy; damaged import leaves saves intact | §5, A14 | engine `save/validate`, worker import | V: `tests/engine/save.test.ts › corrupt imports throw typed errors…`; E-A13 (damaged import rejected) | implemented and tested |
| Explicit repeatable migration | A14 | engine `save/migrate` | V: `tests/engine/save.test.ts › explicit, repeatable v0 → v1 migration` | implemented and tested |
| Single writer across tabs (Web Locks) + revision conflict → recovery checkpoint | §5, A14 | `src/ui/sim/host.ts`, `db.ts` | E-A14 (read-only second tab); V: `tests/engine/save.test.ts › save revision detects a second writer`; checkpoint-on-conflict path not e2e | implemented and tested |
| Recovery checkpoint on failed write | §5 | `db.ts`, worker | none | implemented awaiting verification |
| Restore midway through refuelling, treaty offer, partial order, day rollover | §5, cross-check 9 | engine | V: `tests/engine/save.test.ts › cross-check 9…`; `tests/engine/determinism.test.ts › save/reload mid-run…`; `tests/engine/diplomacy.test.ts › A09: pending offer survives save/load…` | implemented and tested |
| Preferences stored separately (localStorage) | §5 | `src/ui/persist/prefs.ts` | E-A15 (layer restored after reload) | implemented and tested |
| Optional catch-up while closed (named, max, summary) | §3 | worker + Settings | E-settings (enabled with a 2 h maximum; resuming after ~4 s simulates that many minutes, pauses, and the toast names the simulated time and the maximum) | implemented and tested |

## 19. Engine core

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Integer time, seeded streams, same seed + commands ⇒ same state at any speed | Non-negotiable 5, §3 | `src/engine/sim.ts`, `rng.ts` | V: `tests/engine/determinism.test.ts` (all 4) | implemented and tested |
| One validator for human and AI | Non-negotiable 4, cross-check 2 | `src/engine/commands/**` | V: `tests/engine/commands.test.ts › validation results are identical…`, `› an AI controller goes through submitCommand…`; `tests/engine/economy.test.ts › cross-check 2…` | implemented and tested |
| Simultaneous arrivals by documented rule; atomic transfers | §3 | `sim.ts` step order (`docs/ENGINE.md`) | V: `tests/engine/combat.test.ts › timed engagement…`; no dedicated simultaneous-arrival test | implemented awaiting verification |
| Population, morale, revolts (seeded), garrison fights once | §3 Conquest, cross-check 8 | engine `government.ts` | V: `tests/engine/government.test.ts` (all) | implemented and tested |
| Engine runs in a Web Worker and in Node | Architecture | `src/workers/sim.worker.ts`, tests | V: every engine test (Node); E-core (worker) | implemented and tested |

## 20. Computer countries (src/ai)

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Utility planner with no LLM/network, filtered view only | §4 | `src/ai/**` | V: `tests/ai/contract.test.ts` (all) | implemented and tested |
| Staggered scheduler, per-country budget, wakes, no starvation (incl. distant states) | Depth·AI | `src/engine/ai-host/scheduler.ts` | V: `tests/engine/scale.test.ts › AI starvation…`; `tests/ai/world120.test.ts › activity: every bot…no starvation` | implemented and tested |
| Useful decisions counted by type; no repeated no-ops; invalid = 0 | Depth·AI | `src/ai/log.ts` | V: `tests/ai/activity.test.ts` (passes); `tests/ai/world120.test.ts › all bot commands pass the shared validator…` **currently fails** at the end of this audit: the USA bot issued 4 rejected `rebase` commands on real data (src/ai is mid-change by the AI agent; `tests/ai/alliance.test.ts › zero invalid commands…` passes on the mini world) | implemented awaiting verification |
| Industrial investment / electronics shortage response | §4 table | `src/ai/economic.ts` | V: `tests/ai/economy.test.ts › electronics shortage → …` | implemented and tested |
| Archipelago funds sea mobility; landlocked avoids naval orders | §4 table | `src/ai/strategic.ts`, `economic.ts` | V: `tests/ai/economy.test.ts › archipelago start…`, `› landlocked bot never issues naval orders…` | implemented and tested |
| Objective changes after lost port / new transit / expired observation | §4 Territorial objectives | `src/ai/operational.ts`, `strategic.ts` | no dedicated test found | implemented awaiting verification |
| Small state seeks access/coalition/trade before war | Depth·AI | `src/ai/diplomacy.ts` | V: `tests/ai/diplomacy.test.ts › a small state seeks access…`; `tests/ai/world120.test.ts › small states sought access/coalition/trade before any war…` | implemented and tested |
| Bots propose/accept/reject/revoke; leave coalitions by explicit rule; anti-spam cooldowns | §4 Diplomacy, Peace and coalition | `src/ai/diplomacy.ts`, `memory.ts` | V: `tests/ai/diplomacy.test.ts` (all) | implemented and tested |
| Personality weights and decaying memory; developer-only decision log outside the save | §4 | `src/ai/memory.ts`, `log.ts` | V: `tests/ai/contract.test.ts › decision log is a bounded developer-only ring buffer…` | implemented and tested |
| Coalition mutual defence (reinforce a partner's threatened capital/core city, help requests honoured, grievances/favours) | §4 Defence vs expansion, Peace and coalition policy | `src/ai/alliance.ts` (landed during this audit by the AI agent) | V: `tests/ai/alliance.test.ts › AI coalition mutual defence` (5 tests) | implemented and tested |
| Naval escort of embarked formations, blockade only with sea superiority, carrier wings embark | §4, W04 | `src/ai/naval.ts` | V: `tests/ai/alliance.test.ts › AI naval escort, blockade and carriers` (3 tests). Engine has no blockade effect yet (positional only) | implemented and tested |
| Trade agreements sized to forecast deficit and actual surplus; recipient refuses beyond reserve | §4 Industrial investment, Depth·Economy | `src/ai/diplomacy.ts`, `economic.ts` | V: `tests/ai/alliance.test.ts › AI trade agreements sized to surplus and deficit` (3 tests) | implemented and tested |
| Peace terms with territory or resources; multi-round haggling | §4 Peace and coalition policy | not implemented (`docs/AI.md` Known gaps) | — | missing |
| Zero-human-order campaign reaches a terminal condition | A02 | `src/ai`, engine | V: `tests/engine/ai.test.ts › A02…`; `tests/ai/world120.test.ts › several bots mobilize, invest, negotiate, fight and change control`; observer suite 4 × 180 d (`docs/reports/observer-summary.md`) | implemented and tested |

## 21. Opening power, balance evidence

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Opening power index (5 dimensions, weights, normalization, nearest rival), persisted, dossier breakdown | Asymmetric countries, W03 | `src/engine/power.ts`; `scripts/opening-power-report.ts` → `docs/reports/opening-power.md`; ChooseCountry/Score dossier | V: `tests/engine/power.test.ts` (all); `tests/profiles/opening-power.test.ts › W03 opening power` (all) | implemented and tested |
| U.S. = 118 (115–121), lead 15–21 %, no hidden multiplier, $1 basket change isolation | W03 | profiles + power | V: `tests/profiles/opening-power.test.ts › ranks all 120 seats…118…`, `› the U.S. leads the nearest rival by 15–21 %`, `› a $1 change in the reference basket…`; `tests/profiles/profiles.test.ts › profiles carry only contract fields and no per-country multiplier…` | implemented and tested |
| U.S. technology package (lift, refuelling, carrier aviation, recon, research lead, sustainment, import pressure, hypersonic prerequisite only) | U.S. technology family table, W04 | `src/data/profiles/**` | V: `tests/profiles/profiles.test.ts › U.S. technology package (data)` (5); `tests/profiles/opening-power.test.ts › W04 technology package…` (3) | implemented and tested |
| Carrier aviation / lift advantages operate in ordinary play with real-data U.S. | W04 | engine `air.ts` | E-W08-USA (real-data U.S.: Carrier Air Wing 1 rebases onto its carrier through the normal dialog, then patrols from it; Sealift I researched on day 4 raises `self.lift` by exactly 4); V: `tests/engine/air.test.ts › carriers are mobile bases…` | implemented and tested |
| 120 seeded observer campaigns with per-country metrics and flags | Balance evidence, W08 | `scripts/observer-suite.ts` → `docs/reports/observer-summary.md` | report run: 120 × **5-day** horizon + 4 × 180-day (not 120 full campaigns) | implemented awaiting verification |
| Three human walkthroughs: U.S., Indonesia, landlocked | Balance evidence, W08 | `e2e/walkthroughs.spec.ts` | E-W08-USA (2 + 4 days: build, mobilize, offer, move, carrier aviation, day-4 research, outcomes, save/reload), E-W08-BOL (5 days: no naval options, economy/forecast, market, both directions of diplomacy, coalition application, score, save/reload), E-W08-IDN (3 days) plus E-core/E-worked | implemented and tested |
| Playtest high/medium/small vs U.S. bot | Asymmetric countries | — | not recorded | missing |

## 22. Symbology and gallery

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| Stable entity key + versioned SIDC crosswalk; 20-digit strings; validation; fail-safe generic contact (never infantry) | Symbol contract | `src/data/catalog/symbols.ts`, `public/licenses/milsymbol-LICENSE.txt` | V: `tests/catalog/symbols.test.ts` (all 9) | implemented and tested |
| Bundled pinned milsymbol + licence; offline rendering | Symbol contract, Non-negotiable 2 | `package.json` (milsymbol 3.0.5), `src/ui/map/symbols.ts` | E-A13 (no non-loopback requests) | implemented and tested |
| Same symbol/designation/knowledge cut-off in map, roster, inspector | W05 | `src/ui/map/objects.ts` (one dataset) | E-A04 (roster aria, inspector SIDC entity 000000, map hit label) | implemented and tested |
| Offline gallery: every family × 4 affiliations, planned/selected/damaged/stale/greyscale, meaning text, reviewed manifest | Symbol gallery | `scripts/symbol-gallery.ts` → `docs/gallery/` | `npm run gallery`; E-gallery (regenerates the manifest in memory and requires it to equal the committed `docs/gallery/manifest.json`: renderer, sample count, every SIDC, caption and SVG hash, in order). Note: sample ids are not unique (`#mono-unknown` appears in two sections) | implemented and tested |
| Echelon only when verified; HQ only for known HQ; stack count ≠ echelon | Symbol table | `symbols.ts`, renderer | V: `tests/catalog/symbols.test.ts › applies verified echelon and HQ to land units only…` | implemented and tested |
| Verification against APP-6 E reference plates | Symbol contract | `docs/CATALOG.md` (milsymbol validity only) | plate-by-plate visual comparison not recorded | implemented awaiting verification |

## 23. Performance

| Feature | Spec | Implementation | Tests | Status |
| --- | --- | --- | --- | --- |
| p95 map input < 100 ms, pan ≥ 45 fps with ~2,000 stacks at 1440×900 | Depth·Performance | `src/ui/map/renderer.ts` | E-perf (this audit: Europe p95 28.5 ms, 57.7 fps; headless software rendering) | implemented and tested |
| 390×844 measurements | Depth·Performance | same | E-perf with `WC_PERF_MOBILE=1` (numbers in `docs/UI.md`; skipped by default) | implemented awaiting verification |
| Simulation-day cost, autosave < 2 s, cold load, save size, peak memory on a declared reference laptop | Depth·Performance | engine; `docs/ENGINE.md`, `docs/UI.md` | V: `tests/engine/scale.test.ts › benchmark…` (prints, no threshold); container numbers only, no reference laptop, peak memory not recorded | implemented awaiting verification |
| Heavy-war day (~650 movers) ≤ 400 ms | Engine target (`docs/ENGINE.md`) | engine (being optimised) | measured 530–640 ms | missing |

## 24. Service-only and reference-only features (documented dispositions)

| Feature | Spec | Disposition | Status |
| --- | --- | --- | --- |
| Other human players, public rooms, matchmaking, chat with people, moderators | Intro, Annex B Career | Out of product (solo, offline); local AI threads replace chat | deferred by stated product choice |
| Membership, subscriptions, premium currency, paid boosts, store | Annex A "Victory and progression", Annex B | Excluded; useful free equivalents (queues, rally, fire control) are available | deferred by stated product choice |
| Seasons, persistent alliances, account ranks across campaigns | Annex B Career table | Historical reference only; local career ledger instead | deferred by stated product choice |
| Other scenarios (tutorial maps, event maps, WWZ, Rising Tides, Domination) | Annex B Campaign table | One map, one ruleset (World 120) | deferred by stated product choice |
| Online service status / bug report to server | Annex A·C | Local diagnostics with copyable report | deferred by stated product choice |
| Chemical/nuclear payloads, contamination | Annex B Engagements, unit directory | Excluded (`src/data/catalog/missiles.ts` dispositions: abstract-only campaign) | deferred by stated product choice |
| Fifth diplomatic standing | Annex A Diplomatic relations | Not invented; four documented statuses | deferred by stated product choice |

---

## Release acceptance cases A01–A15

| ID | Evidence | Status |
| --- | --- | --- |
| A01 | E-A01 (Indonesia seed 7 and Bolivia seed 8 in separate slots; homeland, capital, cities, seed, 119 AI; Indonesia intact after playing Bolivia). Doctrine/assets not asserted beyond capital/cities. | implemented and tested |
| A02 | V: `tests/engine/ai.test.ts › A02…` (fixture, documented terminal condition); `tests/ai/world120.test.ts › several bots mobilize, invest, negotiate, fight and change control` (real data, smoke horizon); observer suite 4 × 180 days all settled at day 180 (`docs/reports/observer-summary.md`). | implemented and tested |
| A03 | V: `tests/engine/movement.test.ts › A03: multi-waypoint land+strait route; revoking transit stops the stack at the last legal node…` | implemented and tested |
| A04 | V: `tests/engine/visibility.test.ts › A04…` (2 tests); E-A04 (DOM/aria/search/hit label); E-worked (report frozen). Bot messages not part of the e2e check. | implemented and tested |
| A05 | V: `tests/engine/government.test.ts › A05: capture → cannot recruit → annex → recruit → lose…` (engine only; no UI walkthrough) | implemented and tested |
| A06 | V: `tests/engine/market.test.ts › A06: two purchases…`, `› A06: cancel a partially filled sale…` (engine; market UI not e2e). Note: these failed transiently during this audit while the engine agent was mid-edit (`openOrdersOf` / `openOrderCount` undefined) and pass again on the final run. | implemented and tested |
| A07 | V: `tests/engine/combat.test.ts › A07: split/merge conserve…`, `› overstack efficiency…`, `› timed engagement: identical outcome at two speeds…` | implemented and tested |
| A08 | V: `tests/engine/research.test.ts › A08 / cross-check 3…` | implemented and tested |
| A09 | V: `tests/engine/diplomacy.test.ts › A09…` (2); `tests/ai/diplomacy.test.ts › A09: a save with an offer pending resolves exactly once after reload`, `› plausible yes…` | implemented and tested |
| A10 | V: `tests/engine/air.test.ts` (divert, loss, revoked access, disabled airfield, sunk carrier) | implemented and tested |
| A11 | V: `tests/engine/victory.test.ts` (solo near day change, coalition bloc, no re-award on reload) | implemented and tested |
| A12 | E-A12 (iPhone 13 viewport, keyboard only, Escape restores focus to the opener) | implemented and tested |
| A13 | E-A13 (all non-loopback requests blocked; export → import into a new browser context keeps seed/clock/stock/jobs) | implemented and tested |
| A14 | V: `tests/engine/save.test.ts › corrupt imports…`, `› explicit, repeatable v0 → v1 migration`, `› save revision detects a second writer`; E-A13 (damaged import), E-A14 (second tab read-only) | implemented and tested |
| A15 | E-A15 (Ambon port at continental zoom, terrain legend, city sheet, camera unchanged, layer restored) | implemented and tested |

## Release gates W01–W10

| Gate | Evidence | Status |
| --- | --- | --- |
| W01 Roster | V: `tests/engine/world120.test.ts › W01 roster…`; `tests/profiles/opening-power.test.ts › every seat can issue a legal opening recruit order`; map capital tests | implemented and tested |
| W02 One campaign | V: `tests/engine/world120.test.ts › exposes exactly one campaign mode (W02)`, `› W02: save/reload/replay…`; rebel flag test (government) | implemented and tested |
| W03 Opening power | V: `tests/profiles/opening-power.test.ts › W03 opening power` (8 tests); `tests/engine/power.test.ts`; `docs/reports/opening-power.md` (USA 117.98, lead 17.98 %) | implemented and tested |
| W04 Technology | Data and opening checks tested (`profiles`/`opening-power` W04 blocks; blueprints never inventory); E-W08-USA demonstrates carrier aviation and lift in ordinary real-data play. Not demonstrated: two peers completing a hypersonic branch in a legal playthrough (only static reachability) | implemented awaiting verification |
| W05 Symbols | V: `tests/catalog/symbols.test.ts`; E-A04 (map/roster/inspector agree; unknown contact SIDC entity 000000); E-gallery (all affiliations × families and state variants diffed against the reviewed manifest); E-shots (map snapshots); E-W10-touch (monochrome map, symbol meaning by touch) | implemented and tested |
| W06 Planning | E-W06, E-worked; V: `tests/engine/save.test.ts › W06…` | implemented and tested |
| W07 Missile outcomes | V: `tests/engine/missiles.test.ts` (all families, all terminal outcomes, insufficient stock, double submit, missing observation, save in flight, accelerated clock); E-msl | implemented and tested |
| W08 Country viability | Walkthroughs complete: E-W08-USA, E-W08-BOL, E-W08-IDN (+ E-core, E-worked). Still open: the observer suite has only run 120 × 5 days + 4 × 180 days (0 invalid commands, no stalling nations); a 30-day × 120 run is pending | implemented awaiting verification |
| W09 Geography | V: `tests/map/map.test.ts` (outside territories, disputes, dateline, canals, island links); E-A15 (island hit target); movement routing tests. Foreign boundary labels not asserted. | implemented and tested |
| W10 Accessibility and offline | E-A13 (offline loopback build), E-A12 (keyboard), E-W10-touch (touch only, monochrome: locate by symbol meaning, planned vs present, dated contact), E-m-worked | implemented and tested |

## Annex B cross-system checks 1–10

| # | Evidence | Status |
| --- | --- | --- |
| 1 One human through save/reload/elimination/victory | V: `tests/engine/government.test.ts › human eliminated…still one human`; `tests/engine/world120.test.ts › W01…`; E-archive (archive → restore → resume unchanged); E-W08-* (save/reload) | implemented and tested |
| 2 Concurrent orders vs funds | V: `tests/engine/economy.test.ts › cross-check 2…` | implemented and tested |
| 3 Research completion upgrades existing + in-production units once | V: `tests/engine/research.test.ts › A08 / cross-check 3…` | implemented and tested |
| 4 Non-capturing unit vs infantry capture | V: `tests/engine/combat.test.ts › cross-check 4…` | implemented and tested |
| 5 Status change mid-route revalidates | V: `tests/engine/movement.test.ts › A03…`, `› a stack mid-edge…` | implemented and tested |
| 6 Hidden unit cannot affect another country's view/route/journal/wording | V: `tests/engine/visibility.test.ts › cross-check 6…`; `tests/ai/contract.test.ts › cross-system check 6…` | implemented and tested |
| 7 Two sensors on one contact | V: `tests/engine/visibility.test.ts › cross-check 7…` | implemented and tested |
| 8 Undefended vs garrisoned uprising | V: `tests/engine/government.test.ts › cross-check 8…` | implemented and tested |
| 9 Save before completion/settlement/expiry/day change/victory ≡ uninterrupted | V: `tests/engine/save.test.ts › cross-check 9…`; `tests/engine/determinism.test.ts › save/reload mid-run…` | implemented and tested |
| 10 Solo and coalition settlement across a day-change save | V: `tests/engine/victory.test.ts` | implemented and tested |

---

## Status counts (all rows above, excluding the legend)

Counted from the last cell of every data row in sections 1–24 and the A/W/cross-check tables (238 rows; the legend and this table excluded).

| Status | Rows |
| --- | ---: |
| implemented and tested | 172 |
| implemented awaiting verification | 52 |
| deferred by stated product choice | 9 |
| missing | 5 |

## Top missing items (priority order)

1. **Full-length observer evidence**: 120 campaigns were run to a 5-day horizon only (4 × 180 days); run `npm run report:observer -- --runs 120 --days 30 --long 4 --long-days 180` (≈ 3.5 h) or longer (W08 — the three human walkthroughs are now automated: E-W08-USA, E-W08-BOL, E-W08-IDN).
2. **Playtest record** of a high/medium/small start against the U.S. bot (§21).
3. **AI depth**: peace terms with territory/resources and multi-round haggling.
4. **Heavy-war simulation day** still 530–640 ms with ~650 movers (target 400 ms; engine agent working on it).
5. Helicopter air-mobile embark rules; newspaper article image attachment.
6. W04: two peers completing a hypersonic branch in a legal real-data playthrough.
7. UI rows still "awaiting verification" that most need an e2e test next: resource strip / time strip, interrupt-and-pause in the worker, attack/delay/embark dialogs, multi-selection, context menu / lasso, pinch + cluster picker + d-pad on touch, journal event after its unit is destroyed, recovery-copies list, score/end panels.
