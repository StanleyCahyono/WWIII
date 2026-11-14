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
  never over-commits. Result in every test and observer run so far: **0 invalid bot commands**.
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
| Diplomatic | every 12 h (staggered) | `diplomacy.ts` `diplomaticReview` | Peace proposals, coalition apply/found/invite/coordinate/leave, revoke grants, passage and shared-intel proposals, resource trade agreements. |
| Operational | every 2 h + wakes (normal/hard) | `operational.ts` | Defend threatened/under-garrisoned cities (capital first), attack/retake with force-ratio estimates from observed (possibly stale) contacts and intel reports, front concentration (merge), peace-time staging, naval strikes on enemy ports, air patrol/rebase, missile launches, intel purchases/agents and plan updates on findings. |

`turn.ts` holds one invocation (view, ctx, memory, budget copy, reserve, bounded output, path budget);
`analysis.ts` derives territory, frontier, neighbours, hostile contacts, per-city threat/required
garrison and rival power priors (public opening-power composite × public score trend);
`value.ts` prices resource vectors at the published reference prices and estimates unit/contact power;
`geo.ts` is the cached static map analysis; `memory.ts` persistence/decay; `log.ts` the developer log.

**Quiet path.** An operational-only call with no wake, no war, no pending offer/request and no rebel
province returns immediately without touching memory (most peace-time calls).

## Signals per decision (SPEC §4 table → code)

| Decision | Signals used (all from the CountryView or own memory) | Visible consequence / where |
| --- | --- | --- |
| Industrial investment | `self.resources` net/day, forecast, hours-to-depletion (lookahead by difficulty), shortages, city threat (safety), days remaining (payback < 60 % of remaining days), free construction slots (one per city, concurrency cap), building effects (increment over the current level) | Electronics shortage ⇒ electronics-producing building scores ×3, market buy placed first, expensive electronics research and missile procurement delayed (`economic.ts` `construction`, `market`, `techValue`, `tradeIndex`). Test: `economy.test.ts` "electronics shortage". |
| Research and recruitment | Doctrine (preview), facilities (requirements per city), observed opponents (war/threat raises land weight), geography (`geo.ts`: landlocked / maritime / coastal), upkeep headroom (no unit whose upkeep drives any resource below 14 days of stock), force mix targets | Archipelago ⇒ mobility ×1.3, naval ×1.1, lift/embark modifiers +0.8, naval bases/pontoons valued; landlocked ⇒ naval weight 0, sea techs filtered, naval units never mobilized, ships never ordered. Spending goes through the shared validator and the ledger (test reconciles stock). |
| Territorial objectives | Reachable nodes (land hop distance from own territory, sea for coastal states), VP value, power ratio, trust, grievance, border exposure, travel (hops), observation age of the objective | Re-target triggers: lost port, new transit agreement, observation expired (> 2 days without a valid report), objective taken, target eliminated / joined our coalition; otherwise a 2-day commitment window with 20 % hysteresis prevents oscillation (`strategic.ts`). |
| Defense vs expansion | Per-city required garrison (tier/capital prior + 1.25 × observed hostile strength within 320 km), present strength, reserves (stacks not needed as garrison), commitments (stack tasks) | Coalition partner defends its exposed capital and declines a partner's (human's) operation with a concrete reason (`operationRequests` + `defend`). Test: `diplomacy.test.ts`. |
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

See "Observer suite results" for the measured numbers. Planner cost per game day on the real map
(119 bots) is reported by `aiPerf` (wall time inside `decide`, including the validator previews it
requests). The dominant AI-related cost is **outside** the planner: the engine builds a full
`CountryView` for every scheduled call (≈ 0.8 ms each, ≈ 2,400 calls/day) and every accepted command
invalidates the shared public slices. See Engine requests 1–2.

## Observer suite

`npm run report:observer -- --runs 120 --days 30 --long 4 --long-days 180` (see script header; uses 4
`worker_threads`). Writes `docs/reports/observer-summary.md|json`.

## Engine requests

1. **Skip the view for quiet calls.** Add an optional `CountryController.wants?(info: { country, reviews, wake, tick, memory }): boolean`
   (or a lazy `ctx.view()`), so the scheduler does not build a CountryView for calls the planner would
   discard (peace-time operational reviews are ~70 % of calls). This is the single largest AI cost.
2. **Granular derived invalidation.** `submitCommand` invalidates all derived data; with ~1,000 bot
   commands/day the public slice (owners, public cities, scores) and every market book are rebuilt
   repeatedly. Market/diplomacy/research commands should not invalidate ownership/scores; books
   could be maintained incrementally.
3. **Route flip-flop after peace.** A stack on an edge whose both endpoints become illegal (e.g. inside a
   former enemy after peace) is turned back every step (`route_revoked` ≈ 96 events/day for one stack).
   Stop it at the nearer node, or grant a time-limited "withdrawal" passage back to own territory.
4. **Structured event payloads.** `war_declared`, `grant_revoked`, `city_captured` private texts are parsed
   for the actor; please add `data: { by, target }` / `{ from, to }`.
5. **Coalition join time in the view** (`members[].joinedAt`) for transparent leave rules.
6. **Viewer's own trust history** (entries about counterparts) in the view, so replies can cite the
   engine's recorded reasons rather than the AI's own grievance memory.
7. ~~Building `productionMult` semantics~~ — resolved by the engine pass (catalog multiplier semantics,
   `1 + Σ(mult − 1)`); the planner values `*Mult` increments against a base of 1 accordingly.
8. **Market depth.** Bots are the only counterparties; with 119 sellers of common surpluses the books are
   one-sided. The planner now creates demand (it buys inputs that blocked a planned investment) and lets
   cash-starved states undercut, but a scenario-level importer/exporter of last resort would stabilise prices.

## Known gaps

* Ground movement uses `move` previews for routing (bounded per review); `ctx.route` is unused.
* Air: patrols over the threatened city / current attack, rebase toward the front; no escort or
  strike packages; carriers are not managed.
* Naval: only strikes toward enemy ports in war and returns far-off ships home; no blockade logic.
* Trade agreements use fixed 100-unit swaps at reference prices; no multi-round haggling.
* Peace terms never include territory or resources.
* Operation requests are matched by a three-letter country code in the message text (UI contract:
  `sendMessage { intent: 'coordinate', text: '... BOR ...' }`); unmatched text is answered with
  "no target we can act on was named".
