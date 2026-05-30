import { nanoid } from "nanoid";
import { z } from "zod";

import { runAgent } from "@/lib/agent/orchestrator";
import { isDailyBudgetExhausted, incRunsCount } from "@/lib/budget";
import { createRun } from "@/lib/db-queries";
import { extractIntent } from "@/lib/intent";
import { hashIp, checkAndIncrement } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import type { CreateRunResponse } from "@/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  rawQuery: z.string().trim().min(3).max(500),
  turnstileToken: z.string(),
});

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

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
    const { rawQuery, turnstileToken } = parsed.data;

    const ip = clientIp(req);

    // Gate a: app disabled
    if (process.env.APP_DISABLED === "true") {
      return Response.json({ error: "disabled" }, { status: 503 });
    }

    // Gate b: Turnstile
    const turnstileOk = await verifyTurnstile(turnstileToken, ip);
    if (!turnstileOk) {
      return Response.json({ error: "turnstile" }, { status: 403 });
    }

    // Gate c: rate limit
    const ipHash = hashIp(ip);
    const rl = checkAndIncrement(ipHash);
    if (!rl.ok) {
      return Response.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 0) },
        },
      );
    }

    // Gate d: daily budget
    if (isDailyBudgetExhausted()) {
      return Response.json({ budgetExhausted: true }, { status: 200 });
    }

    const intent = await extractIntent(rawQuery);

    const id = nanoid(10);
    createRun({ id, rawQuery, intent, clientIpHash: ipHash });
    incRunsCount();

    // Fire-and-forget: orchestrator runs for minutes on this persistent server.
    runAgent(id, intent).catch((err) =>
      console.error("runAgent failed", id, err),
    );

    const res: CreateRunResponse = { runId: id, intent };
    return Response.json(res, { status: 200 });
  } catch (err) {
    console.error("POST /api/runs failed", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
