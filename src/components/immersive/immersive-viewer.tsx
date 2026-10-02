"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import { ImmersiveActionRail } from "@/components/immersive/immersive-action-rail";
import { SlideHeadline, SlideSections } from "@/components/immersive/immersive-panels";
import { ImmersiveStage, type MediaChangeCause } from "@/components/immersive/immersive-stage";
import { ImmersiveTopBar } from "@/components/immersive/immersive-top-bar";
import { defaultBrowse, describeBrowse, type FeedBrowse } from "@/lib/feed/browse";
import { useFeedSequence, type FeedItem } from "@/components/immersive/use-feed-sequence";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { FeedSlide, FeedVertical } from "@/lib/feed/types";
import { cn } from "@/lib/utils";
import { trackContentView } from "@/lib/views/content-views";

/** A post counts as viewed after two continuous seconds on screen, as on the classic page's video rule. */
const VIEW_DWELL_MS = 2000;
/** Wheel events closer together than this belong to one gesture (trackpad momentum). */
const WHEEL_GESTURE_GAP_MS = 220;
const WHEEL_STEP = 40;
const NAV_SETTLE_MS = 450;
/** Two side panels from 1280px; one tabbed panel below that. */
const SPLIT_QUERY = "(min-width: 1280px)";

const VERTICAL_HOME: Record<FeedVertical, { href: string; label: string }> = {
  market: { href: "/mzansi-market", label: "Mzansi Market" },
  business: { href: "/mzansi-business", label: "Mzansi Business" },
  tourism: { href: "/tourism-events", label: "Tourism & Events" },
};

// Dialogs that are closing keep their node for the exit animation; only open ones block.
const BLOCKING_LAYER =
  '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [data-radix-popper-content-wrapper]';

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [role="tab"], [role="menu"], [role="menuitem"], [role="listbox"], [aria-label$="video player"]'
    )
  );
}

/** Keys pressed inside a side panel scroll that panel instead of changing post. */
function insidePanel(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-feed-panel]"));
}

function overlayOpen() {
  return typeof document !== "undefined" && Boolean(document.querySelector(BLOCKING_LAYER));
}

function slideStyle(offset: number, reducedMotion: boolean) {
  return {
    transform: `translate3d(0, ${offset * 100}%, 0)`,
    transition: reducedMotion ? "none" : "transform 420ms cubic-bezier(0.22, 0.8, 0.24, 1)",
  };
}

/* ─────────────────────────── One post ─────────────────────────── */

