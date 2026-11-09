import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, provisionUser } from "@/server/auth";
import { clientIp, handle, parse, rateLimit } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({ name: z.string().trim().regex(/^[A-Za-z0-9_ \-]{2,24}$/, "2-24 letters, numbers, spaces, - or _") });

export const POST = handle(async (req: Request) => {
  rateLimit(`guest:${clientIp(req)}`, 20, 60_000);
  const { name } = await parse(req, schema);
  const [u] = await db.insert(users).values({ username: `guest_${randomBytes(6).toString("hex")}`, isGuest: true }).returning({ id: users.id });
  await provisionUser(u.id, name);
  await createSession(u.id);
  return NextResponse.json({ ok: true }, { status: 201 });
});
