import "server-only";
import type { DetailPage } from "@/lib/routing/detail-pages";
import { readFoundationPublicOrganisation } from "./organisations";
import { readFoundationPublicPost } from "./public-post";
import { foundationServerPublicApi } from "./server-public";

/**
 * Whether a well-formed detail address names nothing, read before the page
 * renders so the proxy can answer a real 404 (the page's own notFound() comes
 * after streaming has sent 200). Narrow on purpose:
 *
 * - true only when the read succeeded and found nothing the page would show
 *   (no public post of that page's kinds, no listed organisation). The page
 *   still makes its own, finer check.
 * - false when a read fails or is slow: the page renders as before.
 * - answers that a post or organisation exists are kept for a minute per
 *   server instance, so a busy post costs one extra read a minute, not one per
 *   view. A post that goes offline within that minute shows the page's "not
 *   available" design with 200 until the answer expires, as before. Missing
 *   answers are not kept: a new post is found at once.
 */
export interface MissingDetailPageReads {
  postKind(id: string): Promise<"listing" | "business" | "event" | null>;
  organisationListed(slug: string): Promise<boolean>;
}

const ANSWER_TTL_MS = 60_000;
const MAX_REMEMBERED = 1_000;
const READ_TIMEOUT_MS = 1_500;

const POST_PAGE_KINDS: Record<"listing" | "business" | "tourism", readonly string[]> = {
  listing: ["listing"],
  business: ["business"],
  // A tourism address shows a tourism business or an event.
  tourism: ["business", "event"],
};

const remembered = new Map<string, { value: string; until: number }>();

const defaultReads: MissingDetailPageReads = {
  async postKind(id) {
    return (await readFoundationPublicPost(foundationServerPublicApi(), { id }))?.kind ?? null;
  },
  async organisationListed(slug) {
    return (await readFoundationPublicOrganisation(foundationServerPublicApi(), { slug })) !== null;
  },
};

function withinTimeout<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    read(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Detail page read timed out")), READ_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function recall(key: string, at: number): string | null {
  const entry = remembered.get(key);
  if (!entry) return null;
  if (entry.until > at) return entry.value;
  remembered.delete(key);
  return null;
}

function remember(key: string, value: string, at: number) {
  remembered.delete(key);
  if (remembered.size >= MAX_REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  remembered.set(key, { value, until: at + ANSWER_TTL_MS });
}

export async function isMissingDetailPage(
  page: DetailPage,
  reads: MissingDetailPageReads = defaultReads,
  now: () => number = Date.now
): Promise<boolean> {
  try {
    if (page.area === "organisation") {
      const key = `organisation:${page.slug}`;
      if (recall(key, now())) return false;
      const listed = await withinTimeout(() => reads.organisationListed(page.slug));
      if (listed) remember(key, "listed", now());
      return !listed;
    }

    const key = `post:${page.id}`;
    let kind = recall(key, now());
    if (kind === null) {
      kind = await withinTimeout(() => reads.postKind(page.id));
      if (kind === null) return true;
      remember(key, kind, now());
    }
    return !POST_PAGE_KINDS[page.area].includes(kind);
  } catch {
    return false;
  }
}

/** Tests only: forget remembered answers. */
export function forgetMissingDetailPageAnswers() {
  remembered.clear();
}
