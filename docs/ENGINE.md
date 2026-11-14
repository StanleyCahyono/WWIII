# Engine — World Command: World 120

Deterministic, pure-TypeScript simulation in `src/engine/**`. No React/DOM, no `Date.now`, no
`Math.random`, no wall-clock dependence. State is plain JSON. Runs in Node (tests) and in a Web
Worker (UI). Every tunable constant is in [`src/engine/rules.ts`](../src/engine/rules.ts).

## Module map

| Path | Purpose |
| --- | --- |
| `index.ts` | Public API (everything UI/AI may import). |
| `rules.ts` | All game constants (time, scoring, territory factors, morale, revolt bands, combat, air, visibility, market, missiles, AI budgets, opening-power constants). |
| `fixed.ts` | Fixed-point resource vectors (milli-units ×1000), shortfall/format helpers. |
| `rng.ts` | Stateless seeded streams `streamRng(seed, stream, key)` (sfc32 over FNV/murmur mixing); `hash64Hex`. |
| `time.ts` | Tick ↔ day/hour/calendar; `FINAL_TICK`. |
| `ids.ts` | Stable string ids from counters in `state.ids` (`u1`, `s1`, `of1`, `e1`, …). |
| `state.ts` | Runtime state contract (`GameState` and all records). |
| `derived.ts` | Non-serialized memo of derived data (rates, public slices, indexes). |
| `systems/modifiers.ts` | Tech modifier semantics (`*_mult` multiplicative, others additive) and the consumed/unused key lists. |
| `sim.ts` | `advance`, `stepOnce`, step order, day-change processing. |
| `power.ts` | Opening power index. |
| `commands/` | `types.ts` (the `Command` union), `forces.ts`, `national.ts`, `index.ts` (validate/submit). |
| `systems/` | `mapindex` (graph, A*, bins), `world` (queries/rights), `movement`, `combat`, `air`, `government` (capture/morale/revolts), `economy`, `ledger`, `production`, `research`, `missiles`, `visibility`, `intel`, `diplomacy`, `coalitions`, `market`, `score`, `readiness`, `events`, `queue`, `hooks`. |
| `view/` | `country-view.ts` (`getCountryView`, the only projection UI/AI consume) and `queries.ts` (UI models). |
| `save/` | serialize / deserialize / migrate / validate / `stateHash` / UI planning layer. |
| `scenario/` | `types.ts` (Scenario/Catalog), `registry.ts` (static indexes), `create.ts` (`createCampaign`), `defaults.ts` (synthesized profiles), `world120.ts` (real-data loader). |
| `ai-host/` | `types.ts` (CountryController / PlannerContext), `scheduler.ts`, `controllers.ts` (Idle/Basic). |

Test-only fixtures live in `tests/fixtures/` (mini world with 6 countries incl. landlocked DUN,
island CEL, Falen Strait, Borvian Canal, outside-campaign land; mini catalog; a scaled 120-country
synthetic world for benchmarks).

## Public API (src/engine/index.ts)

