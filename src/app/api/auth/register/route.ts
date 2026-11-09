import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, provisionUser } from "@/server/auth";
import { clientIp, fail, handle, parse, rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_ \-]{2,24}$/, "2-24 letters, numbers, spaces, - or _"),
  email: z.string().email().max(255).optional(),
  password: z.string().min(8, "at least 8 characters").max(72),
});

export const POST = handle(async (req: Request) => {
  rateLimit(`reg:${clientIp(req)}`, 10, 60_000);
  const body = await parse(req, schema);
  const clash = await db.execute(sql`select 1 from users where lower(username) = lower(${body.username}) ${body.email ? sql`or lower(email) = lower(${body.email})` : sql``} limit 1`);
  if (clash.rows.length) throw fail(409, "TAKEN", "That username or email is already registered");
  const passwordHash = await hashPassword(body.password);
  let id: string;
  try {
    const [u] = await db.insert(users).values({ username: body.username, email: body.email ?? null, passwordHash }).returning({ id: users.id });
    id = u.id;
  } catch {
    throw fail(409, "TAKEN", "That username or email is already registered");
  }
  await provisionUser(id, body.username);
  await createSession(id);
  return NextResponse.json({ ok: true }, { status: 201 });
});
