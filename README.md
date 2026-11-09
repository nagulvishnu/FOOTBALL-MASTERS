# FOOTBALL MASTERS

Browser-based 3D **7 vs 7** football. Every human controls exactly one footballer from a fixed position, with an
**independent third-person camera**. AI fills every vacant position. Online rooms are **server-authoritative**.

* Offline: **Play now** (7v7 vs AI), **Match setup**, **Practice** (shooting / passing / dribbling / goalkeeper / free), local high-score table.
* Online: private rooms (code + invitation link), Friends vs Friends, Co-op vs AI, Quick Match (matchmaking queue), public room discovery.
* Desktop (keyboard + mouse look) and touch (virtual joystick + buttons, drag-to-look).

## Stack and architecture

| Layer | Implementation |
|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + three.js (no engine wrapper), Tailwind + hand-written theme CSS |
| Shared game core | `src/game/shared` (constants, types, movement) and `src/game/sim` (ball physics, rules, AI, drills) – pure TypeScript, no DOM |
| Realtime server | `src/server/rooms.ts` – framework independent room manager running the authoritative sim at 30 Hz |
| Transport | **SSE (server → client snapshots) + HTTPS POST (client → server inputs)**, see decision below |
| API | Next route handlers in `src/app/api/*` (auth, profile, settings, stats, matches, friends, rooms, matchmaking, health) |
| Database | PostgreSQL via Drizzle ORM (`src/db/schema.ts`, migrations in `drizzle/`) |

### Important architecture decision (read this)

The brief prefers Colyseus/WebSockets on a separate Render service. This repository **does not use Colyseus**.
The preview platform for this build runs a single Next.js Node process, so the authoritative match server lives in
that process (`globalThis`-scoped `RoomManager`) and talks to browsers through **Server-Sent Events + POST**.
Consequences, stated honestly:

* The simulation, rules, AI and room logic have **no Next.js dependency** (`src/game/*`, `src/server/rooms.ts`).
  They can be moved into a standalone Node/Colyseus process by writing a thin transport adapter; the 18 room tests
  exercise the manager directly and would carry over.
* Rooms are held **in memory in one process**. Deploy the app as **one long-running Node web service** (Render, Fly, a VPS).
  It cannot run on Vercel serverless (no shared memory / long-lived streams across invocations) and cannot be scaled to
  multiple instances without sticky routing or moving rooms into a dedicated service.
* The frontend uses same-origin relative URLs. A Vercel-frontend + Render-backend split (CORS + `NEXT_PUBLIC_API_URL`) is **not implemented**.
* Inputs are POSTed (one request in flight, ordered, rate limited), not sent over a socket. On localhost this adds ~3 ms (p50).

### Netcode
* Server owns player positions, ball, stamina, clock, score, fouls/cards, set pieces, ownership. Clients send **inputs only**
  (`mx, mz, sprint, acts[]` + sequence numbers); the server clamps/validates, rate-limits (90 tokens/s) and ignores stale sequence numbers.
* 30 Hz authoritative ticks, compact tuple snapshots (~600 B) broadcast every tick; clients render at display rate with 100 ms
  interpolation delay, and **predict only their own movement** (shared `stepMovement`) with smooth reconciliation. The ball is never predicted.
* Reconnect: the same user re-subscribing to a started match gets a room view + latest snapshot and **regains the original position**;
  while disconnected the AI plays that slot immediately. Opening a second tab replaces the older connection (duplicate-session prevention).
* Only **finished** matches are written to PostgreSQL (transaction: `match_history`, `match_players`, `player_statistics`).

## Controls (rebindable in the pause menu)

W A S D move · Mouse camera · Shift sprint · J short pass · K through pass · Space shoot (hold = power) · L cross/lofted ·
E tackle (slide while sprinting; GK dive) · Q call support · F jump · C tactical camera · Esc pause · R instant restart (offline).
Touch: left thumb joystick, right-side drag to look, on-screen SHOOT/PASS/THRU/LOB/TACK/RUN/CALL buttons.

## Setup

```bash
npm install
cp .env.example .env            # set DATABASE_URL
npx drizzle-kit migrate         # applies drizzle/*.sql   (or: npx drizzle-kit push)
npm run dev                     # http://localhost:3000
```

### Commands
| Task | Command |
|---|---|
| Type check | `npx tsc --noEmit` (or `npm run typecheck`) |
| Lint | `npx eslint .` (or `npm run lint`) |
| Unit/integration tests (needs the DB) | `npx vitest run` (or `npm test`) |
| Production build | `npm run build` then `npm start` |
| Two-session multiplayer smoke test | `node scripts/smoke.mjs` (set `BASE` if not localhost:3000) |
| 14-client load test | `node scripts/load.mjs` (PowerShell: `$env:SECONDS='15'; node scripts/load.mjs`) |
| Two real-browser E2E (needs local Edge/Chrome) | `node scripts/e2e.mjs` (or `npm run test:e2e`) |
| Generate a migration after schema edits | `npx drizzle-kit generate --name <name>` |
| Local migration | `npx drizzle-kit migrate` (reads `.env` via `drizzle.config.ts`) |
| Production migration | `DATABASE_URL=... npx drizzle-kit migrate --config drizzle.config.prod.ts` |

## Deployment (prepared, not performed)

Target architecture: **Players' browsers → Render (Next.js + authoritative multiplayer server) → Neon PostgreSQL**. Deploy as a **single long-running Render Web Service** (`numInstances: 1`); do not split frontend/backend and do not scale instances until shared room state exists.

