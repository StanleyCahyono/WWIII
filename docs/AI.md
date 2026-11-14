# AI — computer countries (src/ai)

_Owner: AI agent. Local rules/utility planner: no LLM, no inference server, no network, no API key.
Deterministic: every random draw comes from the per-call `ctx.rng` stream; persistent strategy lives
in `ctx.memory` (JSON saved by the engine in `state.ai.memory`)._

## Contract and injection

* `src/ai/index.ts` exports `UtilityController` (a `CountryController`), `createSimHost(difficulty?)`
  (preferred by `src/ui/sim/engine-adapter.ts`), `createAiControllers(difficulty?)` / `createControllers()`
  (registry function), `CONTROLLER`/`default`, plus developer tools `getDecisionLog`, `aiPerf`,
  `evaluateOffer`, `DIFFICULTY`.
* `decide(view: CountryView, ctx: PlannerContext): Command[]` — the planner receives **only** the
  filtered `CountryView` and the engine-filtered context (`preview` = shared validator, `route`,
  public `map`/`catalog`, `rng`, `memory`). It never imports `GameState`, `systems/*` or the
  scheduler (enforced by `tests/ai/contract.test.ts`: only type imports from the engine plus the
  `RESOURCES` constant of the static data contract).
* Every command is previewed through the same validator as the human's before it is returned; a local
  copy of the spendable budget (with an upkeep reserve) is decremented per accepted command so a batch
  never over-commits, and batch-consistency guards drop commands that a command earlier in the same batch
  would invalidate (no offer/message/application toward a country we just declared war on — previews run
  against the pre-batch state). Invalid bot commands are counted by the engine (`stats.rejected`) and
  reported by the tests and the observer suite.
* One stateless controller instance serves all 119 bots. Module-level caches hold only pure functions of
  public static data (map adjacency/geography per `MapData`, catalog indexes per `Catalog`) or of
  content-identical inputs (hop distances keyed by the frozen public `owners` array), so caching never
  changes decisions and save/reload mid-campaign reproduces the same `stateHash` (tested).

## Architecture (layers)

