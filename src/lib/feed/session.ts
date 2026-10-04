import { decodeRef, dedupeRefs, encodeRef, refFromHref, sameRef } from "@/lib/feed/refs";
import type { FeedBrowse } from "@/lib/feed/browse";
import type { FeedRef } from "@/lib/feed/types";

/**
 * A browsing session freezes the order of posts the visitor will swipe through.
 * It lives only in this browser tab (sessionStorage): it holds post references
 * and where they came from, never post data, and nobody else can read it.
 */

/** The viewer is desktop-only for now; phones and tablets keep the classic page. */
export const IMMERSIVE_MIN_WIDTH_QUERY = "(min-width: 1024px)";

export const FEED_SESSION_LIMIT = 200;
export const FEED_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
/** A captured click must be followed by the detail page quickly to count. */
const PENDING_TTL_MS = 30_000;
const STORAGE_PREFIX = "vm:feed:";
const PENDING_KEY = `${STORAGE_PREFIX}pending`;
/** The session this tab started last; a repeated start for the same post reuses it. */
const RECENT_KEY = `${STORAGE_PREFIX}recent`;
const RECENT_TTL_MS = 10_000;
const MAX_STORED_SESSIONS = 12;

const FEED_LIST_APIS = ["/api/listings", "/api/businesses", "/api/promotions"] as const;
type FeedListApi = (typeof FEED_LIST_APIS)[number];

export interface FeedSourceDescriptor {
  kind: "list" | "rail" | "search" | "direct" | "browse";
  /** Shown in the viewer's top bar: "Vehicles", "Home showroom", "Search results". */
  label: string;
  /** Same public list API and params the page used, to continue past the rendered cards. */
  continuation?: {
    api: FeedListApi;
    params: string;
    page: number;
    pageSize: number;
    /** Results in the whole list when the page knew it; no request past the end. */
    total?: number;
  };
  /** Rails continue with recommendations once their own cards run out. */
  thenDirect?: boolean;
  /** A rotating showroom continues past its last card back to its first. */
  wrap?: boolean;
  /** Set when the visitor chose a section, province or filters in the viewer. */
  browse?: FeedBrowse;
}

/** A rotating showroom continues past its last card back to its first. */
interface FeedSourceAttribute {
  kind: "list" | "rail" | "search";
  label: string;
  api?: FeedListApi;
  params?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  wrap?: boolean;
}

export type FeedTerminal = "exhausted" | "session_limit" | "source_limit";

export interface FeedSession {
  v: 1;
  id: string;
  createdAt: number;
  source: FeedSourceDescriptor;
  /** Validated same-origin path the visitor came from. */
  returnUrl: string | null;
  refs: string[];
  /** Next list page to read, or null when the list continuation is finished. */
  nextPage: number | null;
  /** Direct recommendations already appended (rails and direct sessions). */
  directLoaded: boolean;
  terminal: FeedTerminal | null;
}

interface PendingCapture {
  at: number;
  ref: string;
  refs: string[];
  source: FeedSourceDescriptor;
  returnUrl: string;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the viewer still works for this page view.
  }
}

/** Only same-site paths are ever used as a way back. */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  return value.slice(0, 600);
}

function isListApi(value: unknown): value is FeedListApi {
  return typeof value === "string" && (FEED_LIST_APIS as readonly string[]).includes(value);
}

/** Parse a container's `data-feed-source`; anything unexpected is dropped, not trusted. */
export function parseSourceAttribute(raw: string | null | undefined): FeedSourceDescriptor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const kind = value.kind;
    if (kind !== "list" && kind !== "rail" && kind !== "search") return null;
    const label = typeof value.label === "string" ? value.label.slice(0, 60) : "";
    const descriptor: FeedSourceDescriptor = {
      kind,
      label,
      thenDirect: kind === "rail",
      wrap: value.wrap === true,
    };
    const page = Number(value.page);
    const pageSize = Number(value.pageSize);
    if (
      isListApi(value.api) &&
      typeof value.params === "string" &&
      value.params.length <= 1500 &&
      Number.isInteger(page) &&
      page >= 1 &&
      Number.isInteger(pageSize) &&
      pageSize >= 1 &&
      pageSize <= 50
    ) {
      const total = Number(value.total);
      descriptor.continuation = {
        api: value.api,
        params: value.params,
        page,
        pageSize,
        ...(Number.isInteger(total) && total >= 0 ? { total } : {}),
      };
    }
    return descriptor;
  } catch {
    return null;
  }
}

