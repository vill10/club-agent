import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbPath = process.env.DATABASE_PATH ?? "./dev.sqlite (DEFAULT — env unset)";
  const resolved = path.resolve(dbPath.replace(" (DEFAULT — env unset)", ""));
  const dir = path.dirname(resolved);
  let dirExists = false,
    dirWritable = false,
    fileExists = false,
    fileSize = -1;
  try {
    dirExists = fs.existsSync(dir);
  } catch {}
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    dirWritable = true;
  } catch {}
  try {
    fileExists = fs.existsSync(resolved);
    if (fileExists) fileSize = fs.statSync(resolved).size;
  } catch {}
  return Response.json({
    databasePathEnv: process.env.DATABASE_PATH ?? null,
    resolvedDbPath: resolved,
    dbDir: dir,
    dbDirExists: dirExists,
    dbDirWritable: dirWritable,
    dbFileExists: fileExists,
    dbFileSizeBytes: fileSize,
    cwd: process.cwd(),
  });
}
