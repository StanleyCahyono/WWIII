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
| `e2e/workflows.spec.ts` | Bulk construction preview/confirm charges the previewed total; bot negotiation reply in the thread |
| `e2e/mobile-keyboard.spec.ts` | A12 on iPhone 13 viewport, keyboard only: title → campaign → city → mobilize → Esc restores focus → Forces list → move preview/confirm → Stop → advance hour |
| `e2e/perf.spec.ts` | Map input response / pan fps probe with 2,000 synthetic render-only stacks |

`?e2e=1` enables a test-only worker op (`debugContact`) used by A04; it is unreachable without the
URL flag. `window.__wc` exposes read-only accessors (camera, frame, projection) for tests.

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

Gaps (worked around in the adapter; nice to have in the engine):
1. A `sensorCoverage(view)` / per-stack sight+radar radius in `StackView` (UI derives it from the
   catalog level stats).
2. A projected "observed nodes" set for the visibility fill (UI approximates from own territory,
   coalition territory, recent contacts and reports).
3. `CountryView.uiPrefs`/`drawings` are read by the worker from `state.ui` directly.
4. Exported `pairKey/threadFor` (UI rebuilds `dm:A|B`).
5. Bulk preview rows for rural targets need a public name (they use the node name).

## Known gaps / resume notes

* Aircraft-specific orders (patrol, rebase, ferry), embark/disembark buttons, attack-on-contact,
  retreat, delay, deployables and missile launch have engine commands but no dedicated UI flows yet
  (move covers embarkation via route mode changes). Add them to `components/Inspector.tsx`
  StackSheet using the same `ActionButton` + preview pattern.
* Sound is a stored preference only (no audio assets).
* Light theme is implemented via tokens but has had less visual review than dark.
* The End screen derives losses/captures from journal event kinds; a dedicated engine summary would
  be more precise.
* Perf numbers come from headless software rendering; re-measure on a reference laptop with GPU.
