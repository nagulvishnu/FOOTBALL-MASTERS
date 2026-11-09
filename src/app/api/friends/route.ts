import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { friendships, playerProfiles, users } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { fail, handle, parse } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const u = await requireUser();
  const rows = await db
    .select({ id: friendships.id, status: friendships.status, requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
    .from(friendships)
    .where(or(eq(friendships.requesterId, u.id), eq(friendships.addresseeId, u.id)));
  const ids = [...new Set(rows.flatMap((r) => [r.requesterId, r.addresseeId]).filter((i) => i !== u.id))];
  const names = ids.length ? await db.select({ id: playerProfiles.userId, name: playerProfiles.displayName }).from(playerProfiles).where(sql`${playerProfiles.userId} in ${ids}`) : [];
  const nm = new Map(names.map((n) => [n.id, n.name]));
  return NextResponse.json({
    friends: rows.map((r) => {
      const other = r.requesterId === u.id ? r.addresseeId : r.requesterId;
      return { id: r.id, status: r.status, name: nm.get(other) ?? "Player", incoming: r.addresseeId === u.id && r.status === "pending" };
    }),
  });
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  if (u.isGuest) throw fail(403, "GUEST", "Create an account to add friends");
  const { username } = await parse(req, z.object({ username: z.string().min(2).max(24) }));
  const [t] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.username}) = lower(${username})`, eq(users.isGuest, false))).limit(1);
  if (!t) throw fail(404, "NO_SUCH_USER", "No registered player with that name");
  if (t.id === u.id) throw fail(409, "SELF", "You cannot add yourself");
  const dup = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(or(and(eq(friendships.requesterId, u.id), eq(friendships.addresseeId, t.id)), and(eq(friendships.requesterId, t.id), eq(friendships.addresseeId, u.id))))
    .limit(1);
  if (dup.length) throw fail(409, "EXISTS", "Friend request already exists");
  await db.insert(friendships).values({ requesterId: u.id, addresseeId: t.id });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const { id, action } = await parse(req, z.object({ id: z.string().uuid(), action: z.enum(["accept", "decline", "remove"]) }));
  const mine = or(eq(friendships.requesterId, u.id), eq(friendships.addresseeId, u.id));
  if (action === "accept") {
    const r = await db.update(friendships).set({ status: "accepted" }).where(and(eq(friendships.id, id), eq(friendships.addresseeId, u.id))).returning({ id: friendships.id });
    if (!r.length) throw fail(404, "NOT_FOUND", "Request not found");
  } else {
    const r = await db.delete(friendships).where(and(eq(friendships.id, id), mine)).returning({ id: friendships.id });
    if (!r.length) throw fail(404, "NOT_FOUND", "Friend not found");
  }
  return NextResponse.json({ ok: true });
});
