import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// The database is created lazily so the app can build and run its offline
// modes without credentials. Any request that actually needs persistence
// raises a clear, catchable error instead of crashing at import time.
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for accounts, online rooms and match history");
  return url;
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsDrizzle?: ReturnType<typeof drizzle>;
};

export function getPool(): Pool {
  const existing = globalForDb.__arenaNextJsPostgresqlPool;
  if (existing) return existing;
  const url = databaseUrl();
  // Neon pooled URLs commonly include sslmode=require; Render/local Postgres may not.
  // `rejectUnauthorized: false` keeps TLS working with common managed cert chains.
  const useSsl = /sslmode=require/i.test(url) || /[?&]ssl=true/i.test(url);
  const created = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  created.on("error", (err) => {
    // Prevent an idle-connection error from crashing the process; the next query
    // will establish a new connection.
    console.error("[db] idle pool error:", err instanceof Error ? err.message : err);
  });
  globalForDb.__arenaNextJsPostgresqlPool = created;
  return created;
}

function getDb(): ReturnType<typeof drizzle> {
  const existing = globalForDb.__arenaNextJsDrizzle;
  if (existing) return existing;
  const created = drizzle(getPool());
  globalForDb.__arenaNextJsDrizzle = created;
  return created;
}

// Proxies keep the familiar `db.select()...` / `pool.end()` call sites while
// deferring the real connection until first use.
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = getPool() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export const db: ReturnType<typeof drizzle> = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
