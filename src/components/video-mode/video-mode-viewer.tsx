"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, MoreHorizontal, RotateCcw, X } from "lucide-react";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import { FilterSheet } from "@/components/immersive/immersive-top-bar";
import { BrandShield } from "@/components/shared/brand-shield";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { VideoSoundButton } from "@/components/ui/video-sound-button";
import {
  ActionRail,
  CircleButton,
  DetailsRow,
  FilterButton,
  MoreSheet,
  PostSummary,
  SECTION_ICONS,
  SectionRail,
  VM_CIRCLE,
  VM_GLYPH,
} from "@/components/video-mode/video-mode-rails";
import { useAutoHide } from "@/components/video-mode/use-auto-hide";
import { captionTop } from "@/components/video-mode/letterbox";
import { useConstrainedNetwork, VideoModeMedia } from "@/components/video-mode/video-mode-media";
import { VideoModeSeek } from "@/components/video-mode/video-mode-seek";
import { useVideoModeFeed, type VideoModePost } from "@/components/video-mode/use-video-mode-feed";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useDwellView } from "@/components/immersive/use-dwell-view";
import {
  activeFilterCount,
  defaultBrowse,
  describeBrowse,
  VERTICAL_LABELS,
  type FeedBrowse,
  type TourismKind,
} from "@/lib/feed/browse";
import type { FeedSlide, FeedVertical } from "@/lib/feed/types";
import {
  listHrefForBrowse,
  positionSearch,
  readPosition,
  rememberVertical,
} from "@/lib/feed/video-mode";
import { VIDEO_MODE_FROM_KEY } from "@/lib/feed/video-mode-keys";
import { AREA_ORDER, nextArea, rolloverBrowse, rolloverCue } from "@/lib/feed/rollover";
import { useVideoMuteStore } from "@/stores/video-mute-store";
import { cn } from "@/lib/utils";

/** Movement before a gesture picks an axis, and the edge strip left to the system's back gesture. */
const AXIS_LOCK_PX = 10;
const EDGE_GUARD_PX = 20;
const SWIPE_MEDIA_PX = 50;
const FLICK_VELOCITY = 0.45;
const TAP_GUARD_MS = 350;
const SLIDE_MS = 380;
const SEEK_ACTIVITY_MS = 1000;
/** How long the new area's name shows after a roll-over. */
const CUE_MS = 1500;
const noop = () => {};
/** First visit only: show how to move on, until the first swipe. */
const HINT_KEY = "vm:video:swipe-hint";
const HINT_MS = 5000;

const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/** How many dialogs and sheets are open (ours, the enquiry form, the report form). */
function useOpenLayers() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(document.querySelectorAll(OPEN_LAYER).length);
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  return count;
}

/**
 * Android Back (and browser Back) closes the top sheet before it leaves Video
 * mode: each newly opened layer adds a history entry that Back consumes.
 */
function useBackClosesLayers(layers: number) {
  const pushed = useRef(0);
  const ignorePops = useRef(0);
  // Bumped whenever history settles on the base entry, so the address can be rewritten there.
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    function onPop() {
      if (ignorePops.current > 0) {
        ignorePops.current -= 1;
        setSettled((value) => value + 1);
        return;
      }
      if (pushed.current === 0) return;
      pushed.current -= 1;
      // Radix closes its top layer on Escape.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    while (pushed.current < layers) {
      window.history.pushState({ ...window.history.state, vmLayer: true }, "");
      pushed.current += 1;
    }
    // Closed with a button or by tapping outside: drop the entries Back no longer needs.
    if (pushed.current > layers) {
      const extra = pushed.current - layers;
      pushed.current = layers;
      ignorePops.current += 1;
      window.history.go(-extra);
    }
  }, [layers]);
  return settled;
}

function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", update);
    };
  }, []);
  return visible;
}

/* ─────────────────────────── Small surfaces ─────────────────────────── */

function PatternSurface({ children }: { children?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-brand-green-950 px-6">
      <div
        className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.09] invert"
        aria-hidden="true"
      />
      <div className="relative w-full">{children}</div>
    </div>
  );
}

