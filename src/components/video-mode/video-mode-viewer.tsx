"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronUp,
  RotateCcw,
  ShoppingBag,
  SlidersHorizontal,
  TreePalm,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import { FilterSheet, rememberProvince } from "@/components/immersive/immersive-top-bar";
import { BrandShield } from "@/components/shared/brand-shield";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ActionRail,
  CircleButton,
  MoreSheet,
  PostActionRow,
  PostInfo,
  SectionRail,
  VM_CIRCLE,
  VM_GLYPH,
} from "@/components/video-mode/video-mode-rails";
import { EdgeTab } from "@/components/video-mode/video-mode-edge-tab";
import { useConstrainedNetwork, VideoModeMedia } from "@/components/video-mode/video-mode-media";
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
import { cn } from "@/lib/utils";

/** Movement before a gesture picks an axis, and the edge strip left to the system's back gesture. */
const AXIS_LOCK_PX = 10;
const EDGE_GUARD_PX = 20;
const SWIPE_MEDIA_PX = 50;
const FLICK_VELOCITY = 0.45;
const TAP_GUARD_MS = 350;
const SLIDE_MS = 380;
const SOUND_KEY = "vm:video:sound";
/** Idle time before the controls step aside for a clean view. */
const AUTO_HIDE_MS = 6000;
const AUTO_HIDE_KEY = "vm:video:auto-hide";
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

