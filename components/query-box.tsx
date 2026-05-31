"use client";

import { useReducedMotion } from "framer-motion";
import { ArrowUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { ExtractIntentResponse, Intent } from "@/types";

type Status = "idle" | "submitting" | "error";

// Auto-grow cap: ~5 lines, then the textarea scrolls.
const MAX_TEXTAREA_HEIGHT = 160;

// Real example queries that teach the user what to type. Rotated as an
// animated overlay (crossfade + subtle upward slide) only while the textarea
// is empty AND unfocused — never overlapping real text or a live placeholder.
const EXAMPLE_QUERIES = [
  "плавание для сына 8 лет, левый берег, вечером",
  "робототехника для дочки 10 лет, до 30 000 ₸/мес",
  "английский для детей, малые группы, выходные",
  "рукоделие для дочки 9 лет, центр города",
  "футбол для сына 7 лет, после школы",
] as const;

// Rotation cadence and the outgoing→incoming crossfade duration.
const ROTATE_MS = 3000;
const FADE_MS = 400;

export interface QueryBoxProps {
  /**
   * Fired on successful intent extraction. Surfaces the raw query and the
   * extracted intent so the parent can drive the chips → run step. Turnstile
   * is owned by the page-level widget (a fresh token is issued at run time),
   * so extract-intent — which the server does NOT gate on Turnstile — needs no
   * token here.
   */
  onExtracted: (args: { rawQuery: string; intent: Intent }) => void;
}

export function QueryBox({ onExtracted }: QueryBoxProps) {
  const [rawQuery, setRawQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Rotating example-query overlay ───────────────────────────────────────
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  // Drives the per-cycle slide/fade: "in" = settled visible; flips to "out"
  // briefly before the index advances so the outgoing string fades+slides up.
  const [phase, setPhase] = useState<"in" | "out">("in");

  // Show the animated overlay only when the field is empty AND unfocused, so
  // it never overlaps the user's text or a live native placeholder.
  const showOverlay = rawQuery.length === 0 && !focused;

  // Advance the example every ROTATE_MS while the overlay is visible. With
  // motion enabled we first flip to "out" (outgoing fades/slides up), then
  // swap the index and flip back to "in" (incoming slides up into place).
  // Under reduced motion we swap the index instantly, no phase animation.
  useEffect(() => {
    if (!showOverlay) return;

    if (reduceMotion) {
      const id = setInterval(() => {
        setExampleIndex((i) => (i + 1) % EXAMPLE_QUERIES.length);
      }, ROTATE_MS);
      return () => clearInterval(id);
    }

    let swapTimer: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setPhase("out");
      swapTimer = setTimeout(() => {
        setExampleIndex((i) => (i + 1) % EXAMPLE_QUERIES.length);
        setPhase("in");
      }, FADE_MS);
    }, ROTATE_MS);

    return () => {
      clearInterval(id);
      if (swapTimer) clearTimeout(swapTimer);
    };
  }, [showOverlay, reduceMotion]);

  // Auto-grow: reset to auto so shrinking works, then grow to scrollHeight up
  // to the cap. useLayoutEffect avoids a flash of the wrong height.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [rawQuery, resize]);

  useEffect(() => {
    resize();
  }, [resize]);

  // ── Data flow (UNCHANGED from the prior QueryBox) ────────────────────────
  // POST /api/extract-intent → surface { rawQuery, intent } via onExtracted.
  // The run + Turnstile token are minted later by the page on chip-confirm.
  const handleSubmit = useCallback(async () => {
    const query = rawQuery.trim();
    if (query.length < 3 || status === "submitting") return;

    setStatus("submitting");

    try {
      const res = await fetch("/api/extract-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawQuery: query }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      const data = (await res.json()) as ExtractIntentResponse;
      if (data?.intent) {
        setStatus("idle");
        onExtracted({ rawQuery: query, intent: data.intent });
        return;
      }

      setStatus("error");
    } catch {
      setStatus("error");
    }
  }, [rawQuery, status, onExtracted]);

  const submitting = status === "submitting";
  const canSubmit = !submitting && rawQuery.trim().length >= 3;

  return (
    <div className="w-full">
      {/* Dark glassy hero container with a SINGLE violet focus-within glow. */}
      <div
        className={cn(
          "group relative flex items-end gap-2 rounded-card border border-border bg-surface/60 p-2.5 backdrop-blur",
          "transition-shadow duration-300 ease-out",
          "focus-within:border-accent/50",
          "focus-within:shadow-[0_0_0_1px_var(--accent-glow),0_0_40px_-8px_var(--accent-glow)]",
        )}
      >
        {/* Animated rotating example-query overlay. Absolutely positioned to
            sit EXACTLY where the textarea's placeholder text renders: the flex
            container adds p-2.5, the textarea adds px-2.5/py-2 → left = 2.5+2.5
            = 1.25rem, top = 2.5+2 ≈ 1.125rem. Matches the placeholder font
            (text-base leading-relaxed) and tone (text-faint). pointer-events
            none so clicks pass to the textarea; aria-hidden so SRs read the
            textarea's aria-label instead. Only mounted while empty+unfocused. */}
        {showOverlay && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-5 top-[1.125rem] right-14 overflow-hidden text-base leading-relaxed text-faint"
          >
            <span
              key={exampleIndex}
              className={cn(
                "block truncate will-change-transform",
                // Incoming: keyed remount runs the enter keyframe (slide up
                // from +6px + fade in). Outgoing: the phase flips to "out"
                // first, applying a transition that slides the current string
                // up (-6px) + fades it before the index swaps.
                !reduceMotion &&
                  phase === "in" &&
                  "animate-example-enter translate-y-0 opacity-100",
                !reduceMotion &&
                  phase === "out" &&
                  "-translate-y-1.5 opacity-0 transition-all duration-[400ms] ease-out",
              )}
            >
              {EXAMPLE_QUERIES[exampleIndex]}
            </span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder=""
          maxLength={500}
          rows={1}
          aria-label="Опишите, какой кружок или секцию вы ищете"
          className="flex-1 resize-none self-center bg-transparent px-2.5 py-2 text-base leading-relaxed text-text placeholder:text-faint focus:outline-none"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Найти"
          className={cn(
            "mb-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent text-text transition-all duration-200 ease-out",
            "hover:bg-accent-hover active:translate-y-px",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {submitting ? (
            <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
          ) : (
            <ArrowUp className="size-5" aria-hidden />
          )}
        </button>
      </div>

      {status === "error" && (
        <p className="mt-3 text-sm text-error">
          Что-то пошло не так. Попробуйте ещё раз через минуту.
        </p>
      )}
    </div>
  );
}