| Layer | Cadence | Module | What it does |
| --- | --- | --- | --- |
| Replies | every call (wakes on `offer`) | `diplomacy.ts` `diplomaticReplies` | Answer pending offers, coalition applications (leader), operation requests (`sendMessage` intent `coordinate`/`request_operation`). Each reply's reason is a logged decision and is stored in memory (`decisions`). |
| Strategic | daily (easy: every 2 days) + triggers | `strategic.ts` | Geography class, shortage forecast, research focus, force/garrison plan, stance, territorial objective with commitment window, war decisions, truce bookkeeping, memory decay, journal ingestion (grievances/favours/intel findings). |
| Economic | every 6 h (staggered) | `economic.ts` | Missile procurement (two-phase, valued in campaign points vs ground units), research, construction (ROI on incremental building effects), mobilization within upkeep headroom, market (cover deficits, sell surpluses, cancel stale orders, price ladder), annexation, anti-stall fallback. |
| Diplomatic | every 12 h (staggered) | `diplomacy.ts` `diplomaticReview` | Peace proposals, coalition apply/found/invite/coordinate/leave, revoke grants, passage and shared-intel proposals, resource trade agreements sized to the forecast deficit and actual surplus (a critical shortage < 48 h jumps the queue). |
| Operational | every 2 h + wakes (normal/hard) | `operational.ts`, `alliance.ts`, `naval.ts` | Defend threatened/under-garrisoned cities (capital first), call the bloc for help when the capital is exposed, mutual defence of coalition partners, attack/retake with force-ratio estimates from observed (possibly stale) contacts and intel reports, front concentration (merge), peace-time staging, naval escort / blockade under sea superiority / carrier air wings, air patrol/rebase, missile launches, intel purchases/agents and plan updates on findings. Peace-time mutual defence, staging and fleet housekeeping ride on the economic review (partners' wars do not wake us). |

`orders.ts` holds the shared move issuer (commitment window via stack tasks, no repeated no-ops) and the
passability rule (own / coalition / passage granted to us). `turn.ts` holds one invocation (view, ctx, memory, budget copy, reserve, bounded output, path budget);
`analysis.ts` derives territory, frontier, neighbours, hostile contacts, per-city threat/required
garrison and rival power priors (public opening-power composite × public score trend);
`value.ts` prices resource vectors at the published reference prices and estimates unit/contact power;
`geo.ts` is the cached static map analysis; `memory.ts` persistence/decay; `log.ts` the developer log.

**Quiet path.** An operational-only call with no wake, no war, no pending offer/request and no rebel
province returns immediately without touching memory (≈ 56 % of calls on the real map). The same
predicate, evaluated from the saved memory only, is exported as `UtilityController.wants` / `wantsCall`
for the proposed scheduler pre-check (Engine request 1).

## Signals per decision (SPEC §4 table → code)

| Decision | Signals used (all from the CountryView or own memory) | Visible consequence / where |
| --- | --- | --- |
| Industrial investment | `self.resources` net/day, forecast, hours-to-depletion (lookahead by difficulty), shortages, city threat (safety), days remaining (payback < 60 % of remaining days), free construction slots (one per city, concurrency cap), building effects (increment over the current level) | Electronics shortage ⇒ electronics-producing building scores ×3, market buy placed first, expensive electronics research and missile procurement delayed (`economic.ts` `construction`, `market`, `techValue`, `tradeIndex`). Test: `economy.test.ts` "electronics shortage". |
| Research and recruitment | Doctrine (preview), facilities (requirements per city), observed opponents (war/threat raises land weight), geography (`geo.ts`: landlocked / maritime / coastal), upkeep headroom (no unit whose upkeep drives any resource below 14 days of stock), force mix targets | Archipelago ⇒ mobility ×1.3, naval ×1.1, lift/embark modifiers +0.8, naval bases/pontoons valued; landlocked ⇒ naval weight 0, sea techs filtered, naval units never mobilized, ships never ordered. Spending goes through the shared validator and the ledger (test reconciles stock). |
| Territorial objectives | Reachable nodes (land hop distance from own territory, sea for coastal states), VP value, power ratio, trust, grievance, border exposure, travel (hops), observation age of the objective | Re-target triggers: lost port, new transit agreement, observation expired (> 2 days without a valid report), objective taken, target eliminated / joined our coalition; otherwise a 2-day commitment window with 20 % hysteresis prevents oscillation (`strategic.ts`). |
| Defense vs expansion | Per-city required garrison (tier/capital prior + 1.25 × observed hostile strength within 320 km), present strength, reserves (stacks not needed as garrison), commitments (stack tasks) | Coalition partner defends its exposed capital and declines a partner's (human's) operation with a concrete reason (`operationRequests` + `defend`). Test: `diplomacy.test.ts`. |
| Mutual defence (coalition) | Partners' capitals / major core cities (public cities), hostile ground contacts within 320 km — our enemies, the foe a partner named, or foreign formations INSIDE the partner's territory (coalition-shared sensors) — vs partner + own forces present; own capital exposure; spare formations beyond every own city's garrison; land reach (≤ 8 hops) through own / coalition / passage territory; public power of the members (share) and of the foe; loyalty, trust, grievance; partners' `request_operation` messages | A capable member joins the partner's war (combat only happens between belligerents; rule `joinVerdict`: no truce, ≤ 2–3 wars, bloc ≥ 70 % of the foe's power, no provoking a much stronger neighbour) and sends a proportionate share of the deficit (its power share among the other members, ≥ ⅓, capped at 35–65 % of spare strength by loyalty), with a 2-day `ally_defend` commitment. An exposed member asks the bloc (`request_operation`, reason names city, node, foe, strengths); partners answer with a concrete reason and honour an accepted request for 2 days. A partner that accepted but never arrived gets grievance +10 (`broken_commitment`), one that came gets favour +6. Tests: `alliance.test.ts`. |
| Diplomacy | Trust by counterpart (view), grievances (war declared on us +50, revoked grant +12, captures +15/+4; decay 10 %/day), favours (agreements in effect; decay 5 %/day), common threats, border length, offer history (declined ⇒ 5-day cooldown), relative power/score | Propose/accept/reject/revoke; replies carry a brief reason equal to the logged decision (`evaluateOffer`). Tests: poor offer refused with reason; generous offer accepted; two bots reach a treaty. |
| Peace and coalition policy | War duration, losses (capitals lost, threatened cities), power ratio, multiple wars, aggression; bloc power, trust in members, small-state status, threat; solo vs bloc fraction of threshold | Peace offers/acceptance, 15-day truce after peace, coalition apply (per-coalition 7-day cooldown) / found / invite / admit (3-day consolidation) / coordinate joint objective / leave by explicit rules (below). |
| Information gathering | Uncertainty about the objective (no observation or older than 12 h, no unexpired report), budget (≥ 3,000 money above reserve), objective importance, war | `buyIntelReport` on the objective node, an information agent on an enemy capital; when the report arrives the plan updates (commit or re-plan) — logged as `plan_update`. Test: `economy.test.ts` "information gathering". |
| Missiles ("Why build one?") | Qualified programme, war, best enemy city VP in range, headline chance × (1 − interception estimate), unit/condition damage vs. ground units bought with the same reference value; trade index = days of coverage of the batch inputs (stock + 3 days net, penalised by market premium and shortages) | Two-phase procurement: proposed → confirmed ≥ 4 h later only if the trade index has not fallen below 60 %; a queued batch is cancelled (full refund) if it falls below 30 %. Seeded example in `economy.test.ts` (Ardenia, seed 77). Launches only at a value ≥ 1.5 points. |

