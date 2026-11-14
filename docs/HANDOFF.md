# Handoff — World Command: World 120

_Last updated 2026-11-14 by the orchestrator (Claude) after the final verification run._ Keep this file current; it is how a new
collaborator (e.g. ChatGPT/Codex) resumes **without access to prior chats**. The requirements are in
[`SPEC.md`](SPEC.md); feature-by-feature status with test IDs is in [`COVERAGE.md`](COVERAGE.md); rules
for every AI collaborator are in [`../AGENTS.md`](../AGENTS.md).

## Milestones (SPEC §6)

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Scaffold, contracts, handoff | done |
| 2 | Deterministic engine + test fixture, end-to-end slice (real order, real AI, save round-trip) | done |
| 3 | Global map, nation selection, scoring, economy, travel graph (Indonesia + landlocked start) | done |
| 4 | Management screens, research, domains, combat, visibility, diplomacy, coalitions, market, news, events, intel, missiles, advanced units | done in engine (tested); several UI panels still lack an e2e test — see COVERAGE "implemented awaiting verification" rows |
| 5 | Normal/accelerated campaigns, performance & balance | partial — observer suite ran 120 × 5 days + 4 × 180 days only; heavy-war day still above target; no reference-laptop numbers |
| 6 | Release audit, coverage matrix | done (this pass) — `docs/COVERAGE.md` |

## Final verified results (2026-11-14, orchestrator, all agents finished, clean tree)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **pass** |
| `npx vitest run` (`npm test`) | **281 passed, 0 failed** (33 files) |
| `npm run build` | **pass** |
| `npx playwright test --trace off` | **33 passed, 0 failed, 33 skipped** (by-design per-project skips) |

Since the sections below were written: the USA `rebase` invalid-command failure is fixed (A02 smoke 0
invalid); Sealift I, Resource Extraction I and Industrial Sustainment I now open on day 1 so all 120
seats can start research immediately (`tests/profiles/day1-research.test.ts`; opening power unchanged,
USA 117.98); gallery sample ids are unique. AI: coalition mutual defence, naval escort/blockade/carrier
use and need-sized trades (`tests/ai/alliance.test.ts`); weakest-quintile survival 57 % → 66 % over
4 × 180-day runs. Perf: World 120 smoke ≈ 1.4 s per game day total (planner ≈ 0.45 s), down from
≈ 8.7 s, measured on a loaded 4-vCPU container — the ≤ 1 s target is not yet met (see ENGINE.md
"Known gaps" and AI.md "Engine requests").

## Verified test results (earlier audit, 2026-11-14, Linux container, 4 vCPU, Node 22, Playwright Chromium 153 headless)

| Command | Result |
| --- | --- |
| `npm run build` | **pass** (one intermediate attempt failed while the AI agent was mid-edit: `Could not resolve "./alliance" from src/ai/operational.ts`; passed once `src/ai/alliance.ts` landed) |
| `npx playwright test --trace off` | **17 passed, 0 failed, 17 skipped** (~46 s). The skips are by design: every spec runs in both projects (`desktop`, `mobile`) and skips itself in the project it does not target; the perf probe's mobile run is opt-in (`WC_PERF_MOBILE=1`). |
| `npx vitest run` (`npm test`) | **271 passed, 1 failed** (31 files, 272 tests). Failing: `tests/ai/world120.test.ts › A02 smoke… › all bot commands pass the shared validator (invalid = 0)…` — the USA bot issued 4 rejected `rebase` commands on real data. This is in `src/ai/**` (owned by the AI agent, who was editing it concurrently); not fixed here. An earlier run in this audit also failed 5 market/save/government tests because the engine agent was mid-edit (`openOrdersOf`/`openOrderCount` undefined); those pass on the final run. |
| `npx tsc --noEmit` | **pass** |

Perf probe (E-perf, 1440×900, 2,000 synthetic stacks, software rendering): Europe regional wheel→frame p95
28.5 ms, pan 57.7 fps; SE Asia p95 19.3 ms; local Java p95 19.3 ms; world p95 17.5 ms; click→painted
frame p95 33.5 ms. Targets (p95 < 100 ms, ≥ 45 fps) met on this machine.

## Verification pass (2026-11-14, verification agent) — latest results

| Command | Result |
| --- | --- |
| `npm run build` | **pass** |
| `npx playwright test --trace off` (full suite, 2 workers) | **33 passed, 0 failed, 33 skipped** (66 scheduled; skips are the by-design per-project skips). New specs re-run alone: 16 passed, 16 skipped |
| `npm test` (Vitest) | **280 passed** (32 files) |
| `npx tsc --noEmit` | **pass** |