/** Data attribute value for a card container. */
export function feedSourceAttribute(source: FeedSourceAttribute) {
  return JSON.stringify(source);
}

/**
 * Called on a card click: remember the cards around it in display order so the
 * detail page can continue through exactly what the visitor saw.
 */
export function capturePendingSource(anchor: HTMLAnchorElement) {
  const ref = refFromHref(anchor.getAttribute("href"), window.location.origin);
  if (!ref) return;
  const container = anchor.closest<HTMLElement>("[data-feed-source]");
  const source = parseSourceAttribute(container?.dataset.feedSource) ?? {
    kind: "direct" as const,
    label: "",
  };
  let refs: FeedRef[] = [ref];
  if (container && source.kind !== "direct") {
    const rendered = dedupeRefs(
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .map((link) => refFromHref(link.getAttribute("href"), window.location.origin))
        .filter((value): value is FeedRef => Boolean(value))
    );
    const start = rendered.findIndex((candidate) => sameRef(candidate, ref));
    refs =
      start < 0
        ? [ref]
        : source.wrap
          ? [...rendered.slice(start), ...rendered.slice(0, start)]
          : rendered.slice(start);
  }
  const pending: PendingCapture = {
    at: Date.now(),
    ref: encodeRef(ref),
    refs: refs.slice(0, FEED_SESSION_LIMIT).map(encodeRef),
    source,
    returnUrl: `${window.location.pathname}${window.location.search}`,
  };
  writeJson(PENDING_KEY, pending);
}

function newSessionId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

function pruneSessions(now: number) {
  const store = storage();
  if (!store) return;
  try {
    const entries: { key: string; createdAt: number }[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(STORAGE_PREFIX) || key === PENDING_KEY || key === RECENT_KEY) {
        continue;
      }
      const session = readJson<FeedSession>(key);
      entries.push({ key, createdAt: session?.createdAt ?? 0 });
    }
    entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((entry, index) => {
        if (index >= MAX_STORED_SESSIONS || now - entry.createdAt > FEED_SESSION_TTL_MS) {
          store.removeItem(entry.key);
        }
      });
  } catch {
    // Best effort.
  }
}

export function saveSession(session: FeedSession) {
  writeJson(`${STORAGE_PREFIX}${session.id}`, session);
}

function isLiveSession(session: FeedSession | null, now: number): session is FeedSession {
  return Boolean(
    session &&
    session.v === 1 &&
    Array.isArray(session.refs) &&
    now - session.createdAt <= FEED_SESSION_TTL_MS
  );
}

/** A stored browse session by id (Video mode resumes after refresh or Back). */
export function readBrowseSession(id: string, now = Date.now()): FeedSession | null {
  const stored = readJson<FeedSession>(`${STORAGE_PREFIX}${id.slice(0, 20)}`);
  return isLiveSession(stored, now) && stored.source.kind === "browse" && stored.source.browse
    ? stored
    : null;
}

export type SessionStart =
  | { session: FeedSession; resumed: boolean; notice: null }
  | { session: FeedSession; resumed: false; notice: "expired" };

/**
 * The session for this page: the one named by `ctx` when it still exists, else
 * one built from the card the visitor just clicked, else a fresh direct one.
 * `ctx` that cannot be found (shared link, new tab, expired) never breaks the
 * page: it starts a direct session and says so.
 */