## Anti-oscillation, cooldowns and commitments

* Proposals: key `${counterpart}:${kind}` cooldown 3 days; after a decline 5 days; at most one pending
  offer per counterpart from us; at most 1–2 proposals per diplomatic review.
* Coalition: apply cooldown 2 days (7 days per coalition); leader admits at most one member per 3 days;
  founding cooldown 30 days; leave rules only after a 10-day membership window:
  (a) lost trust in at least half the other members (trust < −15 or grievance ≥ 25), or
  (b) after day 60 our solo fraction of the solo threshold exceeds 60 % and beats the bloc's fraction by 25 %.
  Departure is announced with a coalition message carrying the same reason.
* War: 4-day cooldown between declarations; 15-day truce after peace with the same country; at most one
  war (two for aggression > 0.7); small states must have sought access/coalition/trade twice first.
* Stacks: tasks (`defend` 18 h, `attack` 12 h, `stage` 24 h, naval 1–3 days); a move is never issued to the
  destination the stack is already heading to (repeated no-op = 0 in tests and observer runs).
* Market: stale buys after 2 days / sells after 4 days are cancelled with a 2-day cooldown per
  resource/side; re-listing steps the ask down a 5 % ladder; no routine selling into a glut (≥ 4 ask levels,
  no bids). Priority per review: (1) buy the inputs that blocked a planned investment this review,
  (2) when cash-starved, sell the largest surplus competitively (undercut ≥ 0.6 × reference), (3) cover
  forecast deficits, (4) list surpluses. At most one new order per review and four open orders per bot.
* Proposal IDs: replies reference the engine offer id; answered offers are remembered (bounded list).

## Personality, memory and decay

Profile personality (already seeded ±0.15 by the engine) plus a per-country jitter drawn once from
`ctx.rng` (stored in memory) shapes aggression/expansion/caution/trade. Memory (`AiMemory`, `types.ts`):
plan, objective (+snapshot for triggers), grievances/favours with daily decay, cooldowns, answered
offers (12), handled messages (24), intel requests (6, 3-day TTL), procurement, counters of useful
decisions by command type, stack tasks (pruned when stacks vanish), war start ticks, coalition join time.
Typical size ≈ 1–2 KB per country.

## Difficulty (planning effort only — no resource handicap at any level)

| | easy | normal | hard |
| --- | --- | --- | --- |
| Commands per review (engine `AI_COMMANDS_PER_REVIEW`) | 4 | 8 | 14 |
| Route previews (A*) per operational review | 2 | 4 | 8 |
| Strategic re-plan cadence | 2 days | 1 day | 1 day |
| Forecast lookahead | 24 h | 48 h | 72 h |
| Required local force ratio to attack | 1.6 | 1.3 | 1.15 |
| Immediate replan on wake triggers (war declared, territory change) | no | yes | yes |
| Intel purchases / agents | no | yes | yes |
| Target candidates scored | 3 | 6 | 10 |
| Force concentration (merge before attack) | no | yes | yes |

