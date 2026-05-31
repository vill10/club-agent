"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { IntentChips } from "@/components/intent-chips";
import { QueryBox } from "@/components/query-box";
import {
  TurnstileGate,
  type TurnstileGateHandle,
} from "@/components/turnstile-gate";
import { FrostedText } from "@/components/ui/frosted-text";
import { WebGLShader } from "@/components/ui/web-gl-shader";
import { cn } from "@/lib/utils";
import type { CreateRunResponse, Intent } from "@/types";

type RunStatus = "idle" | "submitting" | "budget" | "rate_limited" | "error";

export default function Home() {
  const router = useRouter();

  // Two-step landing: free text → editable chips → run. No nav until the run
  // is actually created.
  const [step, setStep] = useState<"query" | "chips">("query");
  const [rawQuery, setRawQuery] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // Page-level Turnstile widget, mounted across both steps so a freshly-issued
  // single-use token can be obtained right before the /api/runs call.
  const turnstileRef = useRef<TurnstileGateHandle>(null);

  function handleExtracted(args: { rawQuery: string; intent: Intent }) {
    setRawQuery(args.rawQuery);
    setIntent(args.intent);
    setRunStatus("idle");
    setStep("chips");
  }

  async function handleConfirm() {
    if (!intent || runStatus === "submitting") return;

    setRunStatus("submitting");
    setRetryAfter(null);

    try {
      // Turnstile tokens are single-use + short-lived. Mint a FRESH one right
      // before the run call so /api/runs never sees a spent/expired token.
      let turnstileToken: string;
      try {
        turnstileToken = await turnstileRef.current!.getFreshToken();
      } catch {
        setRunStatus("error");
        return;
      }

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawQuery, intent, turnstileToken }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setRetryAfter(
          typeof data?.retryAfter === "number" ? data.retryAfter : null,
        );
        setRunStatus("rate_limited");
        return;
      }

      if (res.status === 403) {
        // Turnstile rejected (token spent / expired). Send the user back to the
        // start so the widget re-issues a fresh token.
        setRunStatus("error");
        return;
      }

      if (!res.ok) {
        setRunStatus("error");
        return;
      }

      const data = await res.json();
      if (data?.budgetExhausted) {
        setRunStatus("budget");
        return;
      }

      const result = data as CreateRunResponse;
      if (result?.runId) {
        router.push(`/runs/${result.runId}`);
        return;
      }

      setRunStatus("error");
    } catch {
      setRunStatus("error");
    }
  }

  const showQuery = step === "query" || !intent;

  return (
    <main className="relative flex flex-1 flex-col bg-transparent">
      {/* "The beam" — fixed WebGL violet light-beam behind everything.
          The wrapper is bg-transparent (NOT bg-bg) so the fixed -z-10 canvas
          shows through; <html>/<body> keep the dark --bg as the fallback. */}
      <WebGLShader />

      {/* Soft, smaller radial behind the headline for text contrast — NOT a
          full-screen dark wash. Fades fully transparent well before the edges
          so the beam stays visible across most of the viewport. Sits above the
          canvas (z-0), below the content (z-10). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_38%_22%_at_50%_30%,color-mix(in_oklch,var(--bg)_55%,transparent)_0%,transparent_72%)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-16 sm:py-24">
        {/* Frosted-glass hero — NO box. The heading is TRUE glass letters: a
            backdrop-blur layer masked to the glyph shapes, so the animated
            violet beam shows through the letters BLURRED/frosted while staying
            fully transparent everywhere else. Real text kept sr-only for a11y.
            The subtitle (wrapping Russian) uses the translucent-glass fallback —
            semi-transparent white fill so the beam shows through the glyphs,
            with a soft text-shadow for legibility. No panel, no border. */}
        <header className="mb-10 flex flex-col items-center text-center sm:mb-12">
          <h1 className="sr-only">Club Agent</h1>
          {/* Glass-letter heading. Width clamps the responsive scale; the SVG
              mask scales with it (text-6xl → md:text-8xl equivalents). */}
          <FrostedText
            text="Club Agent"
            fontSize={100}
            fontWeight={800}
            letterSpacing={-3}
            blur={13}
            tintAlpha={0.09}
            strokeAlpha={0.38}
            className="w-[min(92vw,34rem)]"
          />

          {/* Subtitle: translucent-glass fallback (beam visible through the
              glyphs, no box). */}
          <p className="sr-only">
            Агент для поиска подходящих кружков и секций в Астане
          </p>
          <p
            aria-hidden
            className={cn(
              "mx-auto mt-6 max-w-xl text-base font-medium sm:text-lg",
              "text-white/60 [text-shadow:0_1px_2px_rgba(0,0,0,0.6),0_0_14px_color-mix(in_oklch,var(--accent-glow)_30%,transparent)]",
            )}
          >
            Агент для поиска подходящих кружков и секций в Астане
          </p>
        </header>

        {showQuery ? (
          <QueryBox onExtracted={handleExtracted} />
        ) : (
          <div className="w-full">
            <IntentChips
              intent={intent}
              onChange={setIntent}
              onConfirm={handleConfirm}
              submitting={runStatus === "submitting"}
            />

            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setStep("query");
                  setRunStatus("idle");
                }}
                className="text-sm text-faint transition-colors hover:text-muted"
              >
                ← Изменить запрос
              </button>
            </div>

            {runStatus === "budget" && (
              <p className="mt-3 text-sm text-warning">
                Дневной лимит исчерпан, загляните завтра.
              </p>
            )}
            {runStatus === "rate_limited" && (
              <p className="mt-3 text-sm text-warning">
                Слишком много запросов, попробуйте позже
                {retryAfter
                  ? ` (примерно через ${Math.ceil(retryAfter / 60)} мин)`
                  : ""}
                .
              </p>
            )}
            {runStatus === "error" && (
              <p className="mt-3 text-sm text-error">
                Что-то пошло не так. Попробуйте ещё раз через минуту.
              </p>
            )}
          </div>
        )}

        {/* Page-level Turnstile: stays mounted across both steps so the run
            call always sends a freshly-minted token. Kept subtle below the
            interactive area. */}
        <div className="mt-6 w-full">
          <TurnstileGate ref={turnstileRef} />
        </div>
      </div>
    </main>
  );
}
