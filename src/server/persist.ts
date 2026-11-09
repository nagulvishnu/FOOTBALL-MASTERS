// Persists FINISHED matches only. Live match state never touches PostgreSQL.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchHistory, matchPlayers, playerStatistics } from "@/db/schema";
import type { MatchResult } from "@/game/shared/types";

export interface MatchSummary {
  roomCode: string;
  mode: string;
  stadium: string;
  teamNames: [string, string];
  result: MatchResult;
}

export async function persistMatch(s: MatchSummary) {
  const { result } = s;
  await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(matchHistory)
      .values({
        roomCode: s.roomCode,
        mode: s.mode,
        stadium: s.stadium,
        teamAName: s.teamNames[0],
        teamBName: s.teamNames[1],
        scoreA: result.score[0],
        scoreB: result.score[1],
        possessionA: result.possession[0],
        durationSeconds: result.durationSeconds,
      })
      .returning({ id: matchHistory.id });
    await tx.insert(matchPlayers).values(
      result.players.map((p) => ({
        matchId: m.id,
        userId: p.userId,
        displayName: p.name.slice(0, 24),
        team: p.team,
        position: p.role,
        goals: p.stats.goals,
        assists: p.stats.assists,
        saves: p.stats.saves,
        tackles: p.stats.tackles,
        passes: p.stats.passes,
        passesCompleted: p.stats.passOk,
        yellowCards: p.yellow,
        redCard: p.red,
      })),
    );
    for (const p of result.players) {
      if (!p.userId) continue;
      const mine = result.score[p.team];
      const theirs = result.score[p.team === 0 ? 1 : 0];
      await tx
        .insert(playerStatistics)
        .values({
          userId: p.userId,
          matches: 1,
          wins: mine > theirs ? 1 : 0,
          losses: mine < theirs ? 1 : 0,
          draws: mine === theirs ? 1 : 0,
          goals: p.stats.goals,
          assists: p.stats.assists,
          saves: p.stats.saves,
          tackles: p.stats.tackles,
          playtimeSeconds: result.durationSeconds,
        })
        .onConflictDoUpdate({
          target: playerStatistics.userId,
          set: {
            matches: sql`${playerStatistics.matches} + 1`,
            wins: sql`${playerStatistics.wins} + ${mine > theirs ? 1 : 0}`,
            losses: sql`${playerStatistics.losses} + ${mine < theirs ? 1 : 0}`,
            draws: sql`${playerStatistics.draws} + ${mine === theirs ? 1 : 0}`,
            goals: sql`${playerStatistics.goals} + ${p.stats.goals}`,
            assists: sql`${playerStatistics.assists} + ${p.stats.assists}`,
            saves: sql`${playerStatistics.saves} + ${p.stats.saves}`,
            tackles: sql`${playerStatistics.tackles} + ${p.stats.tackles}`,
            playtimeSeconds: sql`${playerStatistics.playtimeSeconds} + ${result.durationSeconds}`,
            updatedAt: sql`now()`,
          },
        });
    }
  });
  return true;
}