New Playwright specs: `e2e/walkthroughs.spec.ts` (W08 U.S. / Bolivia 5 days / Indonesia 3 days),
`e2e/screens.spec.ts` (market walkthrough 5 with a partial computer fill, coalitions, journal +
toasts + newspaper, dossier, split/merge + fire control, tutorial, archive/restore/delete, settings +
credits + diagnostics + catch-up), `e2e/mobile-touch.spec.ts` (mobile worked interaction, W10 touch
pass in monochrome, narrow dossier), `e2e/visual.spec.ts` (map `toHaveScreenshot` baselines in
`e2e/visual.spec.ts-snapshots/`, gallery manifest diff via `e2e/gallery-manifest.mts`). New `?e2e=1`
worker op `debugMarketOrder` (a computer country submits an ordinary validated order).

UI bugs fixed (see `docs/UI.md` › Known gaps): landlocked/non-coastal sites offered naval units and
naval bases; search "La Paz" for Bolivia selected Mexico's La Paz; standings hid a player ranked
below 25; journal briefly showed the previous filter's rows; on phones toasts blocked the inspector
sheet's Close button and opening another screen required dropping the selection; catch-up toast said
"0 game hours"; queued units now carry an APP-6 planned symbol. Findings for other owners (both since
fixed): the U.S. had no research available until day 4; `scripts/symbol-gallery.ts` emitted
duplicate sample ids.

## What the release audit changed

* **Bug fix (UI, flaky e2e):** closing a panel or modal restored focus with `setTimeout(0)`; Chrome can
  run that timer after the user has already focused something else, so focus jumped back to the opener
  (in `e2e/core.spec.ts` the Enter meant for the search box re-opened the Surabaya city sheet; ~1 in 3
  runs failed). `closePanel` (`src/ui/state/ui.ts`) and `Modal` (`src/ui/components/common.tsx`) now
  restore focus only if the user has not moved it (`userMovedFocus`). Verified: core test 6/6 repeats.
* **Adapter switched to engine projections** (`src/ui/map/MapView.tsx`, `src/ui/sim/engine-adapter.ts`,
  `src/ui/sim/protocol.ts`, `src/ui/panels/Diplomacy.tsx`): visibility fill uses `view.observedNodes`;
  sensor-coverage circles use `StackView.sightKm/radarKm`; diplomacy threads use the engine's
  `threadFor` (adapter adds `view.threadKeys`). The fill cache signature includes an observed-node hash
  when the visibility layer is shown.
* **New UI:** "Launch missile at this sector…" on contact and report sheets (opens the normal validated
  `LaunchDialog` with the public sector preselected; disabled with a reason without ready stock); a
  Fullscreen toggle in the map toolbar.
* **New e2e tests:** `e2e/military.spec.ts › contact sheet: launch shortcut…`; `e2e/workflows.spec.ts ›
  SPEC worked interaction: Indonesia → Surabaya → …` (desktop).
* Docs: `docs/COVERAGE.md` (new), this file, `docs/UI.md` (engine API used, tests, known gaps).

## Outstanding work (see the linked COVERAGE sections)

Status totals in COVERAGE (after the verification pass): 172 implemented and tested · 52 implemented awaiting verification ·
9 deferred by stated product choice · 5 missing.

**Missing** (COVERAGE rows marked `missing`):
1. Playtest record of a high/medium/small start vs a U.S. bot — COVERAGE §21 "Playtest…" (the three
   human walkthroughs are now automated: E-W08-USA / -BOL / -IDN).
2. ~~Screenshot regression~~ and ~~mobile worked interaction~~ — done (E-shots, E-m-worked).
4. Heavy-war simulation day ≤ 400 ms (now 530–640 ms with ~650 movers) — §23; engine agent's area.
5. AI peace terms with territory/resources, multi-round haggling — §20.
6. Helicopter air-mobile embark rules — §6. Newspaper article image attachment — §14.

**Awaiting verification** (code exists, no end-to-end test). Highest value next:
* W08: run the observer suite at a longer horizon — `npm run report:observer -- --runs 120 --days 30 --long 4 --long-days 180` (≈ 3.5 h on 4 vCPU) — §21.
* W04: a real-data test that two peers can finish a hypersonic branch, and that U.S. carrier/lift
  advantages work in an ordinary real-data playthrough — §10, §21.
* W04: two peers completing a hypersonic branch in a legal real-data playthrough (carrier/lift now covered by E-W08-USA).
* e2e still missing for: resource strip / time strip, worker interrupt-and-pause, attack/delay/embark
  dialogs, multi-selection, context menu / lasso, pinch + cluster picker + d-pad, journal event after
  its unit is destroyed, recovery-copies list, score/end panels (W10 touch pass, market, coalitions,
  journal/newspaper, dossier, split/merge, fire control, tutorial, archive/restore, settings and toasts
  are now covered — see COVERAGE short IDs E-market … E-gallery).
* ~~`tests/ai/world120.test.ts` invalid-command failure (USA `rebase` × 4)~~ — fixed.
* Engine+AI ≤ 1 s per game day (now ≈ 1.4 s on a loaded container) — ENGINE.md known gaps.
* Engine rules suggested by the AI: blockade effects, coalition co-belligerence without a war declaration — AI.md #12, #14.

## File ownership (parallel work — do not edit another owner's files without coordinating)

