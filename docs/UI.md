# UI — World Command: World 120

_Owner: UI agent. Paths: `src/ui/**`, `src/main.tsx`, `src/workers/**`, `e2e/**`, `public/**` (except `public/licenses`)._

## Architecture

```
main thread (React 18)                         Web Worker (src/workers/sim.worker.ts)
┌───────────────────────────────┐  postMessage  ┌──────────────────────────────────────────┐
│ SimHost (src/ui/sim/host.ts)  │ ────────────▶ │ engine-adapter.ts → src/engine (only)    │
│  request/response, store,     │   requests    │  GameState (authoritative), clock loop,  │
│  Web Locks + BroadcastChannel │ ◀──────────── │  submit/validate commands, queries,      │
│  (single writer)              │ frames/pushes │  autosave → IndexedDB (persist/db.ts)    │
└───────────────────────────────┘               │  AI: src/ai (if present) else Basic...   │
   ▲ Frame = CountryView (human seat, no rules)  └──────────────────────────────────────────┘
   │
   ├─ map/objects.ts  ONE filtered MapObject dataset → renderer, hit testing, search, roster, aria
   ├─ map/renderer.ts Canvas 2D renderer (Path2D cache, offscreen basemap cache, wrap copies)
   ├─ map/MapView.tsx pointer/keyboard/wheel/pinch, search, layers, legend, context menu, chooser
   ├─ screens/*       Title, ChooseCountry, LoadCampaign, Menus (Settings/Credits/Diagnostics), Game
   ├─ components/*    TopBar, ResourceStrip, LeftRail/MobileNav, Roster, Inspector, TimeStrip,
   │                  MoveOrder, Planning, Toasts/InterruptDialog, Briefing/Tutorial, common
   └─ panels/*        Cities(+city sheet, bulk preview), Research, Forces(+UnitDossier),
                      Economy(+Market), Diplomacy(+Coalition), Intel, Journal(+News), Score(+End,
                      Campaign), Help
```

* **Engine boundary.** Only `src/ui/sim/engine-adapter.ts` imports `src/engine`; the worker imports
  only the adapter. All buttons that change the game call `exec()` → `host.command()` → worker
  `submitCommand` (with a nonce for double-click idempotency). Previews call `validateCommand`.
* **Clock.** Paused by default. Speed `n×` = n game minutes per real second (1× … 256×; the top bar
  shows "1 h ≈ x s"). The worker advances in ≤15-minute chunks under a 28 ms budget per loop turn,
  drops time it cannot simulate (shows "max sim rate"), and posts a frame at most every 120 ms.
  Advance-one-hour (`step`) and jump-to-next-event (`advanceToNextEvent`, max 1 day) pause after.
  Interrupt-and-pause (war on me, capital change, campaign end; "other" off) is decided in the
  worker from `GameEvent.interrupt`, configurable in Settings.
* **Persistence.** IndexedDB `world-command` v1: `campaigns` (metadata rows for the title/load
  screens), `saves` (one serialized save per campaign, written in the same transaction as its
  metadata), `checkpoints` (recovery copies on failed writes / revision conflicts). Autosave every
  60 s of real time while dirty, on pause, after step/next-event, on tab hide/pagehide, plus manual
  save (indicator in the top bar). Preferences (theme, interruptions, map layers, catch-up, speed)
  live in `localStorage` (`wc.prefs.v1`); tutorial progress and planning drawings live in the save's
  UI section (`state.ui`, excluded from `stateHash`).
* **Multi-tab.** Web Locks `world-command:<id>` gives one writer per campaign; a second tab is
  offered *Open read-only* or *Take over* (BroadcastChannel tells the holder to go read-only). As a
  second line, every save compares the stored revision with the tab's known revision; on conflict it
  writes a recovery checkpoint instead of overwriting and offers *Return to campaigns* or an explicit
  overwrite.
* **Import/export.** Export = the raw save JSON. Import validates in the worker with
  `deserialize` (temporary copy, migrations, reference checks) and stores it as a **new** campaign;
  a damaged file is rejected and nothing is replaced.
