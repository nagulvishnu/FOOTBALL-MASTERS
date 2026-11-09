import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { handle, rateLimit } from "@/server/http";
import { rooms } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** Quick Match: queue into the fullest open matchmaking room (balanced teams, auto position). */
export const POST = handle(async () => {
  const u = await requireUser();
  rateLimit(`mm:${u.id}`, 12, 60_000);
  const room = rooms().quickMatch({ id: u.id, displayName: u.displayName, appearance: u.appearance });
  return NextResponse.json({ code: room.code });
});