```ts
// scenario & campaign
loadWorld120(): Promise<Scenario>               // Vite/Vitest/Worker: imports src/data lazily
buildWorld120Scenario({ map, catalog, profiles?, manifest? }): Scenario  // pure (Node scripts)
listCampaignModes(): [{ id: 'world120', name: 'World 120' }]
createCampaign({ seed, humanCountry | null, difficulty?, scenario }): GameState
registerScenario(s)            // createCampaign does this; call before deserialize in a fresh worker
// time
advance(state, minutes, host?) ; stepOnce(state, host?) ; advanceToNextEvent(state, country, max?, host?)
isReviewMode(state)            // campaign result frozen
// commands (human and AI identical)
validateCommand(state, cmd) / previewCommand(state, cmd) → { ok:true, preview, warnings? } | { ok:false, code, reason, details? }
submitCommand(state, cmd) → { ok:true, preview, result, duplicate? } | { ok:false, code, reason, details? }
// projections
getCountryView(state, country) : CountryView
getCountryViews(state, ids) : Map<country, CountryView>   // batch; shares the per-step public slices
ledgerModel, forecastModel, scoreBreakdown, researchTree, cityList, provinceInspector,
diplomacyRows, coalitionList, marketView, journal, newspaper(state, day), inbox, forceModel
// persistence
serialize(state) ; deserialize(json) (throws SaveError) ; validateState ; migrate ; MIGRATIONS
stateHash(state) ; cloneState ; markSaved ; revisionConflict(myRev, storedRev)
addDrawing / renameDrawing / setDrawingHidden / deleteDrawing / setPref     // UI-private section
// misc
computeOpeningPower(state, reference='USA') ; rawDimensions ; resolveMissileOutcome
IdleController ; BasicController ; setDefaultHost({ controllers?, fallback? })
RULES / rules.* constants ; fixed.* helpers ; formatGameTime ; dayOf ; FINAL_TICK
```

Functions **mutate** the passed state in place (`advance` returns the same object). Use
`cloneState` for copies. Static data is not in the save: the state references
`scenarioId`/`scenarioVersion`; the scenario must be registered (createCampaign/`loadWorld120`
+`registerScenario`) before deserializing.

### AI plug-in

```ts
interface CountryController { decide(view: CountryView, ctx: PlannerContext): Command[] }
// ctx: now, reviews ('strategic'|'economic'|'diplomatic'|'operational')[], wake (event triggers),
//      budget (max commands, by difficulty), difficulty, memory/setMemory (opaque JSON saved in
//      state.ai.memory), preview(cmd), route(stackId, dest), map, catalog, rng (seeded per call)
advance(state, minutes, { controllers: { USA: myCtl } | (c) => ctl, fallback: BasicController })
```
Controllers receive **only** the CountryView. Commands whose `country` ≠ the controlled country
are rejected (`foreign_issuer`). A throwing controller is counted (`controller_error`) and ignored.

## Time and step order

* Tick = integer game minutes since start (day 1, 06:00 UTC, fictional date 2031-04-01).
* `STEP_MIN = 15`. `advance(state, m)` runs every step boundary in `(tick, tick+m]`, then sets
  `tick += m`. Result is identical however time is chunked (tested: 1×1440 = 96×15 = 1440×1).
* Day change at 00:00 (tick + 360 ≡ 0 mod 1440). Final settlement at the end of day 180
  (`FINAL_TICK = 258840`).
* Order inside a step at boundary T:
  1. scheduled events with `at ≤ T` ordered by **(at, priority class, seq)**; the clock reads `at`
     while each runs. Classes: offer_effect 0, offer_expire 1, coalition_depart 2, research_done 3,
     job_done 4, missile_arrive 5, agent_report 6, report_expire 7.
  2. air operations; 3. ground/naval movement (stacks by numeric id);
  4. whole hours: attack-order refresh + combat round; 5. capture;
  6. whole hours: economy accrual; 7. visibility (every `VISIBILITY_INTERVAL_MIN` = 30);
  8. day change: government (morale/population/revolts), readiness, trust decay, daily digest,
     **score settlement**, pruning; 9. eliminations; 10. AI scheduler.
* Commands submitted between steps apply immediately at the current tick.

## Determinism guarantees

* Random draws: `streamRng(seed, stream, key)` with stable keys (`combat:<eng>:<round>:<stack>`,
  `missile:<launchId>`, `revolt:<city>:<day>`, `uprising:<city>:<tick>`, `agent:<id>:<n>`,
  `trust:<a>><b>`, `personality:<c>`, `ai:<c>:<tick>`). Adding an unrelated event never perturbs others.
* Iteration over records always uses sorted ids/keys; ties broken by id.
* Same seed + same command history ⇒ identical `stateHash` at any speed and across save/reload
  (tests cover mid-step saves, before completions, day changes, missiles in flight, refuelling).
