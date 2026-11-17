import { z } from "zod";

/**
 * Public pages whose address names one record (a post, an organisation) or
 * that are hidden by a switch (the multi-listing page). Each page calls
 * notFound() when its record is missing, but by then streaming has already
 * sent "200 OK", so the proxy answers these addresses' status before rendering
 * (see proxy-handler.ts). Matching here is pure: no database read.
 */
export type DetailPage =
  | { area: "listing" | "business" | "tourism"; id: string }
  | { area: "organisation"; slug: string }
  | { area: "multi-listing" };

const POST_PAGES: ReadonlyArray<readonly [RegExp, "listing" | "business" | "tourism"]> = [
  [/^\/listing\/([^/]+)$/, "listing"],
  [/^\/mzansi-business\/([^/]+)$/, "business"],
  [/^\/tourism-events\/([^/]+)$/, "tourism"],
];
const ORGANISATION_PAGE = /^\/organisation\/([^/]+)$/;

/** The rule the post pages apply before any read (restoredPublicDetail). */
const postId = z.uuid();
/** The organisation slug rule of the page and of api.get_public_organisation
 * (src/lib/foundation/organisations.ts `slug`): no other slug can exist. */
const organisationSlug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .min(3)
  .max(60);

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The detail page an address opens, or null for any other address. */
export function matchDetailPage(pathname: string): DetailPage | null {
  if (pathname === "/pricing/multi-listing") return { area: "multi-listing" };
  for (const [pattern, area] of POST_PAGES) {
    const match = pattern.exec(pathname);
    if (match) return { area, id: decodeSegment(match[1]) ?? "" };
  }
  const organisation = ORGANISATION_PAGE.exec(pathname);
  if (organisation) return { area: "organisation", slug: decodeSegment(organisation[1]) ?? "" };
  return null;
}

/** True when the address cannot name any record: the page is certainly "not found". */
export function detailPageKeyIsMalformed(page: DetailPage): boolean {
  if (page.area === "multi-listing") return false;
  if (page.area === "organisation") return !organisationSlug.safeParse(page.slug).success;
  return !postId.safeParse(page.id).success;
}
