// Agent tool registry — 7 plain async TS functions + zod schemas + metadata.
// Decoupled from the Anthropic Agent SDK on purpose: the orchestrator (next
// task) binds these to the SDK. Keeping them SDK-free makes them independently
// testable.
//
// The Haiku helper lives in `lib/agent/haiku.ts` (reasonable split to keep this
// file focused on the 7 tools).

import { z } from "zod";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

import { assertSafeUrl } from "@/lib/ssrf";
import { searchWeb } from "@/lib/agent/providers/tavily";
import { searchPlaces } from "@/lib/agent/providers/google-places";
import { query2gis, RateLimitError } from "@/lib/agent/providers/twogis";
import { upsertCard, appendEvent } from "@/lib/db-queries";
import { emitRunEvent } from "@/lib/events";
import { callHaikuJSON, callHaikuText } from "@/lib/agent/haiku";
import type { CardField, Contact } from "@/types";

// ── Tool plumbing ───────────────────────────────────────────────────────────

export interface ToolContext {
  runId: string;
}

export interface Tool<I> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  handler: (input: I, ctx: ToolContext) => Promise<unknown>;
}

// Emit a tool_call event at entry. Returns nothing; the caller emits the
// matching tool_result via `emitResult`.
function emitCall(runId: string, tool: string, label: string): void {
  const e = appendEvent(runId, "tool_call", { kind: "tool_call", tool, label });
  emitRunEvent(runId, e);
}

function emitResult(
  runId: string,
  tool: string,
  label: string,
  count?: number,
): void {
  const payload =
    count === undefined
      ? { kind: "tool_result" as const, tool, label }
      : { kind: "tool_result" as const, tool, label, count };
  const e = appendEvent(runId, "tool_result", payload);
  emitRunEvent(runId, e);
}

function emitCardUpdate(runId: string, cardId: string): void {
  const e = appendEvent(runId, "card_update", { kind: "card_update", cardId });
  emitRunEvent(runId, e);
}

// ── Shared zod shapes for LLM extraction ────────────────────────────────────

const confidenceSchema = z.enum(["high", "medium", "low"]);

const cardFieldSchema = z.object({
  value: z.string(),
  confidence: confidenceSchema,
  sourceSnippet: z.string().optional(),
});

const contactSchema = z.object({
  channel: z.enum(["telegram", "whatsapp", "phone", "instagram", "website"]),
  value: z.string(),
  confidence: confidenceSchema,
  source: z.string().optional(),
});

const extractionSchema = z.object({
  district: cardFieldSchema.nullable().optional(),
  address: cardFieldSchema.nullable().optional(),
  schedule: cardFieldSchema.nullable().optional(),
  priceRange: cardFieldSchema.nullable().optional(),
  ageRange: cardFieldSchema.nullable().optional(),
  contacts: z.array(contactSchema).optional(),
});

type Extraction = z.infer<typeof extractionSchema>;

// ── Tool 1: search_web ──────────────────────────────────────────────────────

const searchWebTool: Tool<{ query: string }> = {
  name: "search_web",
  description:
    "Поиск в интернете по запросу. Возвращает массив результатов { title, url, snippet }. Используй для поиска клубов, их сайтов, соцсетей и контактов.",
  inputSchema: z.object({
    query: z.string().describe("Поисковый запрос (на русском)."),
  }),
  async handler({ query }, { runId }) {
    emitCall(runId, "search_web", `Поиск: ${query}`);
    const results = await searchWeb(query);
    emitResult(runId, "search_web", `Найдено результатов: ${results.length}`, results.length);
    return results;
  },
};

// ── Tool 2: query_2gis ──────────────────────────────────────────────────────

const query2gisTool: Tool<{ category: string; district?: string }> = {
  name: "query_2gis",
  description:
    "Поиск организаций в справочнике 2ГИС по категории (и опционально району) в Астане. Возвращает { name, address, phones, url }[]. Если вернулось { rateLimited: true } — источник недоступен, используй query_google_places.",
  inputSchema: z.object({
    category: z.string().describe("Категория, например 'детский футбол' или 'шахматы'."),
    district: z.string().optional().describe("Район Астаны (опционально)."),
  }),
  async handler({ category, district }, { runId }) {
    const label = district ? `2ГИС: ${category}, ${district}` : `2ГИС: ${category}`;
    emitCall(runId, "query_2gis", label);
    try {
      const results = await query2gis(category, district);
      emitResult(runId, "query_2gis", `Найдено в 2ГИС: ${results.length}`, results.length);
      return results;
    } catch (err) {
      if (err instanceof RateLimitError) {
        emitResult(runId, "query_2gis", "2ГИС: лимит запросов, fallback на Google");
        return { rateLimited: true };
      }
      throw err;
    }
  },
};

// ── Tool 3: query_google_places ─────────────────────────────────────────────

