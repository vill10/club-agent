"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { BudgetMeter } from "@/components/budget-meter";
import { IntentChips } from "@/components/intent-chips";
import { QueryBox } from "@/components/query-box";
import {
  TurnstileGate,
  type TurnstileGateHandle,
} from "@/components/turnstile-gate";
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

  return (
    <main className="flex flex-1 flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-16 sm:py-24">
        <header className="mb-10 text-center sm:mb-12">
          <h1 className="text-5xl font-bold tracking-tight text-accent sm:text-6xl">
            Club Agent
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Опишите, что ищете — агент сам найдёт кружки и секции в Астане
            и соберёт всё в одном месте.
          </p>
        </header>

        {step === "query" || !intent ? (
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

      <footer className="flex justify-center px-5 pb-8">
        <BudgetMeter />
      </footer>
    </main>
  );
}