function PostSlide({
  slide,
  active,
  views,
  onVideoView,
  tabsMode,
  analytics,
}: {
  slide: FeedSlide;
  active: boolean;
  views: number;
  onVideoView: () => void;
  tabsMode: "split" | "tabs";
  analytics: boolean;
}) {
  const [mediaIndex, setMediaIndex] = useState(0);
  // Photos and videos move on by themselves until the visitor moves them.
  const [autoplay, setAutoplay] = useState(true);
  const changeMedia = useCallback((index: number, cause: MediaChangeCause) => {
    setMediaIndex(index);
    if (cause === "user") setAutoplay(false);
  }, []);
  const [tab, setTab] = useState<"overview" | "contact">("overview");
  const rootRef = useRef<HTMLDivElement>(null);

  // Left and right move through photos when the visitor is not typing or in the player.
  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target) || overlayOpen()) return;
      if (insidePanel(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft") {
        setAutoplay(false);
        setMediaIndex((index) => Math.max(0, index - 1));
      }
      if (event.key === "ArrowRight") {
        setAutoplay(false);
        setMediaIndex((index) => Math.min(slide.media.length - 1, index + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, slide.media.length]);

  const overview = (
    <>
      <SlideHeadline slide={slide} active={active} titleAs={active ? "h1" : "h2"} />
      {slide.left.length > 0 ? (
        <div className="mt-5 border-t border-white/10 pt-5">
          <SlideSections sections={slide.left} slide={slide} />
        </div>
      ) : null}
    </>
  );
  const details = <SlideSections sections={slide.right} slide={slide} />;
  // Panels are exactly as tall as the stage (same formula as its width × 16/9).
  const panelClass =
    "h-[min(853px,calc(100dvh-94px),calc((100vw-480px)*1.7778))] xl:h-[min(853px,calc(100dvh-94px),calc((100vw-736px)*1.7778))] min-h-0 overflow-y-auto overscroll-contain rounded-[28px] border border-white/10 bg-brand-green-950/85 px-6 py-6 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]";

  return (
    // The tracker credits clicks inside this element to this post only.
    <div ref={rootRef} className="contents">
      {active && analytics ? (
        <ContactActionTracker
          table={slide.table}
          id={slide.id}
          website={slide.website}
          root={rootRef}
          surface={`feed:${slide.vertical}`}
        />
      ) : null}
      <div
        className={cn(
          "grid h-full min-h-0 items-center justify-center gap-4",
          tabsMode === "split"
            ? "grid-cols-[minmax(260px,420px)_auto_minmax(260px,420px)]"
            : "grid-cols-[auto_minmax(280px,420px)]"
        )}
      >
        {tabsMode === "split" ? (
          <aside data-feed-panel className={panelClass} aria-label="Post overview">
            {overview}
          </aside>
        ) : null}

        <div className="flex min-h-0 items-end gap-3">
          <div className="relative aspect-[9/16] w-[min(480px,calc((100dvh-94px)*0.5625),calc(100vw-480px))] max-h-full overflow-hidden rounded-[28px] bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10 xl:w-[min(480px,calc((100dvh-94px)*0.5625),calc(100vw-736px))]">
            <ImmersiveStage
              slide={slide}
              active={active}
              mediaIndex={mediaIndex}
              onMediaIndexChange={changeMedia}
              autoplay={autoplay}
              onVideoViewRecorded={onVideoView}
              analytics={analytics}
            />
          </div>
          <ImmersiveActionRail slide={slide} views={views} active={active} />
        </div>

        {tabsMode === "split" ? (
          <aside data-feed-panel className={panelClass} aria-label="Contact and details">
            {details}
          </aside>
        ) : (
          <aside
            data-feed-panel
            className={cn(panelClass, "flex flex-col p-0")}
            aria-label="Post details"
          >
            <div
              role="tablist"
              aria-label="Post details"
              className="flex gap-1 border-b border-white/10 p-2"
            >
              {(
                [
                  ["overview", "Overview"],
                  ["contact", "Contact and details"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  id={`${slide.key}-tab-${value}`}
                  aria-selected={tab === value}
                  aria-controls={`${slide.key}-panel-${value}`}
                  tabIndex={active ? (tab === value ? 0 : -1) : -1}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      setTab(tab === "overview" ? "contact" : "overview");
                    }
                  }}
                  className={cn(
                    "h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300",
                    tab === value
                      ? "bg-white text-brand-green-950"
                      : "text-white/70 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${slide.key}-panel-${tab}`}
              aria-labelledby={`${slide.key}-tab-${tab}`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6"
            >
              {tab === "overview" ? overview : details}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function LoadingSlide({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex aspect-[9/16] h-full max-h-full max-w-[480px] flex-col items-center justify-center gap-4 rounded-[28px] bg-brand-green-900/60 ring-1 ring-white/10">
        {failed ? (
          <>
            <p className="px-8 text-center text-sm text-white/75">This post could not be loaded.</p>
            <button
              type="button"
              onClick={onRetry}
              className="flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-brand-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          </>
        ) : (
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-brand-gold-300"
            role="status"
            aria-label="Loading post"
          />
        )}
      </div>
    </div>
  );
}

function EndSlide({
  item,
  backHref,
  backLabel,
  onRetry,
  onWiden,
}: {
  item: Extract<FeedItem, { type: "end" } | { type: "more-error" }>;
  backHref: string;
  backLabel: string;
  onRetry: () => void;
  /** Offered when a single province ran out: carry on with the whole country. */
  onWiden?: () => void;
}) {
  const title =
    item.type === "more-error"
      ? "More posts could not be loaded"
      : item.terminal === "exhausted"
        ? "You’re all caught up"
        : "Keep exploring";
  const body =
    item.type === "more-error"
      ? "Check your connection and try again, or go back to the list."
      : item.terminal === "exhausted"
        ? "You have seen every post here."
        : "There are more posts in the full list.";
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md space-y-5 text-center">
        <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-white">{title}</h2>
        <p className="text-white/70">{body}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {item.type === "more-error" ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-11 items-center gap-2 rounded-full bg-brand-gold-300 px-5 text-sm font-semibold text-brand-gold-950 hover:bg-brand-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          ) : null}
          {onWiden && item.type === "end" ? (
            <button
              type="button"
              onClick={onWiden}
              className="flex h-11 items-center rounded-full bg-brand-gold-300 px-5 text-sm font-semibold text-brand-gold-950 hover:bg-brand-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              See all of South Africa
            </button>
          ) : null}
          <Link
            href={backHref}
            className="flex h-11 items-center rounded-full border border-white/25 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
          >
            {item.type === "end" && item.terminal !== "exhausted"
              ? `Continue browsing ${backLabel}`
              : `Back to ${backLabel}`}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A section, province or filter choice with no posts yet: say so and offer the way out. */
function EmptyBrowse({
  browse,
  busy,
  onBrowse,
}: {
  browse: FeedBrowse;
  busy: boolean;
  onBrowse: (browse: FeedBrowse) => void;
}) {
  const cleared = defaultBrowse(browse.vertical, browse.province);
  const filtered = describeBrowse(browse) !== describeBrowse(cleared);
  return (
    <div className="absolute inset-x-0 bottom-0 top-[62px] z-[2] flex items-center justify-center px-6">
      <div className="max-w-md space-y-5 text-center" role="status">
        <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-white">
          Nothing here yet
        </h2>
        <p className="text-white/70">
          No posts match {describeBrowse(browse)}. New posts appear here as soon as they go live.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {browse.province ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onBrowse({ ...browse, province: null })}
              className="h-11 rounded-full bg-brand-gold-300 px-5 text-sm font-semibold text-brand-gold-950 hover:bg-brand-gold-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
            >
              Show all of South Africa
            </button>
          ) : null}
          {filtered ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onBrowse(cleared)}
              className="h-11 rounded-full border border-white/25 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:opacity-60"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Viewer ─────────────────────────── */

export function ImmersiveViewer({
  initialSlide,
  onActiveHrefChange,
  fixtures,
}: {
  initialSlide: FeedSlide;
  onActiveHrefChange?: (href: string) => void;
  /** Design preview at /dev/immersive: fixed posts, no analytics, no address-bar changes. */
  fixtures?: FeedSlide[];
}) {
  const preview = Boolean(fixtures);
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [ctx] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("ctx")
  );
  // The post on screen, and where it sat in the list (used if it drops out).
  const [active, setActive] = useState({ id: initialSlide.id, index: 0 });
  const activeId = active.id;
  const [endRequested, setOnEnd] = useState(false);
  const feed = useFeedSequence(initialSlide, ctx, activeId, fixtures);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [tabsMode, setTabsMode] = useState<"split" | "tabs">(() =>
    typeof window !== "undefined" && !window.matchMedia(SPLIT_QUERY).matches ? "tabs" : "split"
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const postItems = useMemo(
    () =>
      feed.items.filter(
        (item): item is Extract<FeedItem, { type: "post" }> => item.type === "post"
      ),
    [feed.items]
  );
  const foundIndex = postItems.findIndex((item) => item.id === activeId);
  // A post that drops out is replaced by the next one, never by the first post.
  const activeIndex =
    foundIndex >= 0 ? foundIndex : Math.min(active.index, Math.max(0, postItems.length - 1));
  const tail = feed.items[feed.items.length - 1];
  const tailItem = tail && tail.type !== "post" ? tail : null;
  // The last post dropped out while it was on screen: show the end of the list.
  const onEnd =
    endRequested ||
    (foundIndex < 0 &&
      active.index >= postItems.length &&
      postItems.length > 0 &&
      Boolean(tailItem));
  const position = onEnd ? postItems.length : activeIndex;
  const activeItem = postItems[activeIndex];
  const activeSlide = activeItem?.slide;
  const home = VERTICAL_HOME[(activeSlide ?? initialSlide).vertical];
  const backHref = feed.returnUrl ?? home.href;
  const backLabel = feed.returnUrl ? feed.sourceLabel || "the list" : home.label;
  const announcement = activeSlide && !onEnd ? `Post ${activeIndex + 1}: ${activeSlide.title}` : "";

  useEffect(() => {
    const query = window.matchMedia(SPLIT_QUERY);
    const apply = () => setTabsMode(query.matches ? "split" : "tabs");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const canPrevious = position > 0;
  const canNext = !onEnd && (activeIndex < postItems.length - 1 || Boolean(tailItem));

  const go = useCallback(
    (direction: 1 | -1) => {
      if (direction === 1) {
        if (onEnd) return;
        if (activeIndex < postItems.length - 1) {
          setActive({ id: postItems[activeIndex + 1].id, index: activeIndex + 1 });
        } else if (tailItem) setOnEnd(true);
        return;
      }
      if (onEnd) {
        setOnEnd(false);
        const last = postItems.length - 1;
        if (last >= 0) setActive({ id: postItems[last].id, index: last });
        return;
      }
      if (activeIndex > 0) {
        setActive({ id: postItems[activeIndex - 1].id, index: activeIndex - 1 });
      }
    },
    [activeIndex, onEnd, postItems, tailItem]
  );

  /* ── Address bar, title and announcements follow the post on screen ── */
  useEffect(() => {
    if (!activeSlide || !feed.sessionId || onEnd || preview) return;
    const timer = window.setTimeout(() => {
      const url = new URL(activeSlide.href, window.location.origin);
      url.searchParams.set("ctx", feed.sessionId!);
      if (
        `${window.location.pathname}${window.location.search}` !== `${url.pathname}${url.search}`
      ) {
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      }
      document.title = `${activeSlide.title} | ${VERTICAL_HOME[activeSlide.vertical].label} | VerifyMzansi`;
      onActiveHrefChange?.(activeSlide.href);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeSlide, feed.sessionId, onEnd, onActiveHrefChange, preview]);

  /* ── Page view after two continuous seconds in the foreground ── */
  useEffect(() => {
    if (!activeSlide || onEnd || preview) return;
    let timer: number | null = null;
    let cancelled = false;
    const slide = activeSlide;
    const arm = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        void trackContentView({
          type: slide.targetType,
          id: slide.id,
          source: "page",
          surface: `feed:${slide.vertical}`,
        }).then((counted) => {
          if (counted && !cancelled) {
            setViewCounts((counts) => ({ ...counts, [slide.key]: (counts[slide.key] ?? 0) + 1 }));
          }
        });
        document.removeEventListener("visibilitychange", arm);
      }, VIEW_DWELL_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [activeSlide, onEnd, preview]);

  /* ── Section, province and filters from the top bar: stay in the viewer ── */
  const [browseBusy, setBrowseBusy] = useState<"section" | "province" | "filters" | null>(null);
  const [browseError, setBrowseError] = useState(false);
  const browse = useCallback(
    async (next: FeedBrowse, cause: "section" | "province" | "filters") => {
      setBrowseBusy(cause);
      setBrowseError(false);
      const result = await feed.browseTo(next);
      setBrowseBusy(null);
      if (!result.ok) {
        // The post on screen stays; the visitor can try the choice again.
        setBrowseError(true);
        return;
      }
      setOnEnd(false);
      setActive({ id: result.firstId ?? "", index: 0 });
    },
    [feed]
  );

  /* ── Leaving ── */
  const close = useCallback(() => {
    const target = feed.returnUrl ?? home.href;
    let cameFromSource = false;
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      cameFromSource =
        Boolean(feed.returnUrl) &&
        referrer?.origin === window.location.origin &&
        `${referrer.pathname}${referrer.search}` === feed.returnUrl;
    } catch {
      cameFromSource = false;
    }
    if (cameFromSource && window.history.length > 1) router.back();
    else router.push(target);
  }, [feed.returnUrl, home.href, router]);

  /* ── One navigation controller for keys, wheel and touch ── */
  const wheel = useRef({ sum: 0, last: 0, locked: false, navAt: 0 });
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || overlayOpen()) return; // ctrl+wheel is browser zoom
      const target = event.target as Element | null;
      if (target?.closest("[data-feed-panel]")) return;
      const state = wheel.current;
      const now = performance.now();
      const quiet = now - state.last > WHEEL_GESTURE_GAP_MS;
      state.last = now;
      if (state.locked) {
        // A trackpad keeps firing after the flick; wait for the gesture to end.
        if (quiet && now - state.navAt > NAV_SETTLE_MS) state.locked = false;
        else return;
      }
      if (quiet) state.sum = 0;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (Math.abs(event.deltaX) > Math.abs(delta)) return;
      state.sum += delta;
      if (Math.abs(state.sum) >= WHEEL_STEP) {
        go(state.sum > 0 ? 1 : -1);
        state.sum = 0;
        state.locked = true;
        state.navAt = now;
      }
    }
    element.addEventListener("wheel", onWheel, { passive: true });
    return () => element.removeEventListener("wheel", onWheel);
  }, [go]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        if (overlayOpen()) return; // the dialog closes first
        event.preventDefault();
        close();
        return;
      }
      if (isTypingTarget(event.target) || insidePanel(event.target) || overlayOpen()) return;
      if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        go(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go]);

  const touch = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    if ((event.target as Element).closest("[data-feed-panel], [data-carousel-control]")) return;
    touch.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Mostly vertical swipes change post; mostly horizontal ones change photo.
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.2) go(dy < 0 ? 1 : -1);
  };

  // Keep keyboard focus inside the post on screen after moving.
  useEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    const active = document.activeElement;
    if (active && stageRef.current?.contains(active) && active.closest("[inert]")) {
      live.focus({ preventScroll: true });
    }
  }, [activeId, onEnd]);

  const rendered = useMemo(() => {
    const from = Math.max(0, activeIndex - 2);
    return postItems
      .slice(from, activeIndex + 3)
      .map((item, offset) => ({ item, index: from + offset }));
  }, [postItems, activeIndex]);

  const total = postItems.length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-brand-green-950 text-white"
      role="region"
      aria-roledescription="post viewer"
      aria-label={feed.sourceLabel ? `${feed.sourceLabel} posts` : "Posts"}
    >
      {/* The brand surface: deep green with the Mzansi pattern across the whole stage. */}
      <div
        className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.09] invert"
        aria-hidden="true"
      />
      <ImmersiveTopBar
        browse={feed.browse}
        activeVertical={(activeSlide ?? initialSlide).vertical}
        sourceLabel={feed.sourceLabel}
        busy={browseBusy}
        error={browseError}
        notice={
          feed.notice === "expired"
            ? "That browsing list has ended, so these are fresh recommendations."
            : null
        }
        onBrowse={browse}
        onClose={close}
      />

      <div className="sr-only" aria-live="polite" tabIndex={-1} ref={liveRef}>
        {announcement}
      </div>

      {postItems.length === 0 && feed.browse ? (
        <EmptyBrowse
          browse={feed.browse}
          busy={browseBusy !== null}
          onBrowse={(next) => void browse(next, "filters")}
        />
      ) : null}

      <div
        ref={stageRef}
        className="relative z-[1] min-h-0 flex-1 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {rendered.map(({ item, index }) => {
          const offset = onEnd ? index - postItems.length : index - activeIndex;
          const isActive = !onEnd && index === activeIndex;
          return (
            <div
              key={item.id}
              className="absolute inset-0 py-4 pl-6 pr-[88px]"
              style={slideStyle(offset, reducedMotion)}
              inert={!isActive}
              aria-hidden={!isActive}
            >
              {item.slide ? (
                <PostSlide
                  slide={item.slide}
                  active={isActive}
                  views={item.slide.engagement.views + (viewCounts[item.slide.key] ?? 0)}
                  onVideoView={() =>
                    setViewCounts((counts) => ({
                      ...counts,
                      [item.slide!.key]: (counts[item.slide!.key] ?? 0) + 1,
                    }))
                  }
                  tabsMode={tabsMode}
                  analytics={!preview}
                />
              ) : (
                <LoadingSlide failed={item.failed} onRetry={() => feed.retrySlide(item.id)} />
              )}
            </div>
          );
        })}
        {tailItem && activeIndex >= postItems.length - 2 ? (
          <div
            className="absolute inset-0 px-6 py-4 pr-[88px]"
            style={slideStyle(onEnd ? 0 : postItems.length - activeIndex, reducedMotion)}
            inert={!onEnd}
            aria-hidden={!onEnd}
          >
            <EndSlide
              item={tailItem}
              backHref={backHref}
              backLabel={backLabel}
              onRetry={() => {
                setOnEnd(false);
                feed.retryGrow();
              }}
              onWiden={
                feed.browse?.province
                  ? () => void browse({ ...feed.browse!, province: null }, "province")
                  : undefined
              }
            />
          </div>
        ) : null}

        <nav
          aria-label="Move between posts"
          className="absolute inset-y-0 right-4 z-10 flex w-14 flex-col items-center justify-center gap-3"
        >
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!canPrevious}
            aria-label="Previous post"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-brand-green-900 text-white transition-colors hover:bg-brand-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:opacity-35"
          >
            <ChevronUp className="h-5 w-5" aria-hidden="true" />
          </button>
          {total > 0 ? (
            <p className="min-w-[3ch] text-center text-xs font-semibold tabular-nums text-white/70">
              <span className="sr-only">Post </span>
              {Math.min(position + 1, Math.max(total, 1))}
              <span className="sr-only"> of</span>
              <span aria-hidden="true">/</span>
              {total}
              {feed.open ? "+" : ""}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!canNext}
            aria-label="Next post"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-brand-green-900 text-white transition-colors hover:bg-brand-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:opacity-35"
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </button>
        </nav>
      </div>
    </div>
  );
}
