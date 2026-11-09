import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchHistory, matchPlayers } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const u = await requireUser();
  const rows = await db
    .select({
      id: matchHistory.id,
      playedAt: matchHistory.playedAt,
      mode: matchHistory.mode,
      stadium: matchHistory.stadium,
      teamAName: matchHistory.teamAName,
      teamBName: matchHistory.teamBName,
      scoreA: matchHistory.scoreA,
      scoreB: matchHistory.scoreB,
      team: matchPlayers.team,
      position: matchPlayers.position,
      goals: matchPlayers.goals,
      assists: matchPlayers.assists,
      saves: matchPlayers.saves,
      tackles: matchPlayers.tackles,
    })
    .from(matchPlayers)
    .innerJoin(matchHistory, eq(matchHistory.id, matchPlayers.matchId))
    .where(eq(matchPlayers.userId, u.id))
    .orderBy(desc(matchHistory.playedAt))
    .limit(20);
  return NextResponse.json({ matches: rows });
});
