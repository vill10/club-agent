"use client";

import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

import { ActivityStream } from "@/components/activity-stream";
import {
  CandidateCard,
  CandidateCardSkeleton,
} from "@/components/candidate-card";
import { BudgetMeter } from "@/components/budget-meter";
import { RunShader } from "@/components/ui/run-shader";
import { useRunStream } from "@/hooks/use-run-stream";
import { cn } from "@/lib/utils";
import type {
  Card,
  Category,
  Intent,
  IntentField,
  RunStatus,
  RunSnapshot,
} from "@/types";

// ── Intent display (read-only) ──────────────────────────────
// Mirrors the category labels used by the editable IntentChips, kept inline so
// the run page renders intent statically without pulling in the editable
// component's state machine.
const CATEGORY_LABEL: Record<Category, string> = {
  sport: "Спорт",
  art: "Искусство",
  music: "Музыка",
  language: "Языки",
  coding: "Программирование",
  dance: "Танцы",
  chess: "Шахматы",
  other: "Другое",
};

type IntentKey = keyof Intent;

const INTENT_ORDER: IntentKey[] = [
  "category",
  "activity",
  "age",
  "district",
  "budget",
  "schedule",
  "hardRequirements",
];

const INTENT_PREFIX: Partial<Record<IntentKey, string>> = {
  activity: "Занятие:",
  age: "Возраст:",
  district: "Район:",
  budget: "Бюджет:",
  schedule: "Расписание:",
};

function intentFieldText(key: IntentKey, f: IntentField<unknown> | undefined): string | null {
  if (!f || !f.present || f.value == null) return null;
  let body: string;
  if (key === "category" && typeof f.value === "string") {
    body = CATEGORY_LABEL[f.value as Category] ?? String(f.value);
  } else if (Array.isArray(f.value)) {
    if (f.value.length === 0) return null;
    body = f.value.join(", ");
  } else {
    body = String(f.value).trim();
    if (!body) return null;
  }
  const prefix = INTENT_PREFIX[key];
  return prefix ? `${prefix} ${body}` : body;
}

function IntentPills({ intent }: { intent: Intent }) {
  const pills = INTENT_ORDER.map((key) => ({
    key,
    text: intentFieldText(key, intent[key]),
  })).filter((p): p is { key: IntentKey; text: string } => p.text !== null);

  if (pills.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <li
          key={p.key}
          className="inline-flex items-center rounded-pill bg-accent-subtle px-3 py-1.5 text-sm text-text"
        >
          {p.text}
        </li>
      ))}
    </ul>
  );
}

// ── Status indicator ────────────────────────────────────────
function StatusIndicator({ status }: { status: RunStatus }) {
  const config: Record<
    RunStatus,
    { label: string; dot: string; text: string; pulse: boolean }
  > = {
    running: {
      label: "идёт поиск",
      dot: "bg-accent",
      text: "text-muted",
      pulse: true,
    },
    complete: {
      label: "готово",
      dot: "bg-success",
      text: "text-success",
      pulse: false,
    },
    failed: {
      label: "ошибка",
      dot: "bg-error",
      text: "text-error",
      pulse: false,
    },
    budget_exhausted: {
      label: "лимит исчерпан",
      dot: "bg-warning",
      text: "text-warning",
      pulse: false,
    },
  };
  const c = config[status];

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-pill",
          c.dot,
          c.pulse && "motion-safe:animate-pulse",
        )}
      />
      <span className={c.text}>{c.label}</span>
    </span>
  );
}

// ── Share button ────────────────────────────────────────────
function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context) — fail quietly.
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-raised px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
    >
      {copied ? "Ссылка скопирована" : "Поделиться"}
    </button>
  );
}

// ── Cards panel (shared between desktop + mobile) ───────────
function sortCards(cards: Card[]): Card[] {
  // Sort by rank ascending; nulls/undefined last. Stable for equal ranks.
  return [...cards].sort((a, b) => {
    const ra = a.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.rank ?? Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}

function CardsList({
  cards,
  status,
}: {
  cards: Card[];
  status: RunStatus;
}) {
  const sorted = useMemo(() => sortCards(cards), [cards]);
  // While running with few/no cards yet, show a couple of skeletons.
  const showSkeletons = status === "running" && sorted.length < 2;
  const skeletonCount = showSkeletons ? 2 - sorted.length : 0;

  return (
    <div className="flex flex-col gap-4">
      {sorted.map((c) => (
        <CandidateCard key={c.id} card={c} />
      ))}
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <CandidateCardSkeleton key={`skeleton-${i}`} />
      ))}
      {!showSkeletons && sorted.length === 0 && (
        <p className="text-sm text-faint">
          {status === "running"
            ? "Пока ничего не найдено — агент ещё ищет."
            : "Подходящих клубов не найдено."}
        </p>
      )}
    </div>
  );
}

// ── Query + intent panel (shared) ───────────────────────────
function QueryPanel({ snapshot }: { snapshot: RunSnapshot }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">
          Запрос
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text">
          {snapshot.run.rawQuery}
        </p>
      </div>
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
          Что ищем
        </h2>
        <IntentPills intent={snapshot.run.intent} />
      </div>
    </div>
  );
}

