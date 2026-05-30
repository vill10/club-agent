"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ExtractIntentResponse, Intent } from "@/types";

type Status = "idle" | "submitting" | "error";

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

  async function handleSubmit() {
    const query = rawQuery.trim();
    if (query.length < 3 || status === "submitting") return;

    setStatus("submitting");

    try {
      // Step 1: extract intent only (cheap, no Turnstile). The run is created
      // later, after the user confirms the chips — with a fresh token.
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
  }

  const submitting = status === "submitting";

  return (
    <div className="w-full">
      <div className="rounded-card bg-surface p-3 shadow-[0_0_40px_-12px_var(--accent-glow)]">
        <textarea
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSubmit();
          }}
          placeholder="Опишите, какой кружок или секцию вы ищете…"
          maxLength={500}
          rows={4}
          className="w-full resize-none rounded-control bg-transparent px-3 py-2 text-base text-text placeholder:text-faint focus:outline-none"
        />

        <div className="mt-2 flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={submitting || rawQuery.trim().length < 3}
            className="h-11 rounded-control bg-accent px-6 text-base font-semibold text-text hover:bg-accent-hover sm:w-auto"
          >
            {submitting ? "Ищу…" : "Найти"}
          </Button>
        </div>
      </div>

      {status === "error" && (
        <p className="mt-3 text-sm text-error">
          Что-то пошло не так. Попробуйте ещё раз через минуту.
        </p>
      )}
    </div>
  );
}
