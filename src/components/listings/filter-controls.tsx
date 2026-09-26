import type { KeyboardEvent, ReactNode } from "react";
import { X } from "lucide-react";
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

export function FilterPanel({
  title = "Filters",
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("surface-card elev-xs space-y-5 rounded-2xl p-5", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FilterField({
  label,
  htmlFor,
  labelId,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
      ) : (
        <p id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

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
  tone?: "green" | "blue" | "sunset";
}) {
  const selectedTone =
    tone === "blue"
      ? "border-brand-blue-600 bg-brand-blue-50 text-brand-blue-700 dark:bg-brand-blue-500/15 dark:text-brand-blue-200"
      : tone === "sunset"
        ? "border-sunset-600 bg-sunset-50 text-sunset-700 dark:bg-sunset-500/15 dark:text-sunset-200"
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

/** Removable "active filter" pill with a real button (keyboard reachable, labelled). */
export function RemovableFilterChip({
  label,
  removeLabel,
  onRemove,
  onRemoveKeyDown,
  disabled,
  icon,
}: {
  label: ReactNode;
  removeLabel: string;
  onRemove: () => void;
  onRemoveKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pl-3 pr-0.5 text-xs font-medium text-foreground">
      {icon}
      <span className="truncate">{label}</span>
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
        onKeyDown={onRemoveKeyDown}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
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
