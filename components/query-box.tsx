"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ExtractIntentResponse, Intent } from "@/types";

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

type Status = "idle" | "submitting" | "error";

export interface QueryBoxProps {
  /**
   * Fired on successful intent extraction. Surfaces the raw query, the
   * extracted intent, and the current Turnstile token so the parent can drive
   * the chips → run step. The widget stays mounted; a fresh token is read on
   * the run call.
   */
  onExtracted: (args: {
    rawQuery: string;
    intent: Intent;
    turnstileToken: string;
  }) => void;
}

export function QueryBox({ onExtracted }: QueryBoxProps) {
  const [rawQuery, setRawQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");

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

    try {
      // Step 1: extract intent only (cheap, no Turnstile). The run is created
      // later, after the user confirms the chips.
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
        onExtracted({
          rawQuery: query,
          intent: data.intent,
          turnstileToken: tokenRef.current,
        });
        return;
      }

      setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  // Exposed via ref pattern is overkill here; the parent re-reads the token by
  // keeping the widget mounted across steps. resetWidget remains available for
  // the error path.
  void resetWidget;

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

      {status === "error" && (
        <p className="mt-3 text-sm text-error">
          Что-то пошло не так. Попробуйте ещё раз через минуту.
        </p>
      )}
    </div>
  );
}
