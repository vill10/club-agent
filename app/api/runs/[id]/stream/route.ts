import { getEventsSince, getRun } from "@/lib/db-queries";
import { getRunBus } from "@/lib/events";
import type { RunEvent } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (e: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      let lastId = 0;
      for (const ev of getEventsSince(id, 0)) {
        send(ev);
        lastId = ev.id;
      }
      const run = getRun(id);
      if (run && run.status !== "running") {
        closed = true;
        controller.close();
        return;
      }
      const bus = getRunBus(id);
      const onEvent = (ev: RunEvent) => {
        if (!closed && ev.id > lastId) {
          send(ev);
          lastId = ev.id;
        }
      };
      const onEnd = () => {
        if (!closed) {
          closed = true;
          clearInterval(hb);
          bus.off("event", onEvent);
          try {
            controller.close();
          } catch {}
        }
      };
      bus.on("event", onEvent);
      bus.once("end", onEnd);
      const hb = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": hb\n\n"));
      }, 15000);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
