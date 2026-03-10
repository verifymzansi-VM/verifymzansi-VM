import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { BusinessDetailContent } from "@/components/business/business-detail-content";

interface BusinessDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("business_name, description")
    .eq("id", id)
    .single();

  if (!business) {
    return { title: "Business Not Found" };
  }

  return {
    title: `${business.business_name} | Mzansi Business`,
    description: business.description?.slice(0, 160),
  };
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!business) {
    notFound();
  }

  const linkedMall = business.mall_id
    ? (await supabase.from("malls").select("id, name").eq("id", business.mall_id).maybeSingle())
        .data
    : null;

  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("display_name, seller_verification_status")
    .eq("user_id", business.seller_id)
    .maybeSingle();

  const { data: promotions } = await supabase
    .from("promotions")
    .select(
      "id, title, promotion_type, category, category_key, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, boost_until, featured_until, view_count, start_date, end_date, created_at"
    )
    .eq("business_id", id)
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(12);

  const trustLevel = seller ? computeTrustLevel(seller.seller_verification_status ?? null) : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.business_name,
    description: business.description?.slice(0, 300),
    ...(business.cover_photo && { image: business.cover_photo }),
    address: {
      "@type": "PostalAddress",
      addressLocality: business.location_city || undefined,
      addressRegion: business.location_province || undefined,
      addressCountry: "ZA",
    },
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        <div className="container-page space-y-5 py-4">
          <BusinessDetailContent
            business={business}
            trustLevel={trustLevel}
            seller={seller}
            linkedMall={linkedMall}
            promotions={promotions ?? []}
          />
        </div>
      </main>

      <Footer />
    </div>
  );
}
