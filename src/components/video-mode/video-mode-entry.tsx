"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { VIDEO_MODE_DESKTOP_QUERY, VIDEO_MODE_FROM_KEY } from "@/lib/feed/video-mode-keys";
import { cn } from "@/lib/utils";

const ENABLED_KEY = "vm:video:enabled";
const ENABLED_TTL_MS = 10 * 60 * 1000;

/** Pages where the tablet header entry belongs: home and the three marketplace lists. */
const ENTRY_PATHS = new Set([
  "/",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/promotions",
  "/promotions/events",
]);

function cachedEnabled(): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(ENABLED_KEY);
    if (!raw) return null;
    const { enabled, at } = JSON.parse(raw) as { enabled?: unknown; at?: unknown };
    return typeof enabled === "boolean" &&
      typeof at === "number" &&
      Date.now() - at < ENABLED_TTL_MS
      ? enabled
      : null;
  } catch {
    return null;
  }
}

/** One question per page load, however many places ask (header, tab bar). */
let pending: Promise<boolean> | null = null;

function askEnabled(): Promise<boolean> {
  const cached = cachedEnabled();
  if (cached !== null) return Promise.resolve(cached);
  pending ??= fetch("/api/feed/video-mode", { cache: "no-store", credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : { enabled: false }))
    .then((payload: { enabled?: unknown }) => {
      const value = payload.enabled === true;
      try {
        window.sessionStorage.setItem(
          ENABLED_KEY,
          JSON.stringify({ enabled: value, at: Date.now() })
        );
      } catch {
        // Asked again on the next page.
      }
      return value;
    })
    .catch(() => false)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * Whether this visitor may use Video mode (the `video_mode` flag), on phones and
 * tablets only. The header and tab bar are shared by cached pages, so it is
 * asked once per tab session; it stays false until the answer is yes.
 */
export function useVideoModeEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia(VIDEO_MODE_DESKTOP_QUERY);
    let cancelled = false;
    // Asked when the screen is (or becomes, e.g. a rotated tablet) phone or tablet sized.
    const check = () => {
      if (desktop.matches) return;
      void askEnabled().then((value) => {
        if (!cancelled) setEnabled(value);
      });
    };
    check();
    desktop.addEventListener("change", check);
    return () => {
      cancelled = true;
      desktop.removeEventListener("change", check);
    };
  }, []);
  return enabled;
}

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
  const enabled = useVideoModeEnabled();
  const open = useOpenVideoMode();
  if (!enabled || !ENTRY_PATHS.has(pathname)) return null;
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