All countries — including the U.S. when a bot holds it — use the same catalog prices, validator,
research gates and visibility. The difficulty never weakens a seat.

## Developer-only decision log

`getDecisionLog(country)` returns the last 64 decisions (tick, layer, kind, detail, reason, command) from
a module-memory ring buffer. It is never saved, never read by the planner and never shown in the live
campaign UI; the only bot-authored text a player sees is the reply reason of its own offers/messages.
`setDecisionLogging(false)` disables it (observer suite).

## Performance

Measured on the real World 120 map (120 AI seats, observer mode, seed 7, esbuild bundle, Node 22,
this 4-core container, idle machine), averaged over game days 7–9 (≈1,750 stacks):

| Configuration | Total ms / game day | of which planner (`decide`) | AI calls / day | View cost / call |
| --- | ---: | ---: | ---: | ---: |
| Engine only (IdleController) | ≈ 230 | — | 0 | — |
| Engine + empty controller (views only) | ≈ 4,300 | 0 | 2,208 | ≈ 1.9 ms |
| **Current engine + utility planner** | **≈ 5,900** | **≈ 420** (previews ≈ 95) | 2,208 (56 % quiet) | ≈ 1.9 ms |
| + proposed `wants()` hook (request 1, prototyped in a scratch copy) | ≈ 4,200 | ≈ 410 | 982 | ≈ 2.0 ms |
| + lite AI view & market-versioned books (requests 2–3, prototyped) | **≈ 2,470** | ≈ 400 | 977 | ≈ 1.2 ms |

Where the time goes (CPU profile, current engine): ≈ 88 % of the AI phase is `getCountryView`
(public slice + market books rebuilt after cache invalidation ≈ 34 %, `observedNodes` ≈ 10 %,
`forceSummary`/`liftBreakdown`/`maintenanceCapacity` ≈ 16 %, 119 diplomacy rows with lazy trust
≈ 7 %, allied contacts, journal scan); the planner itself is ≈ 8–17 % (economic review ≈ ⅓ of it,
validator previews ≈ ¼, memory deep copy in `setMemory` ≈ 8 %). AI-side measures already taken:
quiet operational calls return without work or memory writes; bounded path previews; market reviews on
alternate economic reviews (orders/day −30 %); construction payback ≤ min(50 % of remaining days, 45 days);
one-pass ownership scan for objectives; lazy hop BFS; static analysis cached per map/catalog.
**The ≤ 1 s/day target is not reachable from src/ai alone**: with zero commands the views alone cost
≈ 4.3 s/day. With requests 1–3 the prototype reaches ≈ 2.5 s/day; requests 4–5 (granular invalidation,
per-step trust/resource rows) are needed for the remaining step to ≈ 1 s.

## Observer suite

`npm run report:observer -- --runs 120 --days 30 --long 4 --long-days 180` (options in the script
header: `--workers` (default 4 `worker_threads`), `--seed0`, `--difficulty`, `--resume` to continue from
the per-run checkpoint `<out>.runs.jsonl`, `--summarize-only`). Writes `docs/reports/observer-summary.md|json`.

**What was run (final code):** 120 seeded campaigns (seeds 1–120) to a **5-day** horizon plus **4 full
180-day** campaigns (seeds 1–4), normal difficulty, 4 workers, 52 min wall on this container (shared CPU).
A 30-day horizon for all 120 seeds would take ≈ 3.5 h here at the current engine cost; it was not run.
`docs/reports/observer-prefix.md|json` keeps the earlier 4 × 180-day cohort (before the
balance-of-power / batch-guard changes) for comparison.

| | 120 × 5 days | 4 × 180 days | 4 × 180 days, before fixes |
| --- | --- | --- | --- |
| Terminal condition | 120/120 horizon reached ("timeout") | 4/4 day-180 settlement, 0 threshold wins | 4/4 day-180 settlement |
| Unilateral victories | — | CHN 3/4 (fractions 0.27, 0.28, 0.26 of the solo threshold) | RUS 3/4 |
| Coalition victories | — | 1/4: ALB+FIN+FRA+POL+USA (0.20 of the 5-member threshold) | 1/4: CHN+ITA+MMR+PAK+PER |
| Strongest / median rival | CHN 0.19 / ECU 0.03 | CHN 0.256 / PRK 0.023 (RUS 0.249, USA 0.240) | RUS 0.26 / BLR 0.02 |
| USA | survives 100 %, median rank 2 | survives 100 %, median rank 2.5, 1 coalition win | survives, median rank 3 |
| Survival by opening-rank quintile | 100 % all | 99 / 93 / 87 / 80 / 57 % | 99 / … |
| Wars / captures per run | 1.3 / 1.2 | 137 / 791 | 145 / 756 |
| Invalid bot commands | **0** | **0** | 2 (fixed: batch-consistency guard) |
| Repeated stalls / no legal opening order | none / none | none / none | none / none |
| Flags | none | noncompetitive peer set (CHN 3 of 4 wins — see below) | same (RUS) |

