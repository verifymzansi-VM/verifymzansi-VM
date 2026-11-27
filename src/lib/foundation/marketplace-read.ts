import type { FoundationPublicApi } from "./public-api";
import { declareNotAvailable, notAvailable } from "./not-available";
import { readPublicBusinessStickers } from "./business-seen";
import {
  searchFoundationPresentedCards,
  foundationMediaUrl,
  type FoundationCardPresentation,
} from "./public-cards";
import {
  readFoundationPublicContactChannels,
  readFoundationPublicPost,
  type FoundationPublicPostDetail,
} from "./public-post";
import type { FoundationPublicPostCore } from "./public-post-contract";
import reference from "../domains/taxonomy/reference.json";
import { buildFoundationPostSearch } from "./post-search";
import { SEARCH_MAX_OFFSET, searchLastPage } from "./search-depth";
import {
  businessContactAvailability,
  presentedFormFields,
  presentedVideoLayout,
  type FrontendPostPresentation,
} from "./post-presentation";
import { readFoundationPostEngagement, type PostEngagement } from "./post-engagement";
import { SHOW_BUSINESS_STOREFRONT, SHOW_ENGAGEMENT_TOTALS } from "../hidden-features";
import { z } from "zod";

export type PublicCollection = "listings" | "businesses" | "promotions";
export class MarketplaceQueryError extends Error {
  override name = "MarketplaceQueryError";
}

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
export function publicProvinceLabel(id: string) {
  return reference.provinces.find((row) => row.id === id)?.label ?? id;
}

/** Public post fields the live backend does not provide on any public read. */
export const PUBLIC_POST_NOT_AVAILABLE = declareNotAvailable({
  boost_until: notAvailable(null, "public reads carry no paid Boost placement"),
  featured_until: notAvailable(null, "public reads carry no paid Featured placement"),
  featured: notAvailable(false, "public reads carry no paid Featured placement"),
  viewer_has_liked: notAvailable(
    false,
    "public reads are the same for everyone; the like button reads the browser's own likes"
  ),
  location_suburb: notAvailable(null, "posts keep a province and city only"),
  account_profile: notAvailable(null, "public reads never carry the owner's profile"),
});
/** Public post fields only a detail read provides: cards from a collection
 * read leave them at these placeholders. */
export const PUBLIC_CARD_NOT_AVAILABLE = declareNotAvailable({
  seller: notAvailable(null, "the card read carries no seller; the detail read does"),
  contact_methods: notAvailable([], "the card read carries no contact channels"),
});

/** Only approved public DTOs enter the restored cards. Missing private/paid
 * facts stay absent; a card never acquires an owner id or a verification badge. */
