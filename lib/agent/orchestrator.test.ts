// Offline regression tests for the orchestrator tool-use loop.
//
// No real Anthropic API calls, no real sqlite, no real network. The orchestrator's
// dependencies (db-queries / budget / events / tools / playbook) are mocked so we
// can drive scripted model responses through `runAgent` and assert the message
// threading invariant the API enforces:
//
//   EVERY tool_use block in an assistant message MUST be answered by a matching
//   tool_result in the very next user message — on every code path, including a
//   max_tokens-truncated turn that still contains tool_use blocks.
//
// The headline regression (Bug 1): a response with stop_reason:"max_tokens" that
// CONTAINS tool_use blocks must NOT push a bare "Продолжай." while those ids are
// unanswered (that caused the live 400). It must execute them and return a
// tool_result for every id.

import { describe, test, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ── Mocks ───────────────────────────────────────────────────────────────────

// A controllable tool registry. Each test resets handler behavior as needed.
const searchHandler = vi.fn(async (_i: unknown) => ({ ok: true, results: [] }));
const draftHandler = vi.fn(async (_i: unknown) => ({ ok: true, draft: "..." }));

vi.mock("@/lib/agent/tools", () => ({
  clearRunEnrichment: vi.fn(),
  tools: [
    {
      name: "search_web",
      description: "search",
      inputSchema: z.object({ query: z.string() }),
      handler: (i: unknown) => searchHandler(i),
    },
    {
      name: "draft_outreach",
      description: "draft",
      inputSchema: z.object({ cardId: z.string(), name: z.string() }),
      handler: (i: unknown) => draftHandler(i),
    },
  ],
}));

vi.mock("@/lib/agent/playbook", () => ({
  SYSTEM_PROMPT: "system",
  buildIntentBlock: () => "INTENT",
}));

const setRunStatus = vi.fn((..._a: unknown[]) => undefined);
const appendEvent = vi.fn((runId: string, kind: string, payload: unknown) => ({
  id: 1,
  runId,
  ts: 0,
  kind,
  payload,
}));
const getCards = vi.fn((..._a: unknown[]) => [] as unknown[]);
const getRun = vi.fn((id: string) => ({ id, rawQuery: "плавание для сына 8 лет" }));

vi.mock("@/lib/db-queries", () => ({
  setRunStatus: (...a: unknown[]) => setRunStatus(...a),
  appendEvent: (runId: string, kind: string, payload: unknown) =>
    appendEvent(runId, kind, payload),
  getCards: (...a: unknown[]) => getCards(...a),
  getRun: (id: string) => getRun(id),
}));

vi.mock("@/lib/events", () => ({
  emitRunEvent: vi.fn(),
  closeRunBus: vi.fn(),
}));

vi.mock("@/lib/budget", () => ({
  isDailyBudgetExhausted: () => false,
  addDailyCost: vi.fn(),
}));

// Imported AFTER the mocks are registered.
import { runAgent } from "./orchestrator";
import type { Intent } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const USAGE = { input_tokens: 10, output_tokens: 10 } as Anthropic.Usage;

function textBlock(text: string): Anthropic.ContentBlock {
  return { type: "text", text, citations: null } as unknown as Anthropic.ContentBlock;
}
function toolUseBlock(id: string, name: string, input: unknown): Anthropic.ContentBlock {
  return { type: "tool_use", id, name, input } as unknown as Anthropic.ContentBlock;
}
function response(
  stop_reason: Anthropic.Message["stop_reason"],
  content: Anthropic.ContentBlock[],
): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content,
    stop_reason,
    stop_sequence: null,
    usage: USAGE,
  } as unknown as Anthropic.Message;
}

// A mock client that replays a scripted sequence of responses and records every
// `messages.create` call so we can inspect what was threaded back.
function mockClient(script: Anthropic.Message[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    const r = script[Math.min(i, script.length - 1)];
    i++;
    return r;
  });
  // Only `messages.create` is exercised; cast the partial mock to the client shape.
  const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
  return { client, calls, create };
}

const INTENT = {} as Intent;

