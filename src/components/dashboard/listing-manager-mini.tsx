"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Pencil, Eye, Package, AlertTriangle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpiryCountdownBadge } from "@/components/dashboard/expiry-countdown-badge";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MiniListingPost {
  id: string;
  title: string | null;
  status: string;
  area?: string | null;
  photos?: string[] | null;
  view_count?: number | null;
  expires_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface ListingManagerMiniProps {
  posts: MiniListingPost[];
  /** Maximum posts per tab (default 5) */
  limit?: number;
}

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  live: {
    label: "Live",
    className:
      "bg-brand-green-50 text-brand-green border-brand-green-200 dark:bg-brand-green-950 dark:border-brand-green-800",
  },
  active: {
    label: "Live",
    className:
      "bg-brand-green-50 text-brand-green border-brand-green-200 dark:bg-brand-green-950 dark:border-brand-green-800",
  },
  pending_moderation: {
    label: "Pending",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
  },
  pending_review: {
    label: "Pending",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
  },
  flagged_for_review: {
    label: "Review",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:border-red-800",
  },
  draft: {
    label: "Draft",
    className: "bg-warm-100 text-warm-600 border-warm-200 dark:bg-warm-800 dark:border-warm-700",
  },
  expired: {
    label: "Expired",
    className: "bg-warm-100 text-warm-500 border-warm-200 dark:bg-warm-800 dark:border-warm-700",
  },
  sold: {
    label: "Sold",
    className: "bg-warm-100 text-warm-500 border-warm-200 dark:bg-warm-800 dark:border-warm-700",
  },
  hidden: {
    label: "Hidden",
    className: "bg-warm-100 text-warm-500 border-warm-200 dark:bg-warm-800 dark:border-warm-700",
  },
};

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

type TabKey = "all" | "live" | "pending" | "rejected" | "expired";

const TABS: { key: TabKey; label: string; statuses: string[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "live", label: "Live", statuses: ["live", "active"] },
  {
    key: "pending",
    label: "Pending",
    statuses: ["pending_moderation", "pending_review", "flagged_for_review"],
  },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
  { key: "expired", label: "Expired", statuses: ["expired", "sold", "hidden"] },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getEditHref(id: string, area?: string | null): string {
  switch (area) {
    case "MZANSI_BUSINESS":
      return `/post/edit-business/${id}`;
    case "PROMOTIONS_EVENTS":
      return `/post/edit-tourism/${id}`;
    case "BUSINESS_ADS":
      return `/post/edit-business/${id}`;
    case "MALL_SHOPS":
      return `/post/edit-business/${id}`;
    default:
      return `/post/edit-listing/${id}`;
  }
}

function getRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function addDaysIso(value: string | null | undefined, days: number) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString();
}

function getPostExpiresAt(post: MiniListingPost) {
  if (post.expires_at) return post.expires_at;
  return addDaysIso(post.created_at, FREE_POST_CONFIG.durationDays);
}

function getDisplayStatus(post: MiniListingPost, nowMs = Date.now()) {
  if (!(post.status === "live" || post.status === "active")) {
    return post.status;
  }

  const expiresAt = getPostExpiresAt(post);
  if (!expiresAt) return post.status;

  const expiryMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiryMs) && expiryMs <= nowMs ? "expired" : post.status;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ListingManagerMini({ posts, limit = 5 }: ListingManagerMiniProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const displayPosts = posts.map((post) => ({
    ...post,
    status: getDisplayStatus(post),
    expires_at: getPostExpiresAt(post),
  }));

  const countsPerTab: Record<TabKey, number> = {
    all: displayPosts.length,
    live: 0,
    pending: 0,
    rejected: 0,
    expired: 0,
  };
  for (const p of displayPosts) {
    if (["live", "active"].includes(p.status)) countsPerTab.live++;
    if (["pending_moderation", "pending_review", "flagged_for_review"].includes(p.status)) {
      countsPerTab.pending++;
    }
    if (p.status === "rejected") countsPerTab.rejected++;
    if (["expired", "sold", "hidden"].includes(p.status)) countsPerTab.expired++;
  }

  const tabDef = TABS.find((t) => t.key === activeTab)!;
  const filtered =
    tabDef.statuses.length === 0
      ? displayPosts
      : displayPosts.filter((p) => tabDef.statuses.includes(p.status));
  const visible = filtered.slice(0, limit);

  /* ---- Empty state (entire section — no posts at all) ------------ */
  if (posts.length === 0) {
    return (
      <section className="space-y-3" aria-label="My Posts">
        <h2 className="font-display text-base font-semibold">My Posts</h2>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 py-10 text-center">
          <Package className="mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No posts yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Create a listing to start getting leads
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/post/create">Create Post</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-label="My Posts">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">My Posts</h2>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
        >
          <Link href="/dashboard/listings">
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      {/* Tab pills — horizontally scrollable on mobile */}
      <div
        className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5"
        aria-label="Filter posts by status"
      >
        {TABS.map((tab) => {
          const count = countsPerTab[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              data-state={isActive ? "active" : "inactive"}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/15 hover:text-foreground"
              )}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none",
                    isActive ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                  )}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Post list */}
      <div className="rounded-xl border border-border/60 bg-card">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <Package className="mb-1.5 h-6 w-6 opacity-20" />
            <p className="text-sm">No {tabDef.label.toLowerCase()} posts</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50" aria-label="Posts">
            {visible.map((post) => {
              const status = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft;
              const thumbnail = post.photos?.[0] ? normalizeMediaUrl(post.photos[0]) : null;
              const title = post.title?.slice(0, 50) || "Untitled";
              const isRejected = post.status === "rejected";
              const dateStr = getRelativeDate(post.updated_at || post.created_at);
              const showExpiry = post.status === "live" || post.status === "active";

              return (
                <li key={post.id} className="flex items-center gap-3 px-3.5 py-2.5 sm:px-4">
                  {/* Thumbnail */}
                  <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-warm-100 dark:bg-warm-800">
                    {thumbnail ? (
                      <Image
                        src={thumbnail}
                        alt=""
                        width={44}
                        height={44}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Package className="h-4 w-4 text-warm-400" />
                      </div>
                    )}
                  </div>

                  {/* Title + meta */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("h-4 px-1.5 py-0 text-[10px] font-medium", status.className)}
                      >
                        {status.label}
                      </Badge>
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {post.view_count ?? 0}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                    </div>
                    {showExpiry ? (
                      <ExpiryCountdownBadge
                        expiresAt={post.expires_at}
                        className="mt-1 flex text-[10px] font-medium text-amber-700 dark:text-amber-400"
                        iconClassName="h-3 w-3"
                      />
                    ) : null}
                  </div>

                  {/* Quick action */}
                  <Button
                    asChild
                    variant={isRejected ? "destructive" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8 flex-shrink-0",
                      isRejected ? "gap-1 px-2.5 text-xs" : "w-8 p-0"
                    )}
                  >
                    <Link
                      href={getEditHref(post.id, post.area)}
                      aria-label={isRejected ? `Fix ${title}` : `Edit ${title}`}
                    >
                      {isRejected ? (
                        <>
                          <AlertTriangle className="h-3 w-3" />
                          Fix
                        </>
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