// ── Mobile activity drawer ──────────────────────────────────
function latestActivityLine(events: RunSnapshot["events"]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i].payload;
    switch (p.kind) {
      case "tool_call":
      case "tool_result":
        return p.label;
      case "thinking":
      case "message":
        return p.text;
      case "error":
        return p.message;
      case "final":
        return `Поиск завершён — найдено клубов: ${p.cardCount}`;
      default:
        break;
    }
  }
  return "Ожидаю активность…";
}

function MobileActivityDrawer({
  events,
  status,
}: {
  events: RunSnapshot["events"];
  status: RunStatus;
}) {
  const [open, setOpen] = useState(false);
  const latest = latestActivityLine(events);

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-pill",
            status === "running" ? "bg-accent motion-safe:animate-pulse" : "bg-faint",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-muted">
          {latest}
        </span>
        {open ? (
          <ChevronDown size={16} aria-hidden className="shrink-0 text-faint" />
        ) : (
          <ChevronUp size={16} aria-hidden className="shrink-0 text-faint" />
        )}
      </button>
      {open && (
        <div className="h-[45vh] border-t border-border px-3 pb-3">
          <ActivityStream events={events} status={status} />
        </div>
      )}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────
export function RunView({
  runId,
  initialSnapshot,
}: {
  runId: string;
  initialSnapshot: RunSnapshot;
}) {
  const { events, cards, status } = useRunStream(runId, initialSnapshot);
  const [queryOpen, setQueryOpen] = useState(false);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-transparent">
      {/* The agent's beam BRANCHING into many — fixed violet light-streams
          behind everything. Dim by design; the panels below add a scrim so
          text stays crisp. Falls back to near-black if webgl2 is unavailable. */}
      <RunShader />

      {/* Soft top vignette so the header + first rows keep contrast over the
          shader's brighter convergence zone. Above the canvas, below content. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-48 bg-gradient-to-b from-bg to-transparent"
      />

      {/* ── Sticky header (natural height) ────────────────── */}
      <header className="z-30 shrink-0 border-b border-border bg-bg/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-accent transition-colors hover:text-accent-hover"
          >
            Club Agent
          </Link>
          <div className="ml-2 hidden sm:block">
            <BudgetMeter />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <StatusIndicator status={status} />
            <ShareButton />
          </div>
        </div>
      </header>

      {/* ── Desktop: three-panel grid (≥768px) ────────────── */}
      {/* Fills the height below the header; each pane scrolls within its     */}
      {/* own bounds. `min-h-0` on the region AND scrollable children is the   */}
      {/* fix — flex/grid children won't shrink below content without it.      */}
      <div className="mx-auto hidden min-h-0 w-full max-w-[1400px] flex-1 grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,26rem)] gap-6 px-6 py-6 md:grid">
        {/* Left: query + read-only intent (scrolls if tall) */}
        <aside className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 overflow-y-auto rounded-card border border-white/5 bg-bg/50 p-5 backdrop-blur-sm">
            <QueryPanel snapshot={initialSnapshot} />
          </div>
        </aside>

        {/* Center: activity stream */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <h2 className="mb-3 shrink-0 text-sm font-semibold text-text">
            Ход поиска
          </h2>
          <div className="min-h-0 flex-1 rounded-card border border-white/5 bg-bg/50 p-3 backdrop-blur-sm">
            <ActivityStream events={events} status={status} />
          </div>
        </section>

        {/* Right: cards (own scroll) */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <h2 className="mb-3 shrink-0 text-sm font-semibold text-text">
            Найденные клубы ({cards.length})
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CardsList cards={cards} status={status} />
          </div>
        </section>
      </div>

      {/* ── Mobile: single column (<768px) ────────────────── */}
      {/* Mobile keeps page-level scroll: the shell is fixed-height, so this   */}
      {/* column owns the overflow and clears the bottom drawer via padding.   */}
      <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-24 pt-4 md:hidden">
        {/* Collapsible query + intent */}
        <div className="rounded-card border border-white/5 bg-bg/50 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setQueryOpen((v) => !v)}
            aria-expanded={queryOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {initialSnapshot.run.rawQuery}
            </span>
            {queryOpen ? (
              <ChevronUp size={16} aria-hidden className="ml-2 shrink-0 text-faint" />
            ) : (
              <ChevronDown size={16} aria-hidden className="ml-2 shrink-0 text-faint" />
            )}
          </button>
          {queryOpen && (
            <div className="border-t border-border px-4 py-4">
              <QueryPanel snapshot={initialSnapshot} />
            </div>
          )}
        </div>

        {/* Cards — primary stacked content */}
        <section className="mt-5">
          <h2 className="mb-3 text-sm font-semibold text-text">
            Найденные клубы ({cards.length})
          </h2>
          <CardsList cards={cards} status={status} />
        </section>
      </div>

      {/* Mobile sticky bottom activity drawer */}
      <MobileActivityDrawer events={events} status={status} />
    </div>
  );
}
