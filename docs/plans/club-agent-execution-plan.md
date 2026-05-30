---
title: Club Agent — Execution Plan
date: 2026-05-30
aliases: [club-agent-plan]
---

# Club Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, authless, agent-driven web app that finds Astana children's кружки, runs live recon, drafts outreach, and produces shareable run URLs.

**Architecture:** Next.js (App Router) monolith on a persistent Node process. An in-process Anthropic Agent SDK loop spawned per request persists events to SQLite and fans them out over a per-run EventEmitter to SSE clients. Two-tier model routing (Sonnet 4.6 orchestrator + Haiku 4.5 workers). Dark-first violet UI. Deployed to Hetzner behind Cloudflare + Turnstile.

**Tech Stack:** Next.js · TypeScript · Tailwind + shadcn/ui · better-sqlite3 · @anthropic-ai/claude-agent-sdk · Tavily · Google Places · 2GIS · Caddy · systemd · Hetzner · Cloudflare · DuckDNS.

**Spec:** `docs/specs/club-agent-design.md` — read it before starting; this plan assumes it.

**Plan philosophy:** Full code is given for the correctness-critical units (SSRF guard, budget circuit-breaker, SSE replay+tail, EventEmitter registry, prompt-cache layout), with test checkpoints on those. Boilerplate and UI tasks give exact interfaces + acceptance criteria. This keeps the plan precise where mistakes are expensive and lean where they are not.

---

## Execution model — two parallel tracks

The work splits into a **Backend track** and a **Frontend track** that run in parallel after Phase 0. The single thing that makes parallel work safe is freezing the shared contract (`types/index.ts`) in Phase 0 — both tracks build against it, the SSE event taxonomy, and the API route shapes, and never import each other's internal files. They meet only at the contract and at Phase 5.

```
Phase 0 (scaffold + shared contract) ── BLOCKS ALL
        │
        ├──────────── handoff: pull main, start Frontend track ──────────┐
        │                                                                  │
   BACKEND TRACK                                   FRONTEND TRACK           │
   P1 Persistence                                  F1 Landing + query box   │
   P2 Agent core (tools, playbook, orchestrator)   F2 Intent chips          │
   P3 API + SSE                                     F3 use-run-stream hook   │
                                                     F4 Activity stream       │
                                                     F5 Candidate card        │
                                                     F6 Run-page 3-panel      │
                                                     F7 Design files + seed    │
        │                                                    │               │
        └──────────── Phase 5 Integration (merge) ◄──────────┘               │
                              │                                              │
                        Phase 6 Deploy ───────────────────────────────────────┘
```

**Time budget (rough):** Backend track ≈ 11h · Frontend track ≈ 6h · overlapping.

---

## File structure (locked in Phase 0)

```
club-agent/
├── DESIGN.md                       # tokens + rationale
├── STYLE.md                        # banned words/structures
├── impeccable.md                   # rule excerpt
├── .hallmark/log.json              # slop-gate state
├── .env.example                    # placeholders only
├── .gitignore .gitleaks.toml       # secret hygiene
├── package.json next.config.mjs tsconfig.json
├── tailwind.config.ts              # consumes DESIGN.md tokens
├── app/
│   ├── layout.tsx globals.css      # font, theme, token CSS vars
│   ├── page.tsx                    # landing
│   ├── runs/[id]/page.tsx          # run page (SSR shell)
│   └── api/
│       ├── runs/route.ts           # POST create run
│       └── runs/[id]/
│           ├── route.ts            # GET snapshot
│           └── stream/route.ts     # GET SSE
├── lib/
│   ├── db.ts db-queries.ts         # better-sqlite3 + typed helpers
│   ├── events.ts                   # per-run EventEmitter registry
│   ├── intent.ts                   # Haiku intent extraction
│   ├── budget.ts ratelimit.ts      # caps + IP hashing
│   ├── turnstile.ts ssrf.ts        # verify + URL safety
│   └── agent/
│       ├── orchestrator.ts         # Agent SDK loop + system prompt
│       ├── tools.ts playbook.ts    # 7 tools + recon prompt
│       └── providers/{tavily,google-places,twogis}.ts
├── components/
│   ├── ui/                         # shadcn primitives
│   ├── query-box.tsx intent-chips.tsx
│   ├── activity-stream.tsx candidate-card.tsx
│   ├── confidence-badge.tsx budget-meter.tsx
├── hooks/use-run-stream.ts         # EventSource client hook
├── types/index.ts                  # SHARED CONTRACT (Phase 0)
├── data/seed-clubs.json            # curated dataset
├── scripts/deploy.sh               # git push → server
└── docs/{specs,plans,deploy.md}
```

