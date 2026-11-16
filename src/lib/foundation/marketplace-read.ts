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
import { readFoundationPostAffiliations } from "./organisations";
import { readFoundationPostSponsorships } from "./organisation-sponsorships";
import {
  presentedFormFields,
  presentedVideoLayout,
  type FrontendPostPresentation,
} from "./post-presentation";

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
  view_count: notAvailable(null, "views are not stored"),
  like_count: notAvailable(null, "likes are not stored"),
  viewer_has_liked: notAvailable(false, "likes are not stored"),
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
  },
  presentation?: FoundationCardPresentation
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
  const formFields = presentedFormFields(frontend, post.kind === "business");
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
    view_count: missing.view_count,
    like_count: missing.like_count,
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
  };
}

/** The reads behind a public post page: the post, its contact channels and its
 * card presentation (business type and form fields). Null when the post is not
 * public. */
/** A publicly live post with its presentation, as its detail page reads it.
 * The link preview asks for one kind and skips the contact-channel read it
 * does not show. */
export async function readRestoredPublicDetail(
  api: FoundationPublicApi,
  id: string,
  options: { kind?: FoundationPublicPostCore["kind"]; withContactChannels?: boolean } = {}
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
  return {
    ...post,
    contact_channels,
    business_type: presentation.business_type,
    frontend: presentation.frontend,
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
/** Deepest result a merged search reads from each scope (ten card reads). Its
 * reported total is capped to the whole pages within this depth, so page links
 * never point past what can be served. */
const MERGED_SEARCH_DEPTH = 480;

/** Cards of one search scope from `start`, at most `want` of them, in bounded
 * reads of 48. Refuses a card of another kind. */
async function readCards(
  api: FoundationPublicApi,
  input: Record<string, unknown>,
  kind: PresentedCard["kind"],
  { start, want }: { start: number; want: number }
) {
  const cards: PresentedCard[] = [];
  let total = 0;
  for (let count = 0; ; count++) {
    if (count >= 200) throw new Error("Public collection is too large to paginate safely");
    const requested = Math.min(48, want - cards.length);
    const offset = start + cards.length;
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

/** The database's result order (internal.search_posts), used to merge scopes:
 * relevance score, then price (missing prices last), then newest, then id. */
function databaseOrder(sort: unknown) {
  return (a: PresentedCard, b: PresentedCard) => {
    if (sort === "relevance") {
      const score = Number(b.score ?? 0) - Number(a.score ?? 0);
      if (score) return score;
    }
    if (sort === "price_asc" || sort === "price_desc") {
      if (a.price_cents === null || b.price_cents === null) {
        if (a.price_cents !== b.price_cents) return a.price_cents === null ? 1 : -1;
      } else {
        const price = Number(a.price_cents) - Number(b.price_cents);
        if (price) return sort === "price_asc" ? price : -price;
      }
    }
    const published = Date.parse(b.published_at) - Date.parse(a.published_at);
    if (published) return published;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  };
}

/** Translate the selected frontend's filters, never send legacy table names,
 * SQL expressions or private fields to the replacement database. */
export async function readRestoredCollection(
  api: FoundationPublicApi,
  collection: PublicCollection,
  params = new URLSearchParams()
) {
  const page = integer(params, "page", 1, 10000);
  const limit = integer(params, "limit", 24, 50);
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
    if (!match) return { rows: [], total: 0, page, limit };
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
    params.forEach((value, key) => {
      if (key.startsWith("attr_"))
        attributes[key.slice(5)] = value === "true" ? true : value === "false" ? false : value;
    });
    if (Object.keys(attributes).length) input.attributes = attributes;
  }
  if (params.get("type") && collection === "businesses") input.business_type = params.get("type");
  const organisation = params.get("org");
  if (organisation && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organisation))
    throw new MarketplaceQueryError("Invalid organisation");
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
  const kind =
    collection === "listings" ? "listing" : collection === "businesses" ? "business" : "event";
  // A text search under Businesses also finds tourism businesses (stays,
  // restaurants, tours), as the chosen frontend's search did. The database
  // keeps them in the tourism area, so both scopes are read and merged in the
  // database's own order (map 03a C8).
  const scopes: Array<Record<string, unknown>> =
    collection === "businesses" && q && !category
      ? [input, { ...input, area: "tourism_events", category: TOURISM_BUSINESS_CATEGORY }]
      : [input];
  const merged = scopes.length > 1;
  const mergedDepth = merged && !organisation ? Math.floor(MERGED_SEARCH_DEPTH / limit) * limit : 0;
  // A page past the served depth is empty, like any page past the end. Its
  // total comes from one one-card read per scope.
  const tooDeep = mergedDepth > 0 && page * limit > mergedDepth;
  for (const scope of scopes) {
    try {
      buildFoundationPostSearch(scope);
    } catch {
      throw new MarketplaceQueryError("Invalid marketplace filters");
    }
  }
  let cards: PresentedCard[] = [];
  let total = 0;
  // Ordinary pages use SQL filtering, ordering, counts and offsets. At most two
  // bounded card reads serve the legacy 50-card viewer batch; no detail fan-out.
  // Organisation relationships remain public, bounded batches until their
  // dedicated directory read gains the same filter contract. A merged search
  // reads each scope from its start up to the requested page.
  for (const scope of scopes) {
    const read = await readCards(api, scope, kind, {
      start: organisation || merged ? 0 : (page - 1) * limit,
      want: organisation ? Number.POSITIVE_INFINITY : tooDeep ? 1 : merged ? page * limit : limit,
    });
    cards.push(...read.cards);
    total += read.total;
  }
  if (mergedDepth) total = Math.min(total, mergedDepth);
  if (tooDeep) return { rows: [], total, page, limit };
  if (merged) cards.sort(databaseOrder(input.sort));
  if (organisation) {
    const affiliated = new Set<string>();
    for (let offset = 0; offset < cards.length; offset += 100) {
      const post_ids = cards.slice(offset, offset + 100).map((row) => row.id);
      const badges = await readFoundationPostAffiliations(api, { post_ids });
      for (const badge of badges)
        if (
          badge.organisation_slug === organisation &&
          (!params.get("programme_name") || badge.programme_name === params.get("programme_name"))
        )
          affiliated.add(badge.post_id);
    }
    cards = cards.filter((row) => affiliated.has(row.id));
    if (params.get("sponsored") === "1") {
      const sponsored = new Set<string>();
      for (let offset = 0; offset < cards.length; offset += 100) {
        const badges = await readFoundationPostSponsorships(api, {
          post_ids: cards.slice(offset, offset + 100).map((row) => row.id),
        });
        for (const badge of badges)
          if (badge.organisation_slug === organisation) sponsored.add(badge.post_id);
      }
      cards = cards.filter((row) => sponsored.has(row.id));
    }
  }
  if (organisation) total = cards.length;
  const selected = organisation || merged ? cards.slice((page - 1) * limit, page * limit) : cards;
  const stickers = await readPublicBusinessStickers(
    api,
    selected.filter((row) => row.kind === "business").map((row) => row.id)
  );
  const mapped = selected.map((row) => {
    const view = restoredPublicRow(row, undefined, row.presentation);
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