export function restoredPublicRow(
  post: FoundationPublicPostCore & {
    summary?: string;
    preview?: { image_key: string | null; video_key: string | null };
  },
  detail?: FoundationPublicPostDetail & {
    contact_channels?: string[];
    business_type?: string | null;
    frontend?: FrontendPostPresentation;
    engagement?: PostEngagement | null;
  },
  presentation?: FoundationCardPresentation,
  engagement: PostEngagement | null = detail?.engagement ?? null
) {
  const media = detail?.media ?? [];
  const images = media.filter((row) => row.kind === "image" && row.purpose !== "logo");
  const cover = images.find((row) => row.purpose === "cover") ?? images[0];
  const photo = foundationMediaUrl(cover?.object_key ?? post.preview?.image_key);
  const videos = media
    .filter((row) => row.kind === "video")
    .sort((a, b) => a.position - b.position)
    .map((row) => foundationMediaUrl(row.object_key)!);
  if (!videos.length && post.preview?.video_key)
    videos.push(foundationMediaUrl(post.preview.video_key)!);
  const eventWindow = detail?.event_window ?? presentation?.event_window;
  const frontend = detail?.frontend ?? presentation?.frontend;
  const formFields = presentedFormFields(frontend);
  const videoLayout = videos.length ? presentedVideoLayout(frontend) : null;
  const firstVideo = media.find((row) => row.kind === "video" && row.position === 0);
  if (post.kind === "listing") delete formFields.location_address;
  const ticketPrice =
    post.kind === "event" &&
    typeof frontend?.data.ticket_price_cents === "number" &&
    Number.isSafeInteger(frontend.data.ticket_price_cents) &&
    frontend.data.ticket_price_cents >= 0
      ? frontend.data.ticket_price_cents
      : null;
  const photos = images.length
    ? images.map((row) => foundationMediaUrl(row.object_key)!)
    : photo
      ? [photo]
      : [];
  const missing = PUBLIC_POST_NOT_AVAILABLE.values();
  const cardOnly = PUBLIC_CARD_NOT_AVAILABLE.values();
  return {
    id: post.id,
    title: post.title,
    business_name: post.title,
    description: detail?.description ?? post.summary ?? "",
    category:
      post.kind === "event" && typeof frontend?.data.category_label === "string"
        ? frontend.data.category_label
        : post.category,
    category_key: post.kind === "event" ? null : post.category,
    subcategory: post.activity,
    business_type: detail?.business_type ?? presentation?.business_type ?? "",
    promotion_type: "event" as const,
    price_mode: post.price_mode,
    price_cents:
      post.kind === "event"
        ? ticketPrice
        : post.price_cents === null
          ? null
          : Number(post.price_cents),
    price_negotiable: post.price_negotiable,
    condition: post.condition,
    location_province: publicProvinceLabel(post.province),
    location_city: post.locality,
    location_suburb: missing.location_suburb,
    location_town: null,
    location_address: null,
    created_at: post.published_at,
    updated_at: post.published_at,
    photos,
    videos,
    video_thumbnail: photo,
    cover_photo: photo,
    cover_video: videos[0] ?? null,
    gallery_photos: photos,
    logo_url: foundationMediaUrl(media.find((row) => row.purpose === "logo")?.object_key),
    focal_x: firstVideo?.focal_x ?? cover?.focal_x ?? null,
    focal_y: firstVideo?.focal_y ?? cover?.focal_y ?? null,
    media_width: videoLayout?.width ?? cover?.width ?? null,
    media_height: videoLayout?.height ?? cover?.height ?? null,
    boost_until: missing.boost_until,
    featured_until: missing.featured_until,
    featured: missing.featured,
    // Totals while SHOW_ENGAGEMENT_TOTALS is on (readPublicEngagement), else null.
    view_count: engagement?.views ?? null,
    like_count: engagement?.likes ?? null,
    viewer_has_liked: missing.viewer_has_liked,
    seller: detail
      ? {
          display_name: detail.seller.public_name,
          account_verification_status: detail.seller.identity_verified ? "verified" : null,
        }
      : cardOnly.seller,
    account_profile: missing.account_profile,
    business_id: null,
    start_date: eventWindow?.starts_at ?? null,
    end_date: eventWindow?.ends_at ?? null,
    status: "live",
    attributes: {},
    contact_methods: detail?.contact_channels ?? cardOnly.contact_methods,
    category_details: null,
    business_details: null,
    service_areas: null,
    social_links: null,
    operating_hours: null,
    services_offered: null,
    payment_methods_accepted: null,
    delivery_options: null,
    website: null,
    store_number: null,
    ...formFields,
    // Business numbers are served only by the click-to-view route
    // (/api/contact/reveal); the page knows which channels it can ask for.
    phone: null,
    whatsapp: null,
    contact_available: post.kind === "business" ? businessContactAvailability(frontend) : undefined,
  };
}

/** The reads behind a public post page: the post, its contact channels and its
 * card presentation (business type and form fields). Null when the post is not
 * public. */
/** A publicly live post with its presentation, as its detail page reads it.
 * The link preview asks for one kind and skips the contact-channel and
 * engagement reads it does not show. */
export async function readRestoredPublicDetail(
  api: FoundationPublicApi,
  id: string,
  options: {
    kind?: FoundationPublicPostCore["kind"];
    withContactChannels?: boolean;
    withEngagement?: boolean;
  } = {}
) {
  const post = await readFoundationPublicPost(api, { id });
  if (!post || (options.kind && post.kind !== options.kind)) return null;
  const contact_channels =
    options.withContactChannels === false
      ? []
      : await readFoundationPublicContactChannels(api, { id });
  const presentation = (
    await searchFoundationPresentedCards(api, { post_id: id, offset: 0, limit: 1 })
  ).items[0]?.presentation;
  if (!presentation) return null;
  const engagement =
    options.withEngagement === false
      ? null
      : ((await readPublicEngagement(api, [id])).get(id) ?? null);
  return {
    ...post,
    contact_channels,
    business_type: presentation.business_type,
    frontend: presentation.frontend,
    engagement,
  };
}

function integer(params: URLSearchParams, key: string, fallback: number, max: number) {
  const raw = params.get(key);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)
    throw new MarketplaceQueryError(`Invalid ${key}`);
  return Number(raw);
}