function LoadingPost({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <PatternSurface>
      {failed ? (
        <div className="flex flex-col items-center gap-4 px-4 text-center">
          <p className="text-sm text-white/80">This post could not be loaded.</p>
          <button
            type="button"
            onClick={onRetry}
            data-vm-control
            className="flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-brand-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : (
        <span
          className="block h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-brand-gold-300"
          role="status"
          aria-label="Loading post"
        />
      )}
    </PatternSurface>
  );
}

/**
 * A section with nothing yet (the end of a section rolls on into the next
 * one). It offers the next best step: widen the province, clear filters, then
 * another section.
 */
function EndCard({
  browse,
  empty,
  busy,
  onBrowse,
}: {
  browse: FeedBrowse;
  empty: boolean;
  busy: boolean;
  onBrowse: (browse: FeedBrowse) => void;
}) {
  const cleared = defaultBrowse(browse.vertical, browse.province);
  const filtered = describeBrowse(browse) !== describeBrowse(cleared);
  const others = AREA_ORDER.filter((vertical) => vertical !== browse.vertical);
  return (
    <PatternSurface>
      <div
        className="mx-auto flex max-w-sm flex-col items-center gap-5 px-2 text-center"
        role="status"
      >
        <BrandShield className="h-12 w-12 text-brand-gold-300" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-white">
            {empty ? "Nothing here yet" : "You’re all caught up"}
          </h2>
          <p className="text-sm text-white/75">
            {empty
              ? `No posts match ${describeBrowse(browse)} yet.`
              : `You have seen every post in ${describeBrowse(browse)}.`}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2" data-vm-control>
          {browse.province ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onBrowse({ ...browse, province: null })}
              className="h-11 rounded-full bg-brand-gold-300 px-5 text-sm font-semibold text-brand-gold-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
            >
              See all of South Africa
            </button>
          ) : null}
          {filtered ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onBrowse(cleared)}
              className="h-11 rounded-full border border-white/40 px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:opacity-60"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="flex gap-2" data-vm-control>
          {others.map((vertical) => {
            const Icon = SECTION_ICONS[vertical];
            return (
              <button
                key={vertical}
                type="button"
                disabled={busy}
                onClick={() => onBrowse(defaultBrowse(vertical, browse.province))}
                className="flex w-[104px] flex-col items-center gap-1.5 rounded-2xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:opacity-60"
              >
                <span className={VM_CIRCLE}>
                  <Icon className={VM_GLYPH} aria-hidden="true" />
                </span>
                <span className="text-xs font-semibold text-white">
                  {VERTICAL_LABELS[vertical]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </PatternSurface>
  );
}

function TourismSheet({
  open,
  onOpenChange,
  kind,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: TourismKind;
  onChoose: (kind: TourismKind) => void;
}) {
  const options: [TourismKind, string][] = [
    ["all", "Everything"],
    ["stays", "Stays and places"],
    ["events", "Events"],
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5"
      >
        <SheetHeader className="px-2 pb-2 text-left">
          <SheetTitle>Tourism &amp; Events</SheetTitle>
          <SheetDescription>Choose what to show.</SheetDescription>
        </SheetHeader>
        <div className="space-y-1" role="radiogroup" aria-label="Show">
          {options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => onChoose(value)}
              className={cn(
                "flex min-h-12 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                kind === value ? "bg-muted" : "hover:bg-muted"
              )}
            >
              {label}
              {kind === value ? (
                <span className="h-2.5 w-2.5 rounded-full bg-brand-green-600" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─────────────────────────── Viewer ─────────────────────────── */

type Gesture = {
  id: number;
  x: number;
  y: number;
  t: number;
  axis: "x" | "y" | null;
  fromEdge: boolean;
  dx: number;
  dy: number;
};

export function VideoModeViewer({
  initialBrowse,
  fixtures,
}: {
  initialBrowse: FeedBrowse;
  /** Development demo at /dev/video-mode: fixed posts, no analytics, no storage. */
  fixtures?: FeedSlide[];
}) {
  const preview = Boolean(fixtures);
  const analytics = !preview;
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const constrained = useConstrainedNetwork();
  const visible = usePageVisible();
  const layers = useOpenLayers();
  const historySettled = useBackClosesLayers(layers);

  const [initialPosition] = useState(() =>
    readPosition(new URLSearchParams(window.location.search))
  );
  const [active, setActive] = useState<{ id: string | null; index: number }>({
    id: initialPosition.post,
    index: 0,
  });
  const [mediaByPost, setMediaByPost] = useState<Record<string, number>>(() =>
    initialPosition.post ? { [initialPosition.post]: initialPosition.media } : {}
  );
  const [onEnd, setOnEnd] = useState(false);
  // One sound choice for every player on the site.
  const muted = useVideoMuteStore((state) => state.isMuted);
  const setMuted = useVideoMuteStore((state) => state.setMuted);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tourismOpen, setTourismOpen] = useState(false);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});

  const feed = useVideoModeFeed({
    initialBrowse,
    ctx: initialPosition.ctx,
    activeId: active.id,
    fixtures,
  });
  const posts = feed.posts;
  const found = active.id ? posts.findIndex((post) => post.id === active.id) : -1;
  // A post that drops out is replaced by the one after it, never by the first post.
  const activeIndex = found >= 0 ? found : Math.min(active.index, Math.max(0, posts.length - 1));
  const activePost: VideoModePost | undefined = posts[activeIndex];
  const activeSlide = activePost?.slide;
  const ended = feed.status === "ready" && (onEnd || posts.length === 0);
  const mediaIndex = activePost ? (mediaByPost[activePost.id] ?? 0) : 0;
  const held = layers > 0 || !visible;

  /* ── Clean view: after 4 s of playback the left column, Details and the top bar fade;
     the right column, the title and price and the progress line stay; a tap brings
     them back ── */
  const [videoPlaying, setVideoPlaying] = useState(false);
  const autoHide = useAutoHide(Boolean(activeSlide) && !ended && !held && videoPlaying);
  const cleanView = autoHide.hidden;
  const noteActivity = autoHide.noteActivity;
  // Dragging the seek bar is activity too, so the controls never step aside mid-drag.
  // Counted at most once a second: a drag sends a move for every frame.
  const lastSeekMoveAt = useRef(0);
  const noteSeekMove = (event: React.SyntheticEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-video-seek]")) return;
    const now = performance.now();
    if (now - lastSeekMoveAt.current < SEEK_ACTIVITY_MS) return;
    lastSeekMoveAt.current = now;
    noteActivity();
  };

  /* ── The address bar keeps the section, filters and position (refresh, rotate, Back) ── */
  useEffect(() => {
    // Never write over a sheet's history entry; the base entry is rewritten once Back settles.
    if (feed.status !== "ready" || layers > 0) return;
    const timer = window.setTimeout(() => {
      if ((window.history.state as { vmLayer?: boolean } | null)?.vmLayer) return;
      const search = positionSearch(feed.browse, {
        ctx: feed.sessionId,
        post: ended ? null : (activePost?.id ?? null),
        media: ended ? 0 : mediaIndex,
      });
      const next = `${window.location.pathname}?${search}`;
      if (`${window.location.pathname}${window.location.search}` !== next) {
        window.history.replaceState(window.history.state, "", next);
      }
      document.title =
        activeSlide && !ended
          ? `${activeSlide.title} | Video mode | VerifyMzansi`
          : `${VERTICAL_LABELS[feed.browse.vertical]} | Video mode | VerifyMzansi`;
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    activePost?.id,
    activeSlide,
    ended,
    feed.browse,
    feed.sessionId,
    feed.status,
    mediaIndex,
    layers,
    historySettled,
  ]);

  /* ── Page view after two continuous seconds on screen; gallery swipes never count again ── */
  useDwellView(
    activeSlide,
    activeSlide && !ended && analytics ? `video:${activeSlide.vertical}` : null,
    (slide) => setViewCounts((counts) => ({ ...counts, [slide.key]: (counts[slide.key] ?? 0) + 1 }))
  );

  /* ── First-visit hint: swipe up for the next post ── */
  const [hint, setHint] = useState(() => {
    try {
      return !window.localStorage.getItem(HINT_KEY);
    } catch {
      return false;
    }
  });
  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Shown again next visit; harmless.
    }
  }, []);
  const showHint = hint && !ended && !cleanView && Boolean(activeSlide) && posts.length > 1;
  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(dismissHint, HINT_MS);
    return () => window.clearTimeout(timer);
  }, [showHint, dismissHint]);

  /* ── Roll-over: past an area's last post the next area carries on (and back) ── */
  const [busy, setBusy] = useState<FeedVertical | "filters" | null>(null);
  const [browseError, setBrowseError] = useState(false);
  const [cue, setCue] = useState<{ vertical: FeedVertical; text: string; key: number } | null>(
    null
  );
  // Each area's filters from earlier in this visit come back when the visitor returns to it.
  const areaMemory = useRef<Partial<Record<FeedVertical, FeedBrowse>>>({});
  const { show: showControls } = autoHide;
  const rollOver = useCallback(
    async (direction: 1 | -1) => {
      if (busy) return;
      const from = feed.browse;
      areaMemory.current[from.vertical] = from;
      let target = from.vertical;
      // The other two areas, then this one again from the top: a loop that never ends.
      for (let step = 0; step < AREA_ORDER.length; step += 1) {
        target = nextArea(target, direction);
        const next = rolloverBrowse(from, target, areaMemory.current[target]);
        setBusy(target);
        setBrowseError(false);
        const ids = await feed.browseTo(next, { skipEmpty: true });
        setBusy(null);
        if (!ids) {
          setBrowseError(true);
          return;
        }
        if (ids.length === 0) continue;
        if (!preview) rememberVertical(next.vertical);
        setOnEnd(false);
        setActive(
          direction === 1
            ? { id: ids[0], index: 0 }
            : { id: ids[ids.length - 1], index: ids.length - 1 }
        );
        if (next.vertical !== from.vertical) {
          setCue({ vertical: next.vertical, text: rolloverCue(next), key: Date.now() });
        }
        showControls();
        return;
      }
    },
    [busy, feed, preview, showControls]
  );
  useEffect(() => {
    if (!cue) return;
    const timer = window.setTimeout(() => setCue(null), CUE_MS);
    return () => window.clearTimeout(timer);
  }, [cue]);

  /* ── Moving between posts and media ── */
  const go = useCallback(
    (direction: 1 | -1) => {
      if (direction === 1) {
        if (ended) return;
        if (hint) dismissHint();
        if (activeIndex < posts.length - 1) {
          setActive({ id: posts[activeIndex + 1].id, index: activeIndex + 1 });
          showControls();
        } else if (feed.terminal) {
          void rollOver(1);
        }
        return;
      }
      if (onEnd) {
        setOnEnd(false);
        return;
      }
      if (activeIndex > 0) {
        setActive({ id: posts[activeIndex - 1].id, index: activeIndex - 1 });
        showControls();
      } else if (posts.length > 0 && feed.status === "ready") {
        void rollOver(-1);
      }
    },
    [
      activeIndex,
      dismissHint,
      ended,
      feed.status,
      feed.terminal,
      hint,
      onEnd,
      posts,
      rollOver,
      showControls,
    ]
  );

  const moveMedia = useCallback(
    (direction: 1 | -1) => {
      if (!activePost?.slide || ended) return;
      const count = activePost.slide.media.length;
      setMediaByPost((current) => {
        const index = current[activePost.id] ?? 0;
        const next = Math.min(count - 1, Math.max(0, index + direction));
        return next === index ? current : { ...current, [activePost.id]: next };
      });
    },
    [activePost, ended]
  );

  /* ── Sections, province and filters ── */
  const browse = useCallback(
    async (next: FeedBrowse, cause: FeedVertical | "filters") => {
      setBusy(cause);
      setBrowseError(false);
      const ids = await feed.browseTo(next);
      setBusy(null);
      if (!ids) {
        setBrowseError(true);
        return;
      }
      rememberVertical(next.vertical);
      setOnEnd(false);
      setActive({ id: null, index: 0 });
    },
    [feed]
  );

  useEffect(() => {
    if (!preview) rememberVertical(feed.browse.vertical);
  }, [feed.browse.vertical, preview]);

  function selectSection(vertical: FeedVertical) {
    if (vertical === feed.browse.vertical) {
      if (vertical === "tourism") setTourismOpen(true);
      return;
    }
    void browse(defaultBrowse(vertical, feed.browse.province), vertical);
  }

  /* ── Leaving ── */
  const close = useCallback(() => {
    let from: string | null = null;
    try {
      from = window.sessionStorage.getItem(VIDEO_MODE_FROM_KEY);
      window.sessionStorage.removeItem(VIDEO_MODE_FROM_KEY);
    } catch {
      from = null;
    }
    if (from && window.history.length > 1) router.back();
    else router.push(listHrefForBrowse(feed.browse));
  }, [feed.browse, router]);

  function toggleSound() {
    const next = !muted;
    // Set inside the tap itself: iOS only accepts sound that a gesture turned on.
    const video = document.querySelector<HTMLVideoElement>("video[data-vm-active-video]");
    if (video) {
      video.muted = next;
      if (!next && video.paused) void video.play().catch(() => undefined);
    }
    setMuted(next);
  }

  /* ── Keyboard (tablets with keyboards, accessibility) ── */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (document.querySelector(OPEN_LAYER)) return;
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // Any key shows the controls and starts the 4 s again.
      showControls();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        moveMedia(1);
      } else if (event.key === "ArrowLeft") {
        moveMedia(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go, moveMedia, showControls]);

  /* ── Touch: one gesture, one axis. Vertical changes post, horizontal changes media. ── */
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastGestureAt = useRef(0);
  // While the controls are hidden, a tap on the video brings them back instead of pausing.
  // A keyboard or screen reader press of "Pause video" always pauses.
  const { revealOnTap } = autoHide;
  /** True when a tap on the video is used up: a swipe just ended, or it showed the controls. */
  const ignoreTap = useCallback(
    (fromPointer: boolean) =>
      performance.now() - lastGestureAt.current < TAP_GUARD_MS || (fromPointer && revealOnTap()),
    [revealOnTap]
  );

  const setTrackOffset = (px: number, animate: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition =
      animate && !reducedMotion ? `transform ${SLIDE_MS}ms ease-out` : "none";
    track.style.transform = px ? `translate3d(0, ${px}px, 0)` : "";
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if ((event.target as Element).closest("[data-vm-control], a, input, select, textarea")) return;
    const width = stageRef.current?.clientWidth ?? window.innerWidth;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      axis: null,
      fromEdge: event.clientX < EDGE_GUARD_PX || event.clientX > width - EDGE_GUARD_PX,
      dx: 0,
      dy: 0,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = gesture.current;
    if (!state || state.id !== event.pointerId) return;
    state.dx = event.clientX - state.x;
    state.dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.max(Math.abs(state.dx), Math.abs(state.dy)) < AXIS_LOCK_PX) return;
      state.axis = Math.abs(state.dx) > Math.abs(state.dy) ? "x" : "y";
      // A sideways swipe from the very edge belongs to the phone's back gesture.
      if (state.axis === "x" && state.fromEdge) {
        gesture.current = null;
        return;
      }
      try {
        stageRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended.
      }
    }
    if (state.axis === "y") {
      // Resistance past the end card (the first and last posts roll over into the next area).
      const atEnd = ended && state.dy < 0;
      setTrackOffset(atEnd ? state.dy * 0.25 : state.dy, false);
    }
  };

  const finishGesture = (event: React.PointerEvent, cancelled: boolean) => {
    const state = gesture.current;
    gesture.current = null;
    if (!state || state.id !== event.pointerId) return;
    if (state.axis) lastGestureAt.current = performance.now();
    const elapsed = Math.max(1, performance.now() - state.t);
    const height = stageRef.current?.clientHeight ?? window.innerHeight;
    if (state.axis === "y") {
      const flick = Math.abs(state.dy) / elapsed > FLICK_VELOCITY && Math.abs(state.dy) > 30;
      if (!cancelled && (Math.abs(state.dy) > height * 0.18 || flick)) go(state.dy < 0 ? 1 : -1);
      setTrackOffset(0, true);
    } else if (state.axis === "x" && !cancelled && Math.abs(state.dx) > SWIPE_MEDIA_PX) {
      moveMedia(state.dx < 0 ? 1 : -1);
    }
  };

  /* ── Which items are on the stage: the post, its neighbours, and the end card ── */
  const position = ended ? posts.length : activeIndex;
  const rendered = useMemo(() => {
    const from = Math.max(0, position - 1);
    return posts.slice(from, position + 2).map((post, offset) => ({ post, index: from + offset }));
  }, [posts, position]);
  const showEnd =
    feed.status === "ready" &&
    Boolean(feed.terminal || posts.length === 0) &&
    position >= posts.length - 1;

  /* ── A video that leaves black space under it gets the title there ── */
  const [captionAt, setCaptionAt] = useState<number | null>(null);
  const activeVideoKey = activeSlide && !ended ? `${activeSlide.key}:${mediaIndex}` : null;
  useEffect(() => {
    const measure = () => {
      const video = document.querySelector<HTMLVideoElement>("video[data-vm-active-video]");
      setCaptionAt(
        video
          ? captionTop(
              window.innerWidth,
              window.innerHeight,
              video.videoWidth,
              video.videoHeight,
              // The top of Details (it counts the phone's bottom safe area).
              document.querySelector("[data-vm-details]")?.getBoundingClientRect().top ??
                window.innerHeight - 72
            )
          : null
      );
    };
    const onMeta = (event: Event) => {
      if (event.target instanceof Element && event.target.matches("video[data-vm-active-video]")) {
        measure();
      }
    };
    // After the new post's video element is on the page.
    const frame = window.requestAnimationFrame(measure);
    // Media events do not bubble; the capture phase still sees them.
    document.addEventListener("loadedmetadata", onMeta, true);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("loadedmetadata", onMeta, true);
      window.removeEventListener("resize", measure);
    };
  }, [activeVideoKey]);

  const browseValue = feed.browse;
  const filterCount = activeFilterCount(browseValue);
  const activeMedia = activeSlide?.media[Math.min(mediaIndex, activeSlide.media.length - 1)];
  const views = activeSlide ? activeSlide.engagement.views + (viewCounts[activeSlide.key] ?? 0) : 0;
  const announcement = ended
    ? posts.length === 0
      ? `No posts in ${describeBrowse(browseValue)} yet.`
      : "You have reached the end of this section."
    : cue
      ? `Now showing ${cue.text}`
      : activeSlide
        ? `Post ${activeIndex + 1} of ${posts.length}: ${activeSlide.title}`
        : "Loading post";

  return (
    <div
      data-viewer-theme="dark"
      data-chrome={cleanView ? "hidden" : "shown"}
      onPointerDownCapture={noteActivity}
      onPointerMoveCapture={noteSeekMove}
      onTouchMoveCapture={noteSeekMove}
      className="fixed inset-0 z-50 overflow-hidden bg-black text-white"
      role="region"
      aria-roledescription="video mode"
      aria-label={`${describeBrowse(browseValue)}, Video mode`}
    >
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      {activeSlide && analytics && !ended ? (
        // One tracker, for the post on screen; sheets are portalled, so it listens page-wide.
        <ContactActionTracker
          key={activeSlide.key}
          table={activeSlide.table}
          id={activeSlide.id}
          website={activeSlide.website}
          surface={`video:${activeSlide.vertical}`}
          recordDetailView={false}
        />
      ) : null}

      {/* ── Stage ── */}
      <div
        ref={stageRef}
        className="vm-stage absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishGesture(event, false)}
        onPointerCancel={(event) => finishGesture(event, true)}
      >
        <div ref={trackRef} className="vm-track absolute inset-0">
          {feed.status === "loading" ? <LoadingPost failed={false} onRetry={() => {}} /> : null}
          {feed.status === "error" ? (
            <PatternSurface>
              <div className="flex flex-col items-center gap-4 px-4 text-center" role="alert">
                <p className="text-sm text-white/80">
                  Posts could not load. Check your connection.
                </p>
                <button
                  type="button"
                  onClick={feed.retry}
                  data-vm-control
                  className="flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-brand-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </button>
              </div>
            </PatternSurface>
          ) : null}

          {rendered.map(({ post, index }) => {
            const offset = index - position;
            const isActive = !ended && index === activeIndex;
            return (
              <div
                key={post.id}
                className="absolute inset-0"
                style={{
                  transform: `translate3d(0, ${offset * 100}%, 0)`,
                  transition: reducedMotion ? "none" : `transform ${SLIDE_MS}ms ease-out`,
                }}
                inert={!isActive}
                aria-hidden={!isActive}
              >
                {post.slide ? (
                  <VideoModeMedia
                    slide={post.slide}
                    active={isActive}
                    mediaIndex={mediaByPost[post.id] ?? 0}
                    muted={muted}
                    held={held}
                    constrained={constrained}
                    analytics={analytics}
                    ignoreTap={ignoreTap}
                    onPlayingChange={isActive ? setVideoPlaying : noop}
                    onUserPause={showControls}
                    onSoundBlocked={() => setMuted(true)}
                    onVideoViewRecorded={() =>
                      setViewCounts((counts) => ({
                        ...counts,
                        [post.slide!.key]: (counts[post.slide!.key] ?? 0) + 1,
                      }))
                    }
                  />
                ) : (
                  <LoadingPost failed={post.failed} onRetry={() => feed.retrySlide(post.id)} />
                )}
              </div>
            );
          })}

          {showEnd ? (
            <div
              className="absolute inset-0"
              style={{
                transform: `translate3d(0, ${(posts.length - position) * 100}%, 0)`,
                transition: reducedMotion ? "none" : `transform ${SLIDE_MS}ms ease-out`,
              }}
              inert={!ended}
              aria-hidden={!ended}
            >
              <EndCard
                browse={browseValue}
                empty={posts.length === 0}
                busy={busy !== null}
                onBrowse={(next) =>
                  void browse(
                    next,
                    next.vertical !== browseValue.vertical ? next.vertical : "filters"
                  )
                }
              />
            </div>
          ) : null}
        </div>

        {/* Readability over bright media: soft shade top and bottom only. */}
        <div
          className="vm-chrome-fade pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent"
          aria-hidden="true"
        />
        {activeSlide && !ended ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/* ── Media position: one segment per photo or video ── */}
      {activeSlide && !ended && activeSlide.media.length > 1 ? (
        <div
          className="vm-chrome-fade pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+6px)] z-20 flex gap-1"
          aria-hidden="true"
        >
          {activeSlide.media.map((item, index) => (
            <span
              key={`${item.url}:${index}`}
              className={cn(
                "h-0.5 flex-1 rounded-full",
                index === mediaIndex ? "bg-white/80" : "bg-white/30"
              )}
            />
          ))}
        </div>
      ) : null}

      {showHint ? (
        <div
          className="vm-swipe-hint pointer-events-none absolute inset-x-0 top-[38%] z-20 flex justify-center"
          aria-hidden="true"
        >
          <span className="flex flex-col items-center gap-1 rounded-2xl bg-black/45 px-4 py-2.5 text-sm font-semibold text-white">
            <ChevronUp className="vm-swipe-hint-arrow h-6 w-6" />
            Swipe up for the next post
          </span>
        </div>
      ) : null}

      {/* ── Top bar: logo; More and Close on the right ── */}
      <div
        data-vm-control
        data-vm-chrome
        inert={cleanView}
        className="vm-chrome absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-1.5 pt-[calc(env(safe-area-inset-top)+12px)]"
      >
        <BrandShield
          className="ml-1 h-8 w-8 shrink-0 text-brand-gold-300 drop-shadow"
          aria-hidden="true"
        />
        <span className="sr-only">VerifyMzansi Video mode</span>
        <div className="ml-auto flex items-center gap-1">
          {activeSlide && !ended ? (
            <CircleButton label="More options" onClick={() => setMoreOpen(true)}>
              <MoreHorizontal className={VM_GLYPH} aria-hidden="true" />
            </CircleButton>
          ) : null}
          <CircleButton label="Close Video mode" onClick={close}>
            <X className={VM_GLYPH} aria-hidden="true" />
          </CircleButton>
        </div>
      </div>

      {/* ── Sound, top centre: the same button as every other player; it stays while muted ── */}
      {activeMedia?.kind === "video" && !ended ? (
        <VideoSoundButton
          muted={muted}
          onToggle={toggleSound}
          inert={cleanView && !muted}
          className={cn("top-[calc(env(safe-area-inset-top)+12px)] z-30", !muted && "vm-chrome")}
        />
      ) : null}

      {/* ── Roll-over cue: the new area's name for a moment ── */}
      {cue ? (
        <div
          key={cue.key}
          className="vm-cue pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-30 flex justify-center"
          aria-hidden="true"
        >
          <span className="flex items-center gap-2 rounded-full bg-brand-green-950/90 px-4 py-2 text-sm font-semibold text-white ring-2 ring-brand-gold-300">
            {(() => {
              const Icon = SECTION_ICONS[cue.vertical];
              return <Icon className="h-4 w-4" aria-hidden="true" />;
            })()}
            {cue.text}
          </span>
        </div>
      ) : null}

      {browseError ? (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+68px)] z-30 rounded-xl bg-brand-green-950 px-4 py-3 text-center text-sm text-brand-gold-300 shadow-lg"
        >
          Posts could not load. Try again.
        </p>
      ) : null}

      {/* ── Left, close to the edge: sections, then province and filters ── */}
      {!ended ? (
        <div
          data-vm-chrome
          inert={cleanView}
          className="vm-sections vm-chrome absolute left-[max(4px,env(safe-area-inset-left))] top-[calc(env(safe-area-inset-top)+68px)] z-20"
        >
          <SectionRail
            vertical={browseValue.vertical}
            tourismKind={browseValue.kind}
            busy={busy === "filters" ? null : busy}
            onSelect={selectSection}
            filter={
              <FilterButton
                label={
                  filterCount > 0 || browseValue.province
                    ? `Province and filters: ${describeBrowse(browseValue)}`
                    : "Province and filters"
                }
                count={filterCount + (browseValue.province ? 1 : 0)}
                disabled={busy !== null}
                onClick={() => setFiltersOpen(true)}
              />
            }
          />
        </div>
      ) : null}

      {/* ── Right: views, like, contact, share (never hidden); bottom: title, price, Details ── */}
      {activeSlide && !ended ? (
        <>
          <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+28px)] right-[max(8px,env(safe-area-inset-right))] z-20">
            <ActionRail
              key={activeSlide.key}
              slide={activeSlide}
              views={views}
              analytics={analytics}
            />
          </div>
          {/* Always shown, so people know what they are watching: under a video that
              leaves black space, else at the bottom over it. */}
          <div
            data-vm-caption={captionAt === null ? "over" : "under"}
            style={captionAt === null ? undefined : { top: captionAt }}
            className={cn(
              "vm-info absolute left-[max(12px,env(safe-area-inset-left))] right-[calc(max(8px,env(safe-area-inset-right))+64px)] z-20 max-w-xl",
              captionAt !== null
                ? null
                : cleanView
                  ? "bottom-[calc(env(safe-area-inset-bottom)+28px)]"
                  : "bottom-[calc(env(safe-area-inset-bottom)+84px)]"
            )}
          >
            <PostSummary slide={activeSlide} headingLevel="h1" />
          </div>
          <div
            data-vm-details
            data-vm-chrome
            inert={cleanView}
            className="vm-info vm-chrome absolute bottom-[calc(env(safe-area-inset-bottom)+28px)] left-[max(12px,env(safe-area-inset-left))] right-[calc(max(8px,env(safe-area-inset-right))+64px)] z-20 max-w-xl"
          >
            <DetailsRow
              slide={activeSlide}
              onDetails={() => {
                // Keep the exact spot in the address bar before leaving.
                window.history.replaceState(
                  window.history.state,
                  "",
                  `${window.location.pathname}?${positionSearch(feed.browse, {
                    ctx: feed.sessionId,
                    post: activeSlide.id,
                    media: mediaIndex,
                  })}`
                );
              }}
            />
          </div>
          {/* The quiet progress line stays when the controls fade. */}
          {activeMedia?.kind === "video" ? (
            <div className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] z-20">
              <VideoModeSeek key={`${activeSlide.key}:${mediaIndex}`} />
            </div>
          ) : null}
          <MoreSheet
            key={`more:${activeSlide.key}`}
            slide={activeSlide}
            open={moreOpen}
            onOpenChange={setMoreOpen}
          />
        </>
      ) : null}

      {filtersOpen ? (
        <FilterSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          browse={browseValue}
          side="bottom"
          withProvince
          onApply={(next) => {
            setFiltersOpen(false);
            void browse(next, "filters");
          }}
        />
      ) : null}
      <TourismSheet
        open={tourismOpen}
        onOpenChange={setTourismOpen}
        kind={browseValue.kind}
        onChoose={(kind) => {
          setTourismOpen(false);
          if (kind !== browseValue.kind) {
            void browse(
              {
                ...browseValue,
                kind,
                category: kind === "events" ? null : browseValue.category,
                eventType: kind === "stays" ? null : browseValue.eventType,
              },
              "tourism"
            );
          }
        }}
      />
    </div>
  );
}
