"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  CloudUpload,
  Lightbulb,
  Loader2,
  ShoppingBag,
  TreePalm,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { cn } from "@/lib/utils";

export interface PostFormStep {
  label: string;
  description: string;
  icon: LucideIcon;
}

export type PostFormArea = "market" | "business" | "tourism";

interface AreaStyle {
  icon: LucideIcon;
  tile: string;
  pill: string;
  bar: string;
}

const AREA_STYLES: Record<PostFormArea, AreaStyle> = {
  market: {
    icon: ShoppingBag,
    tile: "area-market-tile",
    pill: "border-brand-green-200 bg-brand-green-50 text-brand-green-800 dark:border-brand-green-800 dark:bg-brand-green-950/60 dark:text-brand-green-200",
    bar: "bg-brand-green-600 dark:bg-brand-green-400",
  },
  business: {
    icon: Building2,
    tile: "area-business-tile",
    pill: "border-brand-blue-200 bg-brand-blue-50 text-brand-blue-800 dark:border-brand-blue-800 dark:bg-brand-blue-950/60 dark:text-brand-blue-200",
    bar: "bg-brand-blue-600 dark:bg-brand-blue-400",
  },
  tourism: {
    icon: TreePalm,
    tile: "area-tourism-tile",
    pill: "border-sunset-200 bg-sunset-50 text-sunset-800 dark:border-sunset-800 dark:bg-sunset-950/60 dark:text-sunset-200",
    bar: "bg-sunset-600 dark:bg-sunset-400",
  },
};

function inferArea(badgeLabel: string): PostFormArea {
  const label = badgeLabel.toLowerCase();
  if (label.includes("business")) return "business";
  if (label.includes("tourism") || label.includes("event")) return "tourism";
  return "market";
}

