import { requireUser } from "@/server/auth";
import { handle, rateLimit } from "@/server/http";
import { rooms } from "@/server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ code: string }> };

/** Server-Sent Events: lobby/room state + authoritative match snapshots (server -> client). */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { code } = await ctx.params;
  // Prevent abusive reconnect loops from opening unlimited SSE connections.
  rateLimit(`stream:${code}:${user.id}`, 30, 60_000);
  const mgr = rooms();
  mgr.get(code);
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let ctl: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (hb) clearInterval(hb);
    try {
      ctl?.close();
    } catch {
      /* already closed */
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctl = controller;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          close();
          unsub?.();
        }
      };
      controller.enqueue(enc.encode("retry: 1000\n\n"));
      const sub = mgr.subscribe(code, user.id, { send, close });
      unsub = sub.unsubscribe;
      hb = setInterval(() => send("ping", "{}"), 15000);
      req.signal.addEventListener("abort", () => {
        close();
        sub.unsubscribe();
      });
    },
    cancel() {
      closed = true;
      if (hb) clearInterval(hb);
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