* **Catch-up.** Named setting, OFF by default, maximum in game hours (default 24); simulates real
  time away at 1× on resume, then pauses and toasts the elapsed game time.
* **Hidden information.** `map/objects.ts` builds labels/aria/search text strictly from the
  `ContactView` level: radar `contact` → "Unknown <domain> contact" with the generic contact SIDC
  (entity 000000); `unidentified` adds owner/count; `identified` adds observed types; reports are
  frozen snapshots at observed coordinates with source/as-of/expiry. Map hit targets, roster rows,
  search, tooltips and the inspector all read these objects.

## Map renderer

* Plate carrée (x = lon, y = −lat), camera `{cx, cy, z px/°}`; horizontal wrap draws every copy
  intersecting the view (paths, routes, symbols, hit targets), dateline panning and selection work.
* Geometry (`geometry.json`, lazy chunk) → one `Path2D` per province/sea shape plus combined land,
  sea and outline paths. Fill groups (per colour+pattern) are rebuilt only when the fill layer,
  theme, ownership, morale or relations change. The basemap (fills, patterns, province/sea/country
  borders) renders into an offscreen canvas covering the viewport + 50 % margin; pans/zooms blit it
  and it is re-rendered after 160 ms of idle or when coverage runs out.
* Zoom states: **world** (<9 px/°: capitals, country names, small-state offset markers, selected /
  pinned / alert objects only), **regional** (9–32: tier ≥3 cities and ports, reviewed straits and
  canals, non-overlapping symbols with ×N counts), **local** (≥32: all cities, province centres,
  designations, order arrows, age badges, crossing labels). Labels use greedy collision with
  priority selection/alerts > pinned > capitals/own > others.
* Primary fill (exactly one): political, terrain, morale, resources, relations/coalition,
  visibility — each with patterns + named legend; independent toggles: borders, names, routes,
  symbols, sensor coverage, dim-under-overlays. Outside-campaign land has a hatch (close zoom) and a
  tooltip. Symbols: milsymbol SVG → cached `Image` per SIDC/size/mono; selection ring, age badge,
  report tag and ×N count are drawn outside the frame. Off-screen selection locator arrows.
* Input: drag pan (5 px click threshold), wheel/pinch zoom at pointer, WASD/arrows, ± keys,
  right-drag lasso (own formations), Shift/Ctrl-click additive selection, right-click = cancel
  targeting or context menu (Inspect, Locate in roster, Orders, Pin report), Shift+F10/Menu key for
  the same menu, cluster click → chooser. Clicking ocean clears selection.

## Screens → components

