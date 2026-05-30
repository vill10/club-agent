// Agent orchestrator — a minimal tool-use loop on the Anthropic Messages API.
//
// Deliberately NOT built on @anthropic-ai/claude-agent-sdk: rolling the loop by
// hand gives clean control over prompt caching, per-response usage/cost, the
// token circuit-breaker, and our custom event emission. The orchestrator model
// is claude-sonnet-4-6; the workers inside extract_fields / draft_outreach use
// Haiku (see lib/agent/haiku.ts).
//
// Cache hierarchy: tools → system → messages. We place an ephemeral
// cache_control breakpoint on the LAST tool (caches the whole tools prefix) and
// on the intent system block. Those breakpoints ride the 5-min TTL across the
// loop's turns, so each follow-up turn reads the prefix from cache.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { tools } from "@/lib/agent/tools";
import { SYSTEM_PROMPT, buildIntentBlock } from "@/lib/agent/playbook";
import { appendEvent, setRunStatus, getCards } from "@/lib/db-queries";
import { emitRunEvent, closeRunBus } from "@/lib/events";
import { isDailyBudgetExhausted, addDailyCost } from "@/lib/budget";
import type { Intent, RunEventKind, RunEventPayload } from "@/types";

const ORCHESTRATOR_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const TOKEN_LIMIT = 200_000;
const MAX_ITERATIONS = 30; // safety net separate from the token breaker

// approximate; confirm against current Anthropic pricing
const PRICE = {
  inputPerMtok: 3,
  outputPerMtok: 15,
  cacheWritePerMtok: 3.75,
  cacheReadPerMtok: 0.3,
};

// TOOL PROTOCOL note appended to the system prompt so the model manages card
// ids deterministically across the multi-tool lifecycle of one club.
const TOOL_PROTOCOL = `

# ПРОТОКОЛ РАБОТЫ С КАРТОЧКАМИ (cardId)
Каждому кандидату-клубу присвой короткий стабильный cardId — слаг из названия (например "olymp-swim", "barys-chess"). Используй ОДИН И ТОТ ЖЕ cardId для этого клуба во ВСЕХ вызовах: emit_card_update → extract_fields → draft_outreach. Никогда не меняй cardId одного и того же клуба между вызовами — иначе создашь дубликаты карточек. cardId передаётся как вход в каждый из этих инструментов.`;

function utcNow(): number {
  return Math.floor(Date.now() / 1000);
}

function emit(runId: string, kind: RunEventKind, payload: RunEventPayload): void {
  const e = appendEvent(runId, kind, payload);
  emitRunEvent(runId, e);
}

// Per-response USD estimate from token usage. Cache reads/writes are billed at
// distinct rates; cache_creation tokens are NOT also counted as input_tokens by
// the API, so summing the four buckets is correct.
function costFromUsage(usage: Anthropic.Usage): number {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (input * PRICE.inputPerMtok +
      output * PRICE.outputPerMtok +
      cacheWrite * PRICE.cacheWritePerMtok +
      cacheRead * PRICE.cacheReadPerMtok) /
    1_000_000
  );
}

