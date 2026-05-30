"use client";

import { useRouter } from "next/navigation";

import { BudgetMeter } from "@/components/budget-meter";
import { QueryBox } from "@/components/query-box";
import type { Intent } from "@/types";

export default function Home() {
  const router = useRouter();

  function handleIntent(runId: string, intent: Intent) {
    // TODO (Task F.2): slot the intent-chip confirm UI in here — let the user
    // review/edit the extracted Intent before the run page consumes it.
    // For now we navigate straight to the run page. The intent is passed along
    // so the chip step can pick it up once F.2 is wired.
    void intent;
    router.push(`/runs/${runId}`);
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

        <QueryBox onIntent={handleIntent} />
      </div>

      <footer className="flex justify-center px-5 pb-8">
        <BudgetMeter />
      </footer>
    </main>
  );
}
