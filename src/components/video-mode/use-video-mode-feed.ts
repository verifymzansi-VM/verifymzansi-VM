"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeBrowse, parseBrowse, serializeBrowse, type FeedBrowse } from "@/lib/feed/browse";
import { decodeRef, encodeRef, slideRef } from "@/lib/feed/refs";
import {
  createBrowseSession,
  readBrowseSession,
  type FeedSession,
  type FeedTerminal,
} from "@/lib/feed/session";
import { fetchSlides, mergeSlides, withoutRefs } from "@/lib/feed/slides-client";
import type { FeedRef, FeedSlide } from "@/lib/feed/types";

/** Post data (not media) for the next two posts and the one behind. */
const LOOK_AHEAD = 2;
/** The slides endpoint accepts at most four refs per request. */
const SLIDE_BATCH = 4;

export interface VideoModePost {
  id: string;
  ref: FeedRef;
  slide: FeedSlide | undefined;
  failed: boolean;
}

export interface VideoModeFeed {
  status: "loading" | "ready" | "error";
  browse: FeedBrowse;
  sessionId: string | null;
  posts: VideoModePost[];
  terminal: FeedTerminal | null;
  /** Replace the feed with another section, province or filter choice. */
  browseTo: (browse: FeedBrowse) => Promise<boolean>;
  retry: () => void;
  retrySlide: (id: string) => void;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** A post with nothing to show cannot be a Video mode entry. */
function usable(slide: FeedSlide | null): FeedSlide | null {
  return slide && slide.media.length > 0 ? slide : null;
}

function fixtureRefs(fixtures: FeedSlide[], browse: FeedBrowse): FeedRef[] {
  return fixtures
    .filter((slide) => slide.vertical === browse.vertical)
    .filter((slide) =>
      browse.vertical !== "tourism" || browse.kind === "all"
        ? true
        : browse.kind === "events"
          ? slide.kind === "event"
          : slide.kind === "tourism"
    )
    .map(slideRef);
}

/** A stored session is only trusted when its browse still passes validation. */
function resumable(ctx: string | null, browse: FeedBrowse): FeedSession | null {
  if (!ctx) return null;
  const stored = readBrowseSession(ctx);
  const storedBrowse = stored?.source.browse;
  if (!stored || !storedBrowse) return null;
  const serialized = serializeBrowse(storedBrowse);
  const valid = parseBrowse(new URLSearchParams(serialized));
  return valid && serialized === serializeBrowse(browse) ? stored : null;
}

export function useVideoModeFeed({
  initialBrowse,
  ctx,
  activeId,
  fixtures,
}: {
  initialBrowse: FeedBrowse;
  ctx: string | null;
  activeId: string | null;
  /** Development demo: fixed posts, no storage and no network. */
  fixtures?: FeedSlide[];
}): VideoModeFeed {
  const [browse, setBrowse] = useState(initialBrowse);
  // Refresh and Back from a post resume the stored session without a request.
  const [resumed] = useState(() => (fixtures ? null : resumable(ctx, initialBrowse)));
  const [session, setSession] = useState<FeedSession | null>(resumed);
  const [status, setStatus] = useState<VideoModeFeed["status"]>(resumed ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [slides, setSlides] = useState<Map<string, FeedSlide | null>>(
    () => new Map((fixtures ?? []).map((slide) => [slide.id, usable(slide)]))
  );
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(new Set<string>());
  const [reload, setReload] = useState(0);
  const abort = useRef(new AbortController());

  // A fresh controller per mount: a remount must never inherit an aborted one.
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);

  const build = useCallback(
    async (next: FeedBrowse, signal: AbortSignal): Promise<FeedSession> => {
      if (fixtures) {
        return {
          v: 1,
          id: "preview",
          createdAt: Date.now(),
          source: { kind: "browse", label: describeBrowse(next), browse: next },
          returnUrl: null,
          refs: fixtureRefs(fixtures, next).map(encodeRef),
          nextPage: null,
          directLoaded: true,
          terminal: "exhausted",
        };
      }
      const payload = await fetchJson<{ refs: string[]; terminal: FeedTerminal }>(
        `/api/feed/browse?${serializeBrowse(next)}`,
        signal
      );
      const refs = payload.refs.map(decodeRef).filter((ref): ref is FeedRef => Boolean(ref));
      return createBrowseSession(next, describeBrowse(next), refs, payload.terminal, null);
    },
    [fixtures]
  );

  // First feed when there was nothing to resume (and again after "Try again").
  useEffect(() => {
    if (resumed) return;
    const controller = new AbortController();
    build(initialBrowse, controller.signal)
      .then((next) => {
        setSession(next);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [build, initialBrowse, resumed, attempt]);

  const refs = useMemo(
    () => (session?.refs ?? []).map(decodeRef).filter((ref): ref is FeedRef => Boolean(ref)),
    [session]
  );
  // Posts that turned out to be unavailable (or have no media) drop out; the rest keep their order.
  const visible = useMemo(() => refs.filter((ref) => slides.get(ref.id) !== null), [refs, slides]);
  const activeIndex = Math.max(
    0,
    visible.findIndex((ref) => ref.id === activeId)
  );

  const loadSlides = useCallback((batch: FeedRef[]) => {
    batch.forEach((ref) => inFlight.current.add(ref.id));
    fetchSlides(batch, abort.current.signal)
      .then((loaded) => {
        setSlides((current) => mergeSlides(current, loaded, usable));
        setFailed((current) => withoutRefs(current, batch));
      })
      .catch((error: unknown) => {
        batch.forEach((ref) => inFlight.current.delete(ref.id));
        if (error instanceof DOMException && error.name === "AbortError") {
          // Cancelled by a remount (React re-runs effects in development): ask again.
          setReload((value) => value + 1);
          return;
        }
        setFailed((current) => new Set([...current, ...batch.map((ref) => ref.id)]));
      })
      .finally(() => batch.forEach((ref) => inFlight.current.delete(ref.id)));
  }, []);

  useEffect(() => {
    if (!session || fixtures) return;
    const window = visible.slice(Math.max(0, activeIndex - 1), activeIndex + 1 + LOOK_AHEAD);
    const missing = window.filter(
      (ref) => !slides.has(ref.id) && !inFlight.current.has(ref.id) && !failed.has(ref.id)
    );
    for (let start = 0; start < missing.length; start += SLIDE_BATCH) {
      loadSlides(missing.slice(start, start + SLIDE_BATCH));
    }
  }, [session, fixtures, visible, activeIndex, slides, failed, loadSlides, reload]);

  const browseTo = useCallback(
    async (next: FeedBrowse) => {
      try {
        const built = await build(next, abort.current.signal);
        setFailed(new Set());
        setBrowse(next);
        setSession(built);
        setStatus("ready");
        return true;
      } catch {
        return false;
      }
    },
    [build]
  );

  const posts = useMemo<VideoModePost[]>(
    () =>
      visible.map((ref) => ({
        id: ref.id,
        ref,
        slide: slides.get(ref.id) ?? undefined,
        failed: failed.has(ref.id),
      })),
    [visible, slides, failed]
  );

  return {
    status,
    browse,
    sessionId: session && !fixtures ? session.id : null,
    posts,
    terminal: session?.terminal ?? null,
    browseTo,
    retry: () => {
      setStatus("loading");
      setAttempt((value) => value + 1);
    },
    retrySlide: (id: string) =>
      setFailed((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
  };
}
