import { BusinessCard } from "@/components/listings/business-card";
import type { BusinessCategory, BusinessType } from "@/types/enums";

export interface BusinessCardGridRow {
  id: string;
  business_type: BusinessType;
  business_name: string;
  description: string | null;
  cover_photo: string | null;
  cover_video: string | null;
  video_thumbnail: string | null;
  logo_url: string | null;
  gallery_photos: string[] | null;
  location_province: string;
  location_city: string;
  category: BusinessCategory | string | null;
  subcategory: string | null;
  boost_until: string | null;
  featured_until: string | null;
  service_areas: Record<string, unknown> | null;
  focal_x: number | null;
  focal_y: number | null;
  media_width: number | null;
  media_height: number | null;
  view_count?: number | null;
}

export function BusinessCardGridItem({
  business,
  index,
}: {
  business: BusinessCardGridRow;
  index: number;
}) {
  return (
    <div
      className={`content-auto animate-in fade-in fill-mode-both [animation-duration:400ms] sm:slide-in-from-bottom-2 [animation-delay:${Math.min(index * 50, 400)}ms]`}
    >
      <BusinessCard
        id={business.id}
        businessName={business.business_name}
        businessType={business.business_type}
        description={business.description ?? undefined}
        coverPhoto={business.cover_photo}
        coverVideo={business.cover_video}
        videoThumbnail={business.video_thumbnail}
        logoUrl={business.logo_url}
        galleryPhotos={business.gallery_photos}
        province={business.location_province}
        city={business.location_city}
        category={business.category as BusinessCategory | undefined}
        subcategory={business.subcategory}
        boostUntil={business.boost_until}
        featuredUntil={business.featured_until}
        serviceAreas={business.service_areas}
        viewCount={business.view_count ?? 0}
        focalX={business.focal_x}
        focalY={business.focal_y}
        mediaWidth={business.media_width}
        mediaHeight={business.media_height}
      />
    </div>
  );
}
