# Handoff — World Command: World 120

_Last updated by: Claude (orchestrator)._ Keep this file current; it is how a new collaborator
(e.g. ChatGPT/Codex) resumes without access to prior chats.

## Milestones (SPEC §6)

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Scaffold, contracts, handoff | done |
| 2 | Deterministic engine + test fixture, end-to-end slice | in progress |
| 3 | Global map, nation selection, scoring, economy, travel graph | in progress |
| 4 | Management screens, research, domains, combat, visibility, diplomacy, market, intel, missiles | pending |
| 5 | Normal/accelerated campaigns, performance & balance | pending |
| 6 | Release audit, coverage matrix | pending |

## File ownership (parallel work — do not edit another owner's files without coordinating)

| Area | Paths | Owner |
| --- | --- | --- |
| Static data contract | `src/engine/data-types.ts` | orchestrator (additive edits allowed, note them below) |
| Engine | `src/engine/**`, `tests/engine/**`, `tests/fixtures/**` | engine agent |
| Map pipeline | `scripts/build-map.ts`, `scripts/map/**`, `src/data/generated/**`, `src/data/cities.ts`, `src/data/territory-manifest.ts`, `tests/map/**` | map agent |
| Catalog | `src/data/catalog/**`, `scripts/symbol-gallery.ts`, `tests/catalog/**` | catalog agent |
| Country profiles & balance | `src/data/profiles/**`, `scripts/opening-power-report.ts`, `tests/profiles/**` | profiles agent (phase 2) |
| AI | `src/ai/**`, `tests/ai/**` | AI agent (phase 2) |
| UI | `src/ui/**`, `src/main.tsx`, `e2e/**`, `public/**` | UI agent (phase 2) |

## Contract change log

- catalog agent: `UnitType.carrierCapable?: boolean`, `UnitType.liftCapacity?: number` (additive).
- Level-tech IDs follow `<unitId>_l<N>` (exceptions: transport L2/L3 = `mob_strategic_airlift_2/3`, cruise launcher L2 = `str_cruise_missile_2`). Building level effects are totals, not increments.
