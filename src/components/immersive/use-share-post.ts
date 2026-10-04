"use client";

import { useEffect, useRef, useState } from "react";
import { shareContent } from "@/lib/sharing/share-content";
import type { FeedSlide } from "@/lib/feed/types";

/** Share a post (native sheet, else copy the link) and keep its public share total. */
export function useSharePost(slide: FeedSlide, analytics: boolean) {
  const [copied, setCopied] = useState(false);
  const [shareCount, setShareCount] = useState<number | null>(slide.engagement.shares ?? null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  async function share() {
    if (sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const result = await shareContent({
        title: slide.shareTitle,
        path: slide.href,
        targetId: slide.id,
        targetType: slide.targetType,
        recordMetrics: analytics,
      });
      if (!result) return;
      if (result.method === "copy") {
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      }
      if (result.shareCount !== undefined) setShareCount(result.shareCount);
    } catch {
      setShareError("Could not share the page. Please copy the address from your browser.");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShareError(null), 6000);
    } finally {
      setSharing(false);
    }
  }

  return { share, copied, shareCount, sharing, shareError };
}
