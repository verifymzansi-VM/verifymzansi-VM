import Link from "next/link";
import { Check, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { DEFAULT_COMMERCIAL_SETTINGS, type CommercialSettings } from "@/lib/commercial/settings";
import { cn } from "@/lib/utils";

/**
 * "Start free": the one introductory post every verified member can choose.
 * The long eligibility, moderation and expiry rules live in `BillingFaq`
 * (anchor `#billing-faq-trial`) so this stays scannable.
 */
export function TrialPolicy({
  trials = DEFAULT_COMMERCIAL_SETTINGS.trials,
  variant = "card",
  className,
}: {
  trials?: CommercialSettings["trials"];
  /** `card`: tall hero card (pricing). `banner`: slim full-width strip (billing). */
  variant?: "card" | "banner";
  className?: string;
}) {
  const { shortDays, longDays } = trials;
  const points = [
    `${shortDays} days, or ${longDays} days while spaces last`,
    `${FREE_POST_CONFIG.maxPhotos} photos and ${FREE_POST_CONFIG.maxVideos} video`,
    "No payment needed",
  ];

  if (variant === "banner") {
    return (
      <section
        aria-labelledby="start-free-title"
        className={cn(
          "mx-auto flex w-full max-w-5xl flex-col gap-4 rounded-2xl border border-brand-green/25 bg-brand-green/[0.06] p-4 dark:bg-brand-green/10 sm:flex-row sm:items-center sm:p-5",
          className
        )}
      >
        <span className="icon-tile h-11 w-11 bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950">
          <Gift className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="start-free-title" className="font-body text-base font-bold text-foreground">
            Your first post is free
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {shortDays} days, or {longDays} days while spaces last.{" "}
            <Link
              href="#billing-faq-trial"
              className="rounded-sm font-medium text-brand-green-700 underline underline-offset-2 hover:text-brand-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
            >
              How it works
            </Link>
          </p>
        </div>
        <Button asChild variant="trust-verified" className="h-11 w-full rounded-full sm:w-auto">
          <Link href="/post/create">Post for free</Link>
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="start-free-title"
      className={cn("hero-panel p-5 elev-lg sm:p-6", className)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-brand-gold/20 blur-3xl"
      />
      <div className="relative">
        <span className="icon-tile h-12 w-12 rounded-2xl bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950">
          <Gift className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2
          id="start-free-title"
          className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground"
        >
          Your first post is free
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">One per verified member.</p>
        <ul className="mt-4 space-y-2.5">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-sm text-foreground/90">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-brand-green-700 dark:text-brand-green-300">
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
              </span>
              {point}
            </li>
          ))}
        </ul>
        <Button
          asChild
          variant="trust-verified"
          size="lg"
          className="mt-5 h-12 w-full rounded-full"
        >
          <Link href="/post/create">Post for free</Link>
        </Button>
        <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
          <Link
            href="#billing-faq-trial"
            className="rounded-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Free post rules
          </Link>
        </p>
      </div>
    </section>
  );
}