* `stateHash` = canonical sorted-key JSON hash excluding `ui` and `meta.saveRevision`.

## Economy, reservation and refund rules

* Quantities are integer milli-units. Production accrues **hourly** using cumulative slicing
  (`floor(rate·(h+1)/24) − floor(rate·h/24)`), so a constant daily rate credits exactly.
* Building `*Mult` effects use catalog semantics (1 = no change) and combine as
  `1 + Σ (mult − 1) × condition/100` (`multEffect`): productionMult, recruitSpeedMult,
  researchSpeedMult, defenseMult, speedMult. Deposit improvements add `deposit × (mult − 1)`.
  `hpRecoveryPerDay` is percent of max HP per day.
* Output pipeline: base × multEffect(productionMult) × industrial_output_mult + flat produces +
  population manpower/money → electronics × electronics_output_mult → × morale factor × city
  condition → × **territory factor once** (homeland 1, annexed 0.5, occupied 0.25). Rural: deposit
  output × rural_output_mult (+ improvements) + population manpower × RURAL_POP_FACTOR.
* Population yields are **sublinear**: manpower/day = 1.5 × √(pop in thousands), money/day = 4 × √pop
  (a 25 M city ≈ 237 manpower/day instead of 500). `MANPOWER_PER_KPOP`/`MONEY_PER_KPOP` remain
  exported only for script compatibility (deprecated).
* Tech modifiers: keys with a `_mult` segment multiply (stacking multiplicatively), others add.
  Consumed keys and their effects are listed in `CONSUMED_MODIFIERS` (research speed, industrial /
  electronics / rural output, fuel upkeep, unit electronics cost, radar range, refit speed, naval
  regen, embark time, own-territory land speed, rebase time, air endurance/range, air/land attack,
  urban defence, artillery range, officer bonus, missile-defence bonus); `report_age_mult`,
  `receiving_capacity_mult`, `carrier_ops`, `track_history` are documented as UI-only/unused.
* Lift = `CountryState.lift` (profile + tech) + Σ building `liftCapacity` (× condition) + Σ
  `UnitType.liftCapacity` of fielded units, computed on demand (`liftBreakdown`); used by the view
  (`self.lift`, `self.liftBreakdown`) and the opening-power mobility dimension.
* Upkeep (units, buildings) and occupation upkeep (per tier) are charged hourly; unpaid portions
  are recorded (`ledger.unpaid`, `country.shortages`); stock never goes negative.
* Ledger categories: production, upkeep, occupation, construction, recruitment, research,
  missile_production, market_escrow, market_fill, refund, loot, corruption, treaty_transfer, intel,
  annex. Invariant (tested): `ledger.initial + Σ ledger.totals == stock` (spendable).
  On-hand = stock + escrow; escrow == Σ open-order reservations (validated on load).
* **Jobs are charged in full at enqueue.** Cancel: queued → 100 % refund; active → `cost ×
  remaining fraction × 0.75`. Per city: one construction (incl. annexation) + one mobilization
  run concurrently, FIFO queue max 6. Missile batches use national missile slots.
  Occupied cities can build but not mobilize. On capture, the former owner's jobs at that location
  are cancelled with the standard refund.
* Research: slots = 2 + Σ researchSlots (homeland/annexed cities); refund on cancel
  `cost × remaining × 0.8` (quoted exactly by preview). Statuses: completed, busy, available,
  time_locked, prerequisite_locked, facility_locked, doctrine_unavailable, unaffordable, slots_full.
  Upgrade rule: a `unitLevel` tech raises every existing unit of that type (HP scaled
  proportionally) and all later mobilizations — applied once by the single completion event.
* Bulk build/mobilize: one preview row per target (eligible/ineligible + reason, level, cost,
  start tick, queue position) with cumulative affordability in target order; `previewToken`
  rejects with `stale_preview` (and returns the fresh preview) if anything changed.

