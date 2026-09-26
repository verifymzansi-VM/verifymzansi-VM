"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Pencil, Eye, Package, AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpiryCountdownBadge } from "@/components/dashboard/expiry-countdown-badge";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { formatSaShortDate } from "@/lib/utils/format";

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

const LIVE_TONE =
  "bg-brand-green-50 text-brand-green-700 ring-brand-green/20 dark:bg-brand-green-500/15 dark:text-brand-green-300";
const PENDING_TONE =
  "bg-brand-gold-50 text-brand-gold-900 ring-brand-gold-400/40 dark:bg-brand-gold-400/15 dark:text-brand-gold-200";
const REJECTED_TONE =
  "bg-brand-red-50 text-brand-red-700 ring-brand-red-300 dark:bg-brand-red-500/15 dark:text-brand-red-300";
const NEUTRAL_TONE = "bg-muted text-muted-foreground ring-border";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  live: { label: "Live", className: LIVE_TONE },
  active: { label: "Live", className: LIVE_TONE },
  pending_moderation: { label: "In review", className: PENDING_TONE },
  pending_review: { label: "In review", className: PENDING_TONE },
  flagged_for_review: { label: "In review", className: PENDING_TONE },
  rejected: { label: "Rejected", className: REJECTED_TONE },
  draft: { label: "Draft", className: NEUTRAL_TONE },
  expired: { label: "Expired", className: NEUTRAL_TONE },
  sold: { label: "Sold", className: NEUTRAL_TONE },
  hidden: { label: "Hidden", className: NEUTRAL_TONE },
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
    label: "In review",
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
  // Deterministic "Sat 15 Mar" → "15 Mar" (no locale drift between server and browser).
  return formatSaShortDate(iso).split(" ").slice(1).join(" ");
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
      <section
        aria-labelledby="my-posts-title"
        className="rounded-2xl border border-border/70 bg-card p-5 text-center elev-xs"
      >
        <h2 id="my-posts-title" className="sr-only">
          My posts
        </h2>
        <span aria-hidden="true" className="empty-state-icon">
          <Package className="h-6 w-6" />
        </span>
        <p className="mt-3 font-display text-base font-semibold text-foreground">
          You haven&apos;t posted yet
        </p>
        <Button asChild variant="trust-verified" className="mt-4 h-11 rounded-full px-5">
          <Link href="/post/create">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Create your first post
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="my-posts-title"
      className="rounded-2xl border border-border/70 bg-card elev-xs"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <h2 id="my-posts-title" className="font-display text-base font-semibold">
          My posts
        </h2>
        <Link href="/dashboard/listings" className="link-arrow min-h-11 px-1">
          Manage all
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>

      {/* Status filter — horizontally scrollable on mobile */}
      <div
        role="group"
        className="flex gap-1.5 overflow-x-auto px-4 pb-3 pt-1 scrollbar-hide sm:px-5"
        aria-label="Filter posts by status"
      >
        {TABS.map((tab) => {
          const count = countsPerTab[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={isActive}
              data-state={isActive ? "active" : "inactive"}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground"
              )}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums",
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
      <div className="border-t border-border/60">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <Package aria-hidden="true" className="mb-2 h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              No {tabDef.label.toLowerCase()} posts right now.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60" aria-label="Posts">
            {visible.map((post) => {
              const status = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft;
              const thumbnail = post.photos?.[0] ? normalizeMediaUrl(post.photos[0]) : null;
              const title = post.title?.slice(0, 60) || "Untitled";
              const isRejected = post.status === "rejected";
              const dateStr = getRelativeDate(post.updated_at || post.created_at);
              const showExpiry = post.status === "live" || post.status === "active";

              return (
                <li key={post.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  {/* Thumbnail */}
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {thumbnail ? (
                      <Image
                        src={thumbnail}
                        alt=""
                        width={56}
                        height={56}
                        className="h-full w-full bg-muted object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Package aria-hidden="true" className="h-5 w-5 text-muted-foreground/60" />
                      </div>
                    )}
                  </div>

                  {/* Title + meta */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                          status.className
                        )}
                      >
                        {status.label}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                        <span>{post.view_count ?? 0}</span>
                        <span className="sr-only">views</span>
                      </span>
                      <span suppressHydrationWarning>{dateStr}</span>
                    </div>
                    {showExpiry ? (
                      <ExpiryCountdownBadge
                        expiresAt={post.expires_at}
                        className="mt-1 flex text-xs font-medium text-brand-gold-800 dark:text-brand-gold-300"
                        iconClassName="h-3.5 w-3.5"
                      />
                    ) : null}
                  </div>

                  {/* Quick action */}
                  <Button
                    asChild
                    variant={isRejected ? "destructive" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-11 shrink-0 rounded-full",
                      isRejected ? "gap-1.5 px-3.5" : "w-11 p-0"
                    )}
                  >
                    <Link
                      href={getEditHref(post.id, post.area)}
                      aria-label={isRejected ? `Fix ${title}` : `Edit ${title}`}
                    >
                      {isRejected ? (
                        <>
                          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                          Fix
                        </>
                      ) : (
                        <Pencil aria-hidden="true" className="h-4 w-4" />
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