---

## Phase 0 — Scaffold & shared contract  [BLOCKS ALL · ~1.5h]

### Task 0.1: Initialize Next.js project

**Files:** repo root (existing `~/Code/club-agent`).

- [ ] **Step 1:** In `~/Code/club-agent`, scaffold without overwriting LICENSE/README:
```bash
cd ~/Code/club-agent
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --eslint
```
If prompted about a non-empty dir, keep existing files. Resolve any README/`.gitignore` conflict by keeping the richer version.
- [ ] **Step 2:** Install runtime deps:
```bash
npm i better-sqlite3 @anthropic-ai/claude-agent-sdk nanoid zod
npm i -D @types/better-sqlite3
```
- [ ] **Step 3:** Init shadcn/ui:
```bash
npx shadcn@latest init -d
npx shadcn@latest add button input badge card popover skeleton tooltip
```
- [ ] **Step 4:** Verify dev server boots: `npm run dev` → open `http://localhost:3000` → default page renders. Kill server.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "chore: scaffold next.js + tailwind + shadcn"`

### Task 0.2: Write the shared contract — `types/index.ts`

This file is the interface both tracks build against. It must be complete and exact.

- [ ] **Step 1:** Create `types/index.ts`:
```typescript
// ── Intent ────────────────────────────────────────────────
export type Category =
  | "sport" | "art" | "music" | "language" | "coding" | "dance" | "chess" | "other";

export interface IntentField<T> {
  value: T | null;
  present: boolean;
  confidence: "high" | "medium" | "low";
}

export interface Intent {
  category: IntentField<Category>;     // required
  age: IntentField<string>;            // required (e.g. "8" or "6-9")
  district: IntentField<string>;       // optional
  budget: IntentField<string>;         // optional (e.g. "≤30000₸/mo")
  schedule: IntentField<string>;       // optional
  hardRequirements: IntentField<string[]>; // optional
}

export const REQUIRED_INTENT_FIELDS = ["category", "age"] as const;

// ── Run ───────────────────────────────────────────────────
export type RunStatus = "running" | "complete" | "failed" | "budget_exhausted";

export interface Run {
  id: string;
  createdAt: number;        // unix seconds
  rawQuery: string;
  intent: Intent;
  status: RunStatus;
  finishedAt: number | null;
  costUsd: number | null;
}

// ── Events (SSE wire taxonomy) ────────────────────────────
export type RunEventKind =
  | "tool_call" | "tool_result" | "thinking"
  | "message" | "card_update" | "final" | "error";

export interface RunEvent {
  id: number;               // monotonic per run (run_events.id)
  runId: string;
  ts: number;
  kind: RunEventKind;
  payload: RunEventPayload;
}

export type RunEventPayload =
  | { kind: "tool_call"; tool: string; label: string }
  | { kind: "tool_result"; tool: string; label: string; count?: number }
  | { kind: "thinking"; text: string }
  | { kind: "message"; text: string }
  | { kind: "card_update"; cardId: string }
  | { kind: "final"; cardCount: number }
  | { kind: "error"; message: string; fatal: boolean };

// ── Card ──────────────────────────────────────────────────
export type ContactChannel = "telegram" | "whatsapp" | "phone" | "instagram" | "website";

export interface Contact {
  channel: ContactChannel;
  value: string;            // handle, number, or url
  confidence: "high" | "medium" | "low";
  source?: string;          // url the value came from
}

export interface CardField<T> {
  value: T;
  confidence: "high" | "medium" | "low";
  sourceSnippet?: string;   // text the agent extracted from
}

export interface Card {
  id: string;
  runId: string;
  name: string;
  district?: CardField<string>;
  address?: CardField<string>;
  contacts: Contact[];
  schedule?: CardField<string>;
  priceRange?: CardField<string>;
  ageRange?: CardField<string>;
  matchReason?: string;
  draftMessage?: string;
  rank?: number;
  sources: string[];        // all urls visited for this card
}