## Movement

* Graph from `MapData` (edge kinds land/strait/coast/sea/canal). Stack position = node or edge with
  km progress (or an air flight). Move classes: ground (land + embarked), naval (sea + ports), air.
  Helicopters move with ground stacks.
* Eligibility: ground uses land/strait in land mode; coast edges embark (coastal province only,
  +120 min) / disembark; sea/canal embarked at 18 km/h. Naval: sea/canal; coast only to a port.
  Outside-campaign land is impassable. Canal/strait `via` owner must grant passage.
* Access: own, coalition, right_of_way/shared_intel grant, or war enemy. Entering a peace country
  without passage is an **act of war**: the route preview lists the countries; the command must
  include them in `confirmActOfWar`; war is declared on entry.
* A* (time cost, deterministic heap) with failure classification: `no_access` (+ blocking owners),
  `missing_facility`, `outside_campaign`, `unreachable`, `invalid_domain`.
* Remaining routes are re-validated every step; the first illegal segment truncates the route
  (stop at last legal node) or turns a stack mid-edge back to its origin — never a teleport; an
  event explains why (A03).
* Effective speed = slowest unit × terrain (catalog terrain speed or default table) × logistics.

## Combat (documented solo algorithm)

Hourly rounds keyed by tick (a round can never apply twice). See `systems/combat.ts` header:
node combat → ranged → air; defender (earliest stationary at the node) fires with its DEFENSE table
(+ entrenchment ×1.25 after 2 h, bunker defenseMult), attackers with ATTACK tables; strength ×
HP fraction × readiness factor (0.5..1) × terrain × officer × refit (×0.5) × overstack efficiency
(1 up to 10 units, −4 %/unit, min 0.5) × seeded variance (±10 %). Damage pools per target class
are applied front echelon first, split evenly with explicit remainder/overflow rules
(`allocateDamage`, tested). Battle reports go to each participant with visible participants,
time, broad cause and outcome. Retreat: adjacent legal destination, 10 % HP cost.

## Air

Home base = owned/coalition/passage city airstrip (slots by tier) or airSlots building, or a carrier
stack. Patrol: outbound → on station (until endurance minus return time) → return → refuel 60 min.
Rebase changes home on arrival. **A10 rule**: base captured/destroyed/access lost while airborne (or
at landing) → divert to nearest legal base within remaining range, else aircraft lost (event with
count). Aircraft on the ground at a captured base evacuate the same way; a disabled base (condition
< 25) grounds them; aircraft aboard a sunk carrier are lost. Re-tasking a patrol keeps take-off time.

## Capture and government

Capture: surviving capture-capable land unit at the control node, at war with the owner (or rebel
node), no hostile stack present. Liberation restores `homeland`; otherwise `occupied`. Annex
(occupied only, cost + 24 h job) → 50 % output and mobilization; lost on recapture. Loot 2 %×tier
of the former owner's money. Morale target from signed factors (base 75, occupation −30, annexed
−12, wars, shortages, distance to capital, hostile neighbours, population losses, facilities,
capital +5); moves 5/day. Revolt bands: <15 → 30 %, <25 → 15 %, <33 → 6 % per day (seeded per
city/day). Undefended → rebel control flag (never a new seat); garrisoned → one-shot fight.

## Visibility model

Incremental implementation (`systems/visibility.ts`): persistent per-stack records in id-sorted
spatial bins; only stacks whose position/roster/air state changed (or that are moving) are
re-binned; sensor groups are rebuilt only when a member changed; a country is recomputed only if
its sensors, its territorial observations or a bin in its sensor footprint changed, or it gained/
lost territory; each sensor's hit list is reused unless its footprint changed. The merge is
order-independent (max level, highest-priority domain, unions). Viewers whose detection inputs are
unchanged are skipped. Results equal a full recompute (`tests/engine/visibility-incremental.test.ts`
compares against `computeDetections(state, { full: true })` on random ticks of two worlds).
Current contacts are only rewritten when a visible field changes; the view reports them as
observed at `clock.lastVisibility` (live HP for identified members). Allied (coalition /
shared-intel source) stacks are projected live by `getCountryView` and are not stored as contacts.