// Each `messages.create` call carries the FULL accumulated message history, so
// the LAST call's `messages` array is the complete transcript the orchestrator
// built. Inspect that single array to avoid double-counting messages that ride
// along in every subsequent call. (If the loop never advanced past one call,
// the last call's history is still the canonical one.)
function transcript(
  calls: Anthropic.MessageCreateParamsNonStreaming[],
): Anthropic.MessageParam[] {
  if (calls.length === 0) return [];
  // The transcript only ever GROWS, so the longest history is authoritative.
  return calls.reduce(
    (longest, c) => (c.messages.length > longest.length ? c.messages : longest),
    [] as Anthropic.MessageParam[],
  );
}

// All user-role messages in the transcript whose content is an array of
// tool_result blocks.
function toolResultMessages(calls: Anthropic.MessageCreateParamsNonStreaming[]) {
  return transcript(calls).filter(
    (m) =>
      m.role === "user" &&
      Array.isArray(m.content) &&
      m.content.every((b) => typeof b === "object" && b.type === "tool_result"),
  );
}

// Every tool_use id that appears in any assistant message in the transcript.
function allToolUseIds(calls: Anthropic.MessageCreateParamsNonStreaming[]): string[] {
  const ids: string[] = [];
  for (const m of transcript(calls)) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (typeof b === "object" && b.type === "tool_use") ids.push(b.id);
    }
  }
  return ids;
}

// Every tool_result id threaded back in the transcript.
function allToolResultIds(calls: Anthropic.MessageCreateParamsNonStreaming[]): string[] {
  const ids: string[] = [];
  for (const m of transcript(calls)) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (typeof b === "object" && b.type === "tool_result") ids.push(b.tool_use_id);
    }
  }
  return ids;
}

