"use client";

import { useState } from "react";
import Link from "next/link";
import { X, ShieldAlert, AlertTriangle, MessageSquare, Clock, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BannerItem {
  id: string;
  variant: "destructive" | "warning" | "info" | "success";
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
}

interface AttentionBannerProps {
  trustLevel: number;
  unreadLeadCount: number;
  rejectedListingCount: number;
  pendingModerationCount: number;
  expiringPromoCount: number;
}

const DISMISS_PREFIX = "vmz-banner-dismissed-";
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

function isDismissed(bannerId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(`${DISMISS_PREFIX}${bannerId}`);
    if (!stored) return false;
    const expiresAt = Number(stored);
    if (Date.now() > expiresAt) {
      localStorage.removeItem(`${DISMISS_PREFIX}${bannerId}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dismissBanner(bannerId: string) {
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${bannerId}`, String(Date.now() + DISMISS_DURATION_MS));
  } catch {
    // localStorage may be unavailable
  }
}

const variantStyles = {
  destructive:
    "border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive/50 dark:bg-destructive/10",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  success:
    "border-brand-green-200 bg-brand-green-50 text-brand-green-900 dark:border-brand-green-800 dark:bg-brand-green-950 dark:text-brand-green-100",
};

export function AttentionBanner({
  trustLevel,
  unreadLeadCount,
  rejectedListingCount,
  pendingModerationCount,
  expiringPromoCount,
}: AttentionBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [mounted] = useState(() => {
    // SSR-safe: starts false, will be true after hydration
    return typeof window !== "undefined";
  });

  // Build the list of banners based on props
  const banners: BannerItem[] = [];

  if (rejectedListingCount > 0) {
    banners.push({
      id: "rejected-listings",
      variant: "destructive",
      icon: AlertTriangle,
      title: `${rejectedListingCount} listing${rejectedListingCount > 1 ? "s" : ""} rejected`,
      description: "Review the rejection reason and resubmit or edit your listing.",
      href: "/dashboard/listings",
      ctaLabel: "Review Listings",
    });
  }

  if (trustLevel <= 1 && trustLevel >= 0) {
    const stepsRemaining = 4 - trustLevel;
    banners.push({
      id: "incomplete-verification",
      variant: "warning",
      icon: ShieldAlert,
      title: "Complete your verification",
      description: `${stepsRemaining} step${stepsRemaining > 1 ? "s" : ""} remaining to unlock all features and build buyer trust.`,
      href: "/verification",
      ctaLabel: "Verify Now",
    });
  } else if (trustLevel === 2) {
    banners.push({
      id: "verification-under-review",
      variant: "info",
      icon: Clock,
      title: "Verification under review",
      description:
        "Your documents have been submitted. Our team is reviewing them — this usually takes 24–48 hours.",
      href: "/verification",
      ctaLabel: "View Status",
    });
  }

  if (unreadLeadCount > 0) {
    banners.push({
      id: "unread-leads",
      variant: "info",
      icon: MessageSquare,
      title: `${unreadLeadCount} new lead${unreadLeadCount > 1 ? "s" : ""} waiting`,
      description: "Respond quickly to increase your chances of closing a sale.",
      href: "/dashboard/leads",
      ctaLabel: "View Leads",
    });
  }

  if (pendingModerationCount > 0) {
    banners.push({
      id: "pending-moderation",
      variant: "info",
      icon: Clock,
      title: `${pendingModerationCount} listing${pendingModerationCount > 1 ? "s" : ""} under review`,
      description:
        "Your listing is being reviewed by our team. This usually takes less than 24 hours.",
      href: "/dashboard/listings",
      ctaLabel: "View Status",
    });
  }

  if (expiringPromoCount > 0) {
    banners.push({
      id: "expiring-promos",
      variant: "warning",
      icon: TrendingUp,
      title: `${expiringPromoCount} Promotions & Events post${expiringPromoCount > 1 ? "s" : ""} expiring soon`,
      description: "Renew your Promotions & Events posts to keep your campaigns visible to buyers.",
      href: "/dashboard/promotions",
      ctaLabel: "Manage Promotions & Events",
    });
  }

  // Filter out dismissed banners
  const visibleBanners = banners.filter(
    (b) => !dismissedIds.has(b.id) && (!mounted || !isDismissed(b.id))
  );

  if (visibleBanners.length === 0) return null;

  return (
    <div className="space-y-2" role="status" aria-label="Items needing your attention">
      {visibleBanners.map((banner) => {
        const Icon = banner.icon;
        return (
          <div
            key={banner.id}
            className={cn(
              "relative flex items-start gap-3 rounded-lg border px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-300",
              variantStyles[banner.variant]
            )}
          >
            <Icon className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{banner.title}</p>
              <p className="text-xs mt-0.5 opacity-80">{banner.description}</p>
              <Button asChild variant="outline" size="sm" className="mt-2 h-7 text-xs">
                <Link href={banner.href}>{banner.ctaLabel}</Link>
              </Button>
            </div>
            <button
              onClick={() => {
                dismissBanner(banner.id);
                setDismissedIds((prev) => new Set([...prev, banner.id]));
              }}
              className="flex-shrink-0 rounded-sm p-1 opacity-60 hover:opacity-100 transition-opacity"
              aria-label={`Dismiss ${banner.title}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
