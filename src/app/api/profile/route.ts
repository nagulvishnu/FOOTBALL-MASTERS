import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { playerCosmetics, playerProfiles } from "@/db/schema";
import { invalidateUserCache, requireUser } from "@/server/auth";
import { handle, parse } from "@/server/http";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const schema = z.object({
  displayName: z.string().trim().regex(/^[A-Za-z0-9_ \-]{2,24}$/).optional(),
  avatarUrl: z.string().url().max(300).startsWith("http").nullable().optional(),
  favouritePosition: z.enum(["GK", "LB", "RB", "CML", "CMR", "LW", "RW"]).nullable().optional(),
  gender: z.enum(["m", "f"]).optional(),
  hair: z.number().int().min(0).max(5).optional(),
  hairColor: z.number().int().min(0).max(5).optional(),
  skin: z.number().int().min(0).max(5).optional(),
});

export const GET = handle(async () => {
  const u = await requireUser();
  const [p] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, u.id));
  return NextResponse.json({ profile: p ?? null, user: u });
});

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const b = await parse(req, schema);
  const profile: Record<string, unknown> = { updatedAt: new Date() };
  if (b.displayName !== undefined) profile.displayName = b.displayName;
  if (b.avatarUrl !== undefined) profile.avatarUrl = b.avatarUrl;
  if (b.favouritePosition !== undefined) profile.favouritePosition = b.favouritePosition;
  await db.update(playerProfiles).set(profile).where(eq(playerProfiles.userId, u.id));
  const cos: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["gender", "hair", "hairColor", "skin"] as const) if (b[k] !== undefined) cos[k] = b[k];
  await db.update(playerCosmetics).set(cos).where(eq(playerCosmetics.userId, u.id));
  invalidateUserCache(u.id);
  return NextResponse.json({ ok: true });
});
