# AGENTS.md — rules for every AI collaborator (Claude agents, ChatGPT/Codex)

This repository builds **World Command: World 120**, a private, offline, single-player
grand strategy game. The authoritative requirements are in [`docs/SPEC.md`](docs/SPEC.md).
Current status, ownership and resume instructions are in [`docs/HANDOFF.md`](docs/HANDOFF.md).
Feature coverage lives in [`docs/COVERAGE.md`](docs/COVERAGE.md).

## Commands (Windows-friendly; all run from the repo root)

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev server (loopback) | `npm run dev` → http://127.0.0.1:5173 |
| Production build + offline play | `npm run play` → http://127.0.0.1:4173 |
| Unit/integration tests | `npm test` |
| Type check | `npm run typecheck` |
| End-to-end (Playwright) | `npm run build && npm run test:e2e` |
| Regenerate map data | `npm run map:build` |
| Opening power table | `npm run report:power` |
| Observer balance suite | `npm run report:observer` |
| Symbol gallery | `npm run gallery` |

## Architecture contracts

- `src/engine/` — deterministic simulation. **No React, no DOM, no `Date.now()`, no `Math.random()`.**
  Integer time (game minutes), seeded RNG streams, fixed-point resources, one command validator
  shared by the human and every AI country. Must run inside a Web Worker and in Node (tests).
- `src/engine/data-types.ts` — static data contract. Additive changes only unless every consumer is updated.
- `src/data/` — authored and generated scenario data (map, catalog, 120 country profiles).
- `src/ai/` — local rules/utility planner. Consumes only the filtered `CountryView`, never raw state.
- `src/ui/` — React UI. Talks to the engine through the sim host (worker) API only.
- `scripts/` — data pipelines and reports. `tests/` — Vitest. `e2e/` — Playwright.

## Non-negotiables

1. Exactly 120 seats, one human controller, 119 AI controllers. One campaign: World 120.
2. No network access at runtime: no remote fonts, images, APIs, telemetry or LLM calls.
3. Hidden information must never leak through UI labels, search, tooltips, logs, AI inputs or news.
4. Every button that says Build/Apply/Trade/Send/etc. goes through the validated command path.
5. Determinism: same seed + same command history ⇒ identical state at any speed.
6. Original names, art and copy. Unit names are fictional. Balance numbers are fictional.
7. Run `npm run typecheck && npm test` before handing off. Report real results.
