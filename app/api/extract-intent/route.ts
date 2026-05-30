import { z } from "zod";

import { extractIntent } from "@/lib/intent";
import type { ExtractIntentResponse } from "@/types";

export const dynamic = "force-dynamic";

// Cheap action: no Turnstile, no run budget. The run endpoint owns the
// abuse gates (Turnstile / rate limit / daily budget). Here we only validate
// input length and extract — the same 3–500 char bound the run endpoint uses.
const bodySchema = z.object({
  rawQuery: z.string().trim().min(3).max(500),
});

export async function POST(req: Request) {
  try {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const intent = await extractIntent(parsed.data.rawQuery);

    const res: ExtractIntentResponse = { intent };
    return Response.json(res, { status: 200 });
  } catch (err) {
    console.error("POST /api/extract-intent failed", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
