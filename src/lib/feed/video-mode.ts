import { defaultBrowse, parseBrowse, serializeBrowse, type FeedBrowse } from "@/lib/feed/browse";
import type { FeedVertical } from "@/lib/feed/types";

/**
 * Mobile Video mode: one full-screen post at a time for phones and tablets.
 * Desktop (fine pointer, 1024px and wider) keeps the lists and the desktop
 * post viewer; a direct visit there goes to the matching list instead.
 */
const VIDEO_MODE_PATH = "/video-mode";

const REMEMBERED_VERTICAL_KEY = "vm:video:vertical";

const LIST_PATHS: Record<FeedVertical, string> = {
  market: "/mzansi-market",
  business: "/mzansi-business",
  tourism: "/tourism-events",
};

function verticalFromPath(pathname: string): FeedVertical | null {
  if (pathname.startsWith("/mzansi-market")) return "market";
  if (pathname.startsWith("/mzansi-business")) return "business";
  if (pathname.startsWith("/tourism-events") || pathname.startsWith("/promotions")) {
    return "tourism";
  }
  return null;
}

/**
 * The browse a list page's own address describes, keeping only filters Video
 * mode understands. Each value is checked on its own against the real option
 * lists, so one unknown value drops that filter instead of the whole browse.
 */
export function browseFromListUrl(pathname: string, search: URLSearchParams): FeedBrowse | null {
  const vertical = verticalFromPath(pathname);
  if (!vertical) return null;
  const candidates: [string, string | null][] = [
    ["province", search.get("province")],
    ["q", search.get("q")],
  ];
  if (vertical === "market") {
    candidates.push(
      ["category", search.get("category")],
      ["condition", search.get("condition")],
      ["sort", search.get("sort")]
    );
  } else if (vertical === "business") {
    candidates.push(["category", search.get("category")]);
  } else {
    const events =
      pathname.startsWith("/promotions/events") ||
      search.get("tab") === "events" ||
      search.get("type") === "event";
    if (events) candidates.push(["kind", "events"]);
    candidates.push(["category", search.get("subcategory")]);
  }

  const params = new URLSearchParams({ v: vertical });
  for (const [key, value] of candidates) {
    if (!value) continue;
    params.set(key, value);
    if (!parseBrowse(params)) params.delete(key);
  }
  return parseBrowse(params) ?? defaultBrowse(vertical);
}

/** Link into Video mode; without a browse it opens the remembered section. */
export function videoModeHref(browse: FeedBrowse | null) {
  return browse ? `${VIDEO_MODE_PATH}?${serializeBrowse(browse)}` : VIDEO_MODE_PATH;
}

/** The list page that shows the same posts (desktop visits and "back to list"). */
export function listHrefForBrowse(browse: FeedBrowse) {
  const params = new URLSearchParams();
  if (browse.province) params.set("province", browse.province);
  if (browse.query) params.set("q", browse.query);
  if (browse.vertical === "tourism") {
    if (browse.kind === "events") params.set("tab", "events");
    if (browse.category) params.set("subcategory", browse.category);
  } else if (browse.category) {
    params.set("category", browse.category);
  }
  if (browse.vertical === "market") {
    if (browse.condition) params.set("condition", browse.condition);
    if (browse.sort !== "recommended") params.set("sort", browse.sort);
  }
  const query = params.toString();
  return query ? `${LIST_PATHS[browse.vertical]}?${query}` : LIST_PATHS[browse.vertical];
}

function isVertical(value: unknown): value is FeedVertical {
  return value === "market" || value === "business" || value === "tourism";
}

export function readRememberedVertical(): FeedVertical {
  try {
    const value = window.localStorage.getItem(REMEMBERED_VERTICAL_KEY);
    return isVertical(value) ? value : "market";
  } catch {
    return "market";
  }
}

export function rememberVertical(vertical: FeedVertical) {
  try {
    window.localStorage.setItem(REMEMBERED_VERTICAL_KEY, vertical);
  } catch {
    // Private mode or blocked storage: Market stays the default.
  }
}

/** Where a visitor was in Video mode, kept in the address bar for refresh and back. */
export interface VideoModePosition {
  ctx: string | null;
  post: string | null;
  media: number;
}

const POST_PARAM = /^[0-9a-f-]{36}$/i;
const CTX_PARAM = /^[a-z0-9]{1,20}$/i;

export function readPosition(search: URLSearchParams): VideoModePosition {
  const ctx = search.get("ctx");
  const post = search.get("post");
  const media = Number(search.get("m"));
  return {
    ctx: ctx && CTX_PARAM.test(ctx) ? ctx : null,
    post: post && POST_PARAM.test(post) ? post.toLowerCase() : null,
    media: Number.isInteger(media) && media > 0 && media < 50 ? media : 0,
  };
}

export function positionSearch(browse: FeedBrowse, position: VideoModePosition) {
  const params = new URLSearchParams(serializeBrowse(browse));
  if (position.ctx) params.set("ctx", position.ctx);
  if (position.post) params.set("post", position.post);
  if (position.media > 0) params.set("m", String(position.media));
  return params.toString();
}