// Tokens counted toward the circuit-breaker. We deliberately EXCLUDE
// cache_read_input_tokens: the cached tools+system prefix is re-read on every
// turn, so counting it would make the breaker trip on cache hits (a tens-of-
// turns run re-reads the same ~10k-token prefix each turn, inflating the count
// to 200k+ while real fresh work is tiny). The breaker should bound *fresh*
// work — new input, generated output, and one-time cache writes. Cache reads
// are still billed in costFromUsage; they just don't gate the loop.
function tokensFromUsage(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

// `client` is injectable purely for offline testing; defaults to a real
// Anthropic client built from the env key. Production callers pass one arg.
export async function runAgent(
  runId: string,
  intent: Intent,
  client: Pick<Anthropic, "messages"> = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
): Promise<void> {

  // ── Build the Anthropic tools param from the registry ─────────────────────
  // cache_control on the LAST tool caches the entire tools prefix.
  const apiTools: Anthropic.Tool[] = tools.map((t, i) => {
    // The project uses zod v4, whose native z.toJSONSchema produces a correct
    // JSON Schema. (zod-to-json-schema@3 targets zod v3 and silently emits {}
    // against a v4 schema, so we use the built-in here.)
    const schema = z.toJSONSchema(t.inputSchema as z.ZodType) as Record<
      string,
      unknown
    >;
    // z.toJSONSchema emits a top-level $schema key; the Anthropic input_schema
    // wants a bare JSON-Schema object of type "object".
    delete schema.$schema;
    const tool: Anthropic.Tool = {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
    if (i === tools.length - 1) {
      tool.cache_control = { type: "ephemeral" };
    }
    return tool;
  });

  // ── System param: SYSTEM_PROMPT (+ protocol note) then the intent block ────
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT + TOOL_PROTOCOL },
    {
      type: "text",
      text: buildIntentBlock(intent),
      cache_control: { type: "ephemeral" },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: "Найди подходящие кружки/секции по этому запросу.",
    },
  ];

  let runTokens = 0;
  let runCost = 0;
  let stopReason: "complete" | "budget" = "complete";
  // True only if the loop exits a natural way (end_turn / stop_sequence / budget
  // breaker). Stays false if we fall through because the iteration cap was hit,
  // which lets us flag the run as truncated below.
  let endedCleanly = false;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // BEFORE each model call: budget / token circuit-breaker.
      if (isDailyBudgetExhausted() || runTokens > TOKEN_LIMIT) {
        stopReason = "budget";
        endedCleanly = true;
        break;
      }

      const response = await client.messages.create({
        model: ORCHESTRATOR_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: apiTools,
        messages,
      });

      // Accrue usage + cost.
      const delta = costFromUsage(response.usage);
      runTokens += tokensFromUsage(response.usage);
      runCost += delta;
      addDailyCost(delta);

      // Surface the model's narration into the activity stream.
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          emit(runId, "message", { kind: "message", text: block.text.trim() });
        }
      }

      if (response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const tool = tools.find((t) => t.name === block.name);
          if (!tool) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Unknown tool: ${block.name}`,
              is_error: true,
            });
            continue;
          }
          try {
            const input = tool.inputSchema.parse(block.input);
            const result = await tool.handler(input, { runId });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Ошибка инструмента ${block.name}: ${msg}`,
              is_error: true,
            });
          }
        }
        // Push assistant turn + the tool results, then continue the loop.
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      if (response.stop_reason === "max_tokens") {
        // The model hit the 4096-token output ceiling mid-turn — this is NOT a
        // clean finish; it may have been about to call a tool. Keep the partial
        // assistant turn, nudge it to continue, and loop. This counts toward
        // MAX_ITERATIONS and the token breaker, so it can't spin forever; a
        // persistent max_tokens run finalizes via the iteration-cap path below.
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: "Продолжай." });
        continue;
      }

      // end_turn / stop_sequence → the agent is genuinely done.
      endedCleanly = true;
      break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(runId, "error", { kind: "error", message: msg, fatal: true });
    setRunStatus(runId, "failed", utcNow(), runCost);
    closeRunBus(runId);
    return;
  }

  // ── Finalization ──────────────────────────────────────────────────────────
  const cardCount = getCards(runId).length;
  if (stopReason === "budget") {
    setRunStatus(runId, "budget_exhausted", utcNow(), runCost);
  } else {
    // If we fell out of the loop because the iteration cap was hit (rather than
    // a natural end_turn), the run was forcibly truncated. We still report
    // terminal "complete" (it produced cards), but emit a message event first
    // so the truncation isn't silent and the user knows results may be partial.
    if (!endedCleanly) {
      emit(runId, "message", {
        kind: "message",
        text: "Достигнут предел шагов поиска — показаны частичные результаты.",
      });
    }
    setRunStatus(runId, "complete", utcNow(), runCost);
  }
  emit(runId, "final", { kind: "final", cardCount });
  closeRunBus(runId);
}