// ── API shapes ────────────────────────────────────────────
export interface CreateRunRequest {
  rawQuery: string;
  turnstileToken: string;
}
export interface CreateRunResponse {
  runId: string;
  intent: Intent;            // extracted; chips render from this
}
export interface RunSnapshot {
  run: Run;
  events: RunEvent[];
  cards: Card[];
}
```
- [ ] **Step 2:** `npx tsc --noEmit` → no errors.
- [ ] **Step 3:** Commit: `git add types/index.ts && git commit -m "feat: shared type contract"`

### Task 0.3: Seed design tokens — `DESIGN.md`, `tailwind.config.ts`, `globals.css`, font

Encodes spec §6.0. Seed the machine-readable tokens now; the rationale prose and the other discipline files come in F.7.

- [ ] **Step 1:** Create `DESIGN.md` with the spec §6.0 OKLCH token table (color, type, spacing, radius, motion) as YAML front-tokens + a short rationale paragraph. Copy values verbatim from spec §6.0.
- [ ] **Step 2:** In `app/layout.tsx`, load Plus Jakarta Sans via `next/font/google`, apply to `<body>`, set `<html className="dark">` (dark-first, no toggle).
- [ ] **Step 3:** In `app/globals.css`, define the §6.0 tokens as CSS custom properties under `:root` (and `.dark`), e.g. `--bg: oklch(0.18 0.02 290);` … through the full set.
- [ ] **Step 4:** In `tailwind.config.ts`, map tokens to theme: `colors.bg`, `colors.surface`, `colors.accent`, etc. → `var(--bg)`…; `borderRadius` → pill/card/control; spacing scale 8/16/24/32/48/80/120.
- [ ] **Step 5:** Replace `app/page.tsx` body with a single centered `<h1>Club Agent</h1>` using accent color, to eyeball the token wiring. `npm run dev` → confirm dark violet bg + off-white heading + correct font.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat: design tokens + dark theme + font"`

### Task 0.4: Secret hygiene

- [ ] **Step 1:** Append to `.gitignore`: `.env`, `.env.local`, `*.sqlite`, `*.sqlite-*`, `.hallmark/cache`.
- [ ] **Step 2:** Create `.env.example` with every var from spec §8.2 (placeholders only, no values).
- [ ] **Step 3:** Create `.gitleaks.toml` (use default ruleset) and a `.git/hooks/pre-commit` that runs `gitleaks protect --staged --no-banner` (install gitleaks: `brew install gitleaks`). Make hook executable.
- [ ] **Step 4:** Test the hook: create a throwaway file containing a fake `sk-ant-` string, `git add`, attempt commit → expect block. Remove the file.
- [ ] **Step 5:** Commit: `git add .gitignore .env.example .gitleaks.toml && git commit -m "chore: secret hygiene + gitleaks pre-commit"`
- [ ] **Step 6:** Push: `git push origin main`. **← HANDOFF POINT: the Frontend track can now pull `main` and begin.**

---

## Phase 1 — Persistence  [Backend track · ~1h]

### Task 1.1: Database init + schema — `lib/db.ts`

**Files:** Create `lib/db.ts`.

- [ ] **Step 1:** Implement a singleton `better-sqlite3` connection at `process.env.DATABASE_PATH ?? "./dev.sqlite"`, `PRAGMA journal_mode=WAL`, and run the spec §4 `CREATE TABLE IF NOT EXISTS` statements (runs, run_events, cards, budget_ledger, ip_ledger) + indexes on first import.
- [ ] **Step 2:** Export the connection as `db`.
- [ ] **Step 3:** Smoke test: a temp script imports `db`, inserts a runs row, selects it back. Run with `npx tsx`. Delete the script.
- [ ] **Step 4:** Commit: `feat: sqlite schema + connection`

### Task 1.2: Typed query helpers — `lib/db-queries.ts`

**Files:** Create `lib/db-queries.ts`.

- [ ] **Step 1:** Implement and export, all using prepared statements, all converting to/from the `types/index.ts` shapes (JSON.parse/stringify the `_json` columns):
  - `createRun(input: { id, rawQuery, intent, clientIpHash }): void`
  - `getRun(id): Run | null`
  - `setRunStatus(id, status, finishedAt?, costUsd?): void`
  - `appendEvent(runId, kind, payload): RunEvent`  ← returns the row incl. its new `id`
  - `getEventsSince(runId, afterId): RunEvent[]`
  - `getEvents(runId): RunEvent[]`
  - `upsertCard(card: Partial<Card> & { id, runId, name }): void`
  - `getCards(runId): Card[]`
