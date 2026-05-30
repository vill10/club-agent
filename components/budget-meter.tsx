"use client";

import { useEffect, useState } from "react";

interface BudgetData {
  usedUsd: number;
  capUsd: number;
  runsCount: number;
}

/**
 * BudgetMeter — subtle daily-budget readout.
 * Fetches GET /api/budget on mount. Degrades to nothing if the fetch fails.
 */
export function BudgetMeter() {
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/budget")
      .then((res) => {
        if (!res.ok) throw new Error(`budget fetch ${res.status}`);
        return res.json();
      })
      .then((data: BudgetData) => {
        if (!cancelled) setBudget(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;
  if (!budget) return null;

  return (
    <p className="text-xs text-faint tabular-nums">
      Дневной бюджет: ${budget.usedUsd.toFixed(2)} / ${budget.capUsd.toFixed(2)}
    </p>
  );
}
