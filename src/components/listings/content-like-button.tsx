"use client";

import { useEffect, useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentTargetType } from "@/lib/engagement";

interface ContentLikeButtonProps {
  targetId: string;
  targetType: ContentTargetType;
  initialLikeCount?: number | null;
  initialLiked?: boolean;
  className?: string;
}

export function ContentLikeButton({
  targetId,
  targetType,
  initialLikeCount = 0,
  initialLiked = false,
  className,
}: ContentLikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount ?? 0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLiked(initialLiked);
  }, [initialLiked]);

  useEffect(() => {
    setLikeCount(initialLikeCount ?? 0);
  }, [initialLikeCount]);

  const displayedLikeCount = Math.min(999, Math.max(0, likeCount ?? 0));
  const ariaLabel = liked
    ? `Unlike this card. ${displayedLikeCount} like${displayedLikeCount === 1 ? "" : "s"}`
    : `Like this card. ${displayedLikeCount} like${displayedLikeCount === 1 ? "" : "s"}`;

  return (
    <div className={cn("relative z-20", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={liked}
        disabled={isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          const previousLiked = liked;
          const previousLikeCount = likeCount ?? 0;
          const optimisticLiked = !previousLiked;
          const optimisticLikeCount = Math.max(0, previousLikeCount + (optimisticLiked ? 1 : -1));

          setErrorMessage(null);
          setLiked(optimisticLiked);
          setLikeCount(optimisticLikeCount);

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

              setLiked(Boolean(payload?.liked));
              setLikeCount(Number(payload?.likeCount) || 0);
            } catch (error) {
              setLiked(previousLiked);
              setLikeCount(previousLikeCount);
              setErrorMessage(
                error instanceof Error ? error.message : "Unable to update like right now."
              );
            }
          });
        }}
        className={cn(
          "group inline-flex h-8 min-w-[52px] items-center justify-center rounded-full border border-white/80 bg-white/95 px-2.5 text-slate-700 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.55)] backdrop-blur transition-colors duration-200 hover:border-rose-200 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-80 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-200 dark:hover:border-rose-500/60 dark:hover:text-rose-300 dark:focus-visible:ring-rose-300"
        )}
      >
        <Heart
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110",
            liked && "fill-current text-rose-500"
          )}
        />
        <span className="ml-1 text-[11px] font-semibold tabular-nums">{displayedLikeCount}</span>
      </button>
      {errorMessage ? <span className="sr-only">{errorMessage}</span> : null}
    </div>
  );
}