- [ ] **Step 2:** Since better-sqlite3 is synchronous, `appendEvent` returns its new row synchronously so callers can immediately emit it on the bus (see Phase 3). No async queue needed at MVP scale.
- [ ] **Step 3:** Commit: `feat: typed db query helpers`

### Task 1.3: Per-run EventEmitter registry — `lib/events.ts`

The live-fanout mechanism. Full code given.

**Files:** Create `lib/events.ts`. **Test:** `lib/events.test.ts`.

- [ ] **Step 1:** Write the failing test `lib/events.test.ts`:
```typescript
import { test, expect } from "vitest";
import { getRunBus, emitRunEvent } from "./events";
test("subscriber receives events emitted after subscribe", async () => {
  const bus = getRunBus("run1");
  const received: any[] = [];
  bus.on("event", (e) => received.push(e));
  emitRunEvent("run1", { id: 1, runId: "run1", ts: 0, kind: "message", payload: { kind: "message", text: "hi" } } as any);
  await new Promise((r) => setTimeout(r, 0));
  expect(received).toHaveLength(1);
});
```
- [ ] **Step 2:** `npx vitest run lib/events.test.ts` → FAIL (module not found). (Install: `npm i -D vitest`.)
- [ ] **Step 3:** Implement `lib/events.ts`:
```typescript
import { EventEmitter } from "node:events";
import type { RunEvent } from "@/types";

const buses = new Map<string, EventEmitter>();

export function getRunBus(runId: string): EventEmitter {
  let bus = buses.get(runId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(50); // many SSE viewers per shared run
    buses.set(runId, bus);
  }
  return bus;
}

export function emitRunEvent(runId: string, event: RunEvent): void {
  getRunBus(runId).emit("event", event);
}

// Call when a run reaches a terminal status to free memory.
export function closeRunBus(runId: string): void {
  const bus = buses.get(runId);
  if (bus) { bus.emit("end"); bus.removeAllListeners(); buses.delete(runId); }
}
```
- [ ] **Step 4:** `npx vitest run lib/events.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat: per-run event bus registry`

---

## Phase 2 — Agent core  [Backend track · ~4h]

### Task 2.1: SSRF guard — `lib/ssrf.ts`

Security-critical. Full code + test.

**Files:** Create `lib/ssrf.ts`. **Test:** `lib/ssrf.test.ts`.

- [ ] **Step 1:** Failing test `lib/ssrf.test.ts`:
```typescript
import { test, expect } from "vitest";
import { assertSafeUrl } from "./ssrf";
test("blocks private + metadata + non-https", async () => {
  await expect(assertSafeUrl("http://example.com")).rejects.toThrow();        // not https
  await expect(assertSafeUrl("https://169.254.169.254/")).rejects.toThrow();  // metadata
  await expect(assertSafeUrl("https://localhost/")).rejects.toThrow();
  await expect(assertSafeUrl("https://10.0.0.1/")).rejects.toThrow();         // RFC1918
});
test("allows a public https host", async () => {
  await expect(assertSafeUrl("https://2gis.kz/astana")).resolves.toBeUndefined();
});
```
- [ ] **Step 2:** `npx vitest run lib/ssrf.test.ts` → FAIL.
- [ ] **Step 3:** Implement `lib/ssrf.ts`:
```typescript
import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  // IPv6: block loopback, link-local, ULA
  const lo = ip.toLowerCase();
  return lo === "::1" || lo.startsWith("fe80") || lo.startsWith("fc") || lo.startsWith("fd");
}

export async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid url"); }
  if (u.protocol !== "https:") throw new Error("only https allowed");
  const host = u.hostname;
  if (host === "localhost") throw new Error("blocked host");
  const { address } = await lookup(host);
  if (isPrivate(address)) throw new Error("blocked private ip");
}
```
- [ ] **Step 4:** `npx vitest run lib/ssrf.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat: ssrf guard for fetch_url`

### Task 2.2: Search providers — `lib/agent/providers/*`

**Files:** Create `tavily.ts`, `google-places.ts`, `twogis.ts` in `lib/agent/providers/`.

