"use client";

import { CheckCircle2, Loader2, type LucideIcon } from "lucide-react";
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
  children: React.ReactNode;
  footer?: React.ReactNode;
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
  children,
  footer,
}: PostFormScaffoldProps) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
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

                return (
                  <li
                    key={step.label}
                    className="flex min-w-0 flex-1 items-center last:flex-initial"
                  >
                    <div
                      className={cn(
                        "flex min-w-0 items-center gap-2 text-sm",
                        isCurrent && "text-foreground",
                        isCompleted && "text-brand-green",
                        !isCurrent && !isCompleted && "text-muted-foreground"
                      )}
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                          isCurrent &&
                            "border-brand-green bg-brand-green text-white shadow-lg shadow-brand-green/20",
                          isCompleted && "border-brand-green bg-brand-green/10 text-brand-green",
                          !isCurrent &&
                            !isCompleted &&
                            "border-muted-foreground/30 text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
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

          {error && (
            <Alert variant="destructive">
              <div>
                <AlertTitle>Please review this form</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
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
