import fs from "node:fs";
import path from "node:path";

import { resolveDbPath } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = resolveDbPath();
  const dir = path.dirname(resolved);

  let dbDirExists = false,
    dbDirWritable = false,
    dbFileExists = false,
    dbFileSizeBytes = -1;
  try {
    dbDirExists = fs.existsSync(dir);
  } catch {}
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    dbDirWritable = true;
  } catch {}
  try {
    dbFileExists = fs.existsSync(resolved);
    if (dbFileExists) dbFileSizeBytes = fs.statSync(resolved).size;
  } catch {}

  // Dedicated /data volume probe (independent of the resolved path).
  let dataDirExists = false,
    dataDirWritable = false;
  try {
    dataDirExists = fs.existsSync("/data");
  } catch {}
  try {
    fs.accessSync("/data", fs.constants.W_OK);
    dataDirWritable = true;
  } catch {}

  return Response.json({
    databasePathEnv: process.env.DATABASE_PATH ?? null,
    resolvedDbPath: resolved,
    dbDir: dir,
    dbDirExists,
    dbDirWritable,
    dbFileExists,
    dbFileSizeBytes,
    dataDirExists,
    dataDirWritable,
    cwd: process.cwd(),
  });
}
