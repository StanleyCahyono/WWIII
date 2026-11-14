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

## Visual design (redesign 2026-11-14)

Original identity “Ink & Signal”: graphite ink surfaces, a signal-amber command accent
(`--accent`), a cyan own-nation highlight (`--own`), condensed uppercase display type from the
local system stack (`--font-display`: Bahnschrift / DIN / Roboto Condensed / Arial Narrow — no
web fonts). Layout and ease-of-use follow genre conventions only; no third-party art, icons,
names or copy.

* **Tokens** — `src/ui/theme.css` (imported before `styles.css`): surfaces `--bg --bg-2 --panel
  --panel-2 --panel-3 --glass`, lines `--line --line-2`, text `--text --text-2 --text-3`, signals
  `--accent --accent-2 --on-accent --info --own --own-glow --ok --warn --bad --select --focus`,
  resource tints `--ic-<resource>`, unit tint `--ic-unit`, shape `--radius --radius-lg
  --radius-pill --shadow --shadow-sm`, layout `--top-h --hud-w --tab-w --insp-w`. Light theme
  overrides the same names (`:root[data-theme='light']`). Panel stylesheets use only these names.
* **Icons** — `src/ui/icons.tsx`, original inline SVG on a 24×24 artboard. API:
  `<Icon name size? title? className? />` (decorative unless `title`), `IconName` union,
  `RESOURCE_ICON[resource]`, `familyIcon(unitFamily)`, `<UnitArt family size color? />` (large
  class silhouette on a land/sea/air plate). Resource icons (crate, gear, fuel can, chip, crystal,
  helmet, banknote) and the 13 unit-class silhouettes are filled and tinted by `--ic-*`; UI and
  action glyphs are stroked in `currentColor`. `components/common.tsx` re-exports `Icon`.
* **Flags** — one shared `Flag` component (`common.tsx`; `NationBadge` and `FlagChip` wrap it)
  draws simplified national flags from `src/ui/data/flags.ts`: real colours, horizontal/vertical
  bands, Nordic/centred crosses, hoist triangles, quarters, diagonals and a few cheap emblems
  (disc, ring, star, crescent, diamond, union canton). Codes without an entry fall back to a coded
  chip. `FlagChip` keeps the country code as visually hidden text. Used in the nation card, the
  nation list, the inspector and diplomacy/score rows.
