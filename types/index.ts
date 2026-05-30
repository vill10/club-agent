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
  intent: Intent;            // confirmed intent from the chips step
  turnstileToken: string;
}
export interface ExtractIntentRequest {
  rawQuery: string;
}
export interface ExtractIntentResponse {
  intent: Intent;
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
