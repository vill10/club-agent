"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Globe,
  Loader2,
  MapPin,
  MessageSquare,
  Search,
  Sparkles,
} from "lucide-react";

import type { RunEvent, RunStatus } from "@/types";
import { cn } from "@/lib/utils";

/** Distance from the bottom (px) within which auto-scroll stays engaged. */
const NEAR_BOTTOM_PX = 40;

interface ActivityStreamProps {
  events: RunEvent[];
  status?: RunStatus;
}

/**
 * ActivityStream — the signature live feed.
 *
 * Presentational only: renders an ordered array of RunEvent as a calm,
 * bottom-anchored, live-updating list. New rows slide+fade in. Auto-scrolls to
 * the newest row unless the user has scrolled up (scroll-lock), in which case a
 * subtle "new events" jump affordance appears instead of yanking them down.
 *
 * No data fetching — events arrive via props (useRunStream on the run page).
 */
export function ActivityStream({ events, status }: ActivityStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // True while the viewport is pinned near the bottom (auto-scroll engaged).
  const [atBottom, setAtBottom] = useState(true);
  // True when new events arrived while the user was scrolled up.
  const [hasNew, setHasNew] = useState(false);

  // Pre-compute which tool_call events are still in flight: a tool_call is
  // "in flight" if no later event is a tool_result for the same tool.
  const inFlightById = useMemo(() => {
    const map = new Map<number, boolean>();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.payload.kind !== "tool_call") continue;
      const tool = ev.payload.tool;
      let resolved = false;
      for (let j = i + 1; j < events.length; j++) {
        const later = events[j];
        if (later.payload.kind === "tool_result" && later.payload.tool === tool) {
          resolved = true;
          break;
        }
      }
      map.set(ev.id, !resolved);
    }
    return map;
  }, [events]);

  // Track whether the user is near the bottom to gate auto-scroll.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance <= NEAR_BOTTOM_PX;
    setAtBottom(near);
    if (near) setHasNew(false);
  };

  const lastId = events.length > 0 ? events[events.length - 1].id : null;

  // On new events: auto-scroll if pinned to bottom, otherwise flag "new events".
  useEffect(() => {
    if (lastId == null) return;
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    } else {
      setHasNew(true);
    }
    // We intentionally key only on lastId: a new tail event is the trigger.
    // atBottom is read as a live value, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setHasNew(false);
    setAtBottom(true);
  };

  // Faint "working" line while running and the run hasn't terminated yet.
  const lastKind = events.length > 0 ? events[events.length - 1].kind : null;
  const showWorking =
    status === "running" && lastKind !== "final" && lastKind !== "error";

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-1 py-2"
      >
        <ol className="flex flex-col gap-3">
          {events.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              inFlight={inFlightById.get(event.id) ?? false}
            />
          ))}
          {showWorking && (
            <li className="motion-safe:animate-pulse text-sm text-faint">
              <span aria-hidden>•</span> агент работает…
            </li>
          )}
        </ol>
        <div ref={bottomRef} aria-hidden className="h-px" />
      </div>

      {hasNew && !atBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-pill bg-accent-subtle px-4 py-1.5 text-sm text-text shadow-[0_0_24px_-8px_var(--accent-glow)] transition-colors hover:bg-accent"
        >
          <ArrowDown size={14} aria-hidden className="shrink-0" />
          новые события
        </button>
      )}
    </div>
  );
}

interface ActivityRowProps {
  event: RunEvent;
  inFlight: boolean;
}

/** A single feed row: icon + text, styled per kind. Animates in on mount. */
function ActivityRow({ event, inFlight }: ActivityRowProps) {
  const { payload } = event;

  let content: React.ReactNode;

  switch (payload.kind) {
    case "tool_call":
      content = (
        <span className="flex items-center gap-2 text-sm italic text-muted">
          <Search size={14} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">{payload.label}</span>
          {inFlight && <Spinner />}
        </span>
      );
      break;

    case "tool_result":
      content = (
        <span className="flex items-center gap-2 text-sm text-text">
          <MapPin size={14} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">{payload.label}</span>
          {typeof payload.count === "number" && (
            <span className="shrink-0 rounded-pill bg-accent-subtle px-2 py-0.5 text-xs tabular-nums text-text">
              {payload.count}
            </span>
          )}
        </span>
      );
      break;

    case "thinking":
      content = (
        <span className="flex items-start gap-2 text-sm text-faint">
          <Sparkles size={14} aria-hidden className="mt-0.5 shrink-0 text-faint" />
          <span className="min-w-0 break-words">{payload.text}</span>
        </span>
      );
      break;

    case "message":
      content = (
        <span className="flex items-start gap-2 text-sm text-text">
          <MessageSquare size={14} aria-hidden className="mt-0.5 shrink-0 text-muted" />
          <span className="min-w-0 break-words">{payload.text}</span>
        </span>
      );
      break;

    case "card_update":
      content = (
        <span className="flex items-center gap-2 text-sm text-muted">
          <Globe size={14} aria-hidden className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">Карточка обновлена</span>
        </span>
      );
      break;

    case "error":
      content = (
        <span className="flex items-start gap-2 text-sm font-medium text-warning">
          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0 break-words">{payload.message}</span>
        </span>
      );
      break;

    case "final":
      content = (
        <span className="flex items-center gap-2 text-sm font-semibold text-success">
          <CheckCircle2 size={16} aria-hidden className="shrink-0 text-success" />
          <span className="min-w-0">
            Поиск завершён — найдено клубов:{" "}
            <span className="tabular-nums">{payload.cardCount}</span>
          </span>
        </span>
      );
      break;

    default:
      content = null;
  }

  return <li className="cl-activity-row">{content}</li>;
}

/** Small in-flight spinner. Hidden (no motion) under reduced-motion. */
function Spinner() {
  return (
    <Loader2
      size={14}
      aria-label="выполняется"
      className="shrink-0 animate-spin text-accent motion-reduce:hidden"
    />
  );
}