- [ ] **Step 1:** `tavily.ts` — `searchWeb(query: string): Promise<{title,url,snippet}[]>`. POST `https://api.tavily.com/search` with `{ api_key: env.TAVILY_API_KEY, query, max_results: 10 }`. Map results. On non-200, throw a labeled error.
- [ ] **Step 2:** `google-places.ts` — `searchPlaces(query: string): Promise<{name,address,placeId,location}[]>`. Use Places Text Search (New) `https://places.googleapis.com/v1/places:searchText`, header `X-Goog-Api-Key`, body `{ textQuery: query, locationBias: { circle: { center: { latitude: 51.1605, longitude: 71.4704 }, radius: 50000 } } }` (Astana). Field mask `places.displayName,places.formattedAddress,places.id,places.location`.
- [ ] **Step 3:** `twogis.ts` — `query2gis(category: string, district?: string): Promise<{name,address,phones,url}[]>`. Use 2GIS Catalog API `https://catalog.api.2gis.com/3.0/items` with `key=env.TWOGIS_API_KEY`, `q=<category> <district> Астана`, `region_id` for Astana. Tolerate demo-key rate-limit: on 429/403, throw a typed `RateLimitError`.
- [ ] **Step 4:** Each provider: guard missing API key by throwing a clear "provider X not configured" so the orchestrator can skip gracefully.
- [ ] **Step 5:** Commit: `feat: search providers (tavily, google places, 2gis)`

### Task 2.3: Tools + playbook — `lib/agent/tools.ts`, `lib/agent/playbook.ts`

**Files:** Create both.

- [ ] **Step 1:** `playbook.ts` — export `SYSTEM_PROMPT` (string) encoding spec §5.3 recon playbook + the rule "every extracted field MUST carry {value, confidence, sourceSnippet}; never invent contacts; surface uncertainty." Export `buildIntentBlock(intent): string`.
- [ ] **Step 2:** `tools.ts` — define the 7 tools (spec §5.2) as Agent SDK tool definitions with zod input schemas. Implementations:
  - `search_web` → `providers/tavily`
  - `query_2gis` → `providers/twogis` (catch RateLimitError → return `{rateLimited:true}` so the model falls back)
  - `query_google_places` → `providers/google-places`
  - `fetch_url` → `assertSafeUrl()` then `fetch` with 10s `AbortSignal.timeout`, 2MB cap, then Readability→markdown (use `@mozilla/readability` + `jsdom`; `npm i @mozilla/readability jsdom`)
  - `extract_fields` → dispatch a **Haiku** sub-call (Agent SDK subagent or direct Messages call with `model: claude-haiku-4-5`) returning the `CardField` shape; `upsertCard` then `appendEvent('card_update')` + `emitRunEvent`
  - `draft_outreach` → Haiku sub-call producing a 2–3 sentence Russian DM; `upsertCard({draftMessage})`
  - `emit_card_update` → `upsertCard` + `appendEvent('card_update')` + `emitRunEvent`
- [ ] **Step 3:** Each tool wrapper, on entry, calls `appendEvent('tool_call', …)` + emit; on exit `appendEvent('tool_result', …)` + emit. This is what populates the activity stream.
- [ ] **Step 4:** Commit: `feat: agent tools + recon playbook`

### Task 2.4: Orchestrator + budget wiring — `lib/agent/orchestrator.ts`

**Files:** Create `lib/agent/orchestrator.ts`. Depends on `lib/budget.ts` (Task 3.1) for the cap check — implement those budget functions now if not present.

- [ ] **Step 1:** Implement `runAgent(runId: string, intent: Intent): Promise<void>`:
  - Build the Anthropic Agent SDK query with **prompt-cache layout per spec §5.4**: tool defs (cache) → `SYSTEM_PROMPT` (cache) → `buildIntentBlock(intent)` (cache) → live messages. Set `cache_control: { type: "ephemeral" }` on the last cacheable block.
  - Orchestrator `model: claude-sonnet-4-6`. Workers `model: claude-haiku-4-5`.
  - **PreToolUse hook:** if `isDailyBudgetExhausted()` OR `runTokens > 200_000` → abort the loop, `setRunStatus(runId,'budget_exhausted', now, cost)`, append `final`, `closeRunBus`. (200k = orchestrator + all subagent tokens summed for this run — accumulate in a per-run counter.)
  - **PostToolUse / on each response:** add `usage` to a per-run token counter and to `cost`; `addDailyCost(delta)`.
  - On normal completion: `setRunStatus(runId,'complete', now, cost)`, append `final` with cardCount, `closeRunBus`.
  - Wrap the whole thing in try/catch → on throw, append `error{fatal:true}`, `setRunStatus 'failed'`, `closeRunBus`.
