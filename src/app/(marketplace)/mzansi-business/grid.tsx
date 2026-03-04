import { createClient } from "@/lib/supabase/server";
import { BusinessCard } from "@/components/listings/business-card";
import type { BusinessType, BusinessCategory } from "@/types/enums";

export async function MzansiBusinessGrid() {
  const supabase = await createClient();

  const { data: businesses } = await supabase
    .from("businesses")
    .select(
      "id, business_type, business_name, description, cover_photo, logo_url, gallery_photos, location_province, location_city, category, boost_until, featured_until, service_areas"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(24);

  const items = businesses ?? [];

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-lg font-medium">No businesses yet</p>
        <p className="text-sm mt-1">Be the first to list your business on Mzansi Business.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      {items.map((b) => (
        <BusinessCard
          key={b.id}
          id={b.id}
          businessName={b.business_name}
          businessType={b.business_type as BusinessType}
          description={b.description}
          coverPhoto={b.cover_photo}
          logoUrl={b.logo_url}
          galleryPhotos={b.gallery_photos as string[] | null}
          province={b.location_province}
          city={b.location_city}
          category={b.category as BusinessCategory}
          boostUntil={b.boost_until}
          featuredUntil={b.featured_until}
          serviceAreas={b.service_areas as Record<string, unknown> | null}
        />
      ))}
    </div>
  );
}
