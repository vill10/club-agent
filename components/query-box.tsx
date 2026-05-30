"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreateRunResponse, Intent } from "@/types";

// Cloudflare ALWAYS-PASS test sitekey — public, not a secret. Lets dev work
// without a real key configured.
const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
const SITEKEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITEKEY;

// Minimal surface of the Cloudflare Turnstile global we use.
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    },
  ) => string;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onTurnstileLoad?: () => void;
  }
}

type Status = "idle" | "submitting" | "budget" | "rate_limited" | "error";

export interface QueryBoxProps {
  /** Fired on a successful run creation. */
  onIntent: (runId: string, intent: Intent) => void;
}

export function QueryBox({ onIntent }: QueryBoxProps) {
  const [rawQuery, setRawQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");

  function renderWidget() {
    if (!window.turnstile || !widgetRef.current || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(widgetRef.current, {
      sitekey: SITEKEY,
      theme: "dark",
      callback: (token) => {
        tokenRef.current = token;
      },
      "expired-callback": () => {
        tokenRef.current = "";
      },
      "error-callback": () => {
        tokenRef.current = "";
      },
    });
  }

  // If the script is already present (e.g. client nav), render immediately.
  useEffect(() => {
    if (window.turnstile) renderWidget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetWidget() {
    tokenRef.current = "";
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }

  async function handleSubmit() {
    const query = rawQuery.trim();
    if (query.length < 3 || status === "submitting") return;

    setStatus("submitting");
    setRetryAfter(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawQuery: query, turnstileToken: tokenRef.current }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setRetryAfter(typeof data?.retryAfter === "number" ? data.retryAfter : null);
        setStatus("rate_limited");
        resetWidget();
        return;
      }

      if (!res.ok) {
        setStatus("error");
        resetWidget();
        return;
      }

      const data = await res.json();

      if (data?.budgetExhausted) {
        setStatus("budget");
        return;
      }

      const result = data as CreateRunResponse;
      if (result?.runId && result?.intent) {
        onIntent(result.runId, result.intent);
        return;
      }

      setStatus("error");
      resetWidget();
    } catch {
      setStatus("error");
      resetWidget();
    }
  }

  const submitting = status === "submitting";

  return (
    <div className="w-full">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={renderWidget}
      />

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

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div ref={widgetRef} className="min-h-[65px]" />

          <Button
            onClick={handleSubmit}
            disabled={submitting || rawQuery.trim().length < 3}
            className="h-11 rounded-control bg-accent px-6 text-base font-semibold text-text hover:bg-accent-hover sm:w-auto"
          >
            {submitting ? "Ищу…" : "Найти"}
          </Button>
        </div>
      </div>

      {status === "budget" && (
        <p className="mt-3 text-sm text-warning">
          Дневной лимит исчерпан, загляните завтра.
        </p>
      )}
      {status === "rate_limited" && (
        <p className="mt-3 text-sm text-warning">
          Слишком много запросов, попробуйте позже
          {retryAfter ? ` (примерно через ${Math.ceil(retryAfter / 60)} мин)` : ""}.
        </p>
      )}
      {status === "error" && (
        <p className="mt-3 text-sm text-error">
          Что-то пошло не так. Попробуйте ещё раз через минуту.
        </p>
      )}
    </div>
  );
}
