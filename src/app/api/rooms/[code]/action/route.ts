import { NextResponse } from "next/server";
import { z } from "zod";
import { DIFFICULTIES, PATTERNS, ROLES, STADIUMS, TACTICS, TIMES, WEATHERS } from "@/game/shared/constants";
import type { Role, Tactic, Team } from "@/game/shared/types";
import { requireUser } from "@/server/auth";
import { handle, parse, rateLimit } from "@/server/http";
import { rooms } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };
const team = z.union([z.literal(0), z.literal(1)]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const act = z.object({
  n: z.number().int().min(0),
  type: z.enum(["pass", "through", "shoot", "cross", "tackle", "support", "jump"]),
  power: z.number().min(0).max(1),
});

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join") }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("team"), team }),
  z.object({ type: z.literal("role"), role: z.enum(ROLES as [string, ...string[]]) }),
  z.object({ type: z.literal("ready"), ready: z.boolean() }),
  z.object({
    type: z.literal("settings"),
    halfMinutes: z.number().int().min(1).max(10).optional(),
    difficulty: z.enum(DIFFICULTIES as [string, ...string[]]).optional(),
    stadium: z.enum(STADIUMS.map((s) => s.id) as [string, ...string[]]).optional(),
    time: z.enum(TIMES as unknown as [string, ...string[]]).optional(),
    weather: z.enum(WEATHERS as unknown as [string, ...string[]]).optional(),
    isPublic: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("kit"),
    team,
    name: z.string().max(18).optional(),
    primary: hex.optional(),
    secondary: hex.optional(),
    gk: hex.optional(),
    pattern: z.enum(PATTERNS as unknown as [string, ...string[]]).optional(),
  }),
  z.object({ type: z.literal("tactic"), team, tactic: z.enum(TACTICS as [string, ...string[]]) }),
  z.object({ type: z.literal("kick"), userId: z.string().uuid() }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("rematch") }),
  z.object({
    type: z.literal("input"),
    seq: z.number().int().min(0),
    mx: z.number().min(-1.5).max(1.5),
    mz: z.number().min(-1.5).max(1.5),
    sprint: z.boolean(),
    acts: z.array(act).max(4).optional(),
  }),
]);

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { code } = await ctx.params;
  const b = await parse(req, schema);
  // Gameplay inputs are capped inside the room sim; lobby/control actions and
  // SSE re-subscription attempts still need an outer rate limit.
  if (b.type !== "input") {
    rateLimit(`room-action:${b.type}:${u.id}`, 60, 60_000);
  }
  const mgr = rooms();
  const ru = { id: u.id, displayName: u.displayName, appearance: u.appearance };
  switch (b.type) {
    case "join":
      mgr.join(code, ru);
      break;
    case "leave":
      mgr.leave(code, u.id);
      break;
    case "team":
      mgr.setTeam(code, u.id, b.team as Team);
      break;
    case "role":
      mgr.setRole(code, u.id, b.role as Role);
      break;
    case "ready":
      mgr.setReady(code, u.id, b.ready);
      break;
    case "settings": {
      const { type: _t, ...rest } = b;
      void _t;
      mgr.setSettings(code, u.id, rest as never);
      break;
    }
    case "kit": {
      const { type: _t, team: tm, ...rest } = b;
      void _t;
      mgr.setKit(code, u.id, tm as Team, rest as never);
      break;
    }
    case "tactic":
      mgr.setTactic(code, u.id, b.team as Team, b.tactic as Tactic);
      break;
    case "kick":
      mgr.kick(code, u.id, b.userId);
      break;
    case "start":
      mgr.start(code, u.id);
      break;
    case "cancel":
      mgr.cancelStart(code, u.id);
      break;
    case "rematch":
      mgr.rematch(code, u.id);
      break;
    case "input": {
      const ok = mgr.input(code, u.id, { seq: b.seq, mx: b.mx, mz: b.mz, sprint: b.sprint, acts: b.acts });
      return NextResponse.json({ ok });
    }
  }
  return NextResponse.json({ ok: true });
});
