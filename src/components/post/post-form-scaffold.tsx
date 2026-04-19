"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Loader2, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";

export interface PostFormStep {
  label: string;
  description: string;
  icon: LucideIcon;
}

interface PostFormScaffoldProps {
  title: string;
  description: string;
  breadcrumbs: BreadcrumbItem[];
  badgeLabel: string;
  badgeClassName: string;
  guideTitle?: string;
  guideDescription: string;
  steps: readonly PostFormStep[];
  currentStep: number;
  error?: string | null;
  /** Per-field error messages to list inside the error alert. */
  fieldErrors?: Record<string, string>;
  /** Human-readable labels keyed by field name, used to prefix error messages. */
  fieldLabels?: Record<string, string>;
  /** Label like "Step 1 \u2014 Details" shown in the error alert heading. */
  errorStepLabel?: string;
  /** Per-step boolean: true if that step currently has validation errors. */
  stepHasErrors?: boolean[];
  onRetry?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Optional completeness percentage (0-100). Shows a progress bar when provided. */
  completeness?: number;
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

export function PostFormScaffold({
  title,
  description,
  breadcrumbs,
  badgeLabel,
  badgeClassName,
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
  children,
  footer,
  completeness,
}: PostFormScaffoldProps) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  return (
    <div id="post-form-top" className="max-w-3xl mx-auto space-y-4">
      <PageHeader title={title} description={description} breadcrumbs={breadcrumbs} />

      <Alert variant="info" hideIcon className="border-foreground/10 bg-muted/40 text-foreground">
        <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <AlertTitle>{guideTitle}</AlertTitle>
          <AlertDescription>{guideDescription}</AlertDescription>
        </div>
      </Alert>

      <Card>
        <CardHeader className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Badge className={badgeClassName}>{badgeLabel}</Badge>
            <span className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>

          <nav aria-label={`${badgeLabel} creation steps`}>
            <ol className="flex items-center justify-between gap-2">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isCompleted = index < currentStep;
                const isCurrent = index === currentStep;
                const hasError = stepHasErrors?.[index] ?? false;

                return (
                  <li
                    key={step.label}
                    className="flex min-w-0 flex-1 items-center last:flex-initial"
                  >
                    <div
                      className={cn(
                        "flex min-w-0 items-center gap-2 text-sm",
                        hasError && "text-destructive",
                        !hasError && isCurrent && "text-foreground",
                        !hasError && isCompleted && "text-brand-green",
                        !hasError && !isCurrent && !isCompleted && "text-muted-foreground"
                      )}
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      <div
                        className={cn(
                          "relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                          hasError && "border-destructive bg-destructive/10 text-destructive",
                          !hasError &&
                            isCurrent &&
                            "border-brand-green bg-brand-green text-white shadow-lg shadow-brand-green/20",
                          !hasError &&
                            isCompleted &&
                            "border-brand-green bg-brand-green/10 text-brand-green",
                          !hasError &&
                            !isCurrent &&
                            !isCompleted &&
                            "border-muted-foreground/30 text-muted-foreground"
                        )}
                      >
                        {hasError ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </div>
                      <div className="hidden min-w-0 sm:block">
                        <p className="truncate text-xs font-semibold">{step.label}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </div>

                    {index < steps.length - 1 && (
                      <div
                        aria-hidden="true"
                        className={cn(
                          "mx-3 h-0.5 flex-1 rounded-full transition-colors duration-300",
                          index < currentStep ? "bg-brand-green" : "bg-muted"
                        )}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
            {/* Mobile: show current step label below circles */}
            <p className="sm:hidden text-center text-xs font-semibold mt-2 text-foreground">
              {steps[currentStep].label}
              <span className="block text-[10px] font-normal text-muted-foreground">
                {steps[currentStep].description}
              </span>
            </p>
          </nav>

          {/* Completeness score */}
          {completeness != null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Listing completeness</span>
                <span className="font-medium">{Math.round(completeness)}%</span>
              </div>
              <progress
                max={100}
                value={Math.min(Math.max(Math.round(completeness), 0), 100)}
                className={cn(
                  "h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full",
                  completeness >= 80
                    ? "[&::-webkit-progress-value]:bg-brand-green [&::-moz-progress-bar]:bg-brand-green"
                    : completeness >= 50
                      ? "[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500"
                      : "[&::-webkit-progress-value]:bg-muted-foreground/40 [&::-moz-progress-bar]:bg-muted-foreground/40"
                )}
              />
            </div>
          )}

          {error && (
            <Alert ref={errorRef} variant="destructive">
              <div>
                <AlertTitle>
                  {errorStepLabel ? `Please review ${errorStepLabel}` : "Please review this form"}
                </AlertTitle>
                <AlertDescription>
                  <p>{error}</p>
                  {fieldErrors && Object.keys(fieldErrors).length > 0 && (
                    <ul className="mt-2 list-disc pl-4 space-y-0.5 text-[13px]">
                      {Object.entries(fieldErrors).map(([key, msg], i) => {
                        const label = formatFieldSummaryLabel(key, fieldLabels);
                        return (
                          <li key={i}>
                            <strong>{label}:</strong> {msg}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </AlertDescription>
                {onRetry && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={onRetry}
                  >
                    Try again
                  </Button>
                )}
              </div>
            </Alert>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {children}
          {footer}
        </CardContent>
      </Card>
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

  return (
    <div className="flex items-center justify-between border-t pt-4">
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        disabled={currentStep === 0}
        className={cn(currentStep === 0 && "invisible")}
      >
        Back
      </Button>

      {isLastStep ? (
        <Button
          key="submit-action"
          type={submitType}
          onClick={submitType === "button" ? onSubmitClick : undefined}
          disabled={submitDisabled || isSubmitting}
          aria-busy={isSubmitting}
          className="min-w-36 gap-2"
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
        <Button key="next-action" type="button" onClick={onNext} disabled={nextDisabled}>
          Next
        </Button>
      )}
    </div>
  );
}
