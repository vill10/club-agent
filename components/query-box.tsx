"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { ExtractIntentResponse, Intent } from "@/types";

type Status = "idle" | "submitting" | "error";

// Auto-grow cap: ~5 lines, then the textarea scrolls.
const MAX_TEXTAREA_HEIGHT = 160;

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
        <textarea
          ref={textareaRef}
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Опишите, какой кружок или секцию вы ищете…"
          maxLength={500}
          rows={1}
          aria-label="Запрос"
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