// Did any user message consist solely of the bare "Продолжай." nudge?
function pushedBareContinue(calls: Anthropic.MessageCreateParamsNonStreaming[]): boolean {
  return transcript(calls).some(
    (m) => m.role === "user" && m.content === "Продолжай.",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  searchHandler.mockResolvedValue({ ok: true, results: [] });
  draftHandler.mockResolvedValue({ ok: true, draft: "..." });
  getCards.mockReturnValue([]);
  getRun.mockReturnValue({ id: "run", rawQuery: "плавание для сына 8 лет" });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("orchestrator threading invariant", () => {
  test("REGRESSION: max_tokens turn CONTAINING tool_use → every id answered, no bare Продолжай", async () => {
    // The live-crash scenario: the model emits several tool_use blocks but the
    // turn is truncated at the output ceiling, so stop_reason is "max_tokens".
    const script = [
      response("max_tokens", [
        textBlock("Готовлю черновики…"),
        toolUseBlock("tu_1", "draft_outreach", { cardId: "a", name: "A" }),
        toolUseBlock("tu_2", "draft_outreach", { cardId: "b", name: "B" }),
        toolUseBlock("tu_3", "draft_outreach", { cardId: "c", name: "C" }),
      ]),
      response("end_turn", [textBlock("Готово.")]),
    ];
    const { client, calls } = mockClient(script);

    await runAgent("run", INTENT, client);

    // Every tool_use id got a tool_result.
    const useIds = allToolUseIds(calls);
    const resultIds = allToolResultIds(calls);
    expect(useIds.sort()).toEqual(["tu_1", "tu_2", "tu_3"]);
    expect(resultIds.sort()).toEqual(["tu_1", "tu_2", "tu_3"]);

    // The tool_result message immediately followed the tool_use assistant turn
    // (it rode in the 2nd model call's message history).
    const trMsgs = toolResultMessages(calls);
    expect(trMsgs).toHaveLength(1);
    expect((trMsgs[0].content as Anthropic.ToolResultBlockParam[]).map((b) => b.tool_use_id).sort())
      .toEqual(["tu_1", "tu_2", "tu_3"]);

    // The bug: a bare "Продолжай." while tool_use ids are unanswered. Must NOT happen.
    expect(pushedBareContinue(calls)).toBe(false);

    // Handlers actually ran for all three ids.
    expect(draftHandler).toHaveBeenCalledTimes(3);

    // Run completed cleanly.
    expect(setRunStatus).toHaveBeenCalledWith("run", "complete", expect.any(Number), expect.any(Number));
  });

  test("invalid tool input under max_tokens still yields an is_error tool_result for that id", async () => {
    // A truncated/invalid input must still get a result (is_error) so the id is answered.
    const script = [
      response("max_tokens", [
        toolUseBlock("tu_bad", "draft_outreach", { cardId: "a" /* missing name */ }),
      ]),
      response("end_turn", [textBlock("Готово.")]),
    ];
    const { client, calls } = mockClient(script);

    await runAgent("run", INTENT, client);

    const trMsgs = toolResultMessages(calls);
    expect(trMsgs).toHaveLength(1);
    const blocks = trMsgs[0].content as Anthropic.ToolResultBlockParam[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tool_use_id).toBe("tu_bad");
    expect(blocks[0].is_error).toBe(true);
    expect(pushedBareContinue(calls)).toBe(false);
  });

  test("normal stop_reason:tool_use → tool executed, ids answered, loop continues", async () => {
    const script = [
      response("tool_use", [toolUseBlock("tu_s", "search_web", { query: "плавание Астана" })]),
      response("end_turn", [textBlock("Готово.")]),
    ];
    const { client, calls } = mockClient(script);

    await runAgent("run", INTENT, client);

    expect(searchHandler).toHaveBeenCalledTimes(1);
    expect(allToolResultIds(calls)).toEqual(["tu_s"]);
    expect(pushedBareContinue(calls)).toBe(false);
    expect(setRunStatus).toHaveBeenCalledWith("run", "complete", expect.any(Number), expect.any(Number));
  });

  test("max_tokens with NO tool_use → pushes bare Продолжай and continues", async () => {
    const script = [
      response("max_tokens", [textBlock("Длинное рассуждение, обрезано…")]),
      response("end_turn", [textBlock("Готово.")]),
    ];
    const { client, calls } = mockClient(script);

    await runAgent("run", INTENT, client);

    // Pure text truncation: a bare nudge is the correct behavior here.
    expect(pushedBareContinue(calls)).toBe(true);
    expect(allToolResultIds(calls)).toEqual([]);
    expect(setRunStatus).toHaveBeenCalledWith("run", "complete", expect.any(Number), expect.any(Number));
  });

  test("normal end_turn → clean finish, one setRunStatus complete, one final event", async () => {
    const script = [response("end_turn", [textBlock("Готово.")])];
    const { client, calls } = mockClient(script);

    await runAgent("run", INTENT, client);

    expect(calls).toHaveLength(1);
    expect(setRunStatus).toHaveBeenCalledTimes(1);
    expect(setRunStatus).toHaveBeenCalledWith("run", "complete", expect.any(Number), expect.any(Number));
    const kinds = appendEvent.mock.calls.map((c) => c[1]);
    expect(kinds.filter((k) => k === "final")).toHaveLength(1);
  });

  test("30 consecutive tool_use turns → iteration cap, truncation message, still complete", async () => {
    // Always returns a tool_use turn; the loop must hit MAX_ITERATIONS (30),
    // emit the truncation message, and finalize complete exactly once.
    const oneToolUse = response("tool_use", [
      toolUseBlock("tu_loop", "search_web", { query: "x" }),
    ]);
    const { client, calls, create } = mockClient([oneToolUse]);

    await runAgent("run", INTENT, client);

    expect(create).toHaveBeenCalledTimes(30);
    const texts = appendEvent.mock.calls
      .filter((c) => c[1] === "message")
      .map((c) => (c[2] as { text: string }).text);
    expect(texts.some((t) => t.includes("предел шагов поиска"))).toBe(true);
    expect(setRunStatus).toHaveBeenCalledTimes(1);
    expect(setRunStatus).toHaveBeenCalledWith("run", "complete", expect.any(Number), expect.any(Number));
    // Every tool_use turn was answered with tool_results — never a bare nudge.
    // (One result-bearing user message per executed tool_use turn.)
    expect(toolResultMessages(calls).length).toBeGreaterThanOrEqual(29);
    expect(pushedBareContinue(calls)).toBe(false);
  });
});
