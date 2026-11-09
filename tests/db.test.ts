import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { matchHistory, playerStatistics, users } from "@/db/schema";
import { hashPassword, provisionUser, verifyPassword } from "@/server/auth";
import { persistMatch } from "@/server/persist";
import type { MatchResult } from "@/game/shared/types";

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await pool.end();
});

describe("authentication primitives", () => {
  it("hashes passwords with scrypt, never plaintext, and verifies correctly", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});

describe("database operations", () => {
  it("enforces case-insensitive unique usernames", async () => {
    const name = `T_${Date.now()}`;
    const [u] = await db.insert(users).values({ username: name, isGuest: true }).returning({ id: users.id });
    created.push(u.id);
    await expect(db.insert(users).values({ username: name.toLowerCase(), isGuest: true })).rejects.toThrow();
  });

  it("persists a finished match transactionally and updates player statistics", async () => {
    const [u] = await db.insert(users).values({ username: `S_${Date.now()}`, isGuest: true }).returning({ id: users.id });
    created.push(u.id);
    await provisionUser(u.id, "StatTester");
    const mk = (idx: number, team: 0 | 1, role: "LW" | "GK", userId: string | null, goals: number) => ({
      idx,
      team,
      role,
      name: userId ? "StatTester" : "CPU",
      userId,
      yellow: 0,
      red: false,
      stats: { goals, assists: 1, saves: 0, tackles: 2, passes: 10, passOk: 8, shots: 3, fouls: 0 },
    });
    const result: MatchResult = { score: [2, 1], possession: [55, 45], durationSeconds: 600, players: [mk(5, 0, "LW", u.id, 2), mk(7, 1, "GK", null, 0)] };
    await persistMatch({ roomCode: "TEST1", mode: "private", stadium: "classic", teamNames: ["A", "B"], result });
    await persistMatch({ roomCode: "TEST1", mode: "private", stadium: "classic", teamNames: ["A", "B"], result });
    const [s] = await db.select().from(playerStatistics).where(eq(playerStatistics.userId, u.id));
    expect(s.matches).toBe(2);
    expect(s.wins).toBe(2);
    expect(s.goals).toBe(4);
    expect(s.playtimeSeconds).toBe(1200);
    await db.delete(matchHistory).where(eq(matchHistory.roomCode, "TEST1"));
  });
});
