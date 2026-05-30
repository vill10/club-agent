import crypto from "node:crypto";
import { db } from "@/lib/db";

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function hashIp(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(ip + (process.env.IP_HASH_DAILY_SALT ?? "") + utcDay())
    .digest("hex");
}

const hourCountStmt = db.prepare(
  `SELECT count FROM ip_ledger WHERE ip_hash = ? AND day = ? AND hour = ?`,
);

const dayTotalStmt = db.prepare(
  `SELECT COALESCE(SUM(count), 0) AS total FROM ip_ledger WHERE ip_hash = ? AND day = ?`,
);

const incStmt = db.prepare(
  `INSERT INTO ip_ledger (ip_hash, day, hour, count)
   VALUES (?, ?, ?, 1)
   ON CONFLICT(ip_hash, day, hour) DO UPDATE SET count = count + 1`,
);

export function checkAndIncrement(ipHash: string): {
  ok: boolean;
  retryAfter?: number;
} {
  const perHour = Number(process.env.PER_IP_RUNS_PER_HOUR ?? 3);
  const perDay = Number(process.env.PER_IP_RUNS_PER_DAY ?? 8);

  const txn = db.transaction((): { ok: boolean; retryAfter?: number } => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();

    const hourRow = hourCountStmt.get(ipHash, day, hour) as
      | { count: number }
      | undefined;
    const hourCount = hourRow?.count ?? 0;

    const dayRow = dayTotalStmt.get(ipHash, day) as { total: number };
    const dayTotal = dayRow.total;

    if (hourCount >= perHour) {
      const next = new Date(now);
      next.setUTCMinutes(0, 0, 0);
      next.setUTCHours(now.getUTCHours() + 1);
      return {
        ok: false,
        retryAfter: Math.ceil((next.getTime() - now.getTime()) / 1000),
      };
    }

    if (dayTotal >= perDay) {
      const next = new Date(now);
      next.setUTCHours(0, 0, 0, 0);
      next.setUTCDate(now.getUTCDate() + 1);
      return {
        ok: false,
        retryAfter: Math.ceil((next.getTime() - now.getTime()) / 1000),
      };
    }

    incStmt.run(ipHash, day, hour);
    return { ok: true };
  });

  return txn();
}
