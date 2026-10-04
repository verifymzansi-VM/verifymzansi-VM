"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { defaultBrowse, type FeedBrowse } from "@/lib/feed/browse";
import { listHrefForBrowse, readRememberedVertical } from "@/lib/feed/video-mode";
import { VIDEO_MODE_DESKTOP_QUERY } from "@/lib/feed/video-mode-keys";

function BrandLoading() {
  return (
    <div
      className="fixed inset-0 z-50 bg-brand-green-950"
      role="status"
      aria-label="Loading Video mode"
    >
      <div className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.09] invert" />
    </div>
  );
}

// Browser only: the viewer reads the address, storage and the screen before its first render.
const VideoModeViewer = dynamic(
  () =>
    import("@/components/video-mode/video-mode-viewer").then((module) => module.VideoModeViewer),
  { ssr: false, loading: BrandLoading }
);

function Viewer({ browse }: { browse: FeedBrowse | null }) {
  const router = useRouter();
  // Without a section in the address, open the one used last (Market at first).
  const [initial] = useState(() => browse ?? defaultBrowse(readRememberedVertical()));
  // Desktops keep the lists and the desktop post viewer: go there before loading anything.
  const [desktop] = useState(() => window.matchMedia(VIDEO_MODE_DESKTOP_QUERY).matches);
  useEffect(() => {
    if (desktop) router.replace(listHrefForBrowse(initial));
  }, [desktop, initial, router]);
  return desktop ? <BrandLoading /> : <VideoModeViewer initialBrowse={initial} />;
}

const ClientViewer = dynamic(() => Promise.resolve(Viewer), { ssr: false, loading: BrandLoading });

export function VideoModeLoader({ browse }: { browse: FeedBrowse | null }) {
  return <ClientViewer browse={browse} />;
}