Per-viewer contact tables (`state.contacts[viewer]`, opaque contact ids — never stack ids in
views). Sensors: stack sight/radar (co-located stacks of one owner merge), city sight 80 km +
radar buildings, territory sight. Per-unit detection: visual (subsurface needs ASW; signature 3 only
within 34 % of sight) → identified within 50 % of sight / by recon / inside own city, otherwise
unidentified; radar (domain ∈ radarDetects and signature ≤ sensitivity) → `contact` with domain
only. Vision pooled from coalition members and shared_intel grantors; their stacks are identified.
Undetected contacts become `stale` (frozen fields) and drop after 24 h. Reports are frozen
snapshots with expiry. `getCountryView` omits owner/count/units keys entirely for `contact`
level (deep-scan tested).

## Diplomacy, coalitions, market, missiles, intel, events

* Exactly four statuses per direction: war, peace, right_of_way, shared_intel. Offers: recipient-
  only, idempotent resolution, stale if relation version changed, effects at `acceptedAt + 60`.
  Trust per ordered pair with history entries and daily decay.
* Coalitions: max 5, applications, leader decides, 24 h departure notice, history kept.
* Market: price-time priority, execution at resting price, escrow at placement, partial fills,
  cancel releases remainder exactly once; never self-trade.
* Missiles: see `systems/missiles.ts` header (maturity sequence, one debit per launch, outcome draw
  then defence draw, knowledge separate from outcome). Nonce makes double submit a no-op.
* Events: one `GameEvent` store; journal = private projection, newspaper = public projection per
  day (+ articles, ranked index), inbox = offers/messages. Interrupt flags: war declared on the
  human, capital status change, campaign end, human eliminated. Routine completions bundled into a
  daily digest for the human.

## Scoring

Province 1 VP, city tier+1, capital +4; denominator computed once; thresholds rounded up (solo 24 %,
coalition 40/48/55/60 %). Settlement once per day change; coalitions ≥2 compete only as a bloc.
Tie-break: fraction → capitals held → net industrial output → lexicographically smallest member id.
Result frozen; `advance` becomes a no-op and commands return `game_over` (review mode).

## AI scheduler

Staggered reviews (strategic 24 h, economic 6 h, diplomatic 12 h, operational 2 h) with hashed
offsets; ≤ 60 controller calls per step served round-robin (no starvation; tested with 120
countries); per-review command budget by difficulty (4/8/14). Wakes on war declared, territory
change, offer received/answered, coalition application.

## Cache-invalidation contract (incremental systems)

Derived caches never live in the save; they are validated by version counters in `state.ids`
(saved, deterministic): `relv` (war/peace), `grv` (grants), `cov` (coalition membership), `ownv`
(ownership, with a per-node change journal), `econv` (territory output inputs), `techv` (unit
levels), `trustDays`. Every engine path that mutates the corresponding data bumps the counter
(`bumpEconomy(state, node?)`, `recordOwnerChange`, …). **Code that edits buildings, condition,
morale, population or ownership directly (tests, tools) must call `bumpEconomy(state)`** — the
economy additionally guards with a structural fingerprint. Because every memo is a pure function of
state, a reloaded save (cold caches) continues bit-identically (`stateHash` tests).

## Save format