/** True on wide (lg+) screens. Always false on the server and first render. */
function useWideLayout(): boolean {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWide(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  return isWide;
}

interface PostFormScaffoldProps {
  title: string;
  description: string;
  breadcrumbs: BreadcrumbItem[];
  badgeLabel: string;
  /** @deprecated Colour now comes from `area`; kept for call-site compatibility. */
  badgeClassName?: string;
  /** Product area colour. Inferred from `badgeLabel` when omitted. */
  area?: PostFormArea;
  guideTitle?: string;
  guideDescription: string;
  steps: readonly PostFormStep[];
  currentStep: number;
  error?: string | null;
  /** Per-field error messages to list inside the error alert. */
  fieldErrors?: Record<string, string>;
  /** Human-readable labels keyed by field name, used to prefix error messages. */
  fieldLabels?: Record<string, string>;
  /** Label like "Step 1 — Details" shown in the error alert heading. */
  errorStepLabel?: string;
  /** Per-step boolean: true if that step currently has validation errors. */
  stepHasErrors?: boolean[];
  onRetry?: () => void;
  /** Optional recovery action (e.g. a sign-in link) rendered inside the error alert. */
  errorAction?: React.ReactNode;
  onStepChange?: (step: number) => void;
  onFieldError?: (key: string) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Optional completeness percentage (0-100). Shows a progress bar when provided. */
  completeness?: number;
  /**
   * Optional side panel (live preview, tips). Rendered beside the form on wide
   * screens only, so mobile keeps a single focused column.
   */
  aside?: React.ReactNode;
}

function formatFieldSummaryLabel(fieldKey: string, fieldLabels?: Record<string, string>): string {
  const explicitLabel = fieldLabels?.[fieldKey]?.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  return fieldKey
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function completenessTone(value: number): { bar: string; label: string } {
  if (value >= 80) {
    return { bar: "bg-brand-green-600 dark:bg-brand-green-400", label: "Looking strong" };
  }
  if (value >= 50) {
    return { bar: "bg-brand-gold-500 dark:bg-brand-gold-400", label: "Getting there" };
  }
  return { bar: "bg-muted-foreground/50", label: "Just started" };
}

export function PostFormScaffold({
  title,
  description,
  breadcrumbs,
  badgeLabel,
  area: areaProp,
  guideTitle = "Quick guide",
  guideDescription,
  steps,
  currentStep,
  error,
  fieldErrors,
  fieldLabels,
  errorStepLabel,
  stepHasErrors,
  onRetry,
  errorAction,
  onStepChange,
  onFieldError,
  children,
  footer,
  completeness,
  aside,
}: PostFormScaffoldProps) {
  const errorRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const area = areaProp ?? inferArea(badgeLabel);
  const styles = AREA_STYLES[area];
  const AreaIcon = styles.icon;
  const isWide = useWideLayout();
  const showAside = Boolean(aside) && isWide;
  const safeStep = Math.min(Math.max(currentStep, 0), steps.length - 1);
  const activeStep = steps[safeStep];
  const StepIcon = activeStep.icon;
  const roundedCompleteness =
    completeness != null ? Math.min(Math.max(Math.round(completeness), 0), 100) : null;
  const tone = roundedCompleteness != null ? completenessTone(roundedCompleteness) : null;

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  return (
    <div
      id="post-form-top"
      className={cn(
        "mx-auto space-y-5 scroll-mt-32 [&_input]:scroll-mt-40 [&_select]:scroll-mt-40 [&_textarea]:scroll-mt-40",
        showAside ? "max-w-6xl" : "max-w-3xl"
      )}
    >
      <header>
        <div className="relative space-y-4">
          <Breadcrumbs items={breadcrumbs} />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Posting in {badgeLabel}</span>
            <Link
              href="/post/create"
              onClick={(event) => {
                if (
                  !window.confirm(
                    "Change posting route? Your saved draft stays on this device, but unsaved uploads will need to be selected again."
                  )
                )
                  event.preventDefault();
              }}
              className="inline-flex min-h-11 items-center underline"
            >
              Change
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Complete fields marked Required. You can leave Optional fields blank. Use the
            question-mark help for examples.
          </p>
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className={cn(
                "hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl sm:flex",
                styles.tile
              )}
            >
              <AreaIcon className="h-7 w-7" />
            </span>
            <div className="min-w-0 space-y-2">
              <h1 className="font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight text-foreground sm:text-[2.25rem]">
                {title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                {description}
              </p>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <Alert ref={errorRef} variant="destructive">
          <div>
            <AlertTitle>
              {errorStepLabel ? `Please review ${errorStepLabel}` : "Please review this form"}
            </AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              {fieldErrors && Object.keys(fieldErrors).length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[13px]">
                  {Object.entries(fieldErrors).map(([key, msg], i) => {
                    const label = formatFieldSummaryLabel(key, fieldLabels);
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          className="text-left underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
                          onClick={() => {
                            if (onFieldError) onFieldError(key);
                            else document.getElementById(key)?.focus();
                          }}
                        >
                          <strong>{label}:</strong> {msg}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </AlertDescription>
            {errorAction && <div className="mt-2">{errorAction}</div>}
            {onRetry && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        </Alert>
      )}

      {safeStep === steps.length - 1 && onStepChange && (
        <nav aria-label="Review and edit your answers" className="flex flex-wrap gap-2">
          {steps.slice(0, -1).map((item, index) => (
            <button
              key={item.label}
              type="button"
              className="min-h-11 rounded-lg border px-3 text-sm underline"
              onClick={() => onStepChange(index)}
            >
              Edit {item.label.toLowerCase()}
            </button>
          ))}
        </nav>
      )}
      <div
        className={cn(
          showAside && "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
        )}
      >
        <div className="min-w-0 space-y-4">
          <div className="surface-card overflow-hidden">
            <div className="space-y-3 border-b border-border/60 bg-muted/30 px-4 pb-4 pt-4 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Step {safeStep + 1} of {steps.length}
                </p>
                {roundedCompleteness != null && tone ? (
                  <p className="text-xs font-medium text-muted-foreground">
                    {roundedCompleteness}% complete
                  </p>
                ) : null}
              </div>

              <nav aria-label={`${badgeLabel} creation steps`}>
                <ol className={cn("grid gap-2", steps.length > 3 ? "grid-cols-4" : "grid-cols-3")}>
                  {steps.map((step, index) => {
                    const ItemIcon = step.icon;
                    const isCompleted = index < safeStep;
                    const isCurrent = index === safeStep;
                    const hasError = stepHasErrors?.[index] ?? false;

                    return (
                      <li
                        key={step.label}
                        className="min-w-0"
                        aria-current={isCurrent ? "step" : undefined}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "block h-1.5 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                            hasError
                              ? "bg-destructive"
                              : isCompleted || isCurrent
                                ? styles.bar
                                : "bg-muted"
                          )}
                        />
                        <span
                          className={cn(
                            "mt-2 min-w-0 items-center gap-1.5 text-xs font-semibold sm:flex sm:text-[13px]",
                            steps.length > 3 && !isCurrent ? "hidden" : "flex",
                            hasError
                              ? "text-destructive"
                              : isCurrent
                                ? "text-foreground"
                                : "text-muted-foreground"
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "hidden h-5 w-5 shrink-0 items-center justify-center rounded-full sm:flex",
                              hasError
                                ? "bg-destructive/10"
                                : isCompleted
                                  ? cn(styles.bar, "text-white dark:text-background")
                                  : "bg-muted"
                            )}
                          >
                            {hasError ? (
                              <AlertCircle className="h-3 w-3" />
                            ) : isCompleted ? (
                              <Check className="h-3 w-3" strokeWidth={3} />
                            ) : (
                              <ItemIcon className="h-3 w-3" />
                            )}
                          </span>
                          <span className="truncate">{step.label}</span>
                          {hasError ? <span className="sr-only">(needs attention)</span> : null}
                          {isCompleted && !hasError ? (
                            <span className="sr-only">(done)</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </div>
            <div className="flex items-center gap-3 px-4 pt-5 sm:px-6">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  styles.tile
                )}
              >
                <StepIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2
                  id={headingId}
                  className="font-display text-lg font-bold leading-tight tracking-tight text-foreground sm:text-xl"
                >
                  {activeStep.label}
                </h2>
                <p className="text-sm text-muted-foreground">{activeStep.description}</p>
              </div>
            </div>
            <div className="space-y-6 px-4 pb-6 pt-5 sm:px-6">
              {safeStep === 0 ? (
                <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
                  <Lightbulb
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
                    aria-hidden="true"
                  />
                  <p className="leading-6 text-muted-foreground">
                    <span className="font-semibold text-foreground">{guideTitle}</span>
                    <span aria-hidden="true">: </span>
                    <span className="sr-only">. </span>
                    {guideDescription}
                  </p>
                </div>
              ) : null}
              {children}
            </div>
          </div>

          {footer}
        </div>

        {showAside ? (
          <aside aria-label="Preview" className="sticky top-32 space-y-4">
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

interface PostFormSectionProps {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** Shows a small "Optional" tag beside the title. */
  optional?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Groups related fields inside a step with a short heading and helper line.
 * Consecutive sections are separated by a hairline. The section deliberately
 * has no accessible name so label-based lookups only ever resolve to inputs.
 */
export function PostFormSection({
  title,
  description,
  icon: Icon,
  optional = false,
  id,
  className,
  children,
}: PostFormSectionProps) {
  const generatedId = useId();
  const headingId = `${id ?? generatedId}-heading`;

  return (
    <section
      className={cn(
        "space-y-4 border-t border-border/60 pt-6 first:border-t-0 first:pt-0",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        {Icon ? (
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold leading-6 text-foreground">
            {title}
            {optional ? (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-[11px] font-medium text-muted-foreground">
                Optional
              </span>
            ) : null}
          </h3>
          {description ? (
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function formatClockTime(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

interface PostDraftStatusProps {
  lastSavedAt: number | string | Date | null | undefined;
  onDiscard: () => void;
}

/** Quiet "draft saved" line with a discard action, shown under the form. */
export function PostDraftStatus({ lastSavedAt, onDiscard }: PostDraftStatusProps) {
  const savedTime = lastSavedAt ? formatClockTime(lastSavedAt) : "";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
      <p className="inline-flex items-center gap-1.5" aria-live="polite">
        <CloudUpload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {savedTime
          ? `Draft saved on this device at ${savedTime}`
          : "We save a draft on this device as you type."}
      </p>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-foreground/80 underline-offset-4 transition-colors hover:text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Discard draft
      </button>
    </div>
  );
}

const ACTION_BAR_CLASS =
  "sticky bottom-0 z-30 -mx-4 flex items-center gap-3 border-t border-border/70 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:bg-card/95 sm:py-3 sm:elev-md";

interface PostEditActionBarProps {
  onCancel: () => void;
  isSubmitting?: boolean;
  submittingLabel?: string;
  submitDisabled?: boolean;
  saveLabel?: string;
}

/** Sticky Cancel / Save bar for the edit forms (submits the enclosing form). */
export function PostEditActionBar({
  onCancel,
  isSubmitting = false,
  submittingLabel = "Saving...",
  submitDisabled = false,
  saveLabel = "Save changes",
}: PostEditActionBarProps) {
  return (
    <div className={ACTION_BAR_CLASS}>
      <Button type="button" variant="outline" onClick={onCancel} className="h-11 rounded-full px-5">
        Cancel
      </Button>
      <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
        Changes are checked before they go live.
      </p>
      <Button
        type="submit"
        variant="trust-verified"
        disabled={isSubmitting || submitDisabled}
        aria-busy={isSubmitting}
        className="h-11 min-w-36 flex-1 gap-2 rounded-full px-6 font-semibold sm:flex-none"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{submittingLabel}</span>
          </>
        ) : (
          saveLabel
        )}
      </Button>
    </div>
  );
}

interface PostFormFooterProps {
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  submitDisabled?: boolean;
  isSubmitting?: boolean;
  submitLabel?: string;
  submittingLabel?: string;
  submitType?: "button" | "submit";
  onSubmitClick?: () => void;
}

export function PostFormFooter({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  nextDisabled = false,
  submitDisabled = false,
  isSubmitting = false,
  submitLabel = "Submit for review",
  submittingLabel = "Submitting...",
  submitType = "submit",
  onSubmitClick,
}: PostFormFooterProps) {
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className={ACTION_BAR_CLASS}>
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={isFirstStep}
        className={cn("h-11 rounded-full px-5", isFirstStep && "hidden")}
      >
        Back
      </Button>

      <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
        {isLastStep ? "Nothing goes live until our team has checked it." : null}
      </p>

      {isLastStep ? (
        <Button
          key="submit-action"
          type={submitType}
          variant="trust-verified"
          onClick={submitType === "button" ? onSubmitClick : undefined}
          disabled={submitDisabled || isSubmitting}
          aria-busy={isSubmitting}
          className="h-11 min-w-36 flex-1 gap-2 rounded-full px-6 font-semibold sm:flex-none"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{submittingLabel}</span>
            </>
          ) : (
            submitLabel
          )}
        </Button>
      ) : (
        <Button
          key="next-action"
          type="button"
          variant="trust-verified"
          onClick={onNext}
          disabled={nextDisabled}
          className="h-11 flex-1 rounded-full px-8 font-semibold sm:flex-none"
        >
          Next
        </Button>
      )}
    </div>
  );
}