type PresentedCard = Awaited<ReturnType<typeof searchFoundationPresentedCards>>["items"][number];

/** The tourism area's business category (stays, restaurants, tours). */
const TOURISM_BUSINESS_CATEGORY = "tourism_hospitality";
/** Cards from `start`, at most `want` (up to 50) of them, in reads of up to 48,
 * never from past the deepest offset the database serves. Refuses a card of
 * another kind. */
async function readCards(
  api: FoundationPublicApi,
  input: Record<string, unknown>,
  kind: PresentedCard["kind"],
  { start, want }: { start: number; want: number }
) {
  const cards: PresentedCard[] = [];
  let total = 0;
  for (;;) {
    const requested = Math.min(48, want - cards.length);
    const offset = start + cards.length;
    if (offset > SEARCH_MAX_OFFSET) break;
    const result = await searchFoundationPresentedCards(api, {
      ...input,
      offset,
      limit: requested,
    });
    if (result.items.some((row) => row.kind !== kind))
      throw new Error("Invalid public collection response");
    total = result.total;
    cards.push(...result.items);
    if (
      result.items.length < requested ||
      offset + result.items.length >= total ||
      cards.length >= want
    )
      break;
  }
  return { cards, total };
}

/**
 * View and like totals for public cards and pages, only while
 * SHOW_ENGAGEMENT_TOTALS is on (no read otherwise). Counts are never worth a
 * failed page: a failed read leaves them out (null).
 */
export async function readPublicEngagement(
  api: FoundationPublicApi,
  ids: readonly string[]
): Promise<Map<string, PostEngagement>> {
  if (!SHOW_ENGAGEMENT_TOTALS || ids.length === 0) return new Map();
  try {
    return await readFoundationPostEngagement(api, ids);
  } catch {
    return new Map();
  }
}

/** Translate the selected frontend's filters, never send legacy table names,
 * SQL expressions or private fields to the replacement database. The search
 * request for one page of a collection; `input` is null when a filter can
 * match nothing (an unknown city). */