```json
{ "format": "world-command-save", "schemaVersion": 1, "scenarioId": "...", "scenarioVersion": "...",
  "seed": 42, "savedRevision": 3, "state": { ...GameState } }
```
`deserialize` parses into a temporary copy, runs `MIGRATIONS[v]` stepwise (v0 → v1 included and
tested), validates (finite numbers, non-negative stocks, references, escrow vs open orders, queued
work has completion events, queue order, scenario version) and throws `SaveError{code:
parse|format|version|scenario|invalid}` without touching the caller's state. `ui` (planning
drawings, prefs) is saved but excluded from `stateHash`. `markSaved`/`revisionConflict` support
single-writer detection across tabs.
Size reductions (deterministic): relations are sparse (a missing pair = peace, version 0), opening
trust is derived lazily from the seed + authored profile (`initialTrust`) and stored only once an
event changes it, and allied contacts are not stored. Opening World 120 save: 2,953 KB → 1,657 KB.

## Opening power

`computeOpeningPower(state, 'USA')` — five raw dimensions (see `power.ts`), normalized by the
highest non-reference value, weighted 25/25/20/20/10, rescaled so the best non-reference composite
= 100; zero denominator throws `OpeningPowerConfigError`. Persisted in `state.openingPower` at
creation (before any treaty or random event).

## Performance (real World 120 map, Node 22, this container: 4 vCPU)

Measured with esbuild-bundled scripts (`node`), 120 seats, 2,363 nodes, ~1,080 stacks at start.
Other agents were running tests/builds concurrently (load average 3–9 on 4 vCPU), so wall times
are noisy; CPU times (`process.cpuUsage`) are given where they differ.

| Metric | Before (fd88e62) | After |
| --- | --- | --- |
| Peace, engine-only game day (median of 4–6 days) | 402 ms | **65–85 ms** (CPU median 78 ms) |
| ~40 wars (40 declared neighbour wars + 1 BasicController day of moves), steady day | 915 ms (65 wars, median) | **165–340 ms** (min 163) |
| Same, first day while ~120 ordered stacks still move/fight | — | 550–1000 ms (incl. cold caches after load) |
| Heavy war: 69 wars, 650 stacks moving at once (BasicController sends every army) | — | 0.95–1.8 s CPU per day |
| `getCountryView` (one country, warm) | 0.48 ms median, 9 ms max | **0.3–0.4 ms median**, p90 ≈ 0.9 ms |
| `getCountryViews` for all 120 | — | 37–47 ms |
| Opening save size | 2,953 KB | **1,657 KB** |
| Synthetic 2,040-stack world, peace day | 210 ms | ≈ 70–90 ms |

Targets: peace ≤ 120 ms ✔; view ≤ 2 ms ✔; save < 2.5 MB ✔; war ≤ 200 ms ✔ only in steady state
(min 163 ms) — active fighting with hundreds of simultaneous movers is still 0.5–1.8 s.
Remaining hot spots under heavy war: visibility re-detection around moving stacks (~40 %),
combat/engagement bookkeeping, hourly economy aggregation after captures.

## Known gaps / resume notes

* Heavy-war performance (hundreds of simultaneous movers): next levers are coarser visibility for
  in-transit stacks (re-detect moving targets only at whole hours), a node→stacks index shared by
  combat/capture, and incremental engagement closing.
* Route planning first tries the rights-independent optimal path (memoized per state, keyed by
  class/owner/roster/versions) and falls back to constrained A* only if that path is now illegal.
  `MapIndex.staticCache` keeps its field but the memo is per state (a shared memo could leak between
  different games with equal version counters).
* Emergency diversion now respects airfield/carrier capacity (`nearestBase(..., need)`).
* Helicopters share ground movement; no separate air-mobile embark rules.
* Agents' "corruption" drains money only; officers apply one bonus per officer type.
* `BasicController` is a test bot; the real planner belongs in `src/ai/` (consumes CountryView).
* Real-scenario tests (`tests/engine/world120.test.ts`) run when `src/data` is present and print
  roster/opening-power/benchmark lines; synthesized profiles are reported in `scenario.notes`.