function readSoundOn() {
  try {
    return window.sessionStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
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

const SECTION_ICONS: Record<FeedVertical, typeof ShoppingBag> = {
  market: ShoppingBag,
  business: Building2,
  tourism: TreePalm,
};

/**
 * The end of a section, or a section with nothing yet. With little inventory
 * this is common, so it always offers the next best step instead of looping:
 * widen the province, clear filters, then another section.
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
  const others = (["market", "business", "tourism"] as FeedVertical[]).filter(
    (vertical) => vertical !== browse.vertical
  );
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
  const [muted, setMuted] = useState(() => !readSoundOn());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tourismOpen, setTourismOpen] = useState(false);
  const [busy, setBusy] = useState<FeedVertical | "filters" | null>(null);
  const [browseError, setBrowseError] = useState(false);
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

  /* ── Clean view: the controls slide out through the edges; the edge tab brings them back ── */
  const [chromeHidden, setChromeHidden] = useState(false);
  const [activity, setActivity] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  // Once the visitor brings the details back themselves, they decide from then on:
  // the controls no longer step aside on their own (for the rest of this visit).
  const [autoHide, setAutoHide] = useState(() => {
    try {
      return window.sessionStorage.getItem(AUTO_HIDE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const cleanView = chromeHidden && !ended;
  const toggleChrome = () => {
    if (chromeHidden) {
      setAutoHide(false);
      try {
        window.sessionStorage.setItem(AUTO_HIDE_KEY, "off");
      } catch {
        // Off for this page view only.
      }
    }
    setChromeHidden(!chromeHidden);
  };
  // After a while without a touch the controls step aside on their own, so the
  // visitor can keep swiping through clean videos. Only while a video is playing:
  // someone reading a photo post, or who paused to look, keeps the details.
  useEffect(() => {
    if (!autoHide || chromeHidden || ended || held || !activeSlide || !videoPlaying) return;
    const timer = window.setTimeout(() => {
      const focused = document.activeElement;
      // Keyboard users moving through the controls keep them.
      if (focused?.closest("[data-vm-chrome]") && focused.matches(":focus-visible")) return;
      setChromeHidden(true);
    }, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [autoHide, chromeHidden, ended, held, activeSlide, videoPlaying, activity]);
  const noteActivity = () => {
    if (!chromeHidden) setActivity((value) => value + 1);
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

  /* ── Moving between posts and media ── */
  const go = useCallback(
    (direction: 1 | -1) => {
      if (direction === 1) {
        if (ended) return;
        if (hint) dismissHint();
        if (activeIndex < posts.length - 1) {
          setActive({ id: posts[activeIndex + 1].id, index: activeIndex + 1 });
        } else if (feed.terminal) {
          setOnEnd(true);
        }
        return;
      }
      if (onEnd) {
        setOnEnd(false);
        return;
      }
      if (activeIndex > 0) setActive({ id: posts[activeIndex - 1].id, index: activeIndex - 1 });
    },
    [activeIndex, dismissHint, ended, feed.terminal, hint, onEnd, posts]
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
      const ok = await feed.browseTo(next);
      setBusy(null);
      if (!ok) {
        setBrowseError(true);
        return;
      }
      if (next.province !== feed.browse.province) rememberProvince(next.province);
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

  function rememberSound(on: boolean) {
    try {
      window.sessionStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      // The choice still holds for this page.
    }
  }

  function toggleSound() {
    const next = !muted;
    // Set inside the tap itself: iOS only accepts sound that a gesture turned on.
    const video = document.querySelector<HTMLVideoElement>("video[data-vm-active-video]");
    if (video) {
      video.muted = next;
      if (!next && video.paused) void video.play().catch(() => undefined);
    }
    setMuted(next);
    rememberSound(!next);
  }

  /* ── Keyboard (tablets with keyboards, accessibility) ── */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (document.querySelector(OPEN_LAYER)) return;
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
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
  }, [close, go, moveMedia]);

  /* ── Touch: one gesture, one axis. Vertical changes post, horizontal changes media. ── */
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastGestureAt = useRef(0);
  const ignoreTap = useCallback(() => performance.now() - lastGestureAt.current < TAP_GUARD_MS, []);

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
      // Resistance past the first post and past the end.
      const atStart = activeIndex === 0 && !onEnd && state.dy > 0;
      const atEnd = ended && state.dy < 0;
      setTrackOffset(atStart || atEnd ? state.dy * 0.25 : state.dy, false);
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

  const browseValue = feed.browse;
  const filterCount = activeFilterCount(browseValue);
  const activeMedia = activeSlide?.media[Math.min(mediaIndex, activeSlide.media.length - 1)];
  const views = activeSlide ? activeSlide.engagement.views + (viewCounts[activeSlide.key] ?? 0) : 0;
  const announcement = ended
    ? posts.length === 0
      ? `No posts in ${describeBrowse(browseValue)} yet.`
      : "You have reached the end of this section."
    : activeSlide
      ? `Post ${activeIndex + 1} of ${posts.length}: ${activeSlide.title}`
      : "Loading post";

  return (
    <div
      data-viewer-theme="dark"
      data-chrome={cleanView ? "hidden" : "shown"}
      onPointerDownCapture={noteActivity}
      onKeyDownCapture={noteActivity}
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
                    onUserPause={() => setChromeHidden(false)}
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
            className="vm-chrome-fade pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
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
                index === mediaIndex ? "bg-brand-gold-300" : "bg-white/40"
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

      {/* ── Top bar ── */}
      <div
        data-vm-control
        data-vm-chrome
        inert={cleanView}
        style={{ "--vm-order": 1 } as React.CSSProperties}
        className="vm-chrome vm-chrome-up absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-1.5 pt-[calc(env(safe-area-inset-top)+12px)]"
      >
        <BrandShield
          className="ml-1 h-8 w-8 shrink-0 text-brand-gold-300 drop-shadow"
          aria-hidden="true"
        />
        <span className="sr-only">VerifyMzansi Video mode</span>
        <div className="ml-auto flex items-center gap-1">
          {activeMedia?.kind === "video" && !ended ? (
            <CircleButton
              label={muted ? "Turn sound on" : "Turn sound off"}
              pressed={!muted}
              onClick={toggleSound}
            >
              {muted ? (
                <VolumeX className={VM_GLYPH} aria-hidden="true" />
              ) : (
                <Volume2 className={VM_GLYPH} aria-hidden="true" />
              )}
            </CircleButton>
          ) : null}
          <CircleButton
            label={
              filterCount > 0 || browseValue.province
                ? `Province and filters: ${describeBrowse(browseValue)}`
                : "Province and filters"
            }
            onClick={() => setFiltersOpen(true)}
            disabled={busy !== null}
            className="relative"
          >
            <SlidersHorizontal className={VM_GLYPH} aria-hidden="true" />
            {filterCount + (browseValue.province ? 1 : 0) > 0 ? (
              <span
                className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-gold-300 px-1 text-[10px] font-bold text-brand-gold-950"
                aria-hidden="true"
              >
                {filterCount + (browseValue.province ? 1 : 0)}
              </span>
            ) : null}
          </CircleButton>
          <CircleButton label="Close Video mode" onClick={close}>
            <X className={VM_GLYPH} aria-hidden="true" />
          </CircleButton>
        </div>
      </div>

      {browseError ? (
        <p
          role="alert"
          className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+68px)] z-30 rounded-xl bg-brand-green-950 px-4 py-3 text-center text-sm text-brand-gold-300 shadow-lg"
        >
          Posts could not load. Try again.
        </p>
      ) : null}

      {/* ── Left: sections (the end card offers the other sections itself) ── */}
      {!ended ? (
        <div
          data-vm-chrome
          inert={cleanView}
          style={{ "--vm-order": 3 } as React.CSSProperties}
          className="vm-sections vm-chrome vm-chrome-left absolute left-[max(4px,env(safe-area-inset-left))] top-[calc(env(safe-area-inset-top)+68px)] z-20"
        >
          <SectionRail
            vertical={browseValue.vertical}
            tourismKind={browseValue.kind}
            busy={busy === "filters" ? null : busy}
            onSelect={selectSection}
          />
        </div>
      ) : null}

      {/* ── Right: like, views, enquire; bottom: the post and its actions ── */}
      {activeSlide && !ended ? (
        <>
          <div
            data-vm-chrome
            inert={cleanView}
            style={{ "--vm-order": 0 } as React.CSSProperties}
            className="vm-chrome vm-chrome-right absolute bottom-[calc(env(safe-area-inset-bottom)+72px)] right-[max(8px,env(safe-area-inset-right))] z-20"
          >
            <ActionRail key={activeSlide.key} slide={activeSlide} views={views} />
          </div>
          <div
            data-vm-chrome
            inert={cleanView}
            style={{ "--vm-order": 2 } as React.CSSProperties}
            className="vm-info vm-chrome vm-chrome-down absolute bottom-[calc(env(safe-area-inset-bottom)+12px)] left-[max(12px,env(safe-area-inset-left))] right-[calc(max(8px,env(safe-area-inset-right))+52px)] z-20 max-w-xl space-y-3"
          >
            <PostInfo slide={activeSlide} headingLevel="h1" />
            <PostActionRow
              key={activeSlide.key}
              slide={activeSlide}
              analytics={analytics}
              onMore={() => setMoreOpen(true)}
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
          <MoreSheet
            key={`more:${activeSlide.key}`}
            slide={activeSlide}
            open={moreOpen}
            onOpenChange={setMoreOpen}
          />

          {/* ── The edge tab: everything slides out through the walls and back ── */}
          <EdgeTab hidden={cleanView} onToggle={toggleChrome} />
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
