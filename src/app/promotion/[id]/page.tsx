import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { ACCOUNT_PROFILE_TABLE, normalizeOwnerRecord, readOwnerId } from "@/lib/account/compat";
import type { Metadata } from "next";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";

interface PromotionDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PromotionDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: promotion } = await supabase
    .from("promotions")
    .select("title, description")
    .eq("id", id)
    .single();

  if (!promotion) {
    return { title: "Promotion Not Found" };
  }

  return {
    title: `${promotion.title} | Promotions`,
    description: promotion.description?.slice(0, 160),
  };
}

export default async function PromotionDetailPage({ params }: PromotionDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const engagementAdmin = tryCreateAdminClient();

  // Fetch promotion
  const { data: rawPromotion } = await supabase
    .from("promotions")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  const promotion = rawPromotion ? normalizeOwnerRecord(rawPromotion) : null;

  if (!promotion) notFound();

  // Fetch advertiser profile (maybeSingle — the account may have been deleted)
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

  // Fetch linked business (if any)
  const linkedBusiness = promotion.business_id
    ? (
        await supabase
          .from("businesses")
          .select("id, business_name, logo_url")
          .eq("id", promotion.business_id)
          .maybeSingle()
      ).data
    : null;
  const promotionViewCounts = await getOptionalContentViewCountMap(engagementAdmin, "promotion", [
    promotion.id,
  ]);

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
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <main className="flex-1">
        <div className="container-page py-4 space-y-5">
          <PageHeader
            title={promotion.title}
            breadcrumbs={[
              { label: "Home", href: "/" },
              { label: "Tourism & Events", href: "/promotions" },
              { label: promotion.title },
            ]}
          />
          <PromotionDetailContent
            promotion={{
              ...promotion,
              view_count: promotionViewCounts.ok
                ? (promotionViewCounts.data.get(promotion.id) ?? 0)
                : (promotion.view_count ?? null),
            }}
            advertiserProfile={advertiserProfile}
            linkedBusiness={linkedBusiness}
          />
        </div>
      </main>

      <Footer />
    </div>
  );
}
