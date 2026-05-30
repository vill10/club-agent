import { getRun, getEvents, getCards } from "@/lib/db-queries";
import type { RunSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const snapshot: RunSnapshot = {
    run,
    events: getEvents(id),
    cards: getCards(id),
  };
  return Response.json(snapshot, { status: 200 });
}