const queryGooglePlacesTool: Tool<{ query: string }> = {
  name: "query_google_places",
  description:
    "Поиск мест в Google Places по текстовому запросу (привязка к Астане). Возвращает { name, address, placeId, location, phone?, website? }[]. Основной источник телефонов и сайтов.",
  inputSchema: z.object({
    query: z.string().describe("Текстовый запрос, например 'детская школа танцев Астана'."),
  }),
  async handler({ query }, { runId }) {
    emitCall(runId, "query_google_places", `Google Places: ${query}`);
    const results = await searchPlaces(query);
    emitResult(
      runId,
      "query_google_places",
      `Найдено в Google Places: ${results.length}`,
      results.length,
    );
    return results;
  },
};

// ── Tool 4: fetch_url ───────────────────────────────────────────────────────

const MAX_BYTES = 2 * 1024 * 1024; // ~2MB body cap
const MAX_TEXT_CHARS = 8000;

async function readCappedText(res: Response): Promise<string> {
  // Stream and cap at MAX_BYTES so a huge body can't blow up memory.
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c.subarray(0, Math.min(c.byteLength, MAX_BYTES - offset)), offset);
    offset += c.byteLength;
    if (offset >= MAX_BYTES) break;
  }
  return new TextDecoder("utf-8").decode(merged.subarray(0, MAX_BYTES));
}

const fetchUrlTool: Tool<{ url: string }> = {
  name: "fetch_url",
  description:
    "Загружает HTTPS-страницу (сайт клуба, профиль 2ГИС и т.п.) и возвращает очищенный читаемый текст. Только https; приватные/локальные адреса блокируются.",
  inputSchema: z.object({
    url: z.string().describe("Полный https URL страницы."),
  }),
  async handler({ url }, { runId }) {
    emitCall(runId, "fetch_url", `Загрузка: ${url}`);
    await assertSafeUrl(url);

    // redirect:"manual" so we can re-validate any redirect target against the
    // SSRF guard — a redirect to a private IP would otherwise bypass the check.
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: { "user-agent": "club-agent-recon/1.0" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        const next = new URL(loc, current).toString();
        await assertSafeUrl(next); // re-validate redirect target
        current = next;
        continue;
      }
      break;
    }
    if (!res) throw new Error("fetch produced no response");

    const html = await readCappedText(res);
    const dom = new JSDOM(html, { url: current });
    const article = new Readability(dom.window.document).parse();
    const text = (article?.textContent ?? dom.window.document.body?.textContent ?? "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const truncated = text.slice(0, MAX_TEXT_CHARS);
    emitResult(runId, "fetch_url", `Загружено, ${truncated.length} симв.`);
    return truncated;
  },
};

// ── Tool 5: extract_fields ──────────────────────────────────────────────────

const EXTRACT_SYSTEM = `Ты извлекаешь структурированные факты о детском клубе/секции из сырого текста страницы.
Верни СТРОГО JSON-объект без пояснений со схемой:
{
  "district": { "value": string, "confidence": "high"|"medium"|"low", "sourceSnippet": string } | null,
  "address": { ... } | null,
  "schedule": { ... } | null,
  "priceRange": { ... } | null,
  "ageRange": { ... } | null,
  "contacts": [ { "channel": "telegram"|"whatsapp"|"phone"|"instagram"|"website", "value": string, "confidence": "...", "source": string } ]
}
Правила:
- Каждое поле ОБЯЗАНО иметь sourceSnippet — точную фразу из текста, откуда взято значение.
- НИКОГДА не выдумывай данные. Если поля нет в тексте — ставь null (или пустой массив для contacts).
- Если не уверен — confidence: "low". Лучше честная неопределённость, чем догадка.`;

const extractFieldsTool: Tool<{
  cardId: string;
  name: string;
  rawText: string;
  sourceUrl: string;
}> = {
  name: "extract_fields",
  description:
    "Извлекает поля клуба (район, адрес, расписание, цена, возраст, контакты) из сырого текста страницы, создаёт/обновляет карточку и возвращает извлечённые поля.",
  inputSchema: z.object({
    cardId: z.string(),
    name: z.string(),
    rawText: z.string(),
    sourceUrl: z.string(),
  }),
  async handler({ cardId, name, rawText, sourceUrl }, { runId }) {
    emitCall(runId, "extract_fields", `Извлечение полей: ${name}`);

    const user = `Название клуба: ${name}\nИсточник (URL): ${sourceUrl}\n\nТекст страницы:\n${rawText.slice(0, MAX_TEXT_CHARS)}`;
    const fallback: Extraction = { contacts: [] };
    const extracted = await callHaikuJSON(EXTRACT_SYSTEM, user, extractionSchema, fallback);

    // Stamp sourceUrl onto contacts that lack a source.
    const contacts: Contact[] = (extracted.contacts ?? []).map((c) => ({
      ...c,
      source: c.source ?? sourceUrl,
    }));

    const toField = (f: typeof extracted.district): CardField<string> | undefined =>
      f ? { value: f.value, confidence: f.confidence, sourceSnippet: f.sourceSnippet } : undefined;

    upsertCard({
      id: cardId,
      runId,
      name,
      district: toField(extracted.district),
      address: toField(extracted.address),
      schedule: toField(extracted.schedule),
      priceRange: toField(extracted.priceRange),
      ageRange: toField(extracted.ageRange),
      contacts,
      sources: [sourceUrl],
    });

    emitCardUpdate(runId, cardId);

    const fieldCount =
      [extracted.district, extracted.address, extracted.schedule, extracted.priceRange, extracted.ageRange].filter(
        Boolean,
      ).length + contacts.length;
    emitResult(runId, "extract_fields", `Карточка ${name}: полей ${fieldCount}`, fieldCount);

    return { ...extracted, contacts };
  },
};