| Screen / requirement | Component |
| --- | --- |
| Title (Continue card: nation, day, difficulty, score, last save) | `screens/Title.tsx` |
| Choose your country (map + 6 region filters 22/34/18/22/21/3, Indonesia featured, preview incl. opening power, difficulty, seed) | `screens/ChooseCountry.tsx` |
| Load Campaign (active/archived/recovery, resume/archive/restore/delete, export/import) | `screens/LoadCampaign.tsx` |
| Settings, Credits (milsymbol MIT, Natural Earth PD), Diagnostics (versions, last save, copyable report) | `screens/Menus.tsx` |
| Game layout (top bar, resource strip, rail, roster, map, inspector, time strip; mobile sheet/nav) | `screens/Game.tsx` |
| Briefing (3 decisions linked to screens), tutorial (5 lessons, saved in campaign) | `components/Briefing.tsx` |
| Move workflow (preview route, legs/terrain, mode changes, ETA, war confirmation, cancel) | `components/MoveOrder.tsx` |
| Bulk build/mobilize (per-row eligibility & reasons, queue position, total, stale-token recompute) | `panels/Cities.tsx` |
| City sheet (morale/production breakdowns, buildings, queue + refund preview, annex/demolish, rally, prev/next) | `panels/Cities.tsx` |
| Research (states, current-vs-next, refund preview, eligible cities) | `panels/Research.tsx` |
| Forces (fielded/ready/committed, maintenance, missiles) and unit dossier | `panels/Forces.tsx` |
| Economy (balances, 24/72 h forecast, ledger reconciliation, by-city, nation-specific report) and Market | `panels/Economy.tsx` |
| Diplomacy (both directions, offers, composer, war declaration vs request, threads) and Coalition | `panels/Diplomacy.tsx` |
| Intelligence (agents, missions, cost, report history) | `panels/Intel.tsx` |
| Journal (private, by day, filters, notification history) and Newspaper (editions, index, composer) | `panels/Journal.tsx` |
| Score/standings, End screen, Campaign info | `panels/Score.tsx` |
| Advisor + keyboard chart | `panels/Help.tsx` |
| Planning layer (draw/rename/hide/delete, Issue order → move preview) | `components/Planning.tsx` |
| Stack orders: attack (current contacts or a province), retreat (adjacent destination + forecast HP cost), delay, embark/disembark, deployables (uses, cooldown, placement range); aircraft patrol (area, radius, time on station, home, refuel) and rebase/ferry (new home); aircraft panel (mission, elapsed endurance, footprint, diversion/loss/landing events) | `components/Orders.tsx` (+ `components/Inspector.tsx`) |
| Missiles: program table (research flags, maturity badges with distinct prototype art, backlog, batch cost, ceiling, replacement time), production dialog, launch dialog (facility/platform, range-limited sector picker or map pick, all four outcomes + headline chance before commit, conditional-accuracy definition, war confirmation, inventory after commit), strike reports (“effect unconfirmed” when unobserved), map origin→sector line without steering | `components/Orders.tsx`, `panels/Forces.tsx`, `map/renderer.ts` |
| Career ledger (local XP, separate from VP) | `panels/Score.tsx` (Campaign info) |

## Keyboard chart

| Keys | Action |
| --- | --- |
| W A S D, ↑ ↓ | Pan (ignored while typing) |
| ← → | Cycle armies (army selected) / cities (city or province selected); otherwise pan |
| + / − | Zoom |
| Home, C | Reset to capital |
| Space | Pause / resume (map or page focus) |
| Esc | Cancel targeting → close context menu/chooser → close panel (focus returns to opener) → clear selection; dialogs close on Esc |
| Shift+F10 / Menu | Context menu for the selection |
| F E R G I J Y M N V | Forces, Economy, Research, Diplomacy, Intelligence, Journal, Cities, Market, News, Score |
| Shift-click (Move) | Add waypoint; right-click cancels |
| Enter (drawing) | Finish drawing |

## Tests (Playwright, `npm run build && npx playwright test --trace off`)

