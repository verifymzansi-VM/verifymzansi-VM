"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeRef, encodeRef, slideRef } from "@/lib/feed/refs";
import { describeBrowse, serializeBrowse, type FeedBrowse } from "@/lib/feed/browse";
import {
  appendRefs,
  createBrowseSession,
  FEED_SESSION_LIMIT,
  needsDirectContinuation,
  saveSession,
  startSession,
  type FeedSession,
  type FeedTerminal,
} from "@/lib/feed/session";
import type { FeedRef, FeedSlide } from "@/lib/feed/types";

/** Load this many posts ahead (and one behind) of the post on screen. */
const LOOK_AHEAD = 3;
const SLIDE_BATCH = 4;
/** Extend the sequence when fewer than this many posts are left after the current one. */
const GROW_THRESHOLD = 8;

const LIST_RESULT_KEYS = {
  "/api/listings": { key: "listings", kind: "l" },
  "/api/businesses": { key: "businesses", kind: "b" },
  "/api/promotions": { key: "promotions", kind: "p" },
} as const;

export type FeedItem =
  | { type: "post"; id: string; ref: FeedRef; slide: FeedSlide | undefined; failed: boolean }
  | { type: "end"; terminal: FeedTerminal }
  | { type: "more-error" };

export interface FeedSequence {
  ready: boolean;
  sessionId: string | null;
  sourceLabel: string;
  returnUrl: string | null;
  notice: "expired" | null;
  items: FeedItem[];
  /** True while more posts may still be appended. */
  open: boolean;
  retrySlide: (id: string) => void;
  retryGrow: () => void;
  /** Section, province or filters chosen in the top bar; null when not browsing. */
  browse: FeedBrowse | null;
  /** Replace the sequence with a browse; resolves with its first post (or null when empty). */
  browseTo: (browse: FeedBrowse) => Promise<{ ok: boolean; firstId: string | null }>;
  totalKnown: number;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function useFeedSequence(
  initialSlide: FeedSlide,
  ctx: string | null,
  activeId: string,
  /** Design previews: a fixed list, no storage and no network. */
  fixtures?: FeedSlide[]
): FeedSequence {
  const [session, setSession] = useState<FeedSession | null>(null);
  const [notice, setNotice] = useState<"expired" | null>(null);
  const [slides, setSlides] = useState<Map<string, FeedSlide | null>>(
    () => new Map((fixtures ?? [initialSlide]).map((slide) => [slide.id, slide]))
  );
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [growError, setGrowError] = useState(false);
  const inFlight = useRef(new Set<string>());
  const growing = useRef(false);
  const abort = useRef(new AbortController());

  // A fresh controller per mount: a remount must never inherit an aborted one.
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);

  // Session: resume `ctx`, adopt the clicked list, or start fresh (browser only).
  useEffect(() => {
    if (fixtures) {
      setSession({
        v: 1,
        id: "preview",
        createdAt: Date.now(),
        source: { kind: "list", label: "Design preview" },
        returnUrl: null,
        refs: fixtures.map((slide) => encodeRef(slideRef(slide))),
        nextPage: null,
        directLoaded: true,
        terminal: "exhausted",
      });
      return;
    }
    const started = startSession(slideRef(initialSlide), ctx);
    // The opened post leads the sequence under its resolved kind.
    const first = started.session.refs[0] ? decodeRef(started.session.refs[0]) : null;
    if (first && first.id === initialSlide.id && first.kind === "t") {
      started.session.refs[0] = encodeRef(slideRef(initialSlide));
    }
    saveSession(started.session);
    setSession(started.session);
    setNotice(started.notice);
  }, [ctx, initialSlide, fixtures]);

  const update = useCallback((next: FeedSession) => {
    saveSession(next);
    setSession(next);
  }, []);

  const refs = useMemo(
    () =>
      (session?.refs ?? [encodeRef(slideRef(initialSlide))])
        .map(decodeRef)
        .filter((ref): ref is FeedRef => Boolean(ref)),
    [session, initialSlide]
  );

  // Posts that turned out to be unavailable drop out; the rest keep their frozen order.
  const posts = useMemo(() => refs.filter((ref) => slides.get(ref.id) !== null), [refs, slides]);
  const activeIndex = Math.max(
    0,
    posts.findIndex((ref) => ref.id === activeId)
  );

