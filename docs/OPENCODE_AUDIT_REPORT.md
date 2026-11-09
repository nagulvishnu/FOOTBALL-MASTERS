# FOOTBALL MASTERS — OpenCode Audit Report

Date: 2026-11-09  
Project: `build-football-masters-game` (Next.js 16.2.6 + React 19.2.6 + three.js 0.187 + Drizzle ORM/PostgreSQL)

## Objective
Audit the existing AI-generated FOOTBALL MASTERS repository, preserve working gameplay where possible, and make it a stable, honestly documented, genuinely playable 3D 7v7 football game with server-authoritative online multiplayer. Verify with builds, unit/integration tests, simulated protocol tests, load tests, and real browser automation.

## Final Status Summary
| Area | Status | Notes |
|---|---|---|
| Build / lint / typecheck | **PASS** | `tsc --noEmit` clean; `eslint .` clean; `npm run build` passes with and without `DATABASE_URL`. |
| Database / migrations | **PASS** | Local PostgreSQL 16.15 installed/used; migrations applied; DB tests pass. Drizzle config made env-driven. |
| Offline gameplay (real browser) | **PASS** | Edge E2E verified offline 7v7 start, player movement, 14 players, pause/resume. |
| Online multiplayer (protocol/simulated) | **PASS** | `scripts/smoke.mjs` all checks passed (2 independent sessions). |
| Online multiplayer (2 real browsers) | **PASS** | `scripts/e2e.mjs` all checks passed: room join, same room visibility, input → authoritative movement seen remotely, raw-tick ball identity, clock sync, disconnect → AI takeover, reconnect → control restored. |
| 14-player capacity | **PASS (simulated) / NOT TESTED (real browsers)** | `scripts/load.mjs` passed with 14 clients, 30.0 Hz, 0 errors. 14 real rendering browsers not tested. |
| AI / vacant-slot filling | **PASS** | Role-aware AI fills empty slots; disconnect triggers immediate AI takeover (verified). |
| Rules / match flow | **PARTIAL** | Core phases, halves, timers, goals, set pieces, fouls/cards/offside/handling implemented and covered by sim/room tests; some real-world edge cases and advanced rules (extra time/shootout/advantage/substitutions/wall) not implemented or not fully browser-verified. |
| UI / controls / menus | **PASS (targeted)** | Menu/lobby/game flow exercised in E2E. Fixed pause pointer-lock UX and clarified misleading "Leave match" labels. Touch/mobile device behavior not tested. |
| Performance | **PARTIAL / NOT TESTED on target hardware** | Server/load metrics good on localhost. 60 FPS not measured on real GPU; headless SwiftShader is not representative. |
| Security basics | **PARTIAL** | scrypt passwords, hashed session tokens, HttpOnly cookies, input validation, rate limits, non-member rejection verified. No formal security audit. |
| Deployment (Vercel frontend + Render backend) | **NOT IMPLEMENTED** | Architecture keeps rooms/SSE in one process. Single Render service is configured (`render.yaml`) and documented; split deployment not implemented. |
| Deployment performed | **NOT PERFORMED** | No external Render/Neon deployment executed. |
| Documentation | **PASS** | Added `docs/OPENCODE_AUDIT_REPORT.md`, `docs/ARCHITECTURE.md`, `docs/TEST_REPORT.md`, `docs/DEPLOYMENT.md`; README updated with honest verification. |

## Audit Findings (initial)
- Architecture was already coherent and honest: shared pure-TS sim, authoritative in-process `RoomManager`, SSE+POST transport, Drizzle/Postgres persistence for finished matches.
- `src/db/index.ts` threw at import when `DATABASE_URL` was missing, breaking `next build` / import-time safety.
- `src/components/GameScreen.tsx` had two `react-hooks` lint errors (`set-state-in-effect` / unsafe patterns around touch init and high-score finalize).
- Pause menu left pointer lock active, making menu clicks unreliable/unusable in real browsers (discovered and fixed).
- `broadcastRoom(room, exceptUser)` sent a redundant duplicate `room` event to the excluded subscriber.
- `drizzle.config.json` hardcoded local credentials; replaced with env-driven `drizzle.config.ts`.
- Browser favicon was missing (`/favicon.ico`/icon route absent), causing 404 console noise.
- Vercel/Render split requested by the prompt is incompatible with the current in-process room/SSE design; rewriting to Colyseus/WS would be a large migration and was not chosen because the existing multiplayer path became verifiably functional.

