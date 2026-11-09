# FOOTBALL MASTERS — Deployment (Render + Neon PostgreSQL)

## Deployment Reality (important)
This app is **not** a split Vercel frontend + Render backend. The authoritative room server, SSE streams, and match loops run inside the Next.js Node process and keep room state in memory (`globalThis` `RoomManager`).

**Intended production architecture:**

`Players' browsers → Render (Next.js + authoritative multiplayer server) → Neon PostgreSQL`

- **Supported target:** a single Render Web Service (Blueprint provided), or another single long-running Node host.
- **Not supported:** Vercel serverless for the full app (no long-lived SSE/match loops, no shared room memory across invocations).
- **Not implemented:** CORS, `NEXT_PUBLIC_API_URL`, separate realtime backend, Colyseus/WebSockets, or horizontal scaling.
- **Single instance required:** `numInstances: 1`. Scaling above 1 will split rooms/SSE across processes and break multiplayer.
- **Process restart limitation:** active rooms and SSE connections are lost on restart/deploy. Finished matches already persisted remain in Neon.
- **Not performed in this audit:** no external Render/Neon deployment was executed.

## Prerequisites
- A Neon account/project (or any managed PostgreSQL reachable from Render).
- A Render account connected to the GitHub repository.
- Node.js runtime compatible with Next.js 16 (Render's Node runtime is fine; local verification used Node 24).

## Environment Variables
See `.env.example` (placeholders only; never commit real values).

| Variable | Required | Production guidance |
|---|---|---|
| `DATABASE_URL` | **Yes** for accounts/online rooms/history | Neon **pooled** connection string, e.g. `postgresql://USER:PASSWORD@...-pooler...neon.tech/neondb?sslmode=require`. Store only in Render/Neon env settings. |
| `NODE_ENV` | Yes | `production` (set in `render.yaml`). |
| `PORT` | Provided by Render | Render injects `PORT`; `npm start` / Next binds to it. Do not hardcode. |
| `PG_POOL_MAX` | No | Default `10`. Keep modest for small Render instances and Neon pooled endpoints. |
| `COOKIE_INSECURE` | **No — never in production** | Local plain-HTTP production testing only. In `NODE_ENV=production`, session cookies are always `Secure`; this flag is ignored and a warning is logged. |

## Neon PostgreSQL Setup (manual)
1. Create a Neon project and database.
2. Copy the **pooled** connection string (recommended for serverless/managed app connections) and include `?sslmode=require` if not present.
3. Keep the connection string secret. Do **not** paste it into source files, commits, issues, or client code.
4. (Optional local check before Render) With `DATABASE_URL` set in your shell only:
   ```bash
   npx drizzle-kit migrate --config drizzle.config.prod.ts
   ```
   The app's Render Blueprint also runs this as `preDeployCommand`.
5. If migration fails, check: URL correctness, `sslmode=require`, Neon project not suspended, IP/network access (Neon is publicly reachable by default), and that `drizzle/` migration files are committed.

## Render Web Service Setup (manual)
1. Push this repository to GitHub.
2. In Render: **New → Blueprint** and select the repository (uses `render.yaml`), or create a **Web Service** manually with the same settings.
3. Confirm settings:
   - Runtime: Node
   - Instance count: **1**
   - Build command: `npm ci && npm run build`
   - Pre-deploy command: `npx drizzle-kit migrate --config drizzle.config.prod.ts`
   - Start command: `npm start`
   - Health check path: `/api/health`
4. Set environment variables in the Render dashboard:
   - `DATABASE_URL` = Neon pooled connection string (**secret**)
   - `PG_POOL_MAX` = `10` (optional)
   - Do **not** set `COOKIE_INSECURE`
5. Deploy and wait for build + pre-deploy migration + health check to pass.
6. Open the Render URL. `GET /api/health` should return `{"ok":true}` when the DB is reachable.

## Local Production Verification (before or after deploy prep)
```powershell
npm install
Copy-Item .env.example .env          # set local DATABASE_URL
npx drizzle-kit migrate
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
npm start                            # http://localhost:3000
# while server runs:
node scripts/smoke.mjs
$env:SECONDS='15'; node scripts/load.mjs
node scripts/e2e.mjs                 # requires local Edge/Chrome
```

Local plain-HTTP production-cookie testing only (never on Render):
```powershell
$env:NODE_ENV='production'; $env:COOKIE_INSECURE='1'; npm start
```

## Live Multiplayer Test Checklist (after deployment)
1. Open the Render URL in Browser A and Browser B (different profiles/devices if possible).
2. In Browser A: **Press start → Create room → Continue as guest** (or sign in) → create room.
3. Confirm a 5-character room code appears and SSE status shows connected.
4. In Browser B: **Join room** (or open invitation link), enter code, join.
5. Both pick teams/positions and confirm ready; host starts the match.
6. Verify both reach the match, timer/score display, and movement of one player is visible to the other.
7. Disconnect Browser B (close tab/network) and verify AI covers the slot; reconnect and verify control returns (if the process did not restart).
8. Check Render logs for unexpected errors. A deploy/restart during a match will drop active rooms — expected limitation.

## Troubleshooting
| Symptom | Likely cause | Action |
|---|---|---|
| Build fails on Render | dependency/install-script policy, Node/runtime issue, type/lint error | Check Render build logs; confirm `npm ci && npm run build` works locally. |
| Pre-deploy migration fails | bad `DATABASE_URL`, missing `sslmode=require`, Neon suspended, migration config error | Verify Neon URL; run `npx drizzle-kit migrate --config drizzle.config.prod.ts` locally with the same env (carefully). |
| `/api/health` returns 503 | DB unreachable or misconfigured | Check `DATABASE_URL`, Neon status, SSL settings, pool limits. |
| Login/guest works locally but not on Render | missing env var, Secure cookie over HTTPS expected (normal), or DB issue | Confirm `DATABASE_URL` set in Render; ensure you use `https://` Render URL; never use `COOKIE_INSECURE` in production. |
| Room join fails / `DB_UNAVAILABLE` | No DB configured or DB down | Set/fix `DATABASE_URL`. Offline play still works only when the app can run without DB-backed features; online accounts/rooms/history need DB. |
| Players desync after deploy/restart | process restart dropped in-memory rooms | Expected. Recreate the room. Keep `numInstances=1`. |
| Multiplayer breaks with multiple instances | horizontal scaling not supported | Set instances to 1. Do not scale until a shared room service/sticky realtime architecture is implemented. |
| SSE disconnects behind proxy | buffering or idle timeout | Stream sets `no-store, no-transform`, `keep-alive`, `X-Accel-Buffering: no`. Ensure proxy/load balancer allows long-lived responses and heartbeats. |

## Database Migrations
- Local/dev: `npx drizzle-kit migrate` (uses `drizzle.config.ts`, reads `.env`).
- Production/Neon: `npx drizzle-kit migrate --config drizzle.config.prod.ts` with `DATABASE_URL` set.
- After schema edits: `npx drizzle-kit generate --name <name>`, commit generated migration, then migrate.

## Rollback / Operational Notes
- Roll back by redeploying the previous commit/build. Keep migrations backward-compatible; do not run destructive migrations without backups.
- Active room state is ephemeral. Match history/statistics for finished, persisted matches remain in Neon.
- The in-process rate limiter is per instance/process; sufficient for a single instance, not a distributed control plane.

## Final Status
**PARTIAL (deployment-ready configuration prepared locally; external deployment NOT PERFORMED).** Repo includes Render Blueprint, Neon-compatible env/SSL handling, production cookie hardening, SSE/rate-limit checks, migrations config, and deployment docs. Creating Neon/Render resources and running the live deployment remains a manual, credentialed step (BLOCKED from this environment).
