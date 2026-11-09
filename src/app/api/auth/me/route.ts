import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { handle } from "@/server/http";
import { rooms } from "@/server/runtime";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await currentUser();
  const code = user ? rooms().userRoom.get(user.id) : undefined;
  const room = code ? rooms().rooms.get(code) : undefined;
  return NextResponse.json({ user, activeRoom: room && room.state !== "finished" ? room.code : null });
});