export function restoredCollectionSearch(
  collection: PublicCollection,
  params = new URLSearchParams()
) {
  const limit = integer(params, "limit", 24, 50);
  // Page links stop at the deepest page served (search-depth.ts); a deeper
  // page number shows that last page, so old or hand-typed links still work.
  const page = Math.min(integer(params, "page", 1, 10000), searchLastPage(limit));
  const tourism =
    collection === "businesses" && params.get("category") === TOURISM_BUSINESS_CATEGORY;
  const area =
    collection === "listings"
      ? "market"
      : collection === "promotions" || tourism
        ? "tourism_events"
        : "business";
  const category = collection === "promotions" ? "events" : params.get("category") || undefined;
  if (category && !reference.categories.some((row) => row.key === category && row.area === area))
    throw new MarketplaceQueryError("Invalid category");
  const input: Record<string, unknown> = { area, limit: 48 };
  if (category) input.category = category;
  const q = params.get("q")?.trim();
  if (q) {
    if (q.length > 200) throw new MarketplaceQueryError("Search is too long");
    input.q = q;
    input.sort = "relevance";
  }
  const province = params.get("province");
  if (province) {
    const match = reference.provinces.find((row) =>
      [row.id, row.code, row.label].some((value) => normalized(value) === normalized(province))
    );
    if (!match) throw new MarketplaceQueryError("Invalid province");
    input.province = match.id;
  }
  const city = params.get("city");
  if (city) {
    const match = reference.cities.find(
      (row) =>
        (!input.province || row.province === input.province) &&
        [row.id, row.label, ...row.aliases].some((value) => normalized(value) === normalized(city))
    );
    if (!match) return { input: null, page, limit };
    input.city = match.id;
    input.province = match.province;
  }
  const activity = params.get("subcategory") || params.get("event_type");
  if (activity) input.activity = activity;
  if (collection === "listings") {
    if (params.get("condition")) input.condition = params.get("condition");
    for (const [from, to] of [
      ["minPrice", "min_price_cents"],
      ["maxPrice", "max_price_cents"],
    ]) {
      const raw = params.get(from!);
      if (raw !== null) {
        const amount = Number(raw);
        if (!raw.trim() || !Number.isFinite(amount) || amount < 0)
          throw new MarketplaceQueryError("Invalid price");
        input[to!] = Math.round(amount * 100);
        input.price_mode = "amount";
      }
    }
    const attributes: Record<string, unknown> = {};
    const ranges = new Set<string>();
    params.forEach((value, key) => {
      if (!key.startsWith("attr_")) return;
      // The storefront's number ranges (item 17b): attr_<field>_min and
      // attr_<field>_max (year, bedrooms), whole numbers of up to 9 digits.
      const range = SHOW_BUSINESS_STOREFRONT ? /^attr_(.+)_(min|max)$/.exec(key) : null;
      if (range) {
        if (!/^\d{1,9}$/.test(value)) throw new MarketplaceQueryError("Invalid range");
        const bounds = (attributes[range[1]!] ?? {}) as Record<string, number>;
        attributes[range[1]!] = { ...bounds, [range[2]!]: Number(value) };
        ranges.add(range[1]!);
        return;
      }
      attributes[key.slice(5)] = value === "true" ? true : value === "false" ? false : value;
    });
    // A field filtered both by value and by range is refused, whatever the order.
    for (const field of ranges)
      if (params.has(`attr_${field}`)) throw new MarketplaceQueryError("Invalid range");
    if (Object.keys(attributes).length) input.attributes = attributes;
    // A business's storefront, with its vehicle make filter (item 17b).
    const storefront = params.get("storefront");
    const make = params.get("make");
    if (storefront !== null || make !== null) {
      if (!SHOW_BUSINESS_STOREFRONT || !storefront || !z.uuid().safeParse(storefront).success)
        throw new MarketplaceQueryError("Invalid storefront");
      input.storefront = storefront;
      if (make !== null) {
        if (!make.trim() || make.length > 80 || /[\u0000-\u001f\u007f]/.test(make))
          throw new MarketplaceQueryError("Invalid make");
        input.make = make;
      }
    }
  }
  if (params.get("type") && collection === "businesses") input.business_type = params.get("type");
  // One organisation's supported businesses, optionally one of its
  // programmes or its sponsored businesses.
  const organisation = params.get("org");
  if (organisation) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organisation))
      throw new MarketplaceQueryError("Invalid organisation");
    input.organisation = organisation;
    const programme = params.get("programme");
    if (programme) {
      if (!z.uuid().safeParse(programme).success)
        throw new MarketplaceQueryError("Invalid programme");
      input.programme = programme;
    }
    if (params.get("sponsored") === "1") input.sponsored = true;
  }
  const sort = params.get("sort") || "recommended";
  if (!["recommended", "newest", "price_asc", "price_desc", "popular"].includes(sort))
    throw new MarketplaceQueryError("Invalid sort");
  if (sort === "newest") input.sort = "newest";
  if (sort === "price_asc" || sort === "price_desc") input.sort = sort;
  if (collection === "promotions") {
    input.event_state = params.get("event_state") || "active";
    if (params.get("event_order")) input.event_order = params.get("event_order");
  }
  input.offset = (page - 1) * limit;
  // A text search under Businesses also finds tourism businesses (stays,
  // restaurants, tours), as the chosen frontend's search did. The database
  // keeps them in the tourism area, so the search asks for every business
  // instead of one area (map 03a C8).
  if (collection === "businesses" && q && !category) {
    delete input.area;
    input.kind = "business";
  }
  try {
    buildFoundationPostSearch(input);
  } catch {
    throw new MarketplaceQueryError("Invalid marketplace filters");
  }
  return { input, page, limit };
}

/** One page of a public collection: its cards from one filtered, ordered and
 * counted database read, with their stickers and totals. */
export async function readRestoredCollection(
  api: FoundationPublicApi,
  collection: PublicCollection,
  params = new URLSearchParams()
) {
  const { input, page, limit } = restoredCollectionSearch(collection, params);
  if (!input) return { rows: [], total: 0, page, limit };
  const kind =
    collection === "listings" ? "listing" : collection === "businesses" ? "business" : "event";
  // At most two bounded card reads serve a 50-card page; no detail fan-out.
  const { cards: selected, total } = await readCards(api, input, kind, {
    start: (page - 1) * limit,
    want: limit,
  });
  const stickers = await readPublicBusinessStickers(
    api,
    selected.filter((row) => row.kind === "business").map((row) => row.id)
  );
  const engagement = await readPublicEngagement(
    api,
    selected.map((row) => row.id)
  );
  const mapped = selected.map((row) => {
    const view = restoredPublicRow(
      row,
      undefined,
      row.presentation,
      engagement.get(row.id) ?? null
    );
    const sticker = stickers.get(row.id);
    return sticker ? { ...view, ...sticker } : view;
  });
  return {
    rows: mapped,
    total,
    page,
    limit,
  };
}
