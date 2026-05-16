import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ContentViewCountText } from "@/components/listings/content-view-count-text";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { ACCOUNT_PROFILE_TABLE, normalizeOwnerRecord, readOwnerId } from "@/lib/account/compat";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
    supabase.from("promotions").select("*").eq("id", id).eq("status", "live")
  ).single();

  const promotion = rawPromotion ? normalizeOwnerRecord(rawPromotion) : null;

  if (!promotion) {
    notFound();
  }

  const promotionOwnerId = readOwnerId(promotion);
  const { data: advertiserProfile } = promotionOwnerId
    ? await supabase
        .from(ACCOUNT_PROFILE_TABLE)
        .select(
          "display_name, account_verification_status, phone, masked_phone_public, location_province, location_city, strikes"
        )
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
  const promotionViewCounts = await getOptionalContentViewCountMap(engagementAdmin, "promotion", [
    promotion.id,
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <div className="container-page py-4 space-y-5">
        <PageHeader
          title={promotion.title}
          description={
            <ContentViewCountText
              targetId={promotion.id}
              targetType="promotion"
              initialCount={promotionViewCount}
            />
          }
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Tourism & Events", href: "/tourism-events" },
            { label: promotion.title },
          ]}
        />
        <PromotionDetailContent
          promotion={{
            ...promotion,
            view_count: promotionViewCount,
          }}
          advertiserProfile={advertiserProfile}
          linkedBusiness={linkedBusiness}
        />
      </div>
    </>
  );
}
