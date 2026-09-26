"use client";

import { AlertTriangle, Check, Clock3, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerificationStepType, VerificationStatus } from "@/types/enums";

/** Outcome of the admin review, shown as the final node of the stepper. */
export type VerificationReviewState = "not_started" | "pending" | "approved" | "attention";

interface VerificationProgressProps {
  steps: {
    type: VerificationStepType;
    status: VerificationStatus;
  }[];
  /** The step the member is working on right now (highlighted). */
  currentStep?: VerificationStepType | null;
  /** When set, a final "Review" node shows what happens after submission. */
  reviewState?: VerificationReviewState;
  className?: string;
}

const STEP_ORDER: VerificationStepType[] = ["phone", "id_doc", "selfie", "location"];

const STEP_LABELS: Record<VerificationStepType, string> = {
  phone: "Phone",
  id_doc: "ID Document",
  selfie: "Selfie",
  location: "Location",
};

/** Short labels keep five nodes readable on a 390px phone. */
const STEP_SHORT_LABELS: Record<VerificationStepType, string> = {
  phone: "Phone",
  id_doc: "ID",
  selfie: "Selfie",
  location: "Location",
};

type NodeVisual = "done" | "current" | "review" | "attention" | "todo";

const NODE_CIRCLE: Record<NodeVisual, string> = {
  done: "border-brand-green-600 bg-brand-green-600 text-white dark:border-brand-green-500 dark:bg-brand-green-500 dark:text-brand-green-950",
  current:
    "border-brand-green-600 bg-card text-brand-green-700 ring-4 ring-brand-green-600/15 dark:border-brand-green-400 dark:text-brand-green-300 dark:ring-brand-green-400/20",
  review:
    "border-brand-gold-400 bg-brand-gold-50 text-brand-gold-800 dark:border-brand-gold-400/70 dark:bg-brand-gold-400/10 dark:text-brand-gold-200",
  attention:
    "border-brand-red-600 bg-brand-red-50 text-brand-red-700 dark:border-brand-red-400 dark:bg-brand-red-500/15 dark:text-brand-red-300",
  todo: "border-border bg-muted text-muted-foreground",
};

const NODE_CAPTION: Record<NodeVisual, string> = {
  done: "text-brand-green-700 dark:text-brand-green-300",
  current: "text-brand-green-700 dark:text-brand-green-300",
  review: "text-brand-gold-800 dark:text-brand-gold-200",
  attention: "text-brand-red-700 dark:text-brand-red-300",
  todo: "text-muted-foreground",
};

function resolveStepVisual(status: VerificationStatus | undefined, isCurrent: boolean): NodeVisual {
  if (status === "approved") return "done";
  if (status === "rejected" || status === "needs_resubmission") return "attention";
  if (isCurrent) return "current";
  if (status === "pending") return "review";
  return "todo";
}

const STEP_CAPTION: Record<NodeVisual, string> = {
  done: "Done",
  current: "Now",
  review: "In review",
  attention: "Fix needed",
  todo: "To do",
};

const REVIEW_VISUAL: Record<VerificationReviewState, NodeVisual> = {
  not_started: "todo",
  pending: "review",
  approved: "done",
  attention: "attention",
};

const REVIEW_CAPTION: Record<VerificationReviewState, string> = {
  not_started: "Last",
  pending: "In review",
  approved: "Approved",
  attention: "Fix needed",
};

const REVIEW_ARIA: Record<VerificationReviewState, string> = {
  not_started: "not started",
  pending: "in review",
  approved: "approved",
  attention: "needs attention",
};

function Connector({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute right-[calc(50%+22px)] top-[18px] h-0.5 w-[calc(100%-44px)] rounded-full",
        active ? "bg-brand-green-600 dark:bg-brand-green-500" : "bg-border"
      )}
    />
  );
}

export function VerificationProgress({
  steps,
  currentStep = null,
  reviewState,
  className,
}: VerificationProgressProps) {
  const stepMap = new Map(steps.map((s) => [s.type, s.status]));
  const showReview = reviewState !== undefined;

  return (
    <ol
      className={cn("grid", showReview ? "grid-cols-5" : "grid-cols-4", className)}
      aria-label="Verification progress"
    >
      {STEP_ORDER.map((stepType, i) => {
        const status = stepMap.get(stepType);
        const isApproved = status === "approved";
        const isPending = status === "pending";
        const isRejected = status === "rejected" || status === "needs_resubmission";
        const isCurrent = currentStep === stepType;
        const visual = resolveStepVisual(status, isCurrent);
        const previousApproved = i > 0 && stepMap.get(STEP_ORDER[i - 1]) === "approved";

        return (
          <li
            key={stepType}
            className="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
            aria-label={`${STEP_LABELS[stepType]}: ${isApproved ? "approved" : isPending ? "pending" : isRejected ? "needs attention" : "not started"}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            {i > 0 && <Connector active={previousApproved} />}
            <span
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums transition-colors duration-200",
                NODE_CIRCLE[visual]
              )}
            >
              {visual === "done" ? (
                <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
              ) : visual === "attention" ? (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              ) : visual === "review" ? (
                <Clock3 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{i + 1}</span>
              )}
            </span>
            <span
              className={cn(
                "max-w-full truncate text-xs font-semibold leading-tight sm:text-[13px]",
                visual === "todo" ? "text-muted-foreground" : "text-foreground"
              )}
            >
              <span className="sm:hidden">{STEP_SHORT_LABELS[stepType]}</span>
              <span className="hidden sm:inline">{STEP_LABELS[stepType]}</span>
            </span>
            <span className={cn("text-[11px] font-medium leading-none", NODE_CAPTION[visual])}>
              {STEP_CAPTION[visual]}
            </span>
          </li>
        );
      })}

      {showReview && reviewState && (
        <li
          className="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
          aria-label={`Review: ${REVIEW_ARIA[reviewState]}`}
        >
          <Connector
            active={stepMap.get("location") === "approved" && reviewState === "approved"}
          />
          <span
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors duration-200",
              NODE_CIRCLE[REVIEW_VISUAL[reviewState]]
            )}
          >
            {reviewState === "attention" ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <span
            className={cn(
              "text-xs font-semibold leading-tight sm:text-[13px]",
              reviewState === "not_started" ? "text-muted-foreground" : "text-foreground"
            )}
          >
            Review
          </span>
          <span
            className={cn(
              "text-[11px] font-medium leading-none",
              NODE_CAPTION[REVIEW_VISUAL[reviewState]]
            )}
          >
            {REVIEW_CAPTION[reviewState]}
          </span>
        </li>
      )}
    </ol>
  );
}
