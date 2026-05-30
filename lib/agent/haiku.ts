// Minimal Anthropic Messages API helper for the extract/draft tools.
// Uses the bundled @anthropic-ai/sdk if importable; otherwise falls back to
// fetch against the Messages API. Both paths read ANTHROPIC_API_KEY from env.
// JSON variant zod-validates output, retries once, then returns a caller-
// supplied fallback rather than throwing — tools must never throw out of band.

import type { z } from "zod";

const HAIKU_MODEL = "claude-haiku-4-5";

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicMessageResponse {
  content?: AnthropicTextBlock[];
}

// Lazy SDK client; null if the SDK could not be loaded (we then use fetch).
let sdkClient: { messages: { create: (args: unknown) => Promise<unknown> } } | null =
  null;
let sdkResolved = false;

async function getSdkClient() {
  if (sdkResolved) return sdkClient;
  sdkResolved = true;
  try {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = (mod as { default?: unknown }).default ?? mod;
    const Ctor = Anthropic as unknown as new (opts: {
      apiKey: string | undefined;
    }) => { messages: { create: (args: unknown) => Promise<unknown> } };
    sdkClient = new Ctor({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch {
    sdkClient = null;
  }
  return sdkClient;
}

function extractText(resp: AnthropicMessageResponse): string {
  return (resp.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

async function callHaiku(system: string, user: string): Promise<string> {
  const client = await getSdkClient();
  const args = {
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  };

  if (client) {
    const resp = (await client.messages.create(args)) as AnthropicMessageResponse;
    return extractText(resp);
  }

  // Fetch fallback.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`anthropic messages failed: ${res.status}`);
  const data = (await res.json()) as AnthropicMessageResponse;
  return extractText(data);
}

// Strip ```json fences and grab the first {...} or [...] block if the model
// wrapped the JSON in prose.
function coerceJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const firstBrace = s.search(/[[{]/);
  if (firstBrace > 0) s = s.slice(firstBrace);
  return s.trim();
}

/**
 * Call Haiku and parse+validate a JSON response against `schema`.
 * On any failure (API error, parse error, validation error) retries once;
 * if it still fails, returns `fallback` and never throws.
 */
export async function callHaikuJSON<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callHaiku(system, user);
      const parsed = JSON.parse(coerceJson(text));
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // fall through to retry
    }
  }
  return fallback;
}

/**
 * Call Haiku for a plain-text response. On failure retries once, then returns
 * `fallback`. Never throws.
 */
export async function callHaikuText(
  system: string,
  user: string,
  fallback: string,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callHaiku(system, user);
      if (text.trim()) return text.trim();
    } catch {
      // fall through to retry
    }
  }
  return fallback;
}