## Fixes Implemented
| File(s) | Change | Reason |
|---|---|---|
| `src/db/index.ts` | Lazy pool/drizzle proxies; clear error on first DB use; no throw at import. | Allow build/start/offline paths without credentials; keep API explicit for DB features. |
| `src/server/http.ts` | Map missing DB config to `503 DB_UNAVAILABLE` with clear message. | Honest, actionable runtime failure. |
| `src/components/GameScreen.tsx` | Fixed lint; safe touch init; finalize high score in `onFinished`; release pointer lock on pause/finish; clarified online labels. | Lint/build correctness and real-browser usability. |
| `src/game/client/input.ts` | Added `releaseLock()`. | Pause/menu clickability and UX. |
| `src/game/client/engine.ts` | Added read-only `debugState()` hook. | Enable deterministic browser E2E assertions without affecting gameplay. |
| `src/server/rooms.ts` | Removed redundant extra `room` send for excluded subscriber. | Minor correctness/perf cleanup. |
| `src/app/icon.svg` | Added app icon route asset. | Removes 404 favicon noise. |
| `drizzle.config.ts` / removed `drizzle.config.json` | Env-driven config via `dotenv/config`; requires `DATABASE_URL`. | No hardcoded credentials. |
| `next.config.ts` | Pinned Turbopack root to `process.cwd()`. | Avoid workspace-root inference warning in nested folders. |
| `scripts/e2e.mjs` | New two-real-browser E2E + offline checks. | Meets "test with real browsers" requirement as far as locally automated. |
| `scripts/load.mjs` | Added explicit status/error checks. | More reliable load harness diagnostics. |
| `package.json` | Added `test` and `test:e2e` scripts; added `playwright-core` dev dependency. | Repeatable verification. |
| `tests/db.test.ts`, `rooms.test.ts`, `sim.test.ts` | Read/reused existing suites (no behavior changes required). | Regression coverage already present. |
| `README.md`, `docs/*` | Updated/added honest docs and exact commands. | Traceability and deployment clarity. |

## Current Verification Results
- `npx tsc --noEmit`: **PASS**
- `npx eslint .`: **PASS**
- `npm run build` (with `.env`): **PASS**
- `npm run build` (without `DATABASE_URL`): **PASS**
- `npx vitest run`: **PASS** (3 files, 34 tests)
- `node scripts/smoke.mjs` (running prod server): **PASS** (21 checks)
- `node scripts/load.mjs` (`SECONDS=15`): **PASS** — 14 clients, 15.0s, **30.0 Hz avg/client**, **5164 input requests, 0 errors**, latency **p50 9.7 ms / p95 45.0 ms / p99 61.7 ms**, downstream **17.2 KiB/s/client**, room playing with 14 humans
- `node scripts/e2e.mjs` (real Edge contexts): **PASS** — **ALL CHECKS PASSED** (23 checks). Included online room sync, raw-tick ball identity, disconnect/reconnect, offline 7v7, pause pointer-lock release/resume.

## Requirement Status (honest)
| Requirement | Status | Evidence / note |
|---|---|---|
| Repo audit and preservation of working parts | PASS | Read code, docs, tests, scripts; targeted fixes only. |
| Stable build | PASS | Build passes with/without DB env; lint/ts clean. |
| Server-authoritative multiplayer core | PASS | RoomManager owns sim; clients send inputs; smoke/e2e verify authority/sync. |
| Two real browser sessions can join and play together | PASS | `scripts/e2e.mjs` with isolated Edge contexts. |
| Visible movement/ball/timer sync between players | PASS | Movement seen remotely; same server tick ball identical; clocks agree. |
| Disconnect/reconnect behavior | PASS | AI takeover and reconnect/regain control verified. |
| 14-player capacity / full match | PARTIAL | 14 simulated clients pass; 14 real browsers not tested. |
| AI fills empty positions | PASS | Roster shows 14 players with 2 humans in smoke/e2e; AI takeover verified. |
| Rules (kickoff, goals, out-of-bounds, fouls/cards basics) | PARTIAL | Implemented and tested in sim/rooms; not exhaustively proven in all real-browser edge cases. |
| UI/menus/controls work | PASS (targeted) / PARTIAL (device coverage) | E2E covers key flows; touch hardware/mobile not tested. |
| Performance target 60 FPS | NOT TESTED | No representative GPU profiling. |
| PostgreSQL persistence for relevant data | PASS | Migrations + DB tests + finished-match persistence path present. |
| No fake multiplayer / no hardcoded secrets | PASS | Real SSE/POST rooms; env-driven DB config. |
| Vercel frontend + Render backend deployment split | NOT IMPLEMENTED | Incompatible with current architecture; single Render service documented. |
| Deployment performed | NOT PERFORMED | External accounts not used. |
| Test/deployment/audit docs | PASS | `docs/` added; README updated. |

## Remaining Blockers / Risks
- **Deployment split requirement:** implementing true Vercel frontend + Render backend would require extracting a standalone realtime backend and reworking auth/CORS/URLs/transport; high risk to current working multiplayer.
- **Real-device rendering/perf:** three.js visuals, FPS, mobile touch, and browser compatibility need manual playtesting on target hardware.
- **Scale:** in-memory single-process rooms cannot horizontally scale; process restart drops active rooms.
- **Rule completeness:** extra time, penalty shootout, substitutions, advantage, and full edge-case officiating are incomplete.

## Exact Local Run Commands
```powershell
# from project root
npm install
Copy-Item .env.example .env          # if .env missing; set DATABASE_URL
npx drizzle-kit migrate
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build

# start production server
npm start                            # http://localhost:3000

# verification (while server runs)
node scripts/smoke.mjs
$env:SECONDS='15'; node scripts/load.mjs
node scripts/e2e.mjs                 # requires local Edge/Chrome; uses playwright-core
```

## Final Recommendation
Treat the game as **locally verified and playable** for offline and 2-player online flows, with **14-player capacity verified by simulated clients**. Deploy as a **single Render Node service** with Postgres (Neon) using `render.yaml`. Do **not** claim Vercel/Render split support until a separate realtime backend is implemented. Before a public release, run manual device/browser playtests (rendering, FPS, touch, camera feel, AI balance) and consider extracting the room server if multi-instance scaling is required.
