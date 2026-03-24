import Link from "next/link";
import {
  MessageSquare,
  Package,
  CheckCircle2,
  XCircle,
  TrendingUp,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ActivityItem {
  id: string;
  type:
    | "lead"
    | "listing_approved"
    | "listing_rejected"
    | "listing_pending"
    | "promo_expired"
    | "verification"
    | "listing_created";
  title: string;
  description?: string;
  timestamp: string;
  href?: string;
}

interface RecentActivityProps {
  items: ActivityItem[];
}

const typeConfig: Record<ActivityItem["type"], { icon: React.ElementType; color: string }> = {
  lead: { icon: MessageSquare, color: "text-blue-500 bg-blue-50 dark:bg-blue-950" },
  listing_approved: {
    icon: CheckCircle2,
    color: "text-brand-green bg-brand-green-50 dark:bg-brand-green-950",
  },
  listing_rejected: { icon: XCircle, color: "text-destructive bg-red-50 dark:bg-red-950" },
  listing_pending: { icon: Clock, color: "text-amber-500 bg-amber-50 dark:bg-amber-950" },
  promo_expired: { icon: TrendingUp, color: "text-amber-500 bg-amber-50 dark:bg-amber-950" },
  verification: {
    icon: ShieldCheck,
    color: "text-brand-green bg-brand-green-50 dark:bg-brand-green-950",
  },
  listing_created: {
    icon: Package,
    color: "text-brand-green bg-brand-green-50 dark:bg-brand-green-950",
  },
};

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
  });
}

export function RecentActivity({ items }: RecentActivityProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Recent Activity</CardTitle>
          <p className="text-sm text-muted-foreground">
            Account updates, buyer messages, and listing changes appear here.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Clock className="h-6 w-6 mb-1.5 opacity-20" />
            <p className="text-sm">No recent activity yet</p>
            <p className="text-xs mt-0.5">Activity appears here as you use the platform</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display">Recent Activity</CardTitle>
        <p className="text-sm text-muted-foreground">
          Track the latest buyer conversations and listing changes from one feed.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        <div className="divide-y" role="list" aria-label="Recent activity feed">
          {items.map((item) => {
            const config = typeConfig[item.type];
            const Icon = config.icon;
            const inner = (
              <div className="flex items-start gap-3 w-full">
                <div
                  className={cn(
                    "inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 mt-0.5",
                    config.color.split(" ").slice(1).join(" ")
                  )}
                >
                  <Icon className={cn("h-4 w-4", config.color.split(" ")[0])} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {item.description}
                    </p>
                  )}
                </div>
                <time
                  dateTime={item.timestamp}
                  className="text-[11px] text-muted-foreground flex-shrink-0 mt-0.5"
                >
                  {getRelativeTime(item.timestamp)}
                </time>
              </div>
            );

            return (
              <div key={item.id} role="listitem" className="px-6 py-3">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="block hover:bg-muted/50 -mx-6 -my-3 px-6 py-3 transition-colors rounded"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
