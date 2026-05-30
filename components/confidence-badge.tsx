"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Confidence = "high" | "medium" | "low";

const LABEL: Record<Exclude<Confidence, "high">, string> = {
  medium: "предположительно",
  low: "не уверен",
};

const TONE: Record<Exclude<Confidence, "high">, string> = {
  medium: "text-warning",
  low: "text-faint",
};

/**
 * ConfidenceBadge — tiny, unobtrusive marker for sub-high-confidence fields.
 *
 * High-confidence fields render plainly (no badge), so this returns null for
 * `confidence === "high"`. Medium/low render a small pill; when a
 * `sourceSnippet` is present the pill becomes a Popover trigger that reveals
 * the snippet the agent extracted the value from.
 */
export function ConfidenceBadge({
  confidence,
  sourceSnippet,
}: {
  confidence: Confidence;
  sourceSnippet?: string;
}) {
  if (confidence === "high") return null;

  const label = LABEL[confidence];
  const pillClass = cn(
    "ml-1.5 inline-flex shrink-0 items-center rounded-pill px-1.5 py-px text-[10px] leading-tight tracking-tight",
    "bg-surface-raised",
    TONE[confidence],
  );

  if (!sourceSnippet) {
    return <span className={pillClass}>{label}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          pillClass,
          "cursor-help underline decoration-dotted underline-offset-2 outline-none",
        )}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-64 text-xs text-muted"
      >
        Источник: «{sourceSnippet}»
      </PopoverContent>
    </Popover>
  );
}
