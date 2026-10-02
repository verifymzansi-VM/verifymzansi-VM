import type { FeedRef, FeedRefKind, FeedSlideKind, FeedTable } from "@/lib/feed/types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`, "i");
const DETAIL_PATH_PATTERN = new RegExp(
  `^/(listing|mzansi-business|tourism-events)/(${UUID})(?:/?(?:[?#]|$))`,
  "i"
);

const PATH_KINDS: Record<string, FeedRefKind> = {
  listing: "l",
  "mzansi-business": "b",
  // Tourism businesses and events share this route; the server resolves which.
  "tourism-events": "t",
};

export const TABLE_REF_KINDS: Record<FeedTable, Exclude<FeedRefKind, "t">> = {
  listings: "l",
  businesses: "b",
  promotions: "p",
};

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

/** The post a public detail link points at, or null for any other link. */
export function refFromHref(href: string | null | undefined, origin?: string): FeedRef | null {
  if (!href) return null;
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (origin && url.origin !== origin) return null;
      path = `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  const match = path.match(DETAIL_PATH_PATTERN);
  if (!match) return null;
  return { kind: PATH_KINDS[match[1].toLowerCase()], id: match[2].toLowerCase() };
}

export function refKey(ref: FeedRef) {
  return `${ref.kind}:${ref.id}`;
}

/** Compact wire form: "l.<uuid>". */
export function encodeRef(ref: FeedRef) {
  return `${ref.kind}.${ref.id}`;
}

export function decodeRef(value: string): FeedRef | null {
  const [kind, id] = value.split(".");
  if (!id || !["l", "b", "p", "t"].includes(kind) || !isUuid(id)) return null;
  return { kind: kind as FeedRefKind, id: id.toLowerCase() };
}

/** Same post? An unresolved tourism ref matches the business or event it resolves to. */
export function sameRef(a: FeedRef, b: FeedRef) {
  if (a.id !== b.id) return false;
  return a.kind === b.kind || a.kind === "t" || b.kind === "t";
}

export function slideRef(slide: { table: FeedTable; id: string }): FeedRef {
  return { kind: TABLE_REF_KINDS[slide.table], id: slide.id };
}

export function canonicalHref(kind: FeedSlideKind, id: string) {
  if (kind === "listing") return `/listing/${id}`;
  if (kind === "business") return `/mzansi-business/${id}`;
  return `/tourism-events/${id}`;
}

/** Unique refs in first-seen order; later duplicates (carousel clones, repeats) drop out. */
export function dedupeRefs(refs: FeedRef[]): FeedRef[] {
  const seen = new Set<string>();
  const result: FeedRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    result.push(ref);
  }
  return result;
}
