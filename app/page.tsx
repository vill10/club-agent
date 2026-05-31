"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { IntentChips } from "@/components/intent-chips";
import { QueryBox } from "@/components/query-box";
import {
  TurnstileGate,
  type TurnstileGateHandle,
} from "@/components/turnstile-gate";
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
        {/* Frosted-glass hero: a tight backdrop-blur pane (approach a, glass
            glyphs) hugging the heading+subtitle. The text fill is
            semi-transparent white so the animated violet beam glows softly
            THROUGH the glyphs, while the inline `backdrop-blur` frosts the beam
            behind the text block — the same translucent/blur material as the
            query input (bg-surface/60 + backdrop-blur + border-white/NN).
            A faint border + bg-white/[0.03] tint and a text-shadow keep the
            glyphs legible over the bright moving beam without going opaque. */}
        <header
          className={cn(
            "mb-10 inline-block rounded-card px-6 py-5 text-center sm:mb-12",
            "border border-white/10 bg-white/[0.03] backdrop-blur-md",
          )}
        >
          <h1
            className={cn(
              "text-6xl font-extrabold tracking-tighter md:text-8xl",
              "text-white/70",
              "[text-shadow:0_1px_2px_rgba(0,0,0,0.55),0_0_18px_color-mix(in_oklch,var(--accent-glow)_55%,transparent)]",
            )}
          >
            Club Agent
          </h1>
          <p
            className={cn(
              "mx-auto mt-6 max-w-xl text-base sm:text-lg",
              "text-white/65 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]",
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
