import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { playerSettings } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { handle, parse } from "@/server/http";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  sensitivity: z.number().min(0.2).max(3).optional(),
  distance: z.number().min(3).max(14).optional(),
  height: z.number().min(1).max(8).optional(),
  graphics: z.enum(["low", "medium", "high"]).optional(),
  master: z.number().min(0).max(1).optional(),
  music: z.number().min(0).max(1).optional(),
  invertY: z.boolean().optional(),
  keys: z.record(z.string().max(16), z.string().max(24)).optional(),
});

export const GET = handle(async () => {
  const u = await requireUser();
  const [row] = await db.select().from(playerSettings).where(eq(playerSettings.userId, u.id));
  return NextResponse.json({ settings: row?.settings ?? {} });
});

export const PUT = handle(async (req: Request) => {
  const u = await requireUser();
  const settings = await parse(req, settingsSchema);
  await db
    .insert(playerSettings)
    .values({ userId: u.id, settings })
    .onConflictDoUpdate({ target: playerSettings.userId, set: { settings, updatedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
