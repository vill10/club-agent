import { db } from "@/lib/db";

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

const addCostStmt = db.prepare(
  `INSERT INTO budget_ledger (day, cost_usd, runs_count)
   VALUES (?, ?, 0)
   ON CONFLICT(day) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd`,
);

const getCostStmt = db.prepare(
  `SELECT cost_usd FROM budget_ledger WHERE day = ?`,
);

const incRunsStmt = db.prepare(
  `INSERT INTO budget_ledger (day, cost_usd, runs_count)
   VALUES (?, 0, 1)
   ON CONFLICT(day) DO UPDATE SET runs_count = runs_count + 1`,
);

const getRowStmt = db.prepare(
  `SELECT cost_usd, runs_count FROM budget_ledger WHERE day = ?`,
);

export function addDailyCost(usd: number): void {
  addCostStmt.run(utcDay(), usd);
}

export function getDailyCost(): number {
  const row = getCostStmt.get(utcDay()) as { cost_usd: number } | undefined;
  return row?.cost_usd ?? 0;
}

export function isDailyBudgetExhausted(): boolean {
  return getDailyCost() >= Number(process.env.DAILY_BUDGET_USD ?? 3);
}

export function incRunsCount(): void {
  incRunsStmt.run(utcDay());
}

export function getDailyBudget(): {
  usedUsd: number;
  capUsd: number;
  runsCount: number;
} {
  const row = getRowStmt.get(utcDay()) as
    | { cost_usd: number; runs_count: number }
    | undefined;
  return {
    usedUsd: row?.cost_usd ?? 0,
    capUsd: Number(process.env.DAILY_BUDGET_USD ?? 3),
    runsCount: row?.runs_count ?? 0,
  };
}
