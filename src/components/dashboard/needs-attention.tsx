import Link from "next/link";
import {
  AlertTriangle,
  MessageSquare,
  Clock,
  TrendingUp,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  trustLevel: number;
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
  trustLevel,
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
      label: "Ending Soon",
      description: "Promotions & Events posts ending in 48h",
      href: "/dashboard/promotions",
      icon: TrendingUp,
      variant: "warning",
    });
  }

  if (trustLevel <= 1) {
    items.push({
      count: 4 - trustLevel,
      label: "Steps Left",
      description: "Complete verification",
      href: "/verification",
      icon: ShieldAlert,
      variant: "warning",
    });
  } else if (trustLevel === 2) {
    items.push({
      count: 1,
      label: "Under Review",
      description: "Verification pending",
      href: "/verification",
      icon: Clock,
      variant: "info",
    });
  }

  if (items.length === 0) return null;

  return (
    <section aria-label="Items needing attention">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Needs Your Attention
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {items.slice(0, 4).map((item) => {
          const colors = variantColors[item.variant];
          const Icon = item.icon;

          return (
            <Link key={item.label} href={item.href}>
              <Card
                className={cn(
                  "hover:shadow-md transition-all cursor-pointer border",
                  colors.border
                )}
              >
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        "inline-flex items-center justify-center w-9 h-9 rounded-lg",
                        colors.bg
                      )}
                    >
                      <Icon className={cn("h-4 w-4", colors.text)} />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className={cn("text-2xl font-bold font-display mt-2", colors.text)}>
                    {item.count}
                  </p>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
