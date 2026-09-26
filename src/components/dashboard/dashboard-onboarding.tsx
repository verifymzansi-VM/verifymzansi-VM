import { BrandShield } from "@/components/shared/brand-shield";
import Link from "next/link";
import { Check, Building2, ChevronRight, ImagePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AccountVerificationStatus } from "@/types/enums";

interface OnboardingStep {
  label: string;
  href: string;
  icon: React.ElementType;
  completed: boolean;
}

interface DashboardOnboardingProps {
  isVerified: boolean;
  verificationStatus: AccountVerificationStatus;
  hasListings: boolean;
  hasBusinesses: boolean;
}

/** Empty-account state: no posts yet, so show the path to a first post. */
export function DashboardOnboarding({
  isVerified,
  verificationStatus,
  hasListings,
  hasBusinesses,
}: DashboardOnboardingProps) {
  const verificationSubmitted = isVerified || verificationStatus === "pending_review";

  const steps: OnboardingStep[] = [
    {
      label: isVerified
        ? "Verification approved"
        : verificationSubmitted
          ? "Verification in review"
          : "Complete your verification",
      href: "/verification",
      icon: BrandShield,
      completed: verificationSubmitted,
    },
    {
      label: "Post your first item",
      href: "/post/create",
      icon: ImagePlus,
      completed: hasListings,
    },
    {
      label: "Add your business profile",
      href: "/post/create-business",
      icon: Building2,
      completed: hasBusinesses,
    },
  ];

  return (
    <section
      aria-labelledby="onboarding-title"
      className="rounded-2xl border border-border/70 bg-card elev-xs"
    >
      <div className="flex flex-col gap-4 border-b border-border/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="empty-state-icon mx-0 h-12 w-12 shrink-0">
            <ImagePlus className="h-6 w-6" />
          </span>
          <div>
            <h2
              id="onboarding-title"
              className="font-display text-lg font-bold tracking-tight text-foreground"
            >
              You haven&apos;t posted yet
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Three steps to your first post.
            </p>
          </div>
        </div>
        <Button
          asChild
          variant="trust-verified"
          className="h-11 w-full shrink-0 rounded-full px-5 sm:w-auto"
        >
          <Link href="/post/create">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Create your first post
          </Link>
        </Button>
      </div>

      <ol aria-label="Getting started" className="space-y-1 p-2 sm:p-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.href}>
              <Link
                href={step.href}
                className="group flex min-h-14 items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    step.completed
                      ? "bg-brand-green-600 text-white dark:bg-brand-green-500"
                      : "border border-border bg-background text-foreground"
                  )}
                >
                  {step.completed ? <Check className="h-5 w-5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "flex items-center gap-2 text-sm font-semibold",
                      step.completed
                        ? "text-brand-green-700 dark:text-brand-green-300"
                        : "text-foreground"
                    )}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 opacity-70" />
                    {step.label}
                    {step.completed ? <span className="sr-only">(done)</span> : null}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
