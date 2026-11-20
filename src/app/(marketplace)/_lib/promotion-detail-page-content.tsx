import { publicPersonName } from "@/lib/account/public-name";
import {
  restoredEventDetail,
  restoredEventHostBusiness,
  restoredPublicDetail,
} from "@/lib/foundation/marketplace-server";
import { publicPageMetadata } from "@/lib/sharing/page-metadata";
import { notFound } from "next/navigation";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { normalizeOwnerRecord } from "@/lib/account/compat";
import { ImmersiveDetailGate } from "@/components/immersive/immersive-detail-gate";
import { presentEventSlide } from "@/lib/feed/presenters";
import { toPublicVerification } from "@/lib/business-verification/public";

export async function generatePromotionDetailMetadata(id: string): Promise<Metadata> {
  const promotion = await restoredEventDetail(id);

  if (!promotion) {
    return { title: "Tourism & Events Listing Not Found" };
  }

  return publicPageMetadata({
    title: `${promotion.title} | Tourism & Events`,
    description: promotion.description,
    path: `/tourism-events/${id}`,
    image: promotion.video_thumbnail || promotion.photos?.[0],
    video: promotion.videos?.[0],
    width: promotion.media_width,
    height: promotion.media_height,
  });
}

export async function PromotionDetailPageContent({ id }: { id: string }) {
  const rawPromotion = await restoredEventDetail(id);

  const promotion = rawPromotion ? normalizeOwnerRecord(rawPromotion) : null;

  if (!promotion) {
    notFound();
  }

  const publicPost = await restoredPublicDetail(id);
  const advertiserProfile = publicPost
    ? {
        display_name: publicPost.seller.public_name,
        account_verification_status: publicPost.seller.identity_verified
          ? ("verified" as const)
          : null,
        phone: null,
      }
    : null;

  const linkedBusinessRow = promotion.business_id
    ? await restoredEventHostBusiness(promotion.business_id)
    : null;
  const linkedBusiness = linkedBusinessRow ? toPublicVerification(linkedBusinessRow) : null;
  const promotionViewCount = promotion.view_count ?? 0;

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

  // The number never reaches the page: everyone, the advertiser included,
  // reveals it, so this public page reads no session.
  const publishesPhone = Boolean(
    promotion.contact_methods?.some((method: string) => ["call", "whatsapp"].includes(method))
  );
  const safeAdvertiser = advertiserProfile
    ? {
        ...advertiserProfile,
        display_name: publicPersonName(advertiserProfile.display_name),
        phone: null,
        has_phone: publishesPhone,
        masked_phone_public: null,
      }
    : null;
  const immersiveSlide = presentEventSlide(promotion, safeAdvertiser, linkedBusiness, {
    views: promotionViewCount,
    likes: promotion.like_count ?? 0,
    viewerHasLiked: false,
    shares: null,
  });

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

  // Desktop opens the post viewer; phones, search engines and no-JS visitors get `page`.
  return <ImmersiveDetailGate initialSlide={immersiveSlide}>{page}</ImmersiveDetailGate>;
}
