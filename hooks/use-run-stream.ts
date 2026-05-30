"use client";

import { useEffect, useRef, useState } from "react";
import type { Card, RunEvent, RunSnapshot, RunStatus } from "@/types";

/** How long to coalesce a burst of card_update events into one snapshot refetch. */
const CARD_REFETCH_COALESCE_MS = 800;

export interface UseRunStreamResult {
  events: RunEvent[];
  cards: Card[];
  status: RunStatus;
  connected: boolean;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "complete",
  "failed",
  "budget_exhausted",
]);

function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * useRunStream — powers the live run page.
 *
 * - Hydrates from `initialSnapshot` (SSR) when provided; otherwise seeds by
 *   fetching the snapshot once on mount.
 * - Tails `GET /api/runs/<id>/stream` (SSE). The stream replays past events
 *   then tails live ones; we de-dupe by the monotonic `event.id`.
 * - `card_update` events carry only a `cardId`, so we refetch the snapshot's
 *   cards. Bursts are coalesced into at most one refetch per
 *   CARD_REFETCH_COALESCE_MS (trailing edge), with a dirty flag to fire one
 *   more refetch if updates arrived while a fetch was in flight.
 * - On `final` / `error` we do a final snapshot refetch, set the terminal
 *   status, and close the EventSource (no reconnect thrash).
 */
export function useRunStream(
  runId: string,
  initialSnapshot?: RunSnapshot,
): UseRunStreamResult {
  const [events, setEvents] = useState<RunEvent[]>(
    () => initialSnapshot?.events ?? [],
  );
  const [cards, setCards] = useState<Card[]>(
    () => initialSnapshot?.cards ?? [],
  );
  const [status, setStatus] = useState<RunStatus>(
    () => initialSnapshot?.run.status ?? "running",
  );
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let unmounted = false;
    let es: EventSource | null = null;

    // Highest event id we've already applied. Seed from the initial snapshot so
    // the replay at stream-open doesn't duplicate already-hydrated events.
    let lastSeenId = initialSnapshot?.events.reduce(
      (max, e) => (e.id > max ? e.id : max),
      0,
    ) ?? 0;

    // True once the run has reached a terminal state — gates reconnect.
    let terminal = isTerminal(initialSnapshot?.run.status ?? "running");

    // ── Snapshot refetch (cards + status) ──────────────────────────────────
    let refetchInFlight = false;
    let refetchDirty = false; // a card_update arrived while a fetch was running
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

    const applySnapshot = (snap: RunSnapshot) => {
      if (unmounted) return;
      setCards(snap.cards);
      setStatus(snap.run.status);
      if (isTerminal(snap.run.status)) terminal = true;
    };

    const fetchSnapshot = async (): Promise<RunSnapshot | null> => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as RunSnapshot;
      } catch {
        return null;
      }
    };

    // Refetch the snapshot to refresh cards, coalescing concurrent calls.
    const refetchCards = async () => {
      if (refetchInFlight) {
        refetchDirty = true;
        return;
      }
      refetchInFlight = true;
      refetchDirty = false;
      const snap = await fetchSnapshot();
      refetchInFlight = false;
      if (snap) applySnapshot(snap);
      // If more card_updates landed mid-flight, run exactly one more pass.
      if (refetchDirty && !unmounted) {
        refetchDirty = false;
        void refetchCards();
      }
    };

    // Schedule a trailing-edge coalesced refetch for a card_update burst.
    const scheduleCardRefetch = () => {
      if (coalesceTimer != null) return;
      coalesceTimer = setTimeout(() => {
        coalesceTimer = null;
        void refetchCards();
      }, CARD_REFETCH_COALESCE_MS);
    };

    const closeStream = () => {
      if (es) {
        es.close();
        es = null;
      }
    };

    // ── Seed: if no SSR snapshot, fetch once before/while streaming ─────────
    const seed = async () => {
      if (initialSnapshot) return;
      const snap = await fetchSnapshot();
      if (unmounted || !snap) return;
      // Only apply replayed/seed events we haven't already seen.
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const merged = prev.slice();
        for (const e of snap.events) {
          if (!seen.has(e.id)) merged.push(e);
        }
        return merged;
      });
      lastSeenId = snap.events.reduce(
        (max, e) => (e.id > max ? e.id : max),
        lastSeenId,
      );
      applySnapshot(snap);
    };

    // ── SSE handlers ───────────────────────────────────────────────────────
    const handleEvent = (ev: RunEvent) => {
      if (unmounted) return;
      if (ev.id <= lastSeenId) return; // de-dupe replayed / overlapping events
      lastSeenId = ev.id;

      setEvents((prev) => [...prev, ev]);

      switch (ev.kind) {
        case "card_update":
          scheduleCardRefetch();
          break;
        case "final": {
          // Final refetch for complete cards + terminal status, then close.
          terminal = true;
          void (async () => {
            const snap = await fetchSnapshot();
            if (snap) applySnapshot(snap);
            else if (!unmounted) setStatus("complete");
          })();
          closeStream();
          setConnected(false);
          break;
        }
        case "error": {
          terminal = true;
          void (async () => {
            const snap = await fetchSnapshot();
            if (snap) applySnapshot(snap);
          })();
          if (!unmounted) setStatus("failed");
          closeStream();
          setConnected(false);
          break;
        }
        default:
          break;
      }
    };

    const open = () => {
      es = new EventSource(`/api/runs/${runId}/stream`);
      es.onopen = () => {
        if (!unmounted) setConnected(true);
      };
      es.onmessage = (msg: MessageEvent<string>) => {
        let parsed: RunEvent;
        try {
          parsed = JSON.parse(msg.data) as RunEvent;
        } catch {
          return; // ignore malformed frames (heartbeats are comments, not data)
        }
        handleEvent(parsed);
      };
      es.onerror = () => {
        if (unmounted) return;
        setConnected(false);
        // Server closes the stream after the run finishes — that surfaces as an
        // error on the client. If we're terminal, stop; don't let EventSource
        // thrash-reconnect. Otherwise leave it to auto-reconnect (replay covers
        // any missed events).
        if (terminal) closeStream();
      };
    };

    void seed();
    open();

    return () => {
      unmounted = true;
      if (coalesceTimer != null) clearTimeout(coalesceTimer);
      closeStream();
    };
    // runId identifies the stream; initialSnapshot is only read for first seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { events, cards, status, connected };
}
