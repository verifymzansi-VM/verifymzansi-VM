import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatRandAmount } from "@/lib/utils/format";
import { CATEGORIES } from "@/lib/constants/categories";

/**
 * Shared, calm building blocks for every browse filter surface (Market sidebar
 * and drawer, Business sidebar and drawer, Tourism & Events panel and drawer)
 * so selects, chips and panels look and behave the same in each area.
 */

export const filterSelectClass =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground ring-offset-background transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10";

export const filterInputClass = "h-11 rounded-xl lg:h-10";

/** Toggle chip for single-choice filters (condition, state). Wraps; never squeezes. */
export function FilterChoiceChip({
  selected,
  onClick,
  children,
  tone = "green",
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "green" | "blue" | "teal";
}) {
  const selectedTone =
    tone === "blue"
      ? "border-brand-blue-600 bg-brand-blue-50 text-brand-blue-700 dark:bg-brand-blue-500/15 dark:text-brand-blue-200"
      : tone === "teal"
        ? "border-teal-600 bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200"
        : "border-brand-green-600 bg-brand-green-50 text-brand-green-800 dark:bg-brand-green/15 dark:text-brand-green-200";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:min-h-9 lg:px-3 lg:text-xs",
        selected
          ? selectedTone
          : "border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** Readable price range for chips, e.g. "R500 – R2 000", "From R500", "Up to R2 000". */
export function formatPriceRangeLabel(min?: number, max?: number) {
  const fmt = (value: number) => `R${formatRandAmount(value)}`;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `From ${fmt(min)}`;
  if (max != null) return `Up to ${fmt(max)}`;
  return "";
}

/** Human label for an attribute filter chip (option label, not the stored key). */
export function describeAttributeFilter(
  category: string | undefined,
  name: string,
  value: string | boolean | string[]
) {
  const field = CATEGORIES.find((item) => item.value === category)?.attributeFields.find(
    (item) => item.name === name
  );
  const fieldLabel = field?.label ?? name.replace(/_/g, " ");
  if (typeof value === "boolean") return fieldLabel;
  const toLabel = (raw: string) => {
    const match = field?.options?.find((option) =>
      typeof option === "string" ? option === raw : option.value === raw
    );
    if (match) return typeof match === "string" ? match : match.label;
    return raw.replace(/_/g, " ");
  };
  const text = Array.isArray(value) ? value.map(toLabel).join(", ") : toLabel(value);
  return field?.unit ? `${fieldLabel}: ${text} ${field.unit}` : text;
}
