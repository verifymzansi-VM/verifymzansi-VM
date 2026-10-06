import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  MessageSquare,
  Clock,
  Hourglass,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountVerificationStatus } from "@/types/enums";

interface NeedsAttentionItem {
  label: string;
  href: string;
  icon: React.ElementType;
  variant: "destructive" | "warning" | "info";
}

interface NeedsAttentionProps {
  unreadLeadCount: number;
  rejectedListingCount: number;
  pendingModerationCount: number;
  expiringListingCount: number;
  expiringPromoCount: number;
  verificationStatus: AccountVerificationStatus;
  stepsRemaining: number;
  /**
   * Show verification reminders in this list. Turn off where a dedicated
   * verification card is already on screen so the reminder is not repeated.
   */
  includeVerification?: boolean;
  /** Live businesses with neither the CIPC nor the Seen sticker. */
  unstickeredBusinessCount?: number;
}

const iconTones = {
  destructive:
    "bg-brand-red-100 text-brand-red-700 dark:bg-brand-red-500/15 dark:text-brand-red-300",
  warning:
    "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
  info: "bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-500/15 dark:text-brand-blue-300",
};

export function NeedsAttention({
  unreadLeadCount,
  rejectedListingCount,
  pendingModerationCount,
  expiringListingCount,
  expiringPromoCount,
  verificationStatus,
  stepsRemaining,
  includeVerification = true,
  unstickeredBusinessCount = 0,
}: NeedsAttentionProps) {
  const items: NeedsAttentionItem[] = [];

  if (rejectedListingCount > 0) {
    items.push({
      label: `${rejectedListingCount} rejected post${rejectedListingCount > 1 ? "s" : ""}`,
      href: "/dashboard/listings",
      icon: AlertTriangle,
      variant: "destructive",
    });
  }

  if (unreadLeadCount > 0) {
    items.push({
      label: `${unreadLeadCount} new lead${unreadLeadCount > 1 ? "s" : ""} waiting`,
      href: "/dashboard/leads",
      icon: MessageSquare,
      variant: "info",
    });
  }

  if (pendingModerationCount > 0) {
    items.push({
      label: `${pendingModerationCount} post${pendingModerationCount > 1 ? "s" : ""} under review`,
      href: "/dashboard/listings",
      icon: Clock,
      variant: "warning",
    });
  }

  if (expiringListingCount > 0) {
    items.push({
      label: `${expiringListingCount} listing${expiringListingCount > 1 ? "s" : ""} expiring soon`,
      href: "/dashboard/listings",
      icon: Hourglass,
      variant: "warning",
    });
  }

  if (expiringPromoCount > 0) {
    items.push({
      label: `${expiringPromoCount} tourism or event post${expiringPromoCount > 1 ? "s" : ""} ending in 48h`,
      href: "/dashboard/tourism-events",
      icon: Hourglass,
      variant: "warning",
    });
  }

  if (includeVerification) {
    if (verificationStatus === "rejected") {
      items.push({
        label: "Verification needs fixes",
        href: "/verification",
        icon: ShieldAlert,
        variant: "destructive",
      });
    } else if (verificationStatus === "incomplete" && stepsRemaining > 0) {
      items.push({
        label: `${stepsRemaining} verification step${stepsRemaining > 1 ? "s" : ""} left`,
        href: "/verification",
        icon: ShieldAlert,
        variant: "warning",
      });
    }
  }

  if (unstickeredBusinessCount > 0) {
    items.push({
      label:
        unstickeredBusinessCount > 1
          ? `Verify ${unstickeredBusinessCount} businesses`
          : "Verify your business",
      href: "/dashboard/listings?area=MZANSI_BUSINESS",
      icon: BadgeCheck,
      variant: "info",
    });
  }

  // Nothing to show — hide completely to save space
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="needs-attention-title"
      className="rounded-2xl border border-border/70 bg-card elev-xs"
    >
      <h2
        id="needs-attention-title"
        className="px-4 pb-1 pt-4 font-display text-base font-semibold text-foreground sm:px-5"
      >
        Needs your attention
      </h2>
      <ul className="divide-y divide-border/60 px-2 pb-2 sm:px-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                className="group flex min-h-12 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    iconTones[item.variant]
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                  {item.label}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
