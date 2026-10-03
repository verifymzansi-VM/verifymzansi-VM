"use client";

import { useState, useTransition } from "react";
import { trackContactAction } from "@/lib/analytics/commercial-events";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompactCount } from "@/lib/utils/format";
import type { ContentTargetType } from "@/lib/engagement";

/** Likes double as "saves" in commercial reports. */
const CONTENT_TABLES = {
  listing: "listings",
  business: "businesses",
  promotion: "promotions",
} as const;

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

  const currentState =
    optimisticState &&
    optimisticState.targetId === targetId &&
    optimisticState.targetType === targetType
      ? optimisticState
      : null;
  const liked = currentState?.liked ?? initialLiked;
  const likeCount = currentState?.likeCount ?? initialLikeCount ?? 0;

  const displayedLikeCount = Math.min(999, Math.max(0, likeCount ?? 0));
  // The rail shows the full count (compact); cards keep their capped pill.
  const spokenCount = variant === "rail" ? Math.max(0, likeCount ?? 0) : displayedLikeCount;
  const noun = variant === "rail" ? "post" : "card";
  const ariaLabel = liked
    ? `Unlike this ${noun}. ${spokenCount} like${spokenCount === 1 ? "" : "s"}`
    : `Like this ${noun}. ${spokenCount} like${spokenCount === 1 ? "" : "s"}`;

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
              const response = await fetch("/api/engagement/like", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  targetId,
                  targetType,
                }),
              });

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

              setOptimisticState({
                targetId,
                targetType,
                liked: Boolean(payload?.liked),
                likeCount: Number(payload?.likeCount) || 0,
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
