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
//   CountryView.observedNodes: NodeId[] — nodes covered by the viewer's (+ vision sources') sensors/territory
//   StackView.sightKm / radarKm — effective sensor radii of the viewer's own stacks
observedNodes(state, country) ; stackSensorRadii(state, stack)   // same values as the view fields
pairKey(a, b) ; threadFor(a, b)                                     // relation / diplomacy-thread keys
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

Incremental implementation (`systems/visibility.ts`), results identical to a full recompute:

* **Fine grid.** Persistent per-stack records live in 1° cells (`FINE_BIN_DEG`, `mapindex.fineBin`),
  each cell sorted by numeric stack id. A sensor's footprint is the **exact cover** of its range
  (`fineCover`: every cell that can hold a point within `km` great-circle distance — latitude band
  ±km/R and longitude half-width `asin(sin(km/R)/cos φ)`, with distKm's Earth radius and a 1e-6°
  margin). The grid is an acceleration structure only; detection still tests the real distance.
* **Records.** Only stacks whose position/roster/air state changed, or that are in transit, are
  refreshed; a stack in transit is updated in place (moved between cells when it crosses one). A
  stack profile is reused when a new roster array has the same members (type, level, alive) — e.g.
  after a combat round without losses or a tech completion elsewhere.
* **Sensors.** Sensor groups (co-located stacks of one owner; a stack in transit is its own group
  with a stable key) are rebuilt when a member changed or the owner's `radar_range_mult` changed.
  City sensors are re-derived only at locations announced by the economy journal
  (`econChangesSince`: buildings, condition), ownership changes and radar-modifier changes; a
  global bump or a journal gap rebuilds them all. A sensor is re-evaluated only if its snapshot
  changed or a changed cell lies inside its cover (cell → sensors index, updated by diffing sorted
  covers); ownership changes mark the cells of the changed nodes (in-city identification) and
  re-check territorial observers.
* **Merge.** Each country keeps, per target, the contribution of every source (sensor hit keyed by
  sensor, or territory). A target's merged detection (max level, highest-priority domain, union of
  units/sources — order-independent) is rebuilt only when one of its contributions changed; a
  re-evaluated sensor only touches targets whose hit differs.
* **Contacts.** `updateVisibility` revisits, per viewer, only the targets whose detection changed or
  that moved in one of its vision sources ("touched"); a viewer whose vision sources changed (or a
  cold cache after load) is processed in full. Stale expiry scans a table only when its earliest
  stale contact is due. A contact whose level/domain changes is refreshed in place (same fields).
  Key insertion order of the contact tables is not semantic (the view sorts, `stateHash` is
  canonical); `tests/engine/visibility-incremental.test.ts` compares warm vs cold-clone results
  canonically on random ticks of the mini world, the scaled 120-country world and a heavy-war
  scaled world, plus a radar-modifier regression case.
* **Timing is unchanged:** every `VISIBILITY_INTERVAL_MIN` (30) minutes, for moving and stationary
  stacks alike. (Hourly re-detection of moving stacks was evaluated and rejected: it is not a pure
  function of state across save/reload, and an hourly refresh for everything saved only ~30 %.)

Current contacts are only rewritten when a visible field changes; the view reports them as observed
at `clock.lastVisibility` (live HP for identified members). Allied (coalition / shared-intel
source) stacks are projected live by `getCountryView` and are not stored as contacts.

**Observed nodes / sensor radii (view).** `StackView.sightKm/radarKm` (= `stackSensorRadii`) are the
radii the model uses: best living member's sight × terrain sight modifier at its node (unit levels
included), radar × the owner's `radar_range_mult`; 0 while aboard. `CountryView.observedNodes`
(= `observedNodes`) lists, sorted, every node owned by a vision source plus every node inside the
max(sight, radar) disc of a source's stack (not aboard, current position) or city (80 km + city
radar). It is a pure function of the viewer's own/allied assets (foreign or hidden stacks never
change it — tested) and is live at the current tick; contacts refresh every 30 min, so at a refresh
tick every current contact standing on a node lies inside `observedNodes` (tested on random ticks).

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

Per-location announcements (non-serialized, consumed by caches; a gap forces a full rebuild):
* `bumpEconomy(state, node)` also journals the node (`econChangesSince(state, sinceEconv)` →
  nodes | 'all' | null); `bumpEconomyCountry(state, c)` (research modifiers) dirties only `c`'s
  locations. `governmentDay` announces only the locations whose morale/population changed (it no
  longer bumps everything). The economy re-derives a batch larger than half of the locations as a
  full pass.
* Ownership: `recordOwnerChange` journal (`ownerChangesSince` is memoized per version). Route
  re-validation checks the changed nodes against a per-route node set.
* Unit levels: `techv`. Profiles/speed caches compare roster content (type, level, alive), so a new
  roster array with the same members keeps the cache.
* Other per-state memos: sorted stack list (new stacks are appended — ids grow with the counter —
  with a full sort as fallback), owner set for eliminations (keyed by `ownv`), cached city list,
  `S(state)` one-entry memo (reset by `registerScenario`). Hot fixed-point vector primitives
  (`addInto`, `add`, `mul`, …) are written per resource (same results, monomorphic).

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