| Area | Paths | Owner |
| --- | --- | --- |
| Static data contract | `src/engine/data-types.ts` | orchestrator (additive edits allowed, note them below) |
| Engine | `src/engine/**`, `tests/engine/**`, `tests/fixtures/**` | engine agent |
| Map pipeline | `scripts/build-map.ts`, `scripts/map/**`, `src/data/generated/**`, `src/data/cities.ts`, `src/data/territory-manifest.ts`, `tests/map/**` | map agent |
| Catalog | `src/data/catalog/**`, `scripts/symbol-gallery.ts`, `tests/catalog/**` | catalog agent |
| Country profiles & balance | `src/data/profiles/**`, `scripts/opening-power-report.ts`, `tests/profiles/**` | profiles agent |
| AI | `src/ai/**`, `tests/ai/**`, `scripts/observer-suite.ts` | AI agent |
| UI | `src/ui/**`, `src/main.tsx`, `src/workers/**`, `e2e/**`, `public/**` | UI agent |
| Coverage / handoff | `docs/COVERAGE.md`, `docs/HANDOFF.md` | release-audit agent (anyone may update after re-running tests) |

When working alone (e.g. Codex with no other agents), all areas are yours, but keep the contracts below.

## Engine and architecture contracts (summary — details in `docs/ENGINE.md`)

* `src/engine/` is deterministic: integer game minutes, seeded `streamRng`, fixed-point (milli-unit)
  resources, no `Date.now`/`Math.random`/DOM/React. Same seed + same commands ⇒ same `stateHash` at any speed.
* Every state change goes through `validateCommand`/`submitCommand` (human and AI identical). UI buttons
  call `exec()` → worker → `submitCommand` with a nonce (double-click safe).
* UI and AI consume only `getCountryView` (no raw state). Only `src/ui/sim/engine-adapter.ts` (worker
  side) imports the engine; main-thread UI imports only `src/engine/data-types.ts` and engine *types*.
* AI controllers implement `decide(view, ctx)`; injected by the adapter from `src/ai/index.ts`.
* Saves: `serialize`/`deserialize` (validate + migrate in a temporary copy). IndexedDB in the browser.

## Contract change log

- catalog agent: `UnitType.carrierCapable?: boolean`, `UnitType.liftCapacity?: number` (additive).
- Level-tech IDs follow `<unitId>_l<N>` (exceptions: transport L2/L3 = `mob_strategic_airlift_2/3`, cruise launcher L2 = `str_cruise_missile_2`). Building level effects are totals, not increments.
- engine: `CountryView.observedNodes`, `StackView.sightKm/radarKm`, exported `observedNodes`, `stackSensorRadii`, `pairKey`, `threadFor` (now used by the UI adapter).
- UI protocol (UI-internal): `Frame.view.threadKeys: Record<country, threadKey>` added by the adapter.

## Resume instructions (for ChatGPT/Codex or any new session)

1. `npm install` (needs network once). Node ≥ 20. Chromium for Playwright must already be installed
   (`npx playwright install chromium` only if it is missing and you have network).
2. Verify the baseline, in this order, from the repo root:
   ```
   npm run typecheck
   npm test                         # Vitest, ~2–4 min; real-data tests print [world120] lines
   npm run build
   npx playwright test --trace off  # starts `npm run preview` on 127.0.0.1:4173 automatically
   ```
   Compare with "Verified test results" above. If `tests/ai/world120.test.ts › …invalid = 0…` still
   fails, start there (inspect the rejected `rebase` commands with the decision log in `src/ai/log.ts`).
3. Play it: `npm run play` → http://127.0.0.1:4173 (offline after install). Dev: `npm run dev` → :5173.
4. Pick the next item from "Outstanding work" (or any `missing` / `awaiting verification` row in
   `docs/COVERAGE.md`). For UI rows the usual pattern is a Playwright test in `e2e/` using the helpers
   in `e2e/helpers.ts` (`clearStorage`, `newCampaign`, `frame`, `openPanel`) and `window.__wc`
   accessors (`frame()`, `ui()`, `host()`, `camera()`, `project()`); test-only worker ops (`debugContact`,
   `debugMissileSetup`, `debugEngage`) need `newCampaign(page, …, '/?e2e=1')`.
5. Do not weaken assertions to make a test pass; fix the cause. Keep determinism (run
   `tests/engine/determinism.test.ts`) and hidden-information rules (`e2e/acceptance.spec.ts › A04…`,
   `tests/engine/visibility.test.ts`, `tests/ai/contract.test.ts`).
6. When you change a feature's status, update its COVERAGE row (one status per row, real test IDs) and
   the totals, then update "Verified test results" here with the real numbers you observed.
7. Reports: `npm run report:power` (opening power table → `docs/reports/opening-power.md`),
   `npm run report:observer` (balance suite → `docs/reports/observer-summary.md`), `npm run gallery`
   (symbol gallery → `docs/gallery/`, review the manifest diff on renderer changes).
8. Leave GitHub setup, pushes and hosting alone unless the owner asks (SPEC intro).
