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
| `systems/` | `mapindex` (graph, A*, bins), `world` (queries/rights), `movement`, `combat`, `air`, `airmobile` (helicopter lift), `blockade` (port blockades), `government` (capture/morale/revolts), `economy`, `ledger`, `production`, `research`, `missiles`, `visibility`, `intel`, `diplomacy`, `coalitions`, `market`, `score`, `readiness`, `events`, `queue`, `hooks`. |
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
getCountryView(state, country, { journalLimit?, journalScan?, lite? }) : CountryView
getCountryViews(state, ids, opts?) : Map<country, CountryView>   // batch; shares the public slices
//   lite: planner view — self.force/lift/liftBreakdown, observedNodes, stack sightKm/radarKm and
//         market.myFills are zero/empty placeholders and `view.lite === true`; all else identical
//   CountryView.wars: [a, b][] — every current war (public), sorted
//   coalitions[].joinedAt: { member → join tick } ; relations[].trustHistory?: the viewer's OWN
//         trust changes toward that country ({ at, kind, delta }; free-text reasons omitted)
//   CountryView.observedNodes: NodeId[] — nodes covered by the viewer's (+ vision sources') sensors/territory
//   StackView.sightKm / radarKm — effective sensor radii of the viewer's own stacks
//   CountryView.blockades: own blockaded ports (role 'blockaded', blockaders not named) and enemy
//         ports the viewer's warships blockade (role 'enforcing')
//   Offer.territory?: { give, receive } (peace cessions), Offer.round? / counterOf? (haggling)
liftInfo, canAirLift, interceptionRisk, airborneLifts      // air-mobile lift (systems/airmobile.ts)
updateBlockades, isBlockaded, portIndex                     // blockades (systems/blockade.ts)
cessionError, offerRound                                    // peace settlements (systems/diplomacy.ts)
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
interface CountryController {
  decide(view: CountryView, ctx: PlannerContext): Command[]
  wants?(info: { country, reviews, wake, memory }): boolean  // pre-check before any view is built
  liteView?: boolean                                          // opt in to the planner (lite) view
}
// ctx: now, reviews ('strategic'|'economic'|'diplomatic'|'operational')[], wake (event triggers),
//      budget (max commands, by difficulty), difficulty, memory/setMemory (opaque JSON saved in
//      state.ai.memory), preview(cmd), route(stackId, dest), map, catalog, rng (seeded per call)
advance(state, minutes, { controllers: { USA: myCtl } | (c) => ctl, fallback: BasicController })
```
Controllers receive **only** the CountryView. Commands whose `country` ≠ the controlled country
are rejected (`foreign_issuer`). A throwing controller is counted (`controller_error`) and ignored.
`wants` must be a pure function of its argument (`memory` is the saved blob, read-only); returning
false skips the call (no view, no decide; that call's wake tags are consumed). A throwing `wants`
counts as true. `src/ai`'s `UtilityController` declares both (`wantsCall`, `liteView: true`);
`BasicController` reads `self.force` and keeps full views.

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
  2. air operations; 2b. air-mobile lifts due to land (`airmobileStep`); 3. ground/naval movement
     (stacks by numeric id);
  4. whole hours: attack-order refresh + combat round; 5. capture;
  6. whole hours: blockade refresh (`updateBlockades`), then economy accrual; 7. visibility (every
     `VISIBILITY_INTERVAL_MIN` = 30);
  8. day change: government (morale/population/revolts), readiness, trust decay, daily digest,
     **score settlement**, pruning; 9. eliminations; 10. AI scheduler.
* Commands submitted between steps apply immediately at the current tick.

## Determinism guarantees

* Random draws: `streamRng(seed, stream, key)` with stable keys (`combat:<eng>:<round>:<stack>`,
  `missile:<launchId>`, `airmobile:<stack>:<launchedAt>`, `revolt:<city>:<day>`, `uprising:<city>:<tick>`, `agent:<id>:<n>`,
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
  annex, operations (air-mobile fuel). Invariant (tested): `ledger.initial + Σ ledger.totals == stock` (spendable).
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
  event explains why (A03). If the way back is illegal too (e.g. a stack mid-edge inside a former
  enemy after peace) the stack **settles once** on the nearer endpoint (ties: ahead) and finishes
  that edge: one `route_revoked` event, no flip-flop. The rule is idempotent, so the re-validation
  memo (skipped when no rights/ownership/roster changed) can never make a warm run differ from a
  reloaded one (before, both-ends-illegal stacks turned back on every re-check).
* Effective speed = slowest unit × terrain (catalog terrain speed or default table) × logistics.

### Air-mobile lift (helicopters) — `systems/airmobile.ts`, command `airmobile`

Helicopters are ground-class stacks (they move with ground formations), but a formation with lift can
fly one direct **air-mobile hop** through the shared validator (`{ type: 'airmobile', stack, dest,
confirmActOfWar? }`, human and AI identical):

* Lift: `UnitType.airmobileCapacity` (additive catalog field) — seats for light infantry on a
  helicopter (utility gunship `heli_gunship` = 2; mini-fixture `heli` = 2); an infantry type with a value
  lifts itself (`inf_airmobile` = 1, organic lift). Passengers = every non-helicopter unit without own
  lift; each must be light infantry (family infantry, target class unarmored) or an officer, and
  passengers ≤ Σ seats of living helicopters (attack helicopters fly along as escort). Codes:
  `invalid_domain` (armour/guns aboard, sea destination), `insufficient_lift`, `missing_facility` (no
  lift), `refueling` (turnaround), `insufficient_range`, `insufficient_resources` (fuel), `act_of_war`.
* Range: min `operationalRangeKm` of the flying units (default `AIRMOBILE.defaultRangeKm` = 400) ×
  `air_operational_range_mult`; minimum hop 20 km. Fuel = flyers × ⌈km/100⌉ × 3, charged at launch
  (ledger `operations`). Flight time = 30 min load + km / min(220, slowest helicopter) km/h.
* In flight the stack is in an `air` position with `order.airmobile = { from, launchedAt, arriveAt,
  km }`; it cannot stop, delay, split, merge, move or attack (`busy`). `routeEtaTick` = landing tick.
* Landing (step 2b): (1) a destination that became foreign-at-peace without passage and was not
  confirmed turns the lift back to its origin (`airmobile_aborted`); a confirmed one declares war on
  landing (as ground entry). (2) Interception: risk = Σ hostile (at war) air-defence units within
  max(range, 60 km) of the straight path (0.12 × level × hp fraction) + hostile fighters on patrol
  whose circle touches the path (0.08 each) + an opposed landing (0.1), cap 0.75; one seeded draw
  (`airmobile:<stack>:<launchedAt>`); if intercepted every unit loses a seeded 25–60 % of max HP
  (dead units removed; an emptied formation is destroyed) — events to the owner and the defenders.
  (3) Node position, land mode, order cleared, flyers get `cooldownUntil = now + 120`. Capture then
  follows the ordinary rule in the same step.
* Hidden information: the preview's `riskEstimate`/`riskNote` use only the issuer's own identified
  contacts (an unobserved battery gives 0 % plus a warning); the resolution uses real positions.
* Tests: `tests/engine/features.test.ts` › helicopter air-mobile lift (validation, fuel/ledger,
  in-flight refusals, turnaround, capture on landing, abort, risk estimate without leaks, seeded
  interception, save/reload + chunking hash equality).

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

## Blockades — `systems/blockade.ts` (AI request #12)

A port city (map port flag; adjacent sea zones = its coast edges) is **blockaded** when at least one
adjacent sea zone holds a naval stack with a warship (living sea/subsurface unit with attack > 0) of a
country at war with the city's owner, and **no** adjacent zone holds any naval stack of the owner or
a coalition partner (ships in the harbour node itself do not count). Refreshed every whole hour
before the economy (pure function of stack positions at that boundary); saved as
`state.blockades[city] = { since, by, zones }` because start/lift events need the previous status.
Effects: city output × `BLOCKADE.outputFactor` (0.7, port trade lost; applied in
`cityAdjustedOutput` before the territory factor; the city output cache keys on the flag and
`updateBlockades` announces the node with `bumpEconomy(state, node)`), and naval mobilization there is
refused (`checkMobilize` code `blockaded`; jobs already queued still complete). Journal:
`blockade_started` / `blockade_lifted` (economy category) — the owner is told its port is blockaded
"by hostile warships" without naming them; the blockaders are told whose port. View:
`CountryView.blockades` (own ports `role: 'blockaded'`, enemy ports we enforce `role: 'enforcing'`).
**Direct test edits of `state.blockades` must call `bumpEconomy(state, node)`.** Tests:
`tests/engine/features.test.ts` › port blockade.

## Capture and government

Capture: surviving capture-capable land unit at the control node, at war with the owner (or rebel
node), no hostile stack present. Liberation restores `homeland`; otherwise `occupied`. A treaty
cession (`transferNode(..., 'treaty')`) gives `annexed` (or `homeland` on return) — no loot, event
`territory_ceded` with a public headline. Annex
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
* **Peace settlements** (v2): an offer with `peace` may carry `territory: { give, receive }`
  (control nodes; `give` = sender cedes, `receive` = recipient cedes) next to `resource` terms
  (moved at acceptance). Rules (`validateTerms` / `cessionError`, re-checked at acceptance and at
  the effective time): peace term required, the giver holds the province, never its capital, never
  every province it holds, no duplicates, ≤ `PEACE.maxTerritoryTerms` (6). Cessions apply after peace
  at the effective time (`DiploHooks.cede` → `transferNode(..., 'treaty')`); a clause that became
  impossible is skipped with a `cession_skipped` event. Territory is a separate offer field (not an
  `OfferTerm` kind) so existing term renderers stay exhaustive.
* **Haggling**: `proposeOffer.counterTo = <offer id>` answers a pending offer addressed to the issuer
  with a new offer back to its sender: the countered offer is declined (`responseReason` "countered
  (round n/4)…", no trust penalty, `offer_countered` event), the new one has `counterOf` and
  `round = previous + 1` ≤ `PEACE.maxRounds` (4, else code `negotiation_limit`); the pending-pair
  limit discounts the countered offer. Tests: `tests/engine/features.test.ts` › peace settlements.
* **Coalition co-belligerence (AI request #14) — not adopted.** SPEC keeps exactly four statuses per
  direction and asks not to invent a fifth; an implicit "fights without a declaration" state would be
  a hidden fifth relation (combat, capture, access and visibility would all need it, and the human
  could be attacked by countries never at war with them). Partners join a war by the ordinary,
  visible declaration (the planner's `joinVerdict`).
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
change, offer received/answered, coalition application, and on a `sendMessage` with intent
`coordinate` / `request_operation` (tag `message:<id>`; DM recipient, or every other member for the
coalition thread; `ai-host/wake.ts`, applied when the message is posted).

Per due call `invoke` asks the controller's optional `wants(...)` first and builds no view when it
declines; otherwise it builds `getCountryView(..., { journalLimit: 15, journalScan: 400, lite:
ctl.liteView })`. The planner memory is copied with `jsonClone` (exactly `JSON.parse(JSON.stringify)`
semantics: non-finite → null, undefined dropped), so a warm run equals a reloaded one.

## Cache-invalidation contract (incremental systems)

Derived caches never live in the save; they are validated by version counters in `state.ids`
(saved, deterministic): `relv` (war/peace), `grv` (grants), `cov` (coalition membership), `ownv`
(ownership, with a per-node change journal), `econv` (territory output inputs), `techv` (unit
levels), `trustDays`. Every engine path that mutates the corresponding data bumps the counter
(`bumpEconomy(state, node?)`, `recordOwnerChange`, …). **Code that edits buildings, condition,
morale, population, ownership or `state.blockades` directly (tests, tools) must call `bumpEconomy(state)`** — the
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
  with a full sort as fallback; `stacksReadonly` returns it without copying; the array is never
  mutated in place — an addition or removal replaces it — so hot loops that may delete stacks
  (air, movement, combat, destroyStack) iterate it as a snapshot instead of copying), owner set for
  eliminations (keyed by `ownv`), cached city list, `S(state)` one-entry memo (reset by
  `registerScenario`). Hot fixed-point vector primitives (`addInto`, `add`, `mul`, …) are written
  per resource (same results, monomorphic).
* Stacks per owner (`stacksOfOwner`): keyed by the stack-id counter + stacks object (every stack is
  created with a counter id and a stack's owner never changes), so it survives steps and commands;
  an owner whose list is unchanged keeps the same array (identity-keyed memos downstream). Removed
  stacks may linger until the next creation: callers skip `state.stacks[s.id] !== s`.

**`derived()` key classes and command scopes** (`derived.ts`). The per-state memo is cleared at
every step boundary. After a successful command `submitCommand` clears by class:
* `~…` step-scoped (economy rates `~rates`/`~rate:<c>`/`~staticRates`, research slots/speed,
  maintenance, `~publicSlice`): never cleared by commands (`demolish` clears everything). Direct
  mid-step edits by tests/tools must call `invalidateViewCache(state)`.
* `@…` forces-scoped (`@force:<c>`, `@liftAll`, `@obsNodes:<c>`): cleared by
  every command except the **FORCE_NEUTRAL** set in `commands/index.ts` (build, cancelJob, annex,
  mobilize, setRally, start/cancelResearch, produceMissile, market orders, offers, agents, intel
  reports, articles, messages) — their `apply` never touches stacks, territory, relations or
  coalition membership (paths that do, e.g. `setGrant`/coalition joins, invalidate on their own).
* anything else: cleared after every command.

**Cross-step memos keyed by saved counters** (`memoByVersion(state, name, key, deps, compute,
stillValid?)`, survive steps and commands): territory per owner and the public basemap slice
(owners, rebel nodes, public cities, scores — frozen, shared by all views) are keyed by `ownv` (every
owner/control change goes through `transferNode`); the only other public field that changes
(annexation status) is re-checked once per step. **Code that changes ownership directly must bump
`ownv`** (or go through `transferNode`). The coalition membership index (`coalitionIndex`) is keyed
by `cov` + the coalitions object (membership, leader and dissolution change only with a `cov` bump).

**Other version-keyed indexes** (non-serialized WeakMaps; a reloaded/cloned state rebuilds):
* Market (`systems/market.ts`): open-order index (open list, orders per country, open counts) and
  aggregated books (frozen, shared). Every order mutation lives in market.ts and updates the index
  in place (`noteOrder`: place / fill / cancel / prune); validity = private version + `market.seq` +
  orders object. Lists keep `Object.values(state.market.orders)` order, so results equal a full
  scan in warm and reloaded runs (tested). **Code that edits orders directly must call
  `bumpMarket(state)`.** `counterOrders` (matching, previews), the open-order limit and elimination
  cancels use the index. An order change drops only its own resource's book; a cached book is also
  re-checked against the live last price.
* Offers per country: `memoByVersion('offerIndex', ids.offer, [state.offers])` — offers are only
  created with a new id and deleted only by the day-change prune (status changes are in place); the
  view drops pruned entries on read (`liveOffers`), so the list equals a fresh index.
* dm threads per participant: keyed by the message counter `ids.message`.
* Journal (`journalFor`): per-recipient lists of event references appended from a cursor (event
  ids ascend), trimmed lazily after the log is pruned; rebuilt when `state.events` is replaced.
* Diplomacy rows: war sets (`enemyMap`, `relv`), grant maps (`grantMap`, `grv`; the rebuild diffs
  the previous map and records a per-country touch version — `grantTouch(state, c)` — for both sides
  of every grant that appeared, changed or vanished), coalition membership (`coalitionIndex`, `cov`),
  public war list (`relv`), trust rows (`trustRow`: pair keys and opening values precomputed per
  viewer row; explicit `state.trust` entries are read live, so direct test edits are seen).
* Per-viewer relation rows (`relationRows`): reused between views (frozen rows, frozen array) while
  the war map, coalition index, the viewer's coalition, the seat order and the viewer's grant touch
  are unchanged; every row is still re-checked against the live trust value, trust entry identity,
  history length and newest history item, pending offers and name/controller/alive, and rebuilt
  alone when one differs.
* Coalition entries in views: one frozen public entry per coalition, rebuilt when members /
  departures (array identity + length — they are only appended or replaced), leader, dissolution,
  texts or the frozen score table change; only the leader gets a copy with its applications.
* Allied (vision-source) contacts: the merged per-viewer stack list is memoized per `srcs` array
  while every source's `stacksOfOwner` list is the same array; each allied stack's projected member
  list (type + rounded HP) is frozen and shared, re-checked member by member on every use.
* Contact tables: `sortedContactIds(table)` memo per table object and key-set version (the version
  is bumped by every insert/delete in visibility.ts, the only writer).
* Sorted techs per country (techs are only added; keyed by the record and its key count).
* Visibility internals: fine cells are a dense array (`cellIx`: `lonIndex·181 + latIndex`) holding
  the records and per-owner counts of a cell; sensors are interned to integer slots (`slotFor`, per
  cache, never released) so the current snapshot, evaluated hits and cell → sensor sets are arrays /
  integer sets; the invalid-sensor list is deduplicated with a per-run stamp and keeps first-marking
  order (exactly the iteration order of the former key set). `detectFrom` evaluates `distKm` inline
  with both latitude cosines cached (the same operations in the same order: bit-identical).

## Save format

```json
{ "format": "world-command-save", "schemaVersion": 2, "scenarioId": "...", "scenarioVersion": "...",
  "seed": 42, "savedRevision": 3, "state": { ...GameState } }
