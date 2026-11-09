// Structured API errors, body validation and a tiny in-memory rate limiter.
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: number, code: string, message: string) => new ApiError(status, code, message);

export async function parse<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw fail(400, "BAD_JSON", "Request body must be valid JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    throw fail(422, "VALIDATION", `${first?.path.join(".") || "body"}: ${first?.message ?? "invalid"}`);
  }
  return r.data;
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof Error && typeof (e as ApiError).status === "number" && typeof (e as ApiError).code === "string") {
        const ae = e as ApiError;
        return NextResponse.json({ error: { code: ae.code, message: ae.message } }, { status: ae.status });
      }
      if (e instanceof Error && e.message.startsWith("DATABASE_URL is required")) {
        return NextResponse.json(
          { error: { code: "DB_UNAVAILABLE", message: "No database is configured on this server. Offline play and drills still work; accounts, online rooms and history need DATABASE_URL." } },
          { status: 503 },
        );
      }
      // never log request bodies/credentials – only the error class and message
      console.error("[api] unhandled error:", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: { code: "INTERNAL", message: "Internal server error" } }, { status: 500 });
    }
  };
}

const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  b.n++;
  if (b.n > max) throw fail(429, "RATE_LIMITED", "Too many requests, slow down");
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