| Spec | Covers |
| --- | --- |
| `e2e/core.spec.ts` | title → Indonesia → map centred near Jakarta, paused → select city → research → build → recruit → move with preview/confirm → advance 1 h → save → reload → Continue shows the save |
| `e2e/acceptance.spec.ts` | A01 (Indonesia + Bolivia separate slots, 119 AI), A13/W10 (all non-loopback requests blocked; export → import into a fresh profile, identical seed/clock/stock/jobs; damaged import rejected), A04/W05 (injected radar-only contact over a real hidden stack: no type/name in aria, inspector, search; SIDC entity 000000), W06 (draw/rename/hide/delete leave `stateHash` + RNG unchanged; Issue order opens the move preview), A15 (island port pick, layer switch, city sheet, camera unchanged, layer restored after reload), A14 (second tab read-only) |
| `e2e/workflows.spec.ts` | Bulk construction preview/confirm charges the previewed total; bot negotiation reply in the thread; SPEC worked interaction (Indonesia → Surabaya → maritime formation selected from the roster = map selection, inspector names its port → private route idea survives a switch to Economy → +1 h, the formation has no orders → a purchased dated report stays frozen) |
| `e2e/mobile-keyboard.spec.ts` | A12 on iPhone 13 viewport, keyboard only: title → campaign → city → mobilize → Esc restores focus → Forces list → move preview/confirm → Stop → advance hour |
| `e2e/military.spec.ts` | Missiles research (test hook) → production job → ready → launch dialog (4 outcomes, headline) → in flight with origin → report in viewer terms; contact-sheet launch shortcut (disabled with a reason without inventory, then opens the validated dialog with the contact's sector preselected; cancel commits nothing); aircraft patrol preview → on station → landed → rebase → new home; retreat with forecast HP cost (test hook engages a foreign stack); intelligence agent mission + purchased report |
| `e2e/perf.spec.ts` | Map input response / pan fps probe with 2,000 synthetic render-only stacks |
| `e2e/walkthroughs.spec.ts` | W08 walkthroughs (desktop). **U.S.**: force screen separates fielded/ready/committed; day-1 research tree shows Sealift I time-locked "Available from day 4"; Norfolk construction, Washington MBT mobilization, right-of-way request to Canada, homeland move, carrier air wing rebased onto its carrier then patrols from it; outcomes verified (arrival, +1 MBT, building level, bot answer); day 4 Sealift I researched → lift +4; save/reload identical. **Bolivia (5 days)**: no naval project/unit/building/embark anywhere; mobilize, move, economic report + 24 h forecast checked against the real outcome; market buy crossing a computer ask; accept an incoming bot offer (no second accept); apply to a computer coalition; score panel; save/reload identical. **Indonesia (3 days)**: research, Surabaya naval base, fleet to a sea zone, 24 h forecast, four newspaper editions, save/reload |
| `e2e/screens.spec.ts` | Annex A walkthrough 5 (market sell order → partial computer fill via `debugMarketOrder` → abort the rest → stock/escrow/cash/history reconcile before and after reload); coalition create/details/thread/leave with 24 h notice; journal (day groups, five filters, event detail, notification history + Go) and toasts (jump-to, dismiss, clock unaffected); newspaper (no future edition, previous/next, nation index, anonymous plain-text statement); unit dossier; split/merge conservation and fire control; tutorial skip/reopen/auto-complete/persisted; archive/restore/delete; settings persistence, credits, diagnostics, closed-app catch-up |
| `e2e/mobile-touch.spec.ts` | iPhone 13, taps only: mobile worked interaction (as E-worked); W10 touch pass in monochrome (locate a ship formation by symbol meaning "friendly surface" + SIDC check, planned vs present via APP-6 status digit and "Planned" label, dated radar contact without hidden type); narrow-width dossier selectors |
| `e2e/verification.spec.ts` | Verification pass 2 (desktop unless noted). **Resource/time strip** (Singapore: negative net vs insufficient stock after escrowing all supplies, tooltip breakdown, shortage ledger row + market link; research deadline, build job, arrival, refit and dated report in the timeline, previews never advance the clock). **Interrupt-and-pause** (`debugScheduleWar`: a computer country declares war while the clock runs → the worker pauses within one 15-min chunk, dialog, Stay paused; with the Settings preference off the clock keeps running). **Order dialogs** (embark/delay/disembark with previews; attack lists only current non-air contacts without hidden types, act-of-war confirmation carried by the order). **Map input chart** (Shift/Ctrl multi-select + common actions incl. Move all/Stop all, cluster chooser, right-drag lasso, context menu by right-click and Shift+F10 with arrow keys and Escape, right-click cancels targeting, ocean/province clicks, zoom buttons + scale bar, locator arrow, independent layer toggles). **Journal** after the formation is destroyed (`debugEngage` with `stack`/`strongest`), lost-selection explanation, Go, save/reload. **Recovery copies** (revision conflict → dialog → recovery list → restore as new campaign → delete). **Score + end** (standings, territories sum, history after two settlements; China save moved to one hour before the final settlement via export → edit clock → import; end panel, campaign-end interruption, review mode: controls disabled, step no-op, victory XP awarded once). Choose-country region counts + preview fields, map ≥ 70 % of 1440×900, previous/next formation and city, WASD vs typing, advisor; rural province sheet with zero-output warning; research current-vs-next table and eligible cities. **Mobile**: d-pad, CDP two-finger pinch (anchored), tap on a crowded sector → picker |
| `e2e/visual.spec.ts` | `toHaveScreenshot` of the map canvas: crowded Europe (2,000 deterministic synthetic stacks, four affiliations) at regional and local zoom, Surabaya at regional and local zoom (baselines in `e2e/visual.spec.ts-snapshots/`, maxDiffPixelRatio 1 %); symbol-gallery manifest regenerated in memory (`e2e/gallery-manifest.mts`) must equal `docs/gallery/manifest.json` |

`?e2e=1` enables test-only worker ops (`debugContact` for A04, `debugMissileSetup` = grant the
missile blueprint + a launch complex in the capital, `debugEngage` = put a foreign stack on one of
yours at war, for the retreat test, `debugMarketOrder` = the richest computer country submits an ordinary market order through `submitCommand`, for the partial-fill test; `debugEngage` also accepts `{ stack, strongest }` to pick which of yours and the largest foreign formation; `debugScheduleWar { by, inMinutes }` = that computer country submits an ordinary validated `declareWar` on you when the *running* clock reaches the tick, for the interrupt test); they are unreachable without the URL flag. `debugContact` writes a fresh contact-table object (the engine memoizes per-table sorted ids). `window.__wc` exposes read-only accessors (camera, frame, projection) for tests.

## Performance (measured 2026-11-14)

Device: container, Intel Xeon @ 2.10 GHz, 4 vCPU, 15 GB RAM, Linux; Playwright Chromium
HeadlessChrome 153 (software rendering), deviceScaleFactor 1. Real World 120 map (2,359 shapes,
~182k vertices) + the human's real objects + **2,000 synthetic stacks** (`e2e/perf.spec.ts`).

| 1440×900 | wheel→frame p50 / p95 (ms) | frame draw p95 (ms) | pan fps | pan frame p95 (ms) |
| --- | --- | --- | --- | --- |
| Regional, Europe (dense) | 25.5 / 47.2 | 16.7 | 58.3 | 23.0 |
| Regional, SE Asia | 16.7 / 26.1 | 7.1 | 59.0 | 20.8 |
| Local, Java | 16.6 / 20.9 | 2.1 | 60.0 | 20.6 |
| World | 16.7 / 19.5 | 2.0 | 60.0 | 18.1 |
| Click → selection → painted frame | p50 33.3 / p95 34.8 (two frames included) | | | |

| 390×844 (iPhone 13 profile, DPR 3 capped to 2) | wheel→frame p95 | pan fps |
| --- | --- | --- |
| Regional Europe / SE Asia / local / world | 32.2 / 22.0 / 27.7 / 20.1 ms | 57.1 / 58.4 / 58.0 / 55.6 |
| Click → painted frame p95 | 33.6 ms | |

Targets (p95 input < 100 ms, pan ≥ 45 fps) are met. Simulation cost (Node, same machine): one
game day ≈ 4–5 s with the engine's BasicController for 119 AIs, so speeds up to 64× keep up; the
worker keeps the UI responsive at any speed. Autosave of a ~3 MB save completes in well under 2 s
(indicator shows the result). Cold load to title ≈ 1–2 s locally (main bundle 2.2 MB incl. map
index; geometry chunk 3.1 MB loads lazily with the map).

## Engine API used / gaps

Used: `loadWorld120`, `registerScenario`, `createCampaign`, `advance`, `advanceToNextEvent`,
`getCountryView` (journalLimit option), `submitCommand`/`validateCommand`, `serialize`/`deserialize`/
`markSaved`/`stateHash`, drawing helpers, `cityList`, `provinceInspector`, `researchTree`,
`researchRefund`, `scoreBreakdown`, `ledgerModel`, `shortageBreakdown`, `newspaper`, `journal`,
`marketView`, `forceModel`, `planRoute`, `computeDenominator`, `thresholdFor`, `scenarioOf`,
`BasicController`.

Also used (since the release audit): `CountryView.observedNodes` (visibility fill),
`StackView.sightKm/radarKm` (sensor-coverage layer), `threadFor` (the adapter adds
`view.threadKeys[counterpart]`, which the Diplomacy thread uses).

Remaining gaps (worked around; nice to have in the engine):
1. `CountryView.uiPrefs`/`drawings` are read by the worker from `state.ui` directly.
2. Bulk preview rows for rural targets need a public name (they use the node name).
3. No exported helper for the coalition thread key (`co:<id>` is built in `Diplomacy.tsx`).

## Known gaps / resume notes

* Contact and report sheets offer **Launch missile at this sector…** (opens the normal validated
  launch dialog with that public sector preselected; disabled with a reason without ready stock).
* The adapter imports a few read-only engine internals (`systems/air` range/base checks,
  `economy.sumEffect`) and, for `?e2e=1` hooks only, `grantTech`/`declareWarInternal`.
* The map toolbar has a Fullscreen toggle (browser Fullscreen API; hidden if unsupported).
* Sound is a stored preference only (no audio assets).
* Verification pass (2026-11-14) UI fixes: a non-coastal city/province no longer offers ships,
  submarines, naval officers or coastal-only buildings (catalog rows hidden with a note
  `no-naval-note`; a nation with no coastal city gets no naval bulk projects) — before, La Paz
  offered a Corvette "needs Naval Base level 1" that could never be built; queued mobilizations show
  an APP-6 **planned** symbol (dashed frame, status digit 1) labelled "Planned" in the city queue and
  inspector queue (`PlannedUnitSym`); map search ranks the player's own places first among equal
  matches (a Bolivian "La Paz" no longer resolves to Mexico's); the journal never shows the previous
  filter's rows while a new filter loads; on phones the destination bar stays visible under the
  inspector sheet (opening another screen keeps the selection) and toasts stack below the sheet with
  tap-through text, so a toast can no longer block the sheet's Close button.
* Verification pass 2 (2026-11-14) UI fixes:
  - **Act-of-war orders from dialogs were always rejected.** `CommandDialog` (attack, disembark,
    deployables) read the war list from the *current* preview; once the player ticked "I accept going to
    war", the re-preview with the confirmation succeeded, the list vanished and the command was sent
    without `confirmActOfWar` ("Attacking AUS is an act of war. Confirm to declare war."). The dialog now
    remembers the act-of-war requirement per target (`warFor`) and resets the confirmation when the
    target changes.
  - **Locator arrow** for an off-screen selection was drawn under DOM overlays (legend, toolbar) and
    clicking it only re-selected the object. It now avoids overlay rectangles (`renderer.overlayRects`)
    and brings the object into view; lasso ignores locator hit boxes.
  - **Previous/next formation buttons** added to the formation sheet (cities already had them; the
    input chart requires both).
  - **Readable notification copy** (`src/ui/eventText.ts`): toasts, the journal and the interrupt dialog
    rebuild offer events from structured data (`data.offer` + `view.offers`): country names, "right of
    way", coalition names, "asking nothing in return", "Mexico's offer expired without an answer."; a
    fallback resolves country codes, `of31`, `(co3)`, `[—]` and `at tick N` in any other engine text.
    Several incoming offers collapse into one toast ("3 new offers — open Diplomacy to answer them.",
    with an Open Diplomacy button); each offer is still listed in the notification history.
  - **Building effects** in the city sheet use one shared formatter (`src/ui/effects.ts`):
    "+10% production · +5% recruiting speed", "9 naval slots · +9 HP recovery/day"; demolish previews
    name lost effects the same way.
* Day-1 research for the U.S. is open (Sealift I) — the earlier note about day 4 is obsolete.
* The End screen derives losses/captures from journal event kinds; a dedicated engine summary would
  be more precise.
* Perf numbers come from headless software rendering; re-measure on a reference laptop with GPU.
