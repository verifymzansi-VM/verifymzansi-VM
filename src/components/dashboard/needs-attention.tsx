import Link from "next/link";
import {
  AlertTriangle,
  MessageSquare,
  Clock,
  TrendingUp,
  ShieldAlert,
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
}

const iconColors = {
  destructive: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
};

export function NeedsAttention({
  unreadLeadCount,
  rejectedListingCount,
  pendingModerationCount,
  expiringListingCount,
  expiringPromoCount,
  verificationStatus,
  stepsRemaining,
}: NeedsAttentionProps) {
  const items: NeedsAttentionItem[] = [];

  if (rejectedListingCount > 0) {
    items.push({
      label: `${rejectedListingCount} rejected post${rejectedListingCount > 1 ? "s" : ""} — edit & resubmit`,
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
      icon: TrendingUp,
      variant: "warning",
    });
  }

  if (expiringPromoCount > 0) {
    items.push({
      label: `${expiringPromoCount} tourism or event post${expiringPromoCount > 1 ? "s" : ""} ending in 48h`,
      href: "/dashboard/tourism-events",
      icon: TrendingUp,
      variant: "warning",
    });
  }

  if (verificationStatus === "rejected") {
    items.push({
      label: "Verification needs fixes — resubmit",
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

  // Nothing to show — hide completely to save space
  if (items.length === 0) return null;

  const hasDestructive = items.some((i) => i.variant === "destructive");
  const bannerBg = hasDestructive
    ? "bg-red-50/80 border-red-200 dark:bg-red-950/40 dark:border-red-800"
    : "bg-amber-50/80 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800";
  const bannerIcon = hasDestructive
    ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";

  return (
    <section aria-label="Items needing attention">
      <div className={cn("rounded-xl border p-3", bannerBg)}>
        {/* Summary line */}
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className={cn("h-4 w-4 flex-shrink-0", bannerIcon)} />
          <p className="text-sm font-semibold">
            {items.length} {items.length === 1 ? "item needs" : "items need"} attention
          </p>
        </div>

        {/* Action item list */}
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-background/60 active:scale-[0.98]"
                >
                  <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", iconColors[item.variant])} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
