import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, verifyPassword } from "@/server/auth";
import { clientIp, fail, handle, parse, rateLimit } from "@/server/http";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const schema = z.object({ identifier: z.string().min(2).max(255), password: z.string().min(1).max(72) });
let dummy: Promise<string> | null = null;

export const POST = handle(async (req: Request) => {
  rateLimit(`login:${clientIp(req)}`, 10, 60_000);
  const body = await parse(req, schema);
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${body.identifier}) or lower(${users.email}) = lower(${body.identifier})`)
    .limit(1);
  const u = rows[0];
  if (!u || u.isGuest) {
    dummy ??= hashPassword("not-a-real-password"); // equalise timing
    await verifyPassword(body.password, await dummy);
    throw fail(401, "INVALID_CREDENTIALS", "Wrong username or password");
  }
  if (!(await verifyPassword(body.password, u.passwordHash))) throw fail(401, "INVALID_CREDENTIALS", "Wrong username or password");
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, u.id));
  await createSession(u.id);
  return NextResponse.json({ ok: true });
});