1. **Neon**: create a project, copy the **pooled** `DATABASE_URL` (append `?sslmode=require`).
2. **Render**: New → Blueprint → select this repo (`render.yaml`).
3. Set **secret** `DATABASE_URL` in Render. Keep `NODE_ENV=production`, `PG_POOL_MAX=10` (optional). **Never set `COOKIE_INSECURE` in production** (session cookies are always Secure in production).
4. Render build/predeploy/start/health: `npm ci && npm run build` → `npx drizzle-kit migrate --config drizzle.config.prod.ts` → `npm start` → `/api/health`.
5. Open the live URL and test with two browsers/devices.

Full steps and troubleshooting: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). `.env.example` contains placeholders only.

## Game content
* **Pitch**: 105 × 68 m, goals 7.32 × 2.44 m, centre circle 9.15 m, 16.5 m / 5.5 m boxes, penalty spots at 11 m + arcs, corner arcs + flags,
  technical areas and substitution zone markings, striped mow pattern; 1 world unit = 1 m. Posts, crossbar and nets collide.
* **Stadiums**: International Arena, Classic, Neon (pulsing), Tropical (palms), Championship. Instanced animated crowd, canopy roofs, 4 floodlight
  towers (real spot lights at evening/night), canvas scoreboards, ad boards, tunnel, benches; day / evening / night; clear / cloudy / rain.
  Graphics presets Low / Medium / High (crowd density, shadows, pixel ratio, texture size, rain count).
* **Characters**: procedural rigged footballers (male/female, 6 hairstyles, 6 hair colours, 6 skin tones, kits with solid/stripes/hoops/sash, GK kit,
  numbers, boots). Animation is **procedural pose blending** (locomotion cycle, strafe, lean, turn, kick variants, header, jump, slide, tackle, fall, get-up,
  celebration, GK dive/catch/kick), not authored clips. The builder is isolated (`characters.ts`) so a glTF rig can replace it.
* **Rules**: kickoff, halves, halftime, stoppage time, goals (server-validated once), throw-ins, goal kicks, corners, free kicks, penalties, fouls,
  yellow/red cards, offside, goalkeeper handling, set-piece distances. **Not implemented**: extra time/penalty shoot-outs, advantage rule, substitutions, wall.
* **AI**: role-aware (GK/defenders/midfielders/forwards), formation anchors shifted by ball + tactic, marking, interception prediction, pass/shot/dribble
  decisions, GK positioning/diving, 5 difficulty levels, 5 tactics (balanced / attacking / defensive / high pressing / counterattack).

## Verification report (honest)

Run locally on 2026-11-09 (Windows, Node 24, PostgreSQL 16, production Next server, Edge via `playwright-core`):

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint .`, `npm run build` (with `.env`) | pass |
| `npm run build` with `DATABASE_URL` absent | pass (lazy DB init; DB-backed routes return `503 DB_UNAVAILABLE`) |
| Vitest (`npx vitest run`): 34 tests across `tests/sim.test.ts`, `tests/rooms.test.ts`, `tests/db.test.ts` | pass |
| `scripts/smoke.mjs` – two independent guest sessions against the production build | pass (21 checks): join by code, teams/positions, ready/start, lock, A's input moves A and B sees it, ball/score sync, disconnect → AI takeover, reconnect → same position/control, duplicate session replaced, non-member rejected |
| `scripts/load.mjs` – **14 simulated clients** (7v7), localhost, 15 s | pass: 30.0 Hz snapshots/client, 5164 input requests, 0 errors, input latency p50 9.7 ms / p95 45.0 ms / p99 61.7 ms, ~17.2 KiB/s downstream per client |
| `scripts/e2e.mjs` – **two real browser sessions** (isolated Edge contexts) + offline check | pass (23 checks): room create/join, start, both reach match, movement seen remotely, identical raw-tick ball state, clock/ping sync, AI takeover on disconnect, reconnect via invitation link restores control, offline 7v7 runs/moves/pauses, pointer lock released for pause menu |

Detailed docs: [`docs/OPENCODE_AUDIT_REPORT.md`](docs/OPENCODE_AUDIT_REPORT.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**Not verified / known limitations**
* **14 real rendering browsers** were not tested (14 simulated protocol clients + 2 real browsers were). Localhost load numbers do not represent WAN latency/jitter.
* **60 FPS on target hardware** was not profiled. Headless SwiftShader is not representative of desktop/mobile GPU performance.
* **Touch/mobile devices** were not physically tested (touch controls exist).
* **Deployment split (Vercel frontend + Render backend)** is **not implemented**; the app deploys as **one long-running Node service** (`render.yaml`). Colyseus/WebSockets not used. Rooms are lost on process restart.
* Client prediction covers own movement only; no lag compensation for tackles/shots.
* Tournament mode is intentionally shown as **unavailable**. Friends are stored/queried but there is no invite-by-friend flow yet.
* Some rule edge cases and advanced rules (extra time/penalty shootout, advantage, substitutions, wall) are incomplete.
* No CI configuration is included. E2E requires a local Edge/Chrome installation (uses `playwright-core`, no browser download step).
* High-score table is browser-local (localStorage) by design; accounts, stats and online match history live in PostgreSQL.

## Repository map
```
src/game/shared    constants, types, movement (shared by client + server)
src/game/sim       sim.ts (state machine), actions.ts, ai.ts, ballPhysics.ts, drills.ts
src/game/client    engine.ts (render loop/camera/fx), world.ts (pitch+stadium), characters.ts, input.ts, audio.ts, sources.ts, settings.ts
src/server         rooms.ts (authoritative rooms), auth.ts, persist.ts, http.ts, runtime.ts
src/app/api        REST + SSE endpoints
src/components     App (menus/auth/profile), Lobby, GameScreen (HUD/pause/results), ui
src/db             Drizzle schema (+ drizzle/ migrations)
tests, scripts     vitest suites, smoke + load tests
```
