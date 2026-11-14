# World Command: World 120

A private, offline, single-player, world-scale grand strategy game. You command one of
**120 countries**; the other **119 are computer players** with their own economies, limited
information, diplomacy and objectives. One campaign, one ruleset: **World 120** — 180 game days,
territorial victory points, solo or coalition victory.

Built with TypeScript, React and Vite. A deterministic simulation engine runs in a Web Worker;
the operations map renders NATO APP-6 E symbology locally via the bundled MIT-licensed
[milsymbol](https://github.com/spatialillusions/milsymbol); geography is Natural Earth (public domain).
No accounts, servers, telemetry or AI services — after `npm install` it runs fully offline.

## Play

Requires Node.js 20+ (Windows, macOS or Linux).

```bash
npm install
```

```bash
npm run play
```

Then open http://127.0.0.1:4173 . (`npm run dev` starts a hot-reloading dev server on http://127.0.0.1:5173.)

## Test

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build && npm run test:e2e
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | The full product specification (source of truth) |
| [AGENTS.md](AGENTS.md) | Rules and commands for AI collaborators (Claude, ChatGPT/Codex) |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current status, file ownership, resume instructions |
| [docs/COVERAGE.md](docs/COVERAGE.md) | Screen → feature → test coverage matrix |
| [docs/ENGINE.md](docs/ENGINE.md) | Simulation API, rules, determinism, save format, performance |
| [docs/AI.md](docs/AI.md) | Computer-country planner |
| [docs/UI.md](docs/UI.md) | Interface architecture, keyboard chart, performance |
| [docs/MAP.md](docs/MAP.md) | Geography pipeline, provenance, territory policy |
| [docs/CATALOG.md](docs/CATALOG.md) | Units, research, buildings, missiles, symbology |
| [docs/PROFILES.md](docs/PROFILES.md) | 120 country profiles and the opening power index |

## Licenses and provenance

Original code and content. Geography: Natural Earth via `world-atlas` (public domain).
Symbol renderer: milsymbol 3.0.5 (MIT, see `public/licenses/`). Conflict of Nations wiki was used
only as a functional reference; no text, art or data from it is included. All unit names and balance
values are fictional.
