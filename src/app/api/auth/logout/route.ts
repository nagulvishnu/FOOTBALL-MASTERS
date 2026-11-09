import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  await destroySession();
  return NextResponse.json({ ok: true });
});
