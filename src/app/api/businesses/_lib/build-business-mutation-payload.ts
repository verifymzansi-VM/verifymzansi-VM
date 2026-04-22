import type { z } from "zod";

import { type businessSchema } from "@/lib/validations/business-unified";

type BusinessMutationInput = z.infer<typeof businessSchema>;

type BusinessMediaFallbacks = {
  media_width?: number | null;
  media_height?: number | null;
  focal_x?: number | null;
  focal_y?: number | null;
};

export function buildBusinessMutationPayload(
  data: BusinessMutationInput,
  options?: {
    mediaFallbacks?: BusinessMediaFallbacks;
  }
) {
  const mediaFallbacks = options?.mediaFallbacks;

  return {
    business_type: data.business_type,
    business_name: data.business_name,
    slug: data.slug,
    description: data.description,
    category: data.category,
    logo_url: data.logo_url || null,
    cover_photo: data.cover_photo || null,
    cover_video: data.cover_video || null,
    video_thumbnail: data.video_thumbnail || null,
    gallery_photos: data.gallery_photos || [],
    location_province: data.location_province,
    location_city: data.location_city,
    location_town: data.location_town || null,
    location_address: data.location_address || null,
    store_number: data.store_number || null,
    map_directions: data.map_directions || null,
    phone: data.phone || null,
    whatsapp: data.whatsapp || null,
    email: data.email || null,
    website: data.website || null,
    social_links: data.social_links || null,
    services_offered: data.services_offered,
    service_areas: data.service_areas || null,
    business_details: data.business_details || null,
    operating_hours: data.operating_hours,
    payment_methods_accepted: data.payment_methods_accepted,
    delivery_options: data.delivery_options,
    layout_template: data.layout_template || null,
    media_width:
      data.media_width !== undefined ? data.media_width : (mediaFallbacks?.media_width ?? null),
    media_height:
      data.media_height !== undefined ? data.media_height : (mediaFallbacks?.media_height ?? null),
    focal_x: data.focal_x ?? mediaFallbacks?.focal_x ?? 0.5,
    focal_y: data.focal_y ?? mediaFallbacks?.focal_y ?? 0.5,
  };
}
