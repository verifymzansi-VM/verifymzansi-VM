"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Eye, MapPin, Share2 } from "lucide-react";
import { ContentLikeButton } from "@/components/listings/content-like-button";
import { CONTENT_SHARED_EVENT } from "@/lib/analytics/commercial-events";
import type { FeedSlide } from "@/lib/feed/types";
import { formatCompactCount } from "@/lib/utils/format";

const CIRCLE =
  "flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-brand-green-900 text-white transition-colors duration-200";

/**
 * Beside the stage: only what is not shown anywhere else. Contact and the
 * owner live in the contact card; the rail keeps like, share, the owner's map
 * link (only when they added one) and views.
 */
export function ImmersiveActionRail({
  slide,
  views,
  active,
}: {
  slide: FeedSlide;
  views: number;
  active: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  async function share() {
    // Always the canonical address: a shared link never carries this browsing session.
    const url = `${window.location.origin}${slide.href}`;
    let shared = false;
    if (navigator.share) {
      try {
        await navigator.share({ title: slide.shareTitle, url });
        shared = true;
      } catch {
        // Cancelled or unsupported: fall back to copying.
      }
    }
    if (!shared) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      } catch {
        return;
      }
    }
    window.dispatchEvent(new CustomEvent(CONTENT_SHARED_EVENT));
  }

  return (
    <div className="flex flex-col items-center gap-5 pb-1" role="group" aria-label="Post actions">
      <ContentLikeButton
        key={slide.key}
        variant="rail"
        targetId={slide.id}
        targetType={slide.targetType}
        initialLikeCount={slide.engagement.likes}
        initialLiked={slide.engagement.viewerHasLiked}
      />

      <button
        type="button"
        onClick={share}
        className="group rounded-full focus-visible:outline-none"
        aria-label={copied ? "Link copied" : "Share this post"}
        title={copied ? "Link copied" : "Share"}
        tabIndex={active ? 0 : -1}
      >
        <span
          className={`${CIRCLE} group-hover:bg-brand-green-800 group-focus-visible:ring-2 group-focus-visible:ring-brand-gold-300 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-brand-green-950`}
        >
          {copied ? (
            <Check className="h-5 w-5 text-brand-green-300" aria-hidden="true" />
          ) : (
            <Share2 className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
      </button>

      {slide.mapUrl ? (
        <a
          href={slide.mapUrl}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="group rounded-full focus-visible:outline-none"
          aria-label={`Open ${slide.title} in maps`}
          title="Open in maps"
          tabIndex={active ? 0 : -1}
        >
          <span
            className={`${CIRCLE} group-hover:bg-brand-green-800 group-focus-visible:ring-2 group-focus-visible:ring-brand-gold-300 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-brand-green-950`}
          >
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </span>
        </a>
      ) : null}

      {/* Same circle and count layout as Like, but not a button: views only count. */}
      <div
        className="flex flex-col items-center gap-1.5"
        title={`${views.toLocaleString("en-ZA")} ${views === 1 ? "view" : "views"}`}
      >
        <span className={`${CIRCLE} bg-transparent text-white/80`} aria-hidden="true">
          <Eye className="h-5 w-5" />
        </span>
        <span className="text-xs font-semibold tabular-nums text-white/80" aria-hidden="true">
          {formatCompactCount(views)}
        </span>
        <span className="sr-only">
          {views} {views === 1 ? "view" : "views"}
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </div>
  );
}
