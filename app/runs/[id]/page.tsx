import Link from "next/link";

import { getCards, getEvents, getRun } from "@/lib/db-queries";
import type { RunSnapshot } from "@/types";

import { RunView } from "./run-view";

// Server component does the initial SSR fetch directly from the DB (no HTTP
// round-trip), then hands the snapshot to the client RunView which takes over
// live streaming. Refresh-safe (SSR snapshot rehydrates) and share-safe
// (anyone opening the URL gets the full run on first paint).
export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const run = getRun(id);
  if (!run) {
    return <RunNotFound />;
  }

  const snapshot: RunSnapshot = {
    run,
    events: getEvents(id),
    cards: getCards(id),
  };

  return <RunView runId={id} initialSnapshot={snapshot} />;
}

function RunNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-bg px-5 py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-text sm:text-4xl">
        Поиск не найден
      </h1>
      <p className="mt-4 max-w-md text-base text-muted">
        Такого поиска не существует или он был удалён.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center rounded-control bg-accent px-6 py-3 text-base font-semibold text-text transition-colors hover:bg-accent-hover"
      >
        Начать новый поиск
      </Link>
    </main>
  );
}
