import Link from "next/link";
import {
  AlertTriangle,
  MessageSquare,
  Clock,
  TrendingUp,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AccountVerificationStatus } from "@/types/enums";

interface NeedsAttentionItem {
  count: number;
  label: string;
  description: string;
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

const variantColors = {
  destructive: {
    bg: "bg-red-50 dark:bg-red-950",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-950",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
  },
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
      count: rejectedListingCount,
      label: "Rejected",
      description: "Listings need editing",
      href: "/dashboard/listings",
      icon: AlertTriangle,
      variant: "destructive",
    });
  }

  if (unreadLeadCount > 0) {
    items.push({
      count: unreadLeadCount,
      label: "New Leads",
      description: "Waiting for your response",
      href: "/dashboard/leads",
      icon: MessageSquare,
      variant: "info",
    });
  }

  if (pendingModerationCount > 0) {
    items.push({
      count: pendingModerationCount,
      label: "Under Review",
      description: "Awaiting moderation",
      href: "/dashboard/listings",
      icon: Clock,
      variant: "warning",
    });
  }

  if (expiringListingCount > 0) {
    items.push({
      count: expiringListingCount,
      label: "Expiring Soon",
      description: "Listings expiring in 7 days",
      href: "/dashboard/listings",
      icon: TrendingUp,
      variant: "warning",
    });
  }

  if (expiringPromoCount > 0) {
    items.push({
      count: expiringPromoCount,
      label: "Promos Ending",
      description: "Promotions ending in 48h",
      href: "/dashboard/promotions",
      icon: TrendingUp,
      variant: "warning",
    });
  }

  if (verificationStatus === "rejected") {
    items.push({
      count: 1,
      label: "Resubmit",
      description: "Verification needs fixes",
      href: "/verification",
      icon: ShieldAlert,
      variant: "warning",
    });
  } else if (verificationStatus === "incomplete" && stepsRemaining > 0) {
    items.push({
      count: stepsRemaining,
      label: "Steps Left",
      description: "Complete verification",
      href: "/verification",
      icon: ShieldAlert,
      variant: "warning",
    });
  } else if (verificationStatus === "pending_review") {
    items.push({
      count: 1,
      label: "Under Review",
      description: "Verification pending",
      href: "/verification",
      icon: Clock,
      variant: "info",
    });
  }

  const visibleItems = items.slice(0, 4);

  return (
    <section aria-label="Items needing attention">
      <Card
        className={cn(items.length === 0 && "border-brand-green-200 dark:border-brand-green-800")}
      >
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-display">What needs action now</CardTitle>
          <p className="text-sm text-muted-foreground">
            Start with the items that unblock your account, content, or buyer replies.
          </p>
        </CardHeader>
        <CardContent>
          {visibleItems.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-brand-green-200 bg-brand-green-50/70 p-4 text-brand-green dark:border-brand-green-800 dark:bg-brand-green-950/40 dark:text-brand-green-100">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">You&apos;re caught up</p>
                <p className="text-sm text-current/80">
                  No urgent actions are blocking you right now. Use the overview below to manage
                  your account.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleItems.map((item) => {
                const colors = variantColors[item.variant];
                const Icon = item.icon;

                return (
                  <Link key={`${item.label}-${item.href}`} href={item.href}>
                    <Card
                      className={cn(
                        "h-full border transition-all hover:-translate-y-0.5 hover:shadow-md",
                        colors.border
                      )}
                    >
                      <CardContent className="flex h-full flex-col gap-3 p-4">
                        <div className="flex items-start justify-between">
                          <div
                            className={cn(
                              "inline-flex items-center justify-center w-9 h-9 rounded-lg",
                              colors.bg
                            )}
                          >
                            <Icon className={cn("h-4 w-4", colors.text)} />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">Open</span>
                        </div>
                        <div className="space-y-1">
                          <p className={cn("text-2xl font-bold font-display", colors.text)}>
                            {item.count}
                          </p>
                          <p className="text-sm font-medium">{item.label}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
