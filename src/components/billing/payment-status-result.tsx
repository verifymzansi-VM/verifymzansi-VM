import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PaymentStatusTone = "success" | "pending" | "error" | "neutral";

const TONE_STYLES: Record<PaymentStatusTone, string> = {
  success:
    "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300",
  pending: "bg-brand-gold/15 text-brand-gold-800 dark:bg-brand-gold/15 dark:text-brand-gold-300",
  error: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Calm, single-card payment outcome: what happened, what happens next, and
 * one clear action. Used by the checkout success and cancel return pages.
 */
export function PaymentStatusResult({
  icon,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  tone = "neutral",
  nextSteps,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  primaryAction: {
    href: string;
    label: string;
  };
  secondaryAction: {
    href: string;
    label: string;
  };
  tone?: PaymentStatusTone;
  /** Short "what happens next" list, shown under the description. */
  nextSteps?: readonly string[];
}) {
  return (
    <div className="container-page max-w-lg">
      <div className="rounded-3xl border border-border/70 bg-card p-6 text-center elev-md sm:p-8">
        <div aria-live="polite">
          <span
            className={cn(
              "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl [&_svg]:h-8 [&_svg]:w-8 [&_svg]:text-current",
              TONE_STYLES[tone]
            )}
          >
            {icon}
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>

        {nextSteps && nextSteps.length > 0 ? (
          <div className="mt-6 rounded-2xl bg-muted/60 p-4 text-left">
            <h2 className="text-sm font-semibold text-foreground">What happens next</h2>
            <ul className="mt-2.5 space-y-2">
              {nextSteps.map((step) => (
                <li
                  key={step}
                  className="flex items-start gap-2.5 text-sm leading-6 text-foreground/85"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-1 h-4 w-4 shrink-0 text-brand-green-700 dark:text-brand-green-300"
                    strokeWidth={3}
                  />
                  {step}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="trust-verified" className="h-11 rounded-full px-6 sm:min-w-44">
            <Link href={primaryAction.href}>{primaryAction.label}</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full px-6 sm:min-w-44">
            <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
          </Button>
        </div>

        {children ? <div className="mt-5 space-y-2 text-center">{children}</div> : null}
      </div>
    </div>
  );
}