- [ ] **Step 2:** Manual integration check: a temp script calls `createRun` + `runAgent` with a stub intent and real keys (or mocked providers) → observe events appended in SQLite and status reaching `complete`. Delete script.
- [ ] **Step 3:** Commit: `feat: agent orchestrator + budget circuit-breaker`

### Task 2.5: Intent extraction — `lib/intent.ts`

**Files:** Create `lib/intent.ts`.

- [ ] **Step 1:** Implement `extractIntent(rawQuery: string): Promise<Intent>` — a single **Haiku** Messages call with a zod-validated JSON tool-output matching `Intent`. Prompt: extract category/age/district/budget/schedule/hardRequirements; set `present:false` + `confidence:'low'` for anything not stated; never guess required fields.
- [ ] **Step 2:** Guard: if JSON invalid, return an Intent with all `present:false` (UI will prompt). Never throw to the caller.
- [ ] **Step 3:** Commit: `feat: haiku intent extraction`

---

## Phase 3 — API + SSE  [Backend track · ~2h]

### Task 3.1: Budget, rate-limit, turnstile — `lib/{budget,ratelimit,turnstile}.ts`

**Files:** Create three.

- [ ] **Step 1:** `budget.ts` — `addDailyCost(usd)`, `getDailyCost()`, `isDailyBudgetExhausted()` (compare to `env.DAILY_BUDGET_USD`), `incRunsCount()`. Keyed by UTC `YYYY-MM-DD` row in `budget_ledger`.
- [ ] **Step 2:** `ratelimit.ts` — `hashIp(ip): string` = `sha256(ip + env.IP_HASH_DAILY_SALT + utcYYYYMMDD)`; `checkAndIncrement(ipHash): { ok, retryAfter }` enforcing `PER_IP_RUNS_PER_HOUR` and `PER_IP_RUNS_PER_DAY` against `ip_ledger`.
- [ ] **Step 3:** `turnstile.ts` — `verifyTurnstile(token, ip): Promise<boolean>` POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `env.TURNSTILE_SECRET_KEY`.
- [ ] **Step 4:** Commit: `feat: budget + rate-limit + turnstile`

### Task 3.2: POST /api/runs — `app/api/runs/route.ts`

**Files:** Create.

- [ ] **Step 1:** Implement POST: parse+zod-validate `CreateRunRequest` (rawQuery 3–500 chars). Get client IP from `x-forwarded-for` (Cloudflare). In order: (a) `if env.APP_DISABLED → 503`; (b) `verifyTurnstile` → 403; (c) `checkAndIncrement(hashIp(ip))` → 429 + `Retry-After`; (d) `isDailyBudgetExhausted()` → 200 with a `{budgetExhausted:true}` body the landing renders. Then `extractIntent(rawQuery)`, generate `nanoid(10)`, `createRun`, `incRunsCount`, **spawn `runAgent(id, intent)` without awaiting** (fire-and-forget; it streams via the bus), and return `CreateRunResponse {runId, intent}`.
- [ ] **Step 2:** Manual: `curl -XPOST` with a dev bypass flag (`TURNSTILE_DEV_BYPASS=true`) → returns runId + intent; agent starts.
- [ ] **Step 3:** Commit: `feat: POST /api/runs`

### Task 3.3: SSE stream — `app/api/runs/[id]/stream/route.ts`

The replay+tail mechanism. Full code.

**Files:** Create.

- [ ] **Step 1:** Implement GET returning a `ReadableStream` with `Content-Type: text/event-stream`:
```typescript
import { getEventsSince, getRun } from "@/lib/db-queries";
import { getRunBus } from "@/lib/events";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: any) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      // 1. Replay everything persisted so far.
      let lastId = 0;
      for (const ev of getEventsSince(id, 0)) { send(ev); lastId = ev.id; }

      // 2. If the run already finished, close after replay.
      const run = getRun(id);
      if (run && run.status !== "running") { controller.close(); return; }

      // 3. Tail live events; de-dupe against replay via id.
      const bus = getRunBus(id);
      const onEvent = (ev: any) => { if (ev.id > lastId) { send(ev); lastId = ev.id; } };
      const onEnd = () => { try { controller.close(); } catch {} bus.off("event", onEvent); };
      bus.on("event", onEvent);
      bus.once("end", onEnd);

      // 4. Heartbeat to keep proxies open.
      const hb = setInterval(() => controller.enqueue(encoder.encode(": hb\n\n")), 15000);
      (controller as any)._cleanup = () => { clearInterval(hb); bus.off("event", onEvent); bus.off("end", onEnd); };
    },
    cancel() { /* client disconnected */ },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
export const dynamic = "force-dynamic";
```
- [ ] **Step 2:** Manual: start a run, `curl -N http://localhost:3000/api/runs/<id>/stream` → see replayed + live `data:` lines, then close on `final`.
- [ ] **Step 3:** Commit: `feat: SSE replay+tail stream`

