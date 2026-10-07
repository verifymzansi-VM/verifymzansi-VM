import "server-only";

import { withPublicName } from "@/lib/account/public-name";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessDetailRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import type { ListingDetailRecord } from "@/components/listings/listing-detail-content";
import type { PromotionDetailRecord } from "@/components/listings/promotion-detail-content";
import {
  ACCOUNT_PROFILE_TABLE,
  getOwnerColumn,
  normalizeOwnerRecords,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { selectBusinessWithFallback } from "@/lib/business/business-detail-select";
import { CARD_STICKER_COLUMNS, toPublicVerification } from "@/lib/business-verification/public";
import { withVisibleBusinessPrivateFields } from "@/lib/content/private-fields";
import type { ContentTargetType } from "@/lib/engagement";
import {
  getOptionalContentShareCountMap,
  getOptionalContentLikeSummaryMap,
  getOptionalContentViewCountMap,
} from "@/lib/engagement-server";
import {
  presentBusinessSlide,
  presentEventSlide,
  presentListingSlide,
  type EngagementInput,
  type LinkedBusinessInput,
  type OwnerSummaryInput,
} from "@/lib/feed/presenters";
import { refKey } from "@/lib/feed/refs";
import type { FeedRef, FeedSlide } from "@/lib/feed/types";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { PROMOTION_DETAIL_SELECT } from "@/lib/promotions/detail-select";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";

/** Public listing columns only; never select("*") into something sent to browsers. */
const LISTING_SLIDE_SELECT =
  "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, location_suburb, contact_methods, created_at, media_width, media_height, focal_x, focal_y";

const BUSINESS_POST_SELECT =
  "id, business_id, title, photos, video_thumbnail, start_date, location_city";

export interface SlideLoadContext {
  /** The visitor's own client: RLS still applies to what they can read. */
  supabase: SupabaseClient;
  /** Service client for owner names and engagement totals, when configured. */
  admin: SupabaseClient | null;
  viewerKey: string | null;
}

type Row = Record<string, unknown>;

async function ownerProfiles(
  context: SlideLoadContext,
  ownerIds: string[],
  withPhone: boolean
): Promise<Map<string, OwnerSummaryInput>> {
  if (ownerIds.length === 0) return new Map();
  const { data } = await (context.admin ?? context.supabase)
    .from(ACCOUNT_PROFILE_TABLE)
    .select(
      withPhone
        ? "user_id, display_name, account_verification_status, phone"
        : "user_id, display_name, account_verification_status"
    )
    .in("user_id", ownerIds);
  return new Map(
    ((data ?? []) as unknown as Array<OwnerSummaryInput & { user_id: string }>).map((row) => [
      row.user_id,
      withPublicName(row),
    ])
  );
}

async function engagementFor(
  context: SlideLoadContext,
  type: ContentTargetType,
  ids: string[]
): Promise<(id: string) => EngagementInput> {
  if (ids.length === 0) return () => ({ views: 0, likes: 0, viewerHasLiked: false });
  const [views, likes, shares] = await Promise.all([
    getOptionalContentViewCountMap(context.admin, type, ids),
    getOptionalContentLikeSummaryMap(context.admin, type, ids, context.viewerKey),
    getOptionalContentShareCountMap(context.admin, type, ids),
  ]);
  return (id) => ({
    views: views.ok ? (views.data.get(id) ?? 0) : 0,
    likes: likes.ok ? (likes.data.get(id)?.likeCount ?? 0) : 0,
    viewerHasLiked: likes.ok ? (likes.data.get(id)?.viewerHasLiked ?? false) : false,
    shares: shares.get(id) ?? null,
  });
}

async function loadListingSlides(context: SlideLoadContext, ids: string[]) {
  const slides = new Map<string, FeedSlide>();
  if (ids.length === 0) return slides;
  const ownerColumn = await getOwnerColumn(context.supabase, "listings");
  const { data } = await applyVisibleExpiryFilter(
    context.supabase
      .from("listings")
      .select(withOwnerColumn(LISTING_SLIDE_SELECT, ownerColumn))
      .eq("status", "live")
      .in("id", ids)
  );
  const rows = normalizeOwnerRecords(
    (data ?? []) as unknown as Row[]
  ) as unknown as ListingDetailRecord[];
  const visible = rows.filter(
    (row) => !isPlaceholderMarketplaceContent(row.title, row.description)
  );
  const owners = await ownerProfiles(
    context,
    [...new Set(visible.map((row) => readOwnerId(row)).filter((id): id is string => Boolean(id)))],
    true
  );
  const engagement = await engagementFor(
    context,
    "listing",
    visible.map((row) => row.id)
  );
  for (const row of visible) {
    const owner = owners.get(readOwnerId(row) ?? "") ?? null;
    slides.set(row.id, presentListingSlide(row, owner, engagement(row.id)));
  }
  return slides;
}

async function loadBusinessSlides(context: SlideLoadContext, ids: string[]) {
  const slides = new Map<string, FeedSlide>();
  if (ids.length === 0) return slides;
  const ownerColumn = await getOwnerColumn(context.supabase, "businesses");
  const { data } = await selectBusinessWithFallback<Row[]>((selectClause) =>
    applyVisibleExpiryFilter(
      context.supabase
        .from("businesses")
        .select(withOwnerColumn(selectClause, ownerColumn))
        .eq("status", "live")
        .in("id", ids)
    )
  );
  // Public slides: the street address only when published, contact details
  // never (they're revealed on tap); flags say which contact methods exist.
  const rows = (await withVisibleBusinessPrivateFields(
    normalizeOwnerRecords((data ?? []) as Row[]) as unknown as Array<
      BusinessDetailRecord & { owner_id?: string | null }
    >,
    null
  )) as unknown as BusinessDetailRecord[];
  const visible = rows.filter(
    (row) =>
      row.business_name && !isPlaceholderMarketplaceContent(row.business_name, row.description)
  );
  if (visible.length === 0) return slides;
  const visibleIds = visible.map((row) => row.id);
  const [owners, engagement, posts] = await Promise.all([
    ownerProfiles(
      context,
      [
        ...new Set(
          visible.map((row) => readOwnerId(row)).filter((id): id is string => Boolean(id))
        ),
      ],
      false
    ),
    engagementFor(context, "business", visibleIds),
    applyVisibleExpiryFilter(
      context.supabase
        .from("promotions")
        .select(BUSINESS_POST_SELECT)
        .eq("status", "live")
        .in("business_id", visibleIds)
    )
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const postsByBusiness = new Map<string, BusinessPromotionRecord[]>();
  for (const post of (posts.data ?? []) as unknown as Array<
    BusinessPromotionRecord & { business_id: string }
  >) {
    postsByBusiness.set(post.business_id, [...(postsByBusiness.get(post.business_id) ?? []), post]);
  }
  for (const row of visible) {
    slides.set(
      row.id,
      presentBusinessSlide(
        row,
        owners.get(readOwnerId(row) ?? "") ?? null,
        postsByBusiness.get(row.id) ?? [],
        engagement(row.id)
      )
    );
  }
  return slides;
}

async function loadEventSlides(context: SlideLoadContext, ids: string[]) {
  const slides = new Map<string, FeedSlide>();
  if (ids.length === 0) return slides;
  const { data } = await applyVisibleExpiryFilter(
    context.supabase
      .from("promotions")
      .select(PROMOTION_DETAIL_SELECT)
      .eq("status", "live")
      .in("id", ids)
  );
  const rows = normalizeOwnerRecords(
    (data ?? []) as unknown as Row[]
  ) as unknown as PromotionDetailRecord[];
  const visible = rows.filter(
    (row) => !isPlaceholderMarketplaceContent(row.title, row.description)
  );
  if (visible.length === 0) return slides;
  const businessIds = [
    ...new Set(visible.map((row) => row.business_id).filter((id): id is string => Boolean(id))),
  ];
  const [owners, engagement, businesses] = await Promise.all([
    ownerProfiles(
      context,
      [
        ...new Set(
          visible.map((row) => readOwnerId(row)).filter((id): id is string => Boolean(id))
        ),
      ],
      true
    ),
    engagementFor(
      context,
      "promotion",
      visible.map((row) => row.id)
    ),
    businessIds.length > 0
      ? applyVisibleExpiryFilter(
          context.supabase
            .from("businesses")
            .select(
              `id, owner_id, business_name, logo_url, ${CARD_STICKER_COLUMNS}, owner_verified_role, owner_position_title`
            )
            .eq("status", "live")
            .in("id", businessIds)
        )
      : Promise.resolve({ data: [] }),
  ]);
  const businessById = new Map(
    ((businesses.data ?? []) as LinkedBusinessInput[]).map((business) => [
      business.id,
      toPublicVerification(business),
    ])
  );
  for (const row of visible) {
    slides.set(
      row.id,
      presentEventSlide(
        row,
        owners.get(readOwnerId(row) ?? "") ?? null,
        row.business_id ? (businessById.get(row.business_id) ?? null) : null,
        engagement(row.id)
      )
    );
  }
  return slides;
}

/**
 * Slides for a batch of refs, keyed by `refKey`. A ref that is no longer
 * public (removed, expired, placeholder) maps to null so the browser can skip
 * it. Tourism refs are tried as businesses first, then as events.
 */
export async function loadFeedSlides(
  context: SlideLoadContext,
  refs: FeedRef[]
): Promise<Map<string, FeedSlide | null>> {
  const ids = (kind: FeedRef["kind"]) =>
    refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
  const tourismIds = ids("t");
  const [listings, businesses, events] = await Promise.all([
    loadListingSlides(context, ids("l")),
    loadBusinessSlides(context, [...ids("b"), ...tourismIds]),
    loadEventSlides(context, [...ids("p"), ...tourismIds]),
  ]);

  const result = new Map<string, FeedSlide | null>();
  for (const ref of refs) {
    const slide =
      ref.kind === "l"
        ? listings.get(ref.id)
        : ref.kind === "b"
          ? businesses.get(ref.id)
          : ref.kind === "p"
            ? events.get(ref.id)
            : (businesses.get(ref.id) ?? events.get(ref.id));
    result.set(refKey(ref), slide ?? null);
  }
  return result;
}
