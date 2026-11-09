import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerStatistics } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const u = await requireUser();
  const [row] = await db.select().from(playerStatistics).where(eq(playerStatistics.userId, u.id));
  return NextResponse.json({ stats: row ?? null });
});