### Task 3.4: Snapshot — `app/api/runs/[id]/route.ts`

- [ ] **Step 1:** GET returns `RunSnapshot {run, events, cards}` as JSON, or 404. Used by the run page for SSR and by completed-run static render.
- [ ] **Step 2:** Commit: `feat: GET /api/runs/[id] snapshot`

---

## Phase F (Frontend track)  [parallel from end of Phase 0 · ~6h]

> Build against `types/index.ts`, the SSE taxonomy, and the API shapes. Until the Backend track lands, develop against a local mock: a `data/mock-snapshot.json` shaped as `RunSnapshot` and a fake EventSource that replays it. Swap to real endpoints in Phase 5.

### Task F.1: Landing + query box — `app/page.tsx`, `components/query-box.tsx`

- [ ] Build a centered hero: product name (accent), one-line pitch, large `QueryBox` (textarea + "Run it" button), invisible Turnstile widget, and a `BudgetMeter` in the footer. On submit → POST `/api/runs` → on success store `intent` and transition to chip-confirm state (Task F.2). Honor `budgetExhausted` response with a friendly message. Acceptance: looks correct in dark theme, matches §6.0, mobile-clean at 320–768px.
- [ ] Commit per component.

### Task F.2: Intent chips — `components/intent-chips.tsx`

- [ ] Render each `Intent` field as a chip per spec §2.1 + §6.4: filled / empty-required (red dot, "Run it" disabled) / optional `+ Add`. Inline-edit on click. Required = category, age. On confirm → `router.push('/runs/'+runId)`. Acceptance: required-missing blocks run; optional skippable; pill radius from tokens.
- [ ] Commit.

### Task F.3: Stream hook — `hooks/use-run-stream.ts`

- [ ] `useRunStream(runId)` opens `EventSource('/api/runs/'+runId+'/stream')`, accumulates `RunEvent[]` and a derived `Map<cardId, Card>` (fetch cards from snapshot endpoint on mount for SSR hydrate, then patch on `card_update`). Expose `{events, cards, status}`. Close on `final`/`error`. Acceptance: reconnect-safe (replay handles missed events).
- [ ] Commit.

### Task F.4: Activity stream — `components/activity-stream.tsx`

- [ ] Render `RunEvent[]` as rows per spec §6.2 taxonomy (emoji + verb + object, per-kind styling, spinner on in-flight `tool_call` until matching `tool_result`). Signature motion: slide+fade-in 240ms ease-out (§6.0). Auto-scroll with manual scroll-lock. `prefers-reduced-motion` respected. Acceptance: feels continuous, never frozen.
- [ ] Commit.

### Task F.5: Candidate card — `components/candidate-card.tsx`, `confidence-badge.tsx`

- [ ] Render `Card` per spec §6.3: rank, name, district/address, schedule/price/age with `ConfidenceBadge` (popover shows `sourceSnippet`) for any `confidence < high`, match reason, contacts with `tg://`/`wa.me` deep-link buttons (encodeURIComponent the draftMessage), collapsible draft, sources. Skeleton state before fields arrive. Acceptance: deep links open native apps with message pre-filled; badges show source on hover.
- [ ] Commit.

### Task F.6: Run page 3-panel — `app/runs/[id]/page.tsx`, `components/budget-meter.tsx`

- [ ] SSR-fetch snapshot for the shell, then `useRunStream` for live tail. Three-panel layout per §6.1 (intent left, stream center, cards right); mobile single-column with stream in a sticky bottom drawer. Share button copies the URL. BudgetMeter in header. Acceptance: refresh mid-run resumes correctly (replay); completed run renders static.
- [ ] Commit.

### Task F.7: Design discipline files + seed data