  /* ── Slides around the current post ── */
  const loadSlides = useCallback((batch: FeedRef[]) => {
    if (batch.length === 0) return;
    batch.forEach((ref) => inFlight.current.add(ref.id));
    const query = batch.map(encodeRef).join(",");
    fetchJson<{ slides: { ref: string; slide: FeedSlide | null }[] }>(
      `/api/feed/slides?refs=${encodeURIComponent(query)}`,
      abort.current.signal
    )
      .then((payload) => {
        setSlides((current) => {
          const next = new Map(current);
          for (const entry of payload.slides) {
            const ref = decodeRef(entry.ref.replace(":", "."));
            if (ref && !next.has(ref.id)) next.set(ref.id, entry.slide);
          }
          // Anything the server left out is treated as no longer public.
          for (const ref of batch) if (!next.has(ref.id)) next.set(ref.id, null);
          return next;
        });
        setFailed((current) => {
          const next = new Set(current);
          batch.forEach((ref) => next.delete(ref.id));
          return next;
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed((current) => new Set([...current, ...batch.map((ref) => ref.id)]));
      })
      .finally(() => batch.forEach((ref) => inFlight.current.delete(ref.id)));
  }, []);

  useEffect(() => {
    if (!session) return;
    const window = posts.slice(Math.max(0, activeIndex - 1), activeIndex + 1 + LOOK_AHEAD);
    const missing = window.filter(
      (ref) => !slides.has(ref.id) && !inFlight.current.has(ref.id) && !failed.has(ref.id)
    );
    for (let start = 0; start < missing.length; start += SLIDE_BATCH) {
      loadSlides(missing.slice(start, start + SLIDE_BATCH));
    }
  }, [session, posts, activeIndex, slides, failed, loadSlides]);

  /* ── Extending the sequence ── */
  const grow = useCallback(async () => {
    if (!session || growing.current || session.terminal) return;
    growing.current = true;
    setGrowError(false);
    const signal = abort.current.signal;
    try {
      const continuation = session.source.continuation;
      if (
        continuation &&
        session.nextPage != null &&
        continuation.total != null &&
        (session.nextPage - 1) * continuation.pageSize >= continuation.total
      ) {
        // The list said how long it is: nothing left to read.
        update({
          ...session,
          nextPage: null,
          terminal: session.source.thenDirect ? null : "exhausted",
        });
        return;
      }
      if (continuation && session.nextPage != null) {
        const params = new URLSearchParams(continuation.params);
        params.set("page", String(session.nextPage));
        params.set("limit", String(continuation.pageSize));
        const meta = LIST_RESULT_KEYS[continuation.api];
        const payload = await fetchJson<Record<string, unknown>>(
          `${continuation.api}?${params.toString()}`,
          signal
        );
        const rows = Array.isArray(payload[meta.key])
          ? (payload[meta.key] as Array<{ id?: unknown }>)
          : [];
        const fresh = rows
          .map((row) => (typeof row.id === "string" ? decodeRef(`${meta.kind}.${row.id}`) : null))
          .filter((ref): ref is FeedRef => Boolean(ref));
        const lastPage = rows.length < continuation.pageSize;
        let next = appendRefs(session, fresh);
        next = { ...next, nextPage: lastPage ? null : session.nextPage + 1 };
        if (lastPage && !next.source.thenDirect && !next.terminal)
          next = { ...next, terminal: "exhausted" };
        update(next);
        return;
      }
      if (needsDirectContinuation(session)) {
        const first = session.refs[0];
        const payload = await fetchJson<{ refs: string[]; terminal: FeedTerminal }>(
          `/api/feed/direct?ref=${encodeURIComponent(first)}`,
          signal
        );
        const fresh = payload.refs.map(decodeRef).filter((ref): ref is FeedRef => Boolean(ref));
        const next = appendRefs({ ...session, directLoaded: true }, fresh);
        update({ ...next, terminal: next.terminal ?? payload.terminal });
        return;
      }
      // A list or search section with nothing more to read stops at its own edge.
      update({ ...session, terminal: session.source.continuation ? "exhausted" : "source_limit" });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setGrowError(true);
    } finally {
      growing.current = false;
    }
  }, [session, update]);

  const browseTo = useCallback(
    async (browse: FeedBrowse) => {
      try {
        const payload = await fetchJson<{ refs: string[]; terminal: FeedTerminal }>(
          `/api/feed/browse?${serializeBrowse(browse)}`,
          abort.current.signal
        );
        const refs = payload.refs.map(decodeRef).filter((ref): ref is FeedRef => Boolean(ref));
        const next = createBrowseSession(
          browse,
          describeBrowse(browse),
          refs,
          payload.terminal,
          session?.returnUrl ?? null
        );
        setFailed(new Set());
        setGrowError(false);
        setSession(next);
        return { ok: true, firstId: refs[0]?.id ?? null };
      } catch {
        return { ok: false, firstId: null };
      }
    },
    [session?.returnUrl]
  );

  const remaining = posts.length - 1 - activeIndex;
  useEffect(() => {
    if (!session || session.terminal || growError) return;
    if (session.refs.length >= FEED_SESSION_LIMIT) {
      update({ ...session, terminal: "session_limit" });
      return;
    }
    if (remaining < GROW_THRESHOLD) void grow();
  }, [session, remaining, grow, growError, update]);

  const items = useMemo<FeedItem[]>(() => {
    const list: FeedItem[] = posts.map((ref) => ({
      type: "post",
      id: ref.id,
      ref,
      slide: slides.get(ref.id) ?? undefined,
      failed: failed.has(ref.id),
    }));
    if (session?.terminal) list.push({ type: "end", terminal: session.terminal });
    else if (growError) list.push({ type: "more-error" });
    return list;
  }, [posts, slides, failed, session?.terminal, growError]);

  return {
    ready: Boolean(session),
    sessionId: session?.id ?? null,
    sourceLabel: session?.source.label ?? "",
    returnUrl: session?.returnUrl ?? null,
    notice,
    items,
    open: !session?.terminal,
    totalKnown: posts.length,
    retrySlide: (id: string) =>
      setFailed((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    retryGrow: () => setGrowError(false),
    browse: session?.source.browse ?? null,
    browseTo,
  };
}