export function startSession(current: FeedRef, ctx: string | null, now = Date.now()): SessionStart {
  if (ctx) {
    const stored = readJson<FeedSession>(`${STORAGE_PREFIX}${ctx.slice(0, 20)}`);
    if (isLiveSession(stored, now)) {
      const refs = stored.refs.map(decodeRef).filter((ref): ref is FeedRef => Boolean(ref));
      if (refs.some((ref) => sameRef(ref, current))) {
        return { session: stored, resumed: true, notice: null };
      }
    }
  }

  // Starting twice for the same page (React remounts, effect re-runs) must not
  // lose the list the visitor clicked in: reuse the session started a moment ago.
  const recent = readJson<{ ref: string; id: string; at: number; notice: "expired" | null }>(
    RECENT_KEY
  );
  const recentRef = recent ? decodeRef(recent.ref) : null;
  if (recent && recentRef && sameRef(recentRef, current) && now - recent.at <= RECENT_TTL_MS) {
    const stored = readJson<FeedSession>(`${STORAGE_PREFIX}${recent.id}`);
    if (isLiveSession(stored, now)) {
      return recent.notice
        ? { session: stored, resumed: false, notice: recent.notice }
        : { session: stored, resumed: false, notice: null };
    }
  }

  pruneSessions(now);
  const pending = readJson<PendingCapture>(PENDING_KEY);
  try {
    storage()?.removeItem(PENDING_KEY);
  } catch {
    // Ignore.
  }
  const pendingRef = pending ? decodeRef(pending.ref) : null;
  const fromClick =
    pending && pendingRef && now - pending.at <= PENDING_TTL_MS && sameRef(pendingRef, current);

  const session: FeedSession = fromClick
    ? {
        v: 1,
        id: newSessionId(),
        createdAt: now,
        source: pending.source,
        returnUrl: safeReturnUrl(pending.returnUrl),
        refs: pending.refs
          .map(decodeRef)
          .filter((ref): ref is FeedRef => Boolean(ref))
          .slice(0, FEED_SESSION_LIMIT)
          .map(encodeRef),
        nextPage: pending.source.continuation ? pending.source.continuation.page + 1 : null,
        directLoaded: false,
        terminal: null,
      }
    : {
        v: 1,
        id: newSessionId(),
        createdAt: now,
        source: { kind: "direct", label: "" },
        returnUrl: null,
        refs: [encodeRef(current)],
        nextPage: null,
        directLoaded: false,
        terminal: null,
      };
  saveSession(session);
  const notice = ctx && !fromClick ? ("expired" as const) : null;
  writeJson(RECENT_KEY, { ref: encodeRef(current), id: session.id, at: now, notice });
  return ctx && !fromClick
    ? { session, resumed: false, notice: "expired" }
    : { session, resumed: false, notice: null };
}

/** Add refs to the frozen order without repeats, respecting the session cap. */
export function appendRefs(session: FeedSession, refs: FeedRef[]): FeedSession {
  const existing = session.refs.map(decodeRef).filter((ref): ref is FeedRef => Boolean(ref));
  const merged = dedupeRefs([...existing, ...refs]);
  const capped = merged.slice(0, FEED_SESSION_LIMIT);
  return {
    ...session,
    refs: capped.map(encodeRef),
    terminal: merged.length > FEED_SESSION_LIMIT ? "session_limit" : session.terminal,
  };
}

/** What comes after the source's own posts. */
export function needsDirectContinuation(session: FeedSession) {
  return (
    !session.directLoaded &&
    session.nextPage == null &&
    (session.source.kind === "direct" || Boolean(session.source.thenDirect))
  );
}

/** A session for a section / province / filter choice made inside the viewer. */
export function createBrowseSession(
  browse: FeedBrowse,
  label: string,
  refs: FeedRef[],
  terminal: FeedTerminal,
  returnUrl: string | null,
  now = Date.now()
): FeedSession {
  const session: FeedSession = {
    v: 1,
    id: newSessionId(),
    createdAt: now,
    source: { kind: "browse", label, browse },
    returnUrl,
    refs: refs.slice(0, FEED_SESSION_LIMIT).map(encodeRef),
    nextPage: null,
    directLoaded: true,
    terminal,
  };
  saveSession(session);
  return session;
}
