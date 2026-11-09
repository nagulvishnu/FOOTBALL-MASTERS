import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { handle } from "@/server/http";
import { rooms } from "@/server/runtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/** Members get the full room view; everyone else only learns whether the room can be joined. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { code } = await ctx.params;
  const mgr = rooms();
  const room = mgr.get(code);
  if (room.members.has(u.id)) return NextResponse.json({ room: mgr.view(room), member: true });
  return NextResponse.json({ room: { code: room.code, state: room.state, players: room.members.size, capacity: 14 }, member: false });
});