* **Population** in the place inspector is stored in thousands and shown as “950k” / “10.6M”.
* **Desktop HUD** (`screens/Game.tsx`): the map fills everything under the 52 px top bar.
  - Top bar: brand mark, resource pills (icon, spendable stock, signed net `/d` in green/red, a ▾
    ledger toggle when short/negative), a **Show market** pull-tab (`rail-market`), time controls
    (round play/pause, segmented 1×…64× speeds = group “Game speed”, step hour, next event, real-time
    rate), save indicator, help, menu.
  - Nation card (top-left, `CountryCard`): badge + name (`nation-chip` → campaign info), DAY / TIME
    (`game-clock`; text stays “D1 07:00”, the captions are CSS), victory progress bar
    (`score-button`), five square quick actions with badges: News, Research (active programs),
    Diplomacy (offers awaiting an answer), Coalition, Events (journal, unread count since last
    opened). Ids `rail-news|research|diplomacy|coalition|journal`.
  - Side tabs (left edge, vertical labels): Forces, Cities, Economy, Intel, Plans, Roster
    (`rail-forces|cities|economy|intel|planning`, button “Roster”). The roster opens under the
    nation card. Drawers open to the right of the HUD column (`--drawer-left`), so every
    destination stays clickable while a panel is open.
  - Map controls: search pill top-right; round buttons bottom-right (zoom, recenter, layers/display
    settings, legend, fullscreen); scale bottom-left; toasts top-right under the search; timeline
    pill at the bottom.
  - Selection: a formation opens the **unit card** docked at the bottom (`Inspector dock` →
    `StackSheet layout="dock"`): big order buttons above it (Move/Attack or Patrol/Rebase, Stop,
    Delay, Embark/Disembark, Retreat, Launch, Split, Merge, Refit — the same validated dialogs and
    `exec` path as before), class illustration with APP-6 symbol and unit count, name + owner, HP
    bar, ATK/DEF/SPD/HP/RDY/EFF tiles (aggregates of the player's own units), position, fire
    control, full details, present activity and a units list with dossier links. The card is
    capped in height so a formation centred on the map stays above it. Toasts are click-through
    (only their buttons take clicks) and slide under an open drawer. Cities, provinces, contacts,
    reports and multi-selections keep the right inspector column (320–380 px).
* **Map look** (`map/renderer.ts`, `map/palette.ts`): other countries are muted (low saturation);
  the player's provinces are bright cyan with an outer glow + rim drawn from one fill of the
  province union (political fill). Country names are condensed caps with letter-spacing (own
  nation larger, highlighted); city labels carry the fixed public tier, e.g. “Jakarta (5)”, at
  regional/local zoom. Stack counts are pills tinted by affiliation (outside the symbol frame).
  **Unit markers** (Layers → “Unit markers”, per device, `localStorage wc.unitStyle.v1`): APP-6
  military symbols (default, required by the spec) or game counters — an affiliation-shaped plate
  (friend rounded, hostile hexagon, neutral square, unknown pill; dashed when planned) with the
  class glyph derived from the same viewer-safe `symbolKey` (radar contacts show “?” and an
  unknown count “?”).
* **Phones** (≤760 px): compact top bar (badge, clock, play, speed select, step, score, resource
  toggle, save, menu), icon destination bar, bottom sheet with the same unit card content in a
  vertical layout.

## Panels (redesign 2026-11-14)

Original visual language for every drawer panel: cards, inline-SVG icons, clear primary actions,
secondary detail behind expanders. Files: `src/ui/panels/panels.css` (all panel CSS, theme tokens
only — dark / light / monochrome follow the shell), `src/ui/panels/panelKit.tsx` (shared pieces:
`Cost`/`ResChip` resource chips with icons and a "!" mark for what the treasury cannot pay now,
`Duration`, `Progress`, `StatTile`, `Expander` (native details/summary), `IconTabs` (role=tablist
with roving focus: one Tab stop, ←/→/Home/End), `SectionHead`, `topOutputs`),
`src/ui/panels/panelIcons.tsx` (building glyphs, morale faces, lock/info/rally/gear marks, tier
skyline badge, unit-class tab table `UNIT_CLASSES` + `unitClassOf`, `UnitPlate`/`BuildingPlate`
illustration plates). Resource and unit-class glyphs come from the shared `src/ui/icons.tsx`.
Layout responds to the panel's own width (CSS container queries on `.p-root`), so an open
inspector or a phone gets the stacked layouts automatically.

| Panel | Layout |
| --- | --- |
| Cities › City list | Tabs *City list* / *Build queue*. Daily output of all cities as icon chips. Rows: tick box, size (tier skyline + capital/port marks), city link + status pill + VP/pop, morale face + bar + target, production chips (top 3 by value, +N) and value/day, building badges (icon + level, dashed when damaged), queue count, quick **Build / Mobilize / Rally** (rally opens a picker; Mobilize disabled with reason when occupied). Bulk project select + **Preview order** unchanged (same validated preview/confirm). Below 600 px rows become cards. |
| Cities › Build queue | Every job of the nation as a card: art, kind + name (planned units keep the APP-6 planned symbol), city, working/queued/blocked pill, progress, completion time, charged cost, **Cancel…** (refund preview). |
| City window | Header (back, tier, name, pills, prev/next). Hero: top 4 outputs, morale face/bar/target (uprising risk pill), VP, population, condition. Three slots: *Currently constructing*, *Currently mobilizing*, *Next in queue* (with progress). Icon tab bar: Overview, Buildings, All units, one tab per unit class (infantry, armour & scouts, artillery & support, air defence, helicopters, fighters & drones, bombers & heavy air, ships, submarines — the last two only at coastal cities —, missiles, officers & special), Queue. Catalog rows: illustration, name + level, quick stats or description, cost chips, duration + start time/queue position, **ⓘ** (building: per-level effects and upkeep; unit: dossier), big **Start** (`build-<id>` / `mobilize-<id>`, disabled with the validator's reason). Overview: profile, morale breakdown (signed bars), administration (annex, rally), building cards (effects, condition bar, demolish with preview), production chips + base/net table in an expander. |
| Research | Tabs: All, the eleven unit classes, Doctrine, Industry, Mobility (badge = startable count). Each unit is a line (illustration, name, "Level n of m") with level nodes as diamonds joined by arrows: green ✓ researched (standard-issue L1 shown as "Std"), highlighted = ready, ring fill = researching %, dashed + lock = locked with the day it opens ("Prereq." once only prerequisites block). Same-stem non-unit technologies chain (I → II → III, blueprint → qualified); lone ones are cards. A technology shared by two units appears in both lines (only the first carries `tech-<id>`). Right sidebar: *Currently researching* (every slot, free or busy with progress and ETA) and *Selected research* (status, day available, duration, cost chips, prerequisites ✓/lock, unlocks with art, current-vs-next table, eligible cities, big **Start research** / **Cancel research…** with refund preview). |
| Diplomacy | Tiles (at war, pending offers, agreements); search + filter chips; nation rows (flag, controller, neighbour/coalition, both directions as status glyphs, trust bar on −100…+100, pending badge). Detail: header (war tint), *You grant* ⇄ *They grant* cards, trust, primary **Send request / offer…**, Revoke, **Declare war…** (preview), explanation in an expander, offer cards (direction, status pill, gives ⇄ asks, Accept/Decline/Counter/Withdraw), chat-style private thread. |
| Coalition | Status banner, coalition table (emblem, slot dots), detail with key facts as tiles (`dt`/`dd` pairs kept), member table, applications, chat-style coalition thread. |
| Economy / Market | Advisor report card; seven resource tiles (stock, ▲/▼ net/day, 24/72 h) that open the by-city ledger; full balance table and ledger table in expanders; reconciliation line always visible. Market: header with good icon and last trade, icon tabs (Best / All / My trades), sell/bid books, sticky order form with a Buy/Sell segmented control. |
| Forces / dossier | Stat tiles (fielded, ready with share bar, committed, maintenance), domain cards, formations table with readiness bars; dossier header with the unit illustration. |
| Journal / News / Score / Intel | Journal: icon tabs, category chips with icons, sticky day headings, event rows as cards. News: masthead, article cards, dispatch grid, nation index. Score: tiles with a progress bar to the threshold, area sparkline, standings with fraction bars. Intel: tiles (active agents, reports, next report), cards and tables. |

Contracts kept for tests and accessibility: every `data-testid` used by `e2e/**`, the tab roles and
names (`city-tab-overview|build|mobilize|queue`; new `city-tab-unit-<class>`, `rtab-<key>`), the
`button.tech[data-status]` nodes, table structures the specs query (bulk rows, build catalog rows,
standings, open orders, coalition rows, journal `li`/`.tag`). No new data reaches the UI: panels
read only the filtered `CountryView` and worker queries, and every action still goes through
`exec()` / previews. Not restyled yet: the order dialogs in `components/{Orders,MoveOrder,Planning,
Briefing,Features}.tsx` (they inherit the shell's modal styling).

## Screens → components

| Screen / requirement | Component |
| --- | --- |
| Title (Continue card: nation, day, difficulty, score, last save) | `screens/Title.tsx` |
| Choose your country (nation list with badges + size class, hover-to-identify world map, “Selected nation” banner, 6 region filters 22/34/18/22/21/3, Indonesia featured, preview incl. opening power, difficulty, seed, Back / Random nation / Start) | `screens/ChooseCountry.tsx` |
| Load Campaign (active/archived/recovery, resume/archive/restore/delete, export/import) | `screens/LoadCampaign.tsx` |
| Settings, Credits (milsymbol MIT, Natural Earth PD), Diagnostics (versions, last save, copyable report) | `screens/Menus.tsx` |
| Game layout (resource/time top bar, full-bleed map stage, nation card + side tabs, roster, docked unit card, right inspector for places/contacts, time strip; mobile sheet/nav) | `screens/Game.tsx`, `components/{TopBar,ResourceStrip,LeftRail,Inspector,TimeStrip}.tsx` |
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
| Helicopter air assault (Forces › formation row › **Air assault…** for formations with helicopter lift: landing-zone picker or map pick, previewed distance vs range, load vs seats, landing time, fuel, interception-risk estimate from own observations, act-of-war confirmation; "Air-mobile hop to …, lands …" activity while airborne) | `components/Features.tsx` (`AirmobileDialog`), `panels/Forces.tsx` |
| Blockade report (Economy: own blockaded ports with since/effect/how to lift — blockaders never named; enemy ports our warships blockade) — journal rows come from the engine events `blockade_started` / `blockade_lifted` | `components/Features.tsx` (`BlockadeReport`), `panels/Economy.tsx` |
| Peace settlements: composer territory clauses at war ("<them> cedes" / "I cede", own capital never offered), offer cards show cessions and the negotiation round, **Counter…** on a received offer opens the composer pre-filled with the mirrored terms (disabled in the final round) | `panels/Diplomacy.tsx` |

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
| `e2e/features.spec.ts` | Engine features pass (desktop, `?e2e=1` hook `debugFeature`): helicopter air assault from Forces (picker → preview with range/fuel/risk → airborne activity → lands → turnaround refusal); blockade (enemy warship off an Indonesian port → Economy blockade report names the port, never the blockader; journal text); peace offer with a territory clause composed in Diplomacy and shown as "cession of …" |
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

Also used (engine features pass): command `airmobile`, `proposeOffer.territory` / `counterTo`,
`Offer.territory/round/counterOf`, `CountryView.blockades`; test hook `debugFeature` (adapter uses
`newUnit`/`spawnStack`/`portIndex`, `?e2e=1` only).

Also used (since the release audit): `CountryView.observedNodes` (visibility fill),
`StackView.sightKm/radarKm` (sensor-coverage layer), `threadFor` (the adapter adds
`view.threadKeys[counterpart]`, which the Diplomacy thread uses).

Remaining gaps (worked around; nice to have in the engine):
1. `CountryView.uiPrefs`/`drawings` are read by the worker from `state.ui` directly.
2. Bulk preview rows for rural targets need a public name (they use the node name).
3. No exported helper for the coalition thread key (`co:<id>` is built in `Diplomacy.tsx`).

## Known gaps / resume notes

* Features pass: the air-assault order is reachable from the Forces panel only (the inspector and
  city sheet were being edited by another agent; add an inspector action when convenient). The
  composer mirrors `rules.PEACE.maxRounds` = 4 locally (frames omit `rules`); the validator enforces it.
  `eventText.termPhrase` does not know territory clauses (they are a separate offer field, so toasts
  describing an offer omit cessions; the offer card and the engine journal text include them).

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
