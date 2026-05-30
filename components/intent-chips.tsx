"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category, Intent, IntentField } from "@/types";

// ── Field metadata ──────────────────────────────────────────
// Keys of Intent we render as chips, in display order.
type FieldKey = keyof Intent;

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "sport", label: "Спорт" },
  { value: "art", label: "Искусство" },
  { value: "music", label: "Музыка" },
  { value: "language", label: "Языки" },
  { value: "coding", label: "Программирование" },
  { value: "dance", label: "Танцы" },
  { value: "chess", label: "Шахматы" },
  { value: "other", label: "Другое" },
];

const CATEGORY_LABEL: Record<Category, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.value] = c.label;
    return acc;
  },
  {} as Record<Category, string>,
);

// Affordance copy for adding an optional field.
const ADD_LABEL: Record<FieldKey, string> = {
  category: "+ Вид занятия",
  age: "+ Возраст",
  district: "+ Добавить район",
  budget: "+ Бюджет",
  schedule: "+ Расписание",
  hardRequirements: "+ Требование",
};

// Placeholder copy for required fields that are missing.
const REQUIRED_PLACEHOLDER: Partial<Record<FieldKey, string>> = {
  category: "Укажите вид занятия",
  age: "Укажите возраст",
};

const REQUIRED: FieldKey[] = ["category", "age"];
const OPTIONAL: FieldKey[] = ["district", "budget", "schedule", "hardRequirements"];

function isRequired(key: FieldKey): boolean {
  return REQUIRED.includes(key);
}

// A field counts as "filled" when present and carries a non-empty value.
function fieldFilled(f: IntentField<unknown>): boolean {
  if (!f.present) return false;
  if (f.value == null) return false;
  if (Array.isArray(f.value)) return f.value.length > 0;
  return String(f.value).trim().length > 0;
}

// Human-readable display of a field's value.
function displayValue(key: FieldKey, f: IntentField<unknown>): string {
  if (key === "category" && typeof f.value === "string") {
    return CATEGORY_LABEL[f.value as Category] ?? String(f.value);
  }
  if (Array.isArray(f.value)) return f.value.join(", ");
  return f.value == null ? "" : String(f.value);
}

// ── Component ───────────────────────────────────────────────
export interface IntentChipsProps {
  intent: Intent;
  onChange: (next: Intent) => void;
  onConfirm: () => void;
  submitting?: boolean;
}

export function IntentChips({
  intent,
  onChange,
  onConfirm,
  submitting = false,
}: IntentChipsProps) {
  const [editing, setEditing] = useState<FieldKey | null>(null);

  function setField(key: FieldKey, raw: string) {
    let value: unknown = raw.trim();
    if (key === "hardRequirements") {
      value = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const next: Intent = {
      ...intent,
      [key]: { value, present: true, confidence: "high" },
    } as Intent;
    onChange(next);
  }

  function clearField(key: FieldKey) {
    const next: Intent = {
      ...intent,
      [key]: {
        value: key === "hardRequirements" ? [] : null,
        present: false,
        confidence: "low",
      },
    } as Intent;
    onChange(next);
    setEditing((cur) => (cur === key ? null : cur));
  }

  const requiredMissing = REQUIRED.some((k) => !fieldFilled(intent[k]));
  const confirmDisabled = submitting || requiredMissing;

  return (
    <div className="w-full">
      {requiredMissing && (
        <p className="mb-4 text-sm text-warning">
          Уточните пару деталей: вид занятия и возраст.
        </p>
      )}

      <div className="rounded-card bg-surface p-4 shadow-[0_0_40px_-12px_var(--accent-glow)]">
        <div className="flex flex-wrap gap-2">
          {/* Required + optional present fields */}
          {([...REQUIRED, ...OPTIONAL] as FieldKey[]).map((key) => {
            const f = intent[key];
            const filled = fieldFilled(f);
            const required = isRequired(key);

            // Optional + absent → rendered later as an "add" affordance.
            if (!required && !f.present) return null;

            const isEditing = editing === key;

            if (isEditing) {
              return (
                <FieldEditor
                  key={key}
                  fieldKey={key}
                  initial={displayValue(key, f)}
                  onCommit={(raw) => {
                    if (raw.trim()) setField(key, raw);
                    else if (!required) clearField(key);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            }

            // Required but empty → red-dot placeholder pill.
            if (required && !filled) {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditing(key)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-pill border border-border bg-surface-raised px-4 py-2 text-sm text-muted transition-colors hover:text-text",
                  )}
                >
                  <span className="size-2 rounded-pill bg-error" aria-hidden />
                  {REQUIRED_PLACEHOLDER[key]}
                </button>
              );
            }

            // Filled pill.
            return (
              <span
                key={key}
                className="group inline-flex items-center gap-1.5 rounded-pill bg-accent-subtle px-4 py-2 text-sm text-text"
              >
                <button
                  type="button"
                  onClick={() => setEditing(key)}
                  className="font-medium outline-none"
                >
                  {displayValue(key, f)}
                </button>
                {!required && (
                  <button
                    type="button"
                    aria-label="Убрать"
                    onClick={() => clearField(key)}
                    className="text-muted transition-colors hover:text-text"
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}

          {/* Optional + absent → add affordances */}
          {OPTIONAL.filter((k) => !intent[k].present).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onChange({
                  ...intent,
                  [key]: {
                    value: key === "hardRequirements" ? [] : "",
                    present: true,
                    confidence: "high",
                  },
                } as Intent);
                setEditing(key);
              }}
              className="inline-flex items-center rounded-pill border border-dashed border-border px-4 py-2 text-sm text-faint transition-colors hover:text-muted"
            >
              {ADD_LABEL[key]}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <Button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="h-11 w-full rounded-control bg-accent px-6 text-base font-semibold text-text hover:bg-accent-hover sm:w-auto"
          >
            {submitting ? "Запускаю…" : "Запустить поиск"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Inline editor ───────────────────────────────────────────
// category uses a <select> of the 8 categories; everything else is a text
// input committed on Enter/blur. Escape cancels.
function FieldEditor({
  fieldKey,
  initial,
  onCommit,
  onCancel,
}: {
  fieldKey: FieldKey;
  initial: string;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}) {
  if (fieldKey === "category") {
    // Map the displayed label back to a category value on commit.
    return (
      <select
        autoFocus
        defaultValue={
          CATEGORIES.find((c) => c.label === initial)?.value ?? ""
        }
        onChange={(e) => onCommit(e.target.value)}
        onBlur={(e) => {
          if (e.target.value) onCommit(e.target.value);
          else onCancel();
        }}
        className="rounded-pill border border-accent bg-surface-raised px-4 py-2 text-sm text-text outline-none"
      >
        <option value="" disabled>
          Выберите…
        </option>
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }

  const placeholder =
    fieldKey === "hardRequirements"
      ? "через запятую"
      : fieldKey === "age"
        ? "напр. 8 или 6-9"
        : "";

  return (
    <input
      autoFocus
      type="text"
      defaultValue={initial}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit((e.target as HTMLInputElement).value);
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.target.value)}
      className="w-44 rounded-pill border border-accent bg-surface-raised px-4 py-2 text-sm text-text placeholder:text-faint outline-none"
    />
  );
}
