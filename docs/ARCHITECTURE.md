# FOOTBALL MASTERS — Architecture

## Summary
FOOTBALL MASTERS is a browser-based 3D 7v7 football game. Every human controls exactly one player with an independent third-person camera; AI controls all vacant slots. The offline game runs a pure TypeScript simulation in the browser. Online rooms run the same simulation authoritatively on the server and stream snapshots to clients.

The repository does **not** use Colyseus/WebSockets. Online transport is **SSE (server → client snapshots/events) + HTTPS POST (client → server actions/inputs)**, implemented with Next.js App Router route handlers and a single in-process `RoomManager`.

## Layers
| Layer | Location | Notes |
|---|---|---|
| Shared game core | `src/game/shared/` | Constants (105×68 m pitch, 7.32×2.44 m goals, 30 Hz tick), types, movement step shared by client prediction and server sim. |
| Authoritative simulation | `src/game/sim/` | `sim.ts` state machine, `actions.ts` input effects, `ai.ts` role/tactic AI, `ballPhysics.ts`, `drills.ts`. Pure TypeScript, no DOM/Next dependency. |
| Room server | `src/server/rooms.ts` | `globalThis`-scoped singleton `RoomManager`. Owns rooms, members, lobby actions, countdown, 30 Hz loop, SSE fan-out, AI takeover, reconnect, and persistence hook. |
| Transport/API | `src/app/api/` | Auth, profile, settings, stats, matches, friends, rooms, matchmaking, health. Room control uses `POST /api/rooms/[code]/action`; snapshots use `GET /api/rooms/[code]/stream` (SSE). |
| Database | `src/db/` + `drizzle/` | PostgreSQL via Drizzle ORM. Stores users/sessions/profiles/settings/cosmetics/friends and **finished** match history/statistics. Active rooms are not stored. |
| Client rendering | `src/game/client/` | three.js scene/pitch/stadium/crowd (`world.ts`), procedural rigged characters (`characters.ts`), render/camera/fx/HUD loop (`engine.ts`), input (`input.ts`), online/local sources (`sources.ts`), audio (`settings.ts`/`audio.ts`). |
| UI | `src/components/` | `App.tsx` menus/auth/profile, `Lobby.tsx`, `GameScreen.tsx` HUD/pause/results, shared UI primitives. |

## Multiplayer Authority Model
- Server owns: player positions/velocities/stamina/actions, ball, possession, clock, half/phase, score, fouls/cards, set pieces, ownership, kickoff/restart placement, AI decisions, and match results.
- Clients send: `mx`, `mz`, `sprint`, and `acts[]` (pass/through/shoot/cross/tackle/support/jump) with a sequence number via `POST /api/rooms/[code]/action` (`type: "input"`).
- Server validates/clamps inputs, rate-limits action requests, ignores stale sequence numbers, and applies actions only for the requesting user's assigned slot.
- Clients interpolate received snapshots at display rate (with delay), predict **only their own movement** using the shared movement step, and reconcile smoothly. The ball and other players are never client-predicted as authority.

## Tick / Snapshot Flow
1. `RoomManager` starts a 30 Hz interval per playing room (`TICK_RATE=30`, `TICK_DT=1/30`).
2. Each tick advances the authoritative sim and emits compact tuple snapshots.
3. Snapshots are JSON-serialized and broadcast over SSE as `event: snap` to all subscribers.
4. Lobby/room state changes are broadcast as `event: room`.
5. SSE responses use Node runtime, `text/event-stream`, `no-store`, `keep-alive`, `X-Accel-Buffering: no`, and a 15 s heartbeat ping.
6. On disconnect, the member remains in the room (when appropriate), is marked disconnected, and AI takes over immediately. Re-subscribing restores the same slot and human control.

## Auth / Persistence
- Auth uses scrypt password hashing and opaque random session tokens; only a SHA-256 token hash is stored in `sessions`. Cookie: `fm_session` (`HttpOnly`, `SameSite=Lax`, `path=/`). Cookies are always `Secure` in `NODE_ENV=production`; `COOKIE_INSECURE` is only for local non-production plain-HTTP testing and is ignored in production.
- `GET /api/auth/me` reports the current user and `activeRoom` (for rejoin UI).
- Only finished matches are persisted (`src/server/persist.ts`) in a transaction: `match_history`, `match_players`, and `player_statistics` (upserted per user). Room snapshots/events are not persisted.
- The pg pool is created lazily, supports Neon `sslmode=require` URLs, has bounded pool/timeout settings (`PG_POOL_MAX`, defaults), and logs idle-connection errors without crashing the process.

## AI
- Deterministic, role-aware AI in `src/game/sim/ai.ts`: GK/defenders/midfielders/forwards use formation anchors, ball-relative shifts, tactics (balanced/attacking/defensive/high pressing/counterattack), difficulty, marking/interception/shot/pass decisions, and GK handling/dives.
- Every empty slot is AI-controlled. Disconnected human slots become AI-controlled immediately and return to human control on reconnect.

## Rules / Set Pieces
Implemented in the sim: kickoff, two halves, halftime, stoppage/phase timers, goals (server-validated), throw-ins, goal kicks, corners, free kicks, penalties, fouls, yellow/red cards, offside checks, goalkeeper handling constraints, and set-piece taker selection/distances.
Not implemented/limited (documented): extra time/penalty shoot-outs, advantage rule, substitutions, defensive wall, and full real-world rule edge cases.

## Deployment Constraint
Rooms, subscribers, and match loops live in one Node process. This requires a **single long-running Node service** (Render/Fly/VPS). It cannot run on Vercel serverless and cannot be horizontally scaled without sticky routing or extracting rooms to a dedicated stateful service. A Vercel frontend + Render backend split (CORS / `NEXT_PUBLIC_API_URL` / separate realtime backend) is **not implemented**; Render Blueprint deploys the whole Next app as one service.

## Key Fixes Made During Audit
- `src/db/index.ts`: lazy DB initialization so builds/offline startup do not throw at import when `DATABASE_URL` is absent; DB-backed routes return a clear 503.
- `src/components/GameScreen.tsx`: fixed React hook lint errors and moved offline high-score finalization to a safe event path.
- Pause/menu UX: pointer lock is released when pausing/finishing so menu buttons are clickable; online pause/result labels clarified.
- `src/server/rooms.ts`: removed redundant duplicate `room` SSE send when broadcasting with an excluded user.
- `src/app/icon.svg`: added to eliminate favicon 404 noise.
- `drizzle.config.ts`: replaced hardcoded local JSON config with env-driven config (`dotenv/config`, requires `DATABASE_URL`).
- `scripts/e2e.mjs`: added two-real-browser E2E coverage and `__fmDebug` QA hook in the client engine.