Findings and fixes: (1) an early 60-day cohort showed small cash-poor states stalling (BHR, CRI, FIN, GUY,
MDA): the market was one-sided, so they could not raise cash → fixed by investment-driven buying and
competitive cash-raising sales (now no stalling nation in any cohort). (2) One aggressive profile (RUS,
aggression 0.63 vs ≤ 0.51 elsewhere) won 3/4 settlements → added balance-of-power rules (a runaway leader
becomes the preferred objective of capable neighbours; a clear leader consolidates instead of
over-extending). The winner moved to CHN with the top three peers within 0.016 of each other in mean
fraction; with only four full runs the "noncompetitive peer set" flag (one country ≥ 70 % of decided runs)
is not statistically meaningful, but it is reported as-is. (3) No campaign reaches a threshold in 180 days:
the solo threshold is 24 % of ≈ 5,050 VP while the largest start holds 4.5 %; all full runs settle by the
day-180 fraction rule. (4) The weakest quintile survives only 57 % of full runs — conquest pressure on
small states is real; they join coalitions (≈ 10 live blocs per run) but blocs rarely defend members
militarily (known gap). (5) A two-run invalid-command check found an offer to a country we had just
declared war on in the same batch → guard added; 0 invalid commands since.

## Engine requests

_Requests 1–9 landed in the engine pass of 2026-11-14 (details: docs/ENGINE.md "AI scheduler" and
"Cache-invalidation contract"; tests: `tests/engine/perf-caches.test.ts`)._

1. ~~**Scheduler pre-check.**~~ **Landed.** `CountryController.wants?(info)` (`info = { country, reviews,
   wake, memory }`, memory = the saved blob, read-only) is called in `invoke` before any view is built;
   false skips the call. `UtilityController.wants = wantsCall` and `controllerWithDifficulty` forward it.
   Measured 2,210 → ≈ 980 views/day.
2. ~~**Lite view for planners.**~~ **Landed** as an opt-in: `CountryController.liteView = true` (set on
   `UtilityController` and `controllerWithDifficulty`) makes the scheduler build `getCountryView(…, { lite:
   true })`: `self.force`, `self.lift`, `self.liftBreakdown`, `observedNodes`, stack `sightKm`/`radarKm` and
   `market.myFills` are zero/empty placeholders and `view.lite === true`; every other field is identical to
   the full view (tested field by field). None of these fields is read in src/ai (grep before relying on
   one; if the planner ever needs them, drop `liteView`). Same seed ⇒ same `stateHash` with or without
   lite (verified on the real map). `BasicController` keeps full views (it reads `force.ready`).
3. ~~**Market books keyed on a market version.**~~ **Landed**: an incremental open-order index (open list,
   orders per country, open counts) updated in place by every order mutation, books cached per market
   version (frozen, shared); matching/previews, the open-order limit and `myOrders` use it.
4. ~~**Granular derived invalidation.**~~ **Landed**: key classes `~` (step) / `@` (forces) / plain; the
   FORCE_NEUTRAL commands (build, mobilize, research, market, offers, agents, intel, messages, …) keep
   `@` keys; the public slice and territory index are memoized across steps by `ownv`; offers, threads,
   journal, books, wars are version-keyed.
5. ~~**Per-step diplomacy rows.**~~ **Landed** as shared indexes read once per view (war sets by `relv`,
   grant map by `grv`, coalition index by `cov`) plus per-viewer trust rows with precomputed pair keys and
   opening values (explicit trust entries read live).
6. ~~**Route flip-flop after peace.**~~ **Fixed**: a stack mid-edge whose way forward AND back are illegal
   settles once on the nearer endpoint (one `route_revoked`, idempotent ⇒ also equal after a reload).
