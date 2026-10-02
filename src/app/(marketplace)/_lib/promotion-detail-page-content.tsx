import { notFound } from "next/navigation";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { ACCOUNT_PROFILE_TABLE, normalizeOwnerRecord, readOwnerId } from "@/lib/account/compat";
import {
  getOptionalContentLikeSummaryMap,
  getOptionalContentViewCountMap,
} from "@/lib/engagement-server";
import { buildViewerKey, ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";
import { ImmersiveDetailGate } from "@/components/immersive/immersive-detail-gate";
import { isImmersiveDetailEnabled } from "@/lib/feed/flag";
import { presentEventSlide } from "@/lib/feed/presenters";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PROMOTION_DETAIL_SELECT } from "@/lib/promotions/detail-select";

export async function generatePromotionDetailMetadata(id: string): Promise<Metadata> {
  const supabase = await createClient();
  const { data: promotion } = await applyVisibleExpiryFilter(
    supabase.from("promotions").select("title, description").eq("id", id).eq("status", "live")
  ).single();

  if (!promotion) {
    return { title: "Tourism & Events Listing Not Found" };
  }

  return {
    title: `${promotion.title} | Tourism & Events`,
    description: promotion.description?.slice(0, 160),
    alternates: {
      canonical: `/tourism-events/${id}`,
    },
  };
}

export async function PromotionDetailPageContent({ id }: { id: string }) {
  const supabase = await createClient();
  const engagementAdmin = tryCreateAdminClient();
  const { data: rawPromotion } = await applyVisibleExpiryFilter(
    supabase.from("promotions").select(PROMOTION_DETAIL_SELECT).eq("id", id).eq("status", "live")
  ).single();

  const promotion = rawPromotion ? normalizeOwnerRecord(rawPromotion) : null;

  if (!promotion) {
    notFound();
  }

  const promotionOwnerId = readOwnerId(promotion);
  const { data: advertiserProfile } = promotionOwnerId
    ? await (engagementAdmin ?? supabase)
        .from(ACCOUNT_PROFILE_TABLE)
        .select("display_name, account_verification_status, phone")
        .eq("user_id", promotionOwnerId)
        .maybeSingle()
    : { data: null };

  const linkedBusiness = promotion.business_id
    ? (
        await applyVisibleExpiryFilter(
          supabase
            .from("businesses")
            .select("id, business_name, logo_url")
            .eq("id", promotion.business_id)
            .eq("status", "live")
        ).maybeSingle()
      ).data
    : null;
  const cookieStore = await getOptionalCookieStore();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = readCookieValue(cookieStore, ENGAGEMENT_VIEWER_COOKIE) ?? null;
  const [promotionViewCounts, promotionLikes, immersiveEnabled] = await Promise.all([
    getOptionalContentViewCountMap(engagementAdmin, "promotion", [promotion.id]),
    getOptionalContentLikeSummaryMap(
      engagementAdmin,
      "promotion",
      [promotion.id],
      buildViewerKey(viewerId, user?.id)
    ),
    isImmersiveDetailEnabled({ user, viewerId }),
  ]);
  const promotionViewCount = promotionViewCounts.ok
    ? (promotionViewCounts.data.get(promotion.id) ?? 0)
    : (promotion.view_count ?? 0);

  const locationName = [promotion.location_city, promotion.location_province]
    .filter(Boolean)
    .join(", ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: promotion.title,
    description: promotion.description?.slice(0, 300),
    ...(promotion.photos?.[0] && { image: promotion.photos[0] }),
    ...(promotion.start_date && { startDate: promotion.start_date }),
    ...(promotion.end_date && { endDate: promotion.end_date }),
    ...(locationName && {
      location: { "@type": "Place", name: locationName },
    }),
    ...(promotion.price_cents && {
      offers: {
        "@type": "Offer",
        priceCurrency: "ZAR",
        price: (promotion.price_cents / 100).toFixed(2),
      },
    }),
  };

  const safeAdvertiser = advertiserProfile
    ? {
        ...advertiserProfile,
        phone: promotion.contact_methods?.some((method: string) =>
          ["call", "whatsapp"].includes(method)
        )
          ? advertiserProfile.phone
          : null,
        masked_phone_public: null,
      }
    : null;
  const ownLikes = promotionLikes.ok ? promotionLikes.data.get(promotion.id) : undefined;
  const immersiveSlide = immersiveEnabled
    ? presentEventSlide(promotion, safeAdvertiser, linkedBusiness, {
        views: promotionViewCount,
        likes: ownLikes?.likeCount ?? 0,
        viewerHasLiked: ownLikes?.viewerHasLiked ?? false,
      })
    : null;

  const page = (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <div className="container-page py-4 space-y-5">
        <Breadcrumbs
          items={[
            { label: "Tourism & Events", href: "/tourism-events" },
            { label: promotion.title },
          ]}
        />
        <ContactActionTracker table="promotions" id={promotion.id} />
        <PromotionDetailContent
          promotion={{
            ...promotion,
            view_count: promotionViewCount,
          }}
          advertiserProfile={safeAdvertiser}
          linkedBusiness={linkedBusiness}
        />
      </div>
    </>
  );

  return immersiveSlide ? (
    <ImmersiveDetailGate initialSlide={immersiveSlide}>{page}</ImmersiveDetailGate>
  ) : (
    page
  );
}
