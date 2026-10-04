"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { defaultBrowse, parseBrowse } from "@/lib/feed/browse";
import type { FeedSlide } from "@/lib/feed/types";

const VideoModeViewer = dynamic(
  () =>
    import("@/components/video-mode/video-mode-viewer").then(({ VideoModeViewer }) => {
      function Preview({ slides }: { slides: FeedSlide[] }) {
        // Reloading keeps the section in the address, as the real route does.
        const [browse] = useState(
          () => parseBrowse(new URLSearchParams(window.location.search)) ?? defaultBrowse("market")
        );
        return <VideoModeViewer initialBrowse={browse} fixtures={slides} />;
      }
      return Preview;
    }),
  { ssr: false }
);

export function VideoModePreview({ slides }: { slides: FeedSlide[] }) {
  return <VideoModeViewer slides={slides} />;
}