7. ~~**Wake on coordination messages.**~~ **Landed**: `sendMessage` with intent `coordinate` /
   `request_operation` wakes the DM recipient (or every other member of the coalition thread) with tag
   `message:<id>` at the next AI phase.
8. ~~**Structured event payloads.**~~ **Landed** (private `data`, additive): `war_declared` `{ by, target }`,
   `peace` `{ a, b }`, `grant_revoked` `{ from, to, level }`, `city_captured` / `province_captured` /
   `uprising_success` `{ node, city, from, to, cause }`.
9. ~~**Coalition join time / own trust history.**~~ **Landed**: `view.coalitions[].joinedAt` (member →
   tick) and `view.relations[].trustHistory?` = the viewer's own trust changes toward that country as
   `{ at, kind, delta }` (the free-text reason is omitted: it can carry the other side's private wording,
   e.g. a war-declaration reason only the declarer was told).
10. ~~Building `productionMult` semantics~~ — resolved by the engine pass (catalog multiplier semantics,
   `1 + Σ(mult − 1)`); the planner values `*Mult` increments against a base of 1 accordingly.
11. **Market depth.** Bots are the only counterparties; with 119 sellers of common surpluses the books are
   one-sided. The planner creates demand (it buys inputs that blocked a planned investment) and lets
   cash-starved states undercut; a scenario-level importer/exporter of last resort would stabilise prices.
12. **Blockade effect.** Warships parked off an enemy port have no engine effect beyond engaging what comes
   by. A rule such as "a port whose adjacent sea zones hold only hostile warships loses its port trade /
   naval production / sea supply" would make the planner's superiority-gated blockade matter.
13. ~~**Partners' wars in the view.**~~ **Landed**: `view.wars` = every current war as a sorted `[a, b]`
   pair (public, frozen, shared; keyed by `relv`). Original request: Public `war_declared`/`peace` headlines exist (newspaper) but are not in the
   CountryView, so the planner infers that a partner is under attack from foreign formations inside its
   territory or a named foe in its request. A public `wars: [a, b][]` list (or `relations[].atWarWith` for
   coalition partners) would remove false alarms from passage-holders transiting a partner's land.
14. **Coalition co-belligerence.** Combat requires a war between the two owners, so mutual defence means a
   declaration of war by the helper. If the design intends defensive coalition members to fight an attacker
   automatically (or a "defensive war" status with lower trust cost), that is an engine rule; the planner
   would then skip `join_defence`.

## Known gaps

* Ground movement uses `move` previews for routing (bounded per review); `ctx.route` is unused.
* Air: patrols over the threatened city / current attack, rebase toward the front; no escort or
  strike packages. Carriers embark carrier-qualified wings (`carrierCapable`; family rule when a catalog has
  no such flag) and take station off the focus coast at war under sea superiority (×2); no carrier strike planning.
* Naval: escorts embarked formations, blockades the most valuable enemy port within 3,000 km only with sea
  superiority (fleet ≥ attack ratio + 0.2 × observed or prior hostile naval strength within 600 km). The engine has
  no blockade effect yet, so a blockade is positional pressure only (Engine request 12).
* Trade agreements are sized: receive the forecast deficit (net burn × 3–9 days by difficulty lookahead + reserve
  refill), pay with up to two surpluses (stock beyond 3× reserve and the horizon's burn) at reference value +25 %,
  surpluses the public market bids for first; scaled down when our surplus cannot pay. The recipient refuses to give
  beyond its reserve and values a resource it holds in glut at 0.6. Still no multi-round haggling (one offer, accept/decline).
* Peace terms never include territory or resources.
* Mutual defence covers capitals and tier ≥ 3 core cities only; occupied partner provinces are not
  counter-attacked on the partner's behalf (the helper's own offence may still pick the foe's territory). A partner
  under attack by an unidentified (radar-only) force gets presence but no declaration of war.
* With only 4 full-length observer campaigns, win-rate statements are indicative, not statistical.
* Operation requests are matched by a three-letter country code in the message text (UI contract:
  `sendMessage { intent: 'coordinate', text: '... BOR ...' }`); unmatched text is answered with
  "no target we can act on was named".