// ── Tool 6: draft_outreach ──────────────────────────────────────────────────

const DRAFT_SYSTEM = `Ты пишешь короткое (2-3 предложения) дружелюбное сообщение от лица родителя в детский клуб/секцию.
Сообщение на русском языке. Персонализируй под конкретный клуб и под то, что нужно родителю (возраст ребёнка, район, расписание, бюджет).
Тон: вежливый, естественный, без канцелярита. Верни ТОЛЬКО текст сообщения, без кавычек и пояснений.`;

const draftOutreachTool: Tool<{
  cardId: string;
  name: string;
  intentSummary: string;
}> = {
  name: "draft_outreach",
  description:
    "Создаёт дружелюбное сообщение-запрос на русском (2-3 предложения) в конкретный клуб, персонализированное под запрос родителя, и сохраняет его в карточке.",
  inputSchema: z.object({
    cardId: z.string(),
    name: z.string(),
    intentSummary: z.string().describe("Краткое описание того, что ищет родитель."),
  }),
  async handler({ cardId, name, intentSummary }, { runId }) {
    emitCall(runId, "draft_outreach", `Черновик сообщения: ${name}`);

    const user = `Клуб: ${name}\nЧто нужно родителю: ${intentSummary}\n\nНапиши сообщение в этот клуб.`;
    const fallback = `Здравствуйте! Подскажите, пожалуйста, есть ли у вас места и подходящие группы? ${intentSummary}. Буду признательна за информацию о расписании и стоимости.`;
    const message = await callHaikuText(DRAFT_SYSTEM, user, fallback);

    upsertCard({ id: cardId, runId, name, draftMessage: message });
    emitCardUpdate(runId, cardId);
    emitResult(runId, "draft_outreach", `Черновик готов: ${name}`);

    return message;
  },
};

// ── Tool 7: emit_card_update ────────────────────────────────────────────────

const emitCardUpdateTool: Tool<{
  cardId: string;
  name: string;
  partial?: {
    district?: CardField<string>;
    address?: CardField<string>;
    schedule?: CardField<string>;
    priceRange?: CardField<string>;
    ageRange?: CardField<string>;
    contacts?: Contact[];
    matchReason?: string;
    rank?: number;
    sources?: string[];
  };
}> = {
  name: "emit_card_update",
  description:
    "Создаёт или обновляет карточку клуба и сразу выводит её на экран. Используй, чтобы показать нового кандидата немедленно (до обогащения) или чтобы записать match reason / rank.",
  inputSchema: z.object({
    cardId: z.string(),
    name: z.string(),
    partial: z
      .object({
        district: cardFieldSchema.optional(),
        address: cardFieldSchema.optional(),
        schedule: cardFieldSchema.optional(),
        priceRange: cardFieldSchema.optional(),
        ageRange: cardFieldSchema.optional(),
        contacts: z.array(contactSchema).optional(),
        matchReason: z.string().optional(),
        rank: z.number().optional(),
        sources: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  async handler({ cardId, name, partial }, { runId }) {
    emitCall(runId, "emit_card_update", `Карточка: ${name}`);
    upsertCard({ id: cardId, runId, name, ...(partial ?? {}) });
    emitCardUpdate(runId, cardId);
    emitResult(runId, "emit_card_update", `Обновлена карточка: ${name}`);
    return { ok: true, cardId };
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: Tool<any>[] = [
  searchWebTool,
  query2gisTool,
  queryGooglePlacesTool,
  fetchUrlTool,
  extractFieldsTool,
  draftOutreachTool,
  emitCardUpdateTool,
];

export {
  searchWebTool,
  query2gisTool,
  queryGooglePlacesTool,
  fetchUrlTool,
  extractFieldsTool,
  draftOutreachTool,
  emitCardUpdateTool,
};