```
`deserialize` parses into a temporary copy, runs `MIGRATIONS[v]` stepwise (v0 → v1 and v1 → v2
included and tested; v2 adds the `blockades` section — the optional offer `territory`/`round`/
`counterOf` fields and `MoveOrder.airmobile` need no conversion), validates (finite numbers, non-negative stocks, references, escrow vs open orders, queued
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

### AI phase: 120 AI seats with the src/ai utility planner (engine pass of 2026-11-14)

Real map, observer mode, seed 7, snapshot after 6 game days (≈ 1,690–1,750 stacks), days 7–9,
esbuild bundle, Node 22. **Another agent's 4-worker observer run occupied ≈ 2.7 of the 4 vCPUs during
all of these measurements (load average 6–10)**, so absolute wall times are inflated; every row
was measured interleaved under the same load. To compare engine versions the planner was frozen
(src/ai as of the start of this pass, extracted from the baseline bundle); "current AI" is src/ai
at the end of the pass (with the concurrent alliance/naval layers).

| Configuration (ms / game day) | load ≈ 1 (start of pass) | load ≈ 6–7 | load ≈ 9–10 |
| --- | ---: | ---: | ---: |
| Before (old engine, frozen AI; 2,210 full views/day) | 6,049 (days 7–9; day 9: 5,637) | 6,703–7,287 | 8,647 |
| After, frozen AI, process-cold days 7–9 | — | 1,591–1,798 | — |
| After, frozen AI, JIT-warm (`WARM=1`) | — | **1,295** | 2,114 |
| After, current AI, JIT-warm | — | **1,456** | 1,969 |
| After, views only (empty lite controller, all 2,210 calls), JIT-warm | — | 992 (cold) | 852 |
| Engine only (IdleController), JIT-warm | 224 (cold) | — | 273 |

Same-state checks: with the frozen planner the old and new engine produce the **identical
`stateHash`** after 3 days as long as only behaviour-neutral changes are compared (market index,
granular invalidation, cross-step memos, lite views, trust rows, journal index, …: hash
`3b1c84b6…` before and after). The intended behaviour changes alter it: the `wants` pre-check
(skipped calls), structured event `data`, the route-settle fix.

Per view: lite ≈ 0.26 ms vs. full ≈ 0.83 ms (load 7; 1.9 ms full before). Views per day: 2,210 →
≈ 980 (pre-check). Remaining split of a JIT-warm day (CPU profile, current AI): planner (`decide`,
incl. ≈ 60–90 ms of validator previews / route A*) ≈ 35–40 %, views ≈ 25–30 % (diplomacy rows,
allied contacts, rates, public slice, clones), engine steps ≈ 25 % (visibility ≈ ⅓ of it), GC ≈ 11 %.
**≤ 1 s/day is not reached on this loaded machine** (≈ 1.3–1.5 s/day JIT-warm at load 6–7; the
before/after ratio is 4.1–4.7×, so ≈ 1.2–1.4 s/day is expected on an idle 4-vCPU box). The largest
remaining single item is the planner itself (src/ai), then per-view object construction.

**69-war engine-only day** (save rebuilt this pass: seed 42, 40 neighbour wars + 1 BasicController
day + 5 more days, then extra neighbour wars up to 69; 1,354 stacks, **831 movers at load** — heavier
than the earlier 647-mover save; load ≈ 5.6): day 1 process-cold 1,513 ms (old engine on the same
save 1,591 ms), **JIT-warm 473–610 ms**, days 2–3 JIT-warm 249–330 ms. The AI-phase work did not
target this path; visibility is still the largest part of it (see the known gaps).

### Engine pass 2 (2026-11-14 evening): views, visibility, movement/combat allocation

Same saves and esbuild bundles as above, Node 22, 4 vCPU. **Other agents' Playwright/Vitest runs
loaded the machine throughout (load average 1.2–8)**, so every row interleaves the frozen baseline
bundle ("before" = engine at the start of this pass) with the final tree under the same
conditions; each cell is min / median over the runs listed. JIT-warm = 3 warm-up runs of the same
save in the process first, `global.gc()` before each measured run. The planner (src/ai) is
unchanged. **Every run below ends in the same `stateHash` before and after** (war69 3 days
`ecec5d3a…`, 40-war 3 days `3366d19a…`, AI 3 days `5e2bb4a5…`, engine-only `f1941693…`); the AI
run also reproduces `5e2bb4a5…` with odd time chunks and a save/reload every third chunk.

| Metric (ms; min / median) | load | Before | After |
| --- | --- | ---: | ---: |
| 69 wars, day 1 (831 movers at load), 3 × 6 runs per side | 1.6–3.3 | 460–489 / 492–528 | **393–408 / 468–523** |
| 69 wars, day 1, single run per process with GC accounting | ≈ 1.3 | 412–593 (med ≈ 470; GC 64–94) | **387–527 (med ≈ 410; GC 49–87)** |
| 69 wars, day 2 / day 3 (3 × 4 runs) | 2.5–5 | 264–296 / 288–307; 231–252 / 260–295 | **220–242 / 241–294; 187–206 / 212–225** |
| 40 wars, day 1 / days 2–3 (2 × 4 runs) | 3–5 | 302–379 / 409–442; 156–181 / 176–212 | 267–360 / 308–416; 138–183 / 140–263 |
| AI phase (UtilityController, snap6 days 7–9), per day (3 × 3 runs) | 5–8 | 1,109–1,220 / 1,214–1,287 | **950–1,082 / 969–1,244** |
| Engine only (IdleController, snap6), per day (2 × 4 runs) | 6–8 | 126–177 / 150–215 | 118–142 / 129–177 |
| A02 smoke (`tests/ai/world120.test.ts`, 20 days, 120 seats) | ≈ 3 | ≈ 1,400 ms/day (planner ≈ 450) | **1,104 ms/day (planner 414)** |

Per-view cost (lite, after each 15-min step) measured 0.18–0.26 → 0.19 ms median at load 6–7
(too noisy to resolve); the CPU profile of two JIT-warm AI days is the steadier signal:
`getCountryView` ≈ 423 → ≈ 320 ms/day (relation rows, allied contacts, coalitions, stack lists,
public slice), runStep excluding the AI ≈ 320 → ≈ 260 ms/day. Heavy-war profile after the pass
(per JIT-warm day 1): visibility ≈ 190 ms (detection bookkeeping ≈ 50, sensor re-evaluation ≈ 30,
contact writes ≈ 25), combat ≈ 65, movement ≈ 60, hourly economy ≈ 35, air ≈ 19, capture ≈ 18,
GC ≈ 12 %. A warm war day measured hour by hour: first hour (cold caches after load) 44–80 ms,
day-change hour 33–48 ms, other hours 10–25 ms.

What changed (all behaviour-neutral; caches are non-serialized and rebuild on load):
* Views (`view/country-view.ts`): relation rows reused per viewer (grant touch versions from
  `grantTouch`; every row re-checked against live trust/offers/seat data; no conditional object
  spread); one frozen entry per coalition (applications only for the leader); allied stacks' member
  lists shared frozen and re-checked; sorted contact ids per table version; offer index across
  steps (`liveOffers`); `jsonCopy` (exact JSON round-trip semantics) instead of
  `JSON.parse(JSON.stringify)` for air state, missiles and the result; time text memo.
* World/diplomacy indexes (`systems/world.ts`): stacks per owner keyed by the stack counter (no
  per-command rebuild, unchanged owner arrays kept); coalition index and vision sources keyed by
  counters without per-call allocation; the stack-list append no longer counts every key.
* Visibility (`systems/visibility.ts`): dense cell arrays; integer sensor slots with a stamped
  invalid list (same order as before); inline haversine with cached cosines in `detectFrom`; lazy
  hit / visible-unit arrays; tuple-free territory lookup; a merge of one source returns its Det;
  allocation-free node positions in `writeContact`; the allied merge memoized per `srcs` array.
* Combat (`systems/combat.ts`): open engagements indexed once per round; `closeEngagements` visits
  only open ones and prunes only above 200 closed; no per-stack allocation for the air-defence
  check or the target bins. Movement: array node index, no re-validation key allocation per mover.
  Air/movement/combat/destroyStack iterate the read-only sorted list instead of copying it.
  Economy: hourly shortage flags over the cached city list; market books invalidated per resource.
  Readiness: friendliness evaluated once per owner. Eliminations: recovery check via
  `stacksOfOwner`.
* Tests: `tests/engine/perf-caches.test.ts` › "views from a warm state … equal views of a cold
  reload" (coalition applications/joins/departures, offers, grants, engine and direct trust edits,
  war, new/removed stacks, in-place HP edits, bot days, offer pruning; lite and full views).

Profiling recipe: bundle a script that loads the scenario with `buildWorld120Scenario` (or a JSON
snapshot of map/catalog/profiles) and a war save, `npx esbuild <script> --bundle --platform=node`,
run with `node --cpu-prof` (or the inspector `Profiler` for a time window) and aggregate self /
inclusive samples per function and per line (`positionTicks`).

## Known gaps / resume notes

* AI-phase cost (second engine pass, see "Engine pass 2" above: ≈ 0.95–1.2 s/day JIT-warm on the
  shared container, A02 smoke 1.10 s/day): requests (1) per-viewer diplomacy rows and (2) shared
  allied contacts landed in a form that keeps live trust reads (rows are reused but every row is
  re-checked; allied member lists are shared and re-checked), and the stacks-per-owner index now
  survives steps/commands. Remaining levers: (a) the trust re-check still reads 119 `state.trust`
  entries per view — a saved trust version counter would let a row set be reused without it, but
  tests edit `state.trust` directly, so that needs a contract change; (b) `stacksReadonly` still
  re-checks every record for removals (≈ 25 µs per call; a deletion counter needs every direct test
  deletion to announce itself); (c) `~staticRates` recomputes the structural fingerprint once per
  step that has views (≈ 0.2 ms); (d) planner (src/ai) ≈ 35–40 % of the day, memory `jsonClone`
  ≈ 25 ms/day.
* Heavy-war day (69 wars, 831 movers at load): first day ≈ 390–470 ms JIT-warm (median ≈ 410 at
  load ≈ 1.3; ≈ 470–500 at load 3–5), days 2–3 ≈ 200–270 ms. **≤ 400 ms is met by the fastest
  runs and by every steady day, not reliably by the first-day median on this shared machine.** That
  day includes a one-off cold-cache first hour (≈ 45–80 ms: full visibility build, every mover's
  route re-validated) and the day-change hour (≈ 35–45 ms); GC is ≈ 12 % of it. Remaining levers:
  (1) visibility bookkeeping for moving sensors (≈ 470 re-evaluated per 30-min refresh; most find
  nothing — cover arrays, sensor snapshots and hit diffs are still allocated per refresh), (2) a
  persistent node→stacks index shared by movement/combat/capture/closeEngagements (each still
  builds its own per step/hour), (3) allocation in combat (`combatUnits` filters, `nearby` sorts)
  and `evalEdge` verdict objects. A rule change (hourly visibility) was measured at only ~30 % of
  visibility cost and was not adopted.
* Route planning first tries the rights-independent optimal path (memoized per state, keyed by
  class/owner/roster/versions) and falls back to constrained A* only if that path is now illegal.
  `MapIndex.staticCache` keeps its field but the memo is per state (a shared memo could leak between
  different games with equal version counters).
* Emergency diversion now respects airfield/carrier capacity (`nearestBase(..., need)`).
* Helicopters share ground movement and fly air-mobile hops (see "Air-mobile lift"); a lift is not
  shot at by ordinary combat rounds in flight beyond the landing-time interception rule, and
  passengers cannot be dropped at sea.
* Agents' "corruption" drains money only; officers apply one bonus per officer type.
* `BasicController` is a test bot; the real planner belongs in `src/ai/` (consumes CountryView).
* Real-scenario tests (`tests/engine/world120.test.ts`) run when `src/data` is present and print
  roster/opening-power/benchmark lines; synthesized profiles are reported in `scenario.notes`.
