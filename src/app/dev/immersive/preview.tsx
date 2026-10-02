"use client";

import { ImmersiveViewer } from "@/components/immersive/immersive-viewer";
import type { FeedSlide } from "@/lib/feed/types";

export function ImmersivePreview({ slides }: { slides: FeedSlide[] }) {
  return <ImmersiveViewer initialSlide={slides[0]} fixtures={slides} />;
}
