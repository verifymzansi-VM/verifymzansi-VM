import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { ENTERPRISE_QUOTE_ABOVE_SLOTS } from "@/lib/constants/pricing";
import { cn } from "@/lib/utils";

const MULTI_LISTING_HREF = "/pricing/multi-listing";

/**
 * Offers multi-listing where people choose how to pay for a post: the posting
 * flow's plan step (including "all slots in use") and the billing page. Prices
 * live on the multi-listing page, which reads the current catalogue.
 */
export function MultiListingNudge({
  emphasis = "normal",
  className,
}: {
  /** "strong" when every slot is in use: that is when a dealer needs it most. */
  emphasis?: "normal" | "strong";
  className?: string;
}) {
  const strong = emphasis === "strong";
  return (
    <aside
      aria-label="Multi-listing plans"
      className={cn(
        "mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        strong
          ? "border-brand-green-600/50 bg-brand-green/[0.06] dark:bg-brand-green/10"
          : "border-border/70 bg-muted/40",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span className="icon-tile h-10 w-10 shrink-0 rounded-xl area-business-tile">
          <Building2 aria-hidden="true" className="h-5 w-5" />
        </span>
        <p className="text-sm leading-6 text-muted-foreground">
          <span className="block font-semibold text-foreground">
            {strong ? "Need more posts live at once?" : "Listing lots of stock?"}
          </span>
          Multi-listing keeps 10 to {ENTERPRISE_QUOTE_ABOVE_SLOTS} posts live at the same time for
          90 or 180 days, at a lower price per post. For dealers, agencies, shops and landlords.
        </p>
      </div>
      <Link
        href={MULTI_LISTING_HREF}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        See multi-listing plans
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </aside>
  );
}
