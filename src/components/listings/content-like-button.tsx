"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { trackContactAction } from "@/lib/analytics/commercial-events";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf-client";
import { obtainViewerIdentifier } from "@/components/engagement/viewer-challenge";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompactCount } from "@/lib/utils/format";
import type { ContentTargetType } from "@/lib/engagement";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";

/** Likes double as "saves" in commercial reports. */
const CONTENT_TABLES = {
  listing: "listings",
  business: "businesses",
  promotion: "promotions",
} as const;

/**
 * This browser's note of the posts it liked (only a display hint): the count
 * it showed with its own like and when, so a remounted card or a cached page
 * never shows a red heart with a number that leaves the like out (a like from
 * a new browser waits 10 minutes before the server total includes it, and
 * pages are cached for a while). The count is a floor only for
 * LIKE_FLOOR_WINDOW_MS; after that the page's own count is the truth, so the
 * number cannot stay inflated when others (or this account elsewhere) unlike.
 * Older notes hold "1" and no count.
 */
export const LIKE_FLOOR_WINDOW_MS = 30 * 60 * 1000;
const LIKED_KEY = (id: string) => `vmz:liked:${id}`;
function readLikeNote(id: string): string | null {
  try {
    return localStorage.getItem(LIKED_KEY(id));
  } catch {
    return null;
  }
}
export function parseLikeNote(
  note: string | null,
  now = Date.now()
): { liked: boolean; count: number | null } {
  if (note === null) return { liked: false, count: null };
  const match = /^count:(\d+):at:(\d+)$/.exec(note);
  const count = match ? Number(match[1]) : NaN;
  const at = match ? Number(match[2]) : NaN;
  const fresh = Number.isFinite(at) && now >= at && now - at < LIKE_FLOOR_WINDOW_MS;
  return { liked: true, count: fresh && count >= 1 ? count : null };
}
function rememberLiked(id: string, liked: boolean, count: number) {
  try {
    if (liked) localStorage.setItem(LIKED_KEY(id), `count:${Math.max(1, count)}:at:${Date.now()}`);
    else localStorage.removeItem(LIKED_KEY(id));
  } catch {
    // Storage can be blocked (private mode); the heart then starts empty.
  }
}
/** The number shown: once this browser liked the post, never below the count
 * it confirmed with that like (and never below 1). */
