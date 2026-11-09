import { NextResponse } from "next/server";
import { z } from "zod";
import { DIFFICULTIES, STADIUMS, TIMES, WEATHERS } from "@/game/shared/constants";
import { requireUser } from "@/server/auth";
import { handle, parse, rateLimit } from "@/server/http";
import { rooms } from "@/server/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  mode: z.enum(["private", "friends", "coop"]).default("private"),
  halfMinutes: z.number().int().min(1).max(10).default(5),
  difficulty: z.enum(DIFFICULTIES as [string, ...string[]]).default("medium"),
  stadium: z.enum(STADIUMS.map((s) => s.id) as [string, ...string[]]).default("international"),
  time: z.enum(TIMES as unknown as [string, ...string[]]).default("day"),
  weather: z.enum(WEATHERS as unknown as [string, ...string[]]).default("clear"),
  isPublic: z.boolean().default(false),
});

/** Room discovery: public lobbies that still have space. */
export const GET = handle(async () => {
  await requireUser();
  return NextResponse.json({ rooms: rooms().list() });
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  rateLimit(`room:${u.id}`, 10, 60_000);
  const body = await parse(req, schema);
  const room = rooms().create({ id: u.id, displayName: u.displayName, appearance: u.appearance }, body as never);
  return NextResponse.json({ code: room.code }, { status: 201 });
});