- [ ] Author `STYLE.md` (spec §6.5 banned words/structures), `impeccable.md` (the relevant rule excerpt), `.hallmark/log.json` (empty gate log). Add `DESIGN.md` rationale prose under the seeded tokens.
- [ ] Build `data/seed-clubs.json` — 10–20 hand-curated real Astana clubs across categories (name, district, contacts, category) for extraction testing + demo fallback.
- [ ] Optional CI: `npx @google/design.md lint DESIGN.md` passes.
- [ ] Commit.

---

## Phase 5 — Integration & hardening  [merge · ~2h]

### Task 5.1: Wire frontend to live API
- [ ] Remove the Frontend-track mocks; point hooks at real `/api/*`. Run a real query end-to-end locally with real keys. Fix contract mismatches (these surface here — expected).
- [ ] Commit: `feat: integrate frontend with live api`.

### Task 5.2: Security headers + kill switch
- [ ] Add CSP + security headers in `next.config.mjs` (allow self + Cloudflare Turnstile origins only; no inline script except Turnstile). Verify `APP_DISABLED=true` path returns 503 on POST while `/runs/[id]` still renders.
- [ ] Commit: `feat: CSP + kill switch verified`.

### Task 5.3: End-to-end acceptance (spec §11)
- [ ] Cold run: "плавание для 8-летнего" → ≥5 ranked cards in <3 min, each with name+district+≥1 contact+match-reason+source. Share URL replays. Rate-limit returns 429 past caps. Daily cap returns budget page. Record a demo gif.
- [ ] Commit.

---

## Phase 6 — Deploy  [~2h]

### Task 6.1: Provision Hetzner
- [ ] Create CAX11 (Ubuntu 24.04 ARM) in Helsinki/Falkenstein. SSH key-only. `ufw allow 22,80,443`; install `fail2ban`. Install Node 22 LTS, `gitleaks`. Create `/var/data` for SQLite.
- [ ] Create `/etc/club-agent.env` (chmod 600) with all real secrets (spec §8.2). **Secrets entered on the box only — never committed.**

### Task 6.2: Caddy + systemd + DuckDNS
- [ ] DuckDNS: register `club-agent` subdomain → point at Hetzner IP; add a refresh cron (every 5 min).
- [ ] systemd unit `club-agent.service`: `EnvironmentFile=/etc/club-agent.env`, `ExecStart=node .next/standalone/server.js` (set `output: 'standalone'` in `next.config.mjs`), restart=always.
- [ ] Caddyfile: reverse-proxy `club-agent.duckdns.org` → `127.0.0.1:3000`, auto-TLS. **SSE: ensure `flush_interval -1` on the `/api/runs/*/stream` path** so events aren't buffered.
- [ ] `scripts/deploy.sh`: ssh → `git pull` → `npm ci` → `npm run build` → `systemctl restart club-agent`.

### Task 6.3: Cloudflare + Turnstile
- [ ] Add the domain (or use a Cloudflare-proxied CNAME to the DuckDNS name). Enable proxy (orange cloud) for L3/L4/L7 DDoS. Create a Turnstile widget → put site key in `.env`, secret on the box.
- [ ] Smoke test live: real query at `https://club-agent.duckdns.org` end-to-end; confirm TLS, SSE streaming, Turnstile gate, share URL.
- [ ] Write `docs/deploy.md` documenting the whole runbook.
- [ ] Final commit + push.

---

## Self-review — spec coverage check

| Spec section | Covered by |
|---|---|
| §2 user flow | F.1, F.2, F.6, 3.2 |
| §2.1 required/optional chips | F.2 |
| §3 architecture | 0.1, all backend phases |
| §3.1 stack lock | 0.1, 0.2, 2.x, 6.x |
| §4 data model | 1.1, 1.2 |
| §5 agent loop / routing | 2.3, 2.4, 2.5 |
| §5.4 prompt caching | 2.4 step 1 |
| §5.5 budget + 200k stop | 2.4, 3.1 |
| §6.0 design system | 0.3, F.7 |
| §6.1–6.4 UX | F.4, F.5, F.6, F.2 |
| §6.5 discipline files | 0.3, F.7 |
| §7 abuse protection | 2.1, 3.1, 3.2, 5.2, 6.3 |
| §7.4 SSRF | 2.1 |
| §8 repo discipline | 0.4 |
| §11 success criteria | 5.3 |
| deploy | 6.x |

No spec section is unmapped. Code-complete on the error-prone units (events, ssrf, sse, orchestrator skeleton); interface-complete elsewhere by design.

---

_End of plan._
