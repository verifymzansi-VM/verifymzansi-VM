"use client";

import { Check, Eye, MapPin, Share2 } from "lucide-react";
import { ContentLikeButton } from "@/components/listings/content-like-button";
import { useSharePost } from "@/components/immersive/use-share-post";
import { ContentEnquiryAction } from "@/components/listings/content-enquiry-action";
import { feedContactConfig } from "@/components/listings/contact-action-configs";
import type { FeedSlide } from "@/lib/feed/types";
import { formatCompactCount } from "@/lib/utils/format";

const CIRCLE =
  "flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-[var(--viewer-surface)] text-[color:var(--viewer-foreground)] transition-colors duration-200";

/**
 * Beside the stage: only what is not shown anywhere else. Contact and the
 * owner live in the contact card; the rail keeps views, like, enquire, share and
 * the owner's map link (only when they added one).
 */
export function ImmersiveActionRail({
  slide,
  views,
  active,
  analytics = true,
}: {
  slide: FeedSlide;
  views: number;
  active: boolean;
  analytics?: boolean;
}) {
  const { share, copied, shareCount, sharing, shareError } = useSharePost(slide, analytics);

  return (
    <div
      className="viewer-actions flex flex-col items-center gap-4 pb-1"
      role="group"
      aria-label="Post actions"
    >
      {/* First, in the same circle as the others; not a button: views only count. */}
      <div className="viewer-rail-action flex flex-col items-center gap-1.5">
        <span className={CIRCLE} aria-hidden="true">
          <Eye className="h-5 w-5" />
        </span>
        <span
          className="text-xs font-semibold tabular-nums text-[color:var(--viewer-muted)]"
          aria-hidden="true"
        >
          {formatCompactCount(views)}
        </span>
        <span className="viewer-action-label" aria-hidden="true">
          Views
        </span>
        <span className="sr-only">
          {views} {views === 1 ? "view" : "views"}
        </span>
      </div>
      <ContentLikeButton
        key={slide.key}
        variant="rail"
        className="viewer-rail-action"
        targetId={slide.id}
        targetType={slide.targetType}
        initialLikeCount={slide.engagement.likes}
        initialLiked={slide.engagement.viewerHasLiked}
      />

      {slide.contact.showMessageButton ? (
        <ContentEnquiryAction config={feedContactConfig(slide)} rail />
      ) : null}

      <button
        type="button"
        disabled={sharing}
        onClick={share}
        className="viewer-rail-action group flex flex-col items-center gap-1.5 rounded-full focus-visible:outline-none"
        aria-label={copied ? "Link copied" : "Share this post"}
        tabIndex={active ? 0 : -1}
      >
        <span
          className={`${CIRCLE} group-hover:bg-[var(--viewer-hover)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--viewer-accent)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--viewer-background)]`}
        >
          {copied ? (
            <Check className="h-5 w-5 text-[color:var(--viewer-positive)]" aria-hidden="true" />
          ) : (
            <Share2 className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <span
          className="text-xs font-semibold tabular-nums text-[color:var(--viewer-muted)]"
          aria-hidden="true"
        >
          {shareCount === null ? "—" : formatCompactCount(shareCount)}
        </span>
        <span className="sr-only">
          {shareCount === null ? "Share total unavailable" : `${shareCount} recorded shares`}
        </span>
        <span className="viewer-action-label" aria-hidden="true">
          Share
        </span>
      </button>

      {slide.mapUrl ? (
        <a
          href={slide.mapUrl}
          data-contact-action="directions_click"
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="viewer-rail-action group flex flex-col items-center gap-1.5 rounded-full focus-visible:outline-none"
          aria-label={`Open ${slide.title} in maps`}
          tabIndex={active ? 0 : -1}
        >
          <span
            className={`${CIRCLE} group-hover:bg-[var(--viewer-hover)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--viewer-accent)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--viewer-background)]`}
          >
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="viewer-action-label" aria-hidden="true">
            Directions
          </span>
        </a>
      ) : null}

      <span
        className={
          shareError
            ? "pointer-events-none absolute bottom-2 right-2 z-20 max-w-xs rounded-xl border border-[color:var(--viewer-border)] bg-[var(--viewer-surface)] px-4 py-3 text-sm text-[color:var(--viewer-muted)] shadow-lg"
            : "sr-only"
        }
        aria-live="polite"
      >
        {shareError ?? (copied ? "Link copied" : "")}
      </span>
    </div>
  );
}
