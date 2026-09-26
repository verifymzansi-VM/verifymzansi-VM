import Link from "next/link";
import { Check, Clock, AlertCircle } from "lucide-react";
import { BrandShield, BrandShieldAlert } from "@/components/shared/brand-shield";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AccountVerificationStatus } from "@/types/enums";

type StepKey = "phone" | "id_doc" | "selfie" | "location";
type StepState = "done" | "submitted" | "fix" | "todo";

const STEPS: { key: StepKey; label: string; next: string }[] = [
  { key: "phone", label: "Phone number", next: "confirm your phone number" },
  { key: "id_doc", label: "ID document", next: "upload your ID" },
  { key: "selfie", label: "Selfie", next: "take a selfie" },
  { key: "location", label: "Location", next: "confirm your area" },
];

const STATE_LABELS: Record<StepState, string> = {
  done: "Done",
  submitted: "In review",
  fix: "Needs fixing",
  todo: "To do",
};

export interface VerificationStepRecord {
  step_type?: string | null;
  status?: string | null;
}

function getStepState(steps: VerificationStepRecord[], key: StepKey): StepState {
  const statuses = steps.filter((step) => step.step_type === key).map((step) => step.status);
  if (statuses.includes("rejected") || statuses.includes("needs_resubmission")) return "fix";
  if (statuses.includes("approved")) return "done";
  if (statuses.includes("pending")) return "submitted";
  return "todo";
}

interface VerificationStatusCardProps {
  status: AccountVerificationStatus;
  stepsRemaining: number;
  steps: VerificationStepRecord[] | null | undefined;
}

/**
 * Prominent verification status for members who are not verified yet:
 * where they are, the one next step, and a single action.
 * Verified members see a compact badge in the page header instead.
 */
export function VerificationStatusCard({
  status,
  stepsRemaining,
  steps,
}: VerificationStatusCardProps) {
  if (status === "verified") return null;

  const stepStates = STEPS.map((step) => ({ ...step, state: getStepState(steps ?? [], step.key) }));
  const nextStep =
    stepStates.find((step) => step.state === "fix") ??
    stepStates.find((step) => step.state === "todo");
  const noneStarted = stepStates.every((step) => step.state === "todo");

  const isRejected = status === "rejected";
  const isPending = status === "pending_review";

  const title = isRejected
    ? "Your verification needs attention"
    : isPending
      ? "We're reviewing your documents"
      : stepsRemaining > 0
        ? `${stepsRemaining} step${stepsRemaining === 1 ? "" : "s"} to verify your account`
        : "Finish verifying your account";

  const description = isRejected
    ? "Some details need fixing."
    : isPending
      ? "We'll notify you when it's done."
      : nextStep
        ? `Next: ${nextStep.next}.`
        : "You need to be verified to post.";

  const ctaLabel = isRejected
    ? "Fix and resubmit"
    : isPending
      ? "View verification status"
      : nextStep?.state === "fix"
        ? `Fix your ${nextStep.label.toLowerCase()}`
        : noneStarted
          ? "Start verification"
          : "Continue verification";

  const Icon = isRejected ? BrandShieldAlert : BrandShield;

  return (
    <section
      aria-labelledby="verification-status-title"
      data-testid="dashboard-verification-card"
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-card p-5 elev-sm sm:p-6",
        isRejected ? "border-brand-red-300 dark:border-brand-red-500/40" : "border-brand-green/25"
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent to-60%",
          isRejected
            ? "from-brand-red-50 dark:from-brand-red-500/10"
            : "from-brand-green-50 dark:from-brand-green-500/10"
        )}
      />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              isRejected
                ? "bg-brand-red-100 text-brand-red-700 dark:bg-brand-red-500/15 dark:text-brand-red-300"
                : "area-market-tile"
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2
              id="verification-status-title"
              className="font-display text-lg font-bold leading-snug tracking-tight text-foreground sm:text-xl"
            >
              {title}
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button
          asChild
          variant={isPending ? "outline" : isRejected ? "destructive" : "trust-verified"}
          className="h-11 w-full shrink-0 rounded-full px-5 sm:w-auto"
        >
          <Link href="/verification">{ctaLabel}</Link>
        </Button>
      </div>

      <ol
        aria-label="Verification steps"
        className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {stepStates.map((step, index) => (
          <li
            key={step.key}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
              step.state === "done" &&
                "border-brand-green/25 bg-brand-green-50/70 dark:bg-brand-green-500/10",
              step.state === "submitted" &&
                "border-brand-gold-300/70 bg-brand-gold-50 dark:border-brand-gold-400/30 dark:bg-brand-gold-400/10",
              step.state === "fix" &&
                "border-brand-red-300 bg-brand-red-50 dark:border-brand-red-500/40 dark:bg-brand-red-500/10",
              step.state === "todo" && "border-border/70 bg-background/60"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                step.state === "done" && "bg-brand-green-600 text-white dark:bg-brand-green-500",
                step.state === "submitted" &&
                  "bg-brand-gold-200 text-brand-gold-900 dark:bg-brand-gold-400/25 dark:text-brand-gold-200",
                step.state === "fix" && "bg-brand-red-600 text-white",
                step.state === "todo" && "bg-muted text-muted-foreground"
              )}
            >
              {step.state === "done" ? (
                <Check className="h-3.5 w-3.5" />
              ) : step.state === "submitted" ? (
                <Clock className="h-3.5 w-3.5" />
              ) : step.state === "fix" ? (
                <AlertCircle className="h-3.5 w-3.5" />
              ) : (
                index + 1
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">
                {step.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {STATE_LABELS[step.state]}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