export function shownLikeCount(pageCount: number, note: { liked: boolean; count: number | null }) {
  const page = Math.max(0, pageCount);
  return note.liked ? Math.max(page, note.count ?? 1) : page;
}
/** Likes made in another tab of this browser. */
function subscribeToLikes(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

interface ContentLikeButtonProps {
  targetId: string;
  targetType: ContentTargetType;
  initialLikeCount?: number | null;
  initialLiked?: boolean;
  className?: string;
  /** "rail": large round button with the count underneath, for the desktop viewer. */
  variant?: "pill" | "rail";
}

export function ContentLikeButton({
  targetId,
  targetType,
  initialLikeCount = 0,
  initialLiked = false,
  className,
  variant = "pill",
}: ContentLikeButtonProps) {
  const [optimisticState, setOptimisticState] = useState<{
    targetId: string;
    targetType: ContentTargetType;
    liked: boolean;
    likeCount: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Pages are the same for everyone, so whether this browser liked the post
  // comes from its own note of its likes (the server keeps the truth).
  const note = parseLikeNote(
    useSyncExternalStore(
      subscribeToLikes,
      () => (SHOW_ENGAGEMENT_TOTALS ? readLikeNote(targetId) : null),
      () => null
    )
  );

  const currentState =
    optimisticState &&
    optimisticState.targetId === targetId &&
    optimisticState.targetType === targetType
      ? optimisticState
      : null;
  const liked = currentState?.liked ?? (initialLiked || note.liked);
  const likeCount =
    currentState?.likeCount ??
    (initialLiked && !note.liked
      ? (initialLikeCount ?? 0)
      : shownLikeCount(initialLikeCount ?? 0, note));

  const displayedLikeCount = Math.min(999, Math.max(0, likeCount ?? 0));
  // The rail shows the full count (compact); cards keep their capped pill.
  const spokenCount = variant === "rail" ? Math.max(0, likeCount ?? 0) : displayedLikeCount;
  const noun = variant === "rail" ? "post" : "card";
  const ariaLabel = liked
    ? `Unlike this ${noun}. ${spokenCount} like${spokenCount === 1 ? "" : "s"}`
    : `Like this ${noun}. ${spokenCount} like${spokenCount === 1 ? "" : "s"}`;

  // Hidden until likes are stored by the live backend (src/lib/hidden-features.ts).
  if (!SHOW_ENGAGEMENT_TOTALS) return null;

  return (
    <div className={cn("relative z-20", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          const previousLiked = liked;
          const previousLikeCount = likeCount ?? 0;
          const optimisticLiked = !previousLiked;
          const optimisticLikeCount = Math.max(0, previousLikeCount + (optimisticLiked ? 1 : -1));

          setErrorMessage(null);
          setOptimisticState({
            targetId,
            targetType,
            liked: optimisticLiked,
            likeCount: optimisticLikeCount,
          });

          startTransition(async () => {
            try {
              await ensureCsrfTokenReady();
              const send = () =>
                fetch("/api/engagement/like", {
                  method: "POST",
                  headers: withCsrfHeaders({ "Content-Type": "application/json" }),
                  // The state asked for, so a stale heart never undoes a like.
                  body: JSON.stringify({ targetId, targetType, liked: optimisticLiked }),
                });
              let response = await send();
              // A signed-out browser without its identifier yet: one check, then again.
              if (response.status === 428 && (await obtainViewerIdentifier()))
                response = await send();

              const payload = (await response.json().catch(() => null)) as {
                liked?: boolean;
                likeCount?: number;
                error?: string;
              } | null;

              if (!response.ok) {
                throw new Error(payload?.error || "Unable to update like right now.");
              }
              if (payload?.liked) {
                trackContactAction(CONTENT_TABLES[targetType], targetId, "save", "like");
              }
              const nowLiked = Boolean(payload?.liked);
              const serverCount = Math.max(0, Number(payload?.likeCount) || 0);
              // A waiting like is not in the server total yet: the shown
              // number keeps it, as it does after every remount and reload.
              const confirmedCount = nowLiked
                ? Math.max(serverCount, optimisticLiked ? optimisticLikeCount : 1)
                : serverCount;
              rememberLiked(targetId, nowLiked, confirmedCount);

              setOptimisticState({
                targetId,
                targetType,
                liked: nowLiked,
                likeCount: confirmedCount,
              });
            } catch (error) {
              setOptimisticState({
                targetId,
                targetType,
                liked: previousLiked,
                likeCount: previousLikeCount,
              });
              setErrorMessage(
                error instanceof Error ? error.message : "Unable to update like right now."
              );
            }
          });
        }}
        className={cn(
          variant === "rail"
            ? "group flex flex-col items-center gap-1.5 text-[color:var(--viewer-foreground,white)] focus-visible:outline-none disabled:cursor-wait"
            : "group inline-flex h-8 min-w-[52px] items-center justify-center rounded-full border border-white/80 bg-white/95 px-2.5 text-slate-700 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.55)] backdrop-blur transition-colors duration-200 hover:border-rose-200 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-80 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-200 dark:hover:border-rose-500/60 dark:hover:text-rose-300 dark:focus-visible:ring-rose-300"
        )}
      >
        {variant === "rail" ? (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-[var(--viewer-surface)] transition-colors duration-200 group-hover:bg-[var(--viewer-hover)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--viewer-accent,#f5cc70)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--viewer-background,#032820)]">
              <Heart
                className={cn("h-5 w-5", liked && "fill-current text-rose-400")}
                aria-hidden="true"
              />
            </span>
            <span
              className="text-xs font-semibold tabular-nums text-[color:var(--viewer-muted,white)]"
              aria-hidden="true"
            >
              {formatCompactCount(likeCount ?? 0)}
            </span>
            <span className="viewer-action-label" aria-hidden="true">
              Like
            </span>
          </>
        ) : (
          <>
            <Heart
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110",
                liked && "fill-current text-rose-500"
              )}
            />
            <span className="ml-1 text-[11px] font-semibold tabular-nums">
              {displayedLikeCount}
            </span>
          </>
        )}
      </button>
      {errorMessage ? <span className="sr-only">{errorMessage}</span> : null}
    </div>
  );
}
