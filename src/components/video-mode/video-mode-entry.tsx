"use client";

import type { MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { VIDEO_MODE_FROM_KEY } from "@/lib/feed/video-mode-keys";
import { cn } from "@/lib/utils";

/** Pages where the tablet header entry belongs: home and the three marketplace lists. */
const ENTRY_PATHS = new Set([
  "/",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/promotions",
  "/promotions/events",
]);

/**
 * Open Video mode from the page the visitor is on, keeping a list's filters.
 * Use as a link's click handler; modified clicks open the plain link.
 */
export function useOpenVideoMode() {
  const router = useRouter();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const { pathname: from, search } = window.location;
    try {
      window.sessionStorage.setItem(VIDEO_MODE_FROM_KEY, `${from}${search}`.slice(0, 600));
    } catch {
      // Close falls back to the matching list.
    }
    // The filter mapping (and its option lists) loads only when someone taps.
    void import("@/lib/feed/video-mode")
      .then(({ browseFromListUrl, videoModeHref }) =>
        router.push(videoModeHref(browseFromListUrl(from, new URLSearchParams(search))))
      )
      .catch(() => router.push("/video-mode"));
  };
}

/**
 * Tablets: "Video" beside the marketplace tabs. Phones get it in the bottom
 * tab bar instead, so this hides below the tab bar's breakpoint.
 */
export function VideoModeEntry({ className }: { className?: string }) {
  const pathname = usePathname();
  const open = useOpenVideoMode();
  if (!ENTRY_PATHS.has(pathname)) return null;
  return (
    <a
      href="/video-mode"
      onClick={open}
      aria-label="Video mode"
      className={cn(
        "hidden h-11 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-green-950 text-[10px] font-semibold leading-none text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 md:inline-flex",
        className
      )}
    >
      <Clapperboard className="h-4 w-4 text-brand-gold-300" aria-hidden="true" />
      <span aria-hidden="true">Video</span>
    </a>
  );
}