Measured with esbuild-bundled scripts (`node`), 120 seats, 2,363 nodes, ~1,080–1,260 stacks.
Other agents were running tests/builds concurrently (load average 5–7 on 4 vCPU), so wall times
are noisy; CPU (`process.cpuUsage`, all threads incl. JIT/GC helpers) is given too. Saves used:
`war.json` = 40 declared neighbour wars + one BasicController day (124 stacks under orders at
load), `war2.json` = 69 wars after 5 more days (647 stacks under orders at load, decaying to ~300
by the end of day 1). Days are engine-only (`IdleController`). "JIT-warm" = the same save loaded and
run again in the same process (a running game/worker); "process-cold" = first run in a fresh
process (includes JIT compilation and cold caches). Same-state check: the end-of-run `stateHash`
(ignoring the `econv` cache counter, whose bump count changed) is identical before/after.

| Metric (wall ms, CPU ms in brackets) | Before (this session's start) | After |
| --- | --- | --- |
| Peace day, engine-only (median of 6; min) | 101; 77 (CPU 84) | **48–56; 44–45** (CPU 50–55) |
| 40 wars, day 1 (124 movers at load), JIT-warm | 437–466 | **190–220** (first hour 35–50 + 23 h 155–170) |
| 40 wars, days 2–3, JIT-warm | 208–269 | **91–111** |
| 40 wars, day 1, process-cold | 1,067–1,346 (CPU 1,775–1,880) | 790–1,118 (CPU 1,200–1,510) |
| 40 wars, days 2–3, process-cold | 268–361 | 132–338 |
| 69 wars, day 1 (647 movers at load), JIT-warm | 1,381–1,462 | **530–640** |
| 69 wars, days 2–3 (~280–320 movers), JIT-warm | 913–1,098 | **263–430** (typ. 280–310) |
| 69 wars, day 1, process-cold | 1,716–1,917 (CPU 2,170–2,520) | 976–1,120 (CPU 1,340–1,550) |
| 69 wars, days 2–3, process-cold | 1,003–1,430 | 323–611 |
| `getCountryView` (one country, warm) | 0.50 ms median, p90 1.1 | 0.30–0.44 ms median, p90 1.3–1.6 (now incl. `observedNodes`) |
| `getCountryViews` for all 120 | 35 ms | 42–56 ms (`observedNodes` ≈ +10 ms) |
| Opening save size | 1,657 KB | 1,657 KB |

Targets: peace ≤ 120 ms ✔; view ≤ 2 ms ✔; 40-war days ≤ 250 ms ✔ (JIT-warm, every day incl. the
capture-heavy first day; process-cold steady days ≤ 340); 69-war days ≤ 400 ms ✔ for days 2–3
(JIT-warm; one 430 sample under load) — **✗ the first day with ~650 simultaneous movers is still
530–640 ms** (JIT-warm). Heavy-day profile (JIT-warm): visibility ≈ 45 % (moving sensors re-evaluated
every 30 min, contact refreshes for moved targets), movement ≈ 13 %, combat ≈ 12 %, hourly
economy ≈ 7 %, GC ≈ 8 %.

What changed (all exact; see the visibility and cache sections): fine 1° visibility grid with exact
covers; per-target contribution merge + touched-target contact updates; in-place moving records;
content-based profile/speed caches (a combat round or a tech completion no longer re-bins every
stack); journal-driven city sensors; radar-modifier tracking (fixes stale group radar after a
`radar_range_mult` research — the only behavioural fix); economy: country-scoped research bumps,
per-location day-change bumps, fingerprint computed once per hour, monomorphic vector primitives,
lazy missile slots; combat: fine-grid target search over index-sorted candidates, node index for
engagement closing, cheap checks before range computation, roster copied only when a unit died;
movement: numeric re-validation key, per-route node set, slowest-unit memo; capture candidates
pre-filtered by war/rebel eligibility; elimination owner set cached by `ownv`; sorted stack list
appended; `S(state)` memo; O(n) VP table.

Profiling recipe: bundle a script that loads the scenario with `buildWorld120Scenario` (or a JSON
snapshot of map/catalog/profiles) and a war save, `npx esbuild <script> --bundle --platform=node`,
run with `node --cpu-prof` (or the inspector `Profiler` for a time window) and aggregate self /
inclusive samples per function and per line (`positionTicks`).

## Known gaps / resume notes

* Heavy-war performance with ~650 simultaneous movers (first war day: 530–640 ms JIT-warm, target
  400): next levers are (1) integer-indexed visibility structures (typed arrays for records, cells
  and contributions instead of string-keyed Maps/Sets — the remaining cost is per-mover
  bookkeeping, ~5 µs per moved target per refresh), (2) a persistent node→stacks index maintained by
  movement/combat/capture (each currently builds its own per step/hour), (3) allocation-free
  `stackLL`/contact refresh, (4) caching per-stack combat range / air-defence member lists. A rule
  change (hourly visibility) was measured at only ~30 % of visibility cost and was not adopted.
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
