import type { BusinessCategory } from "@/types/enums";
import { sanitizeCategoryDetails } from "@/lib/forms/business-category-details";
import {
  customerAccessSchema,
  cleanCustomerAccess,
  primaryBusinessType,
} from "@/lib/forms/customer-access";
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

  // Profile extras have no dedicated columns — persist them inside the
  // category_details jsonb column under a stable key.
  const businessProfile: Record<string, unknown> = {};
  if (data.year_established !== undefined) businessProfile.year_established = data.year_established;
  if (data.bbbee_level) businessProfile.bbbee_level = data.bbbee_level;
  if (data.languages_spoken) businessProfile.languages_spoken = data.languages_spoken;
  if (data.load_shedding_ready !== undefined)
    businessProfile.load_shedding_ready = data.load_shedding_ready;
  if (data.number_of_employees) businessProfile.number_of_employees = data.number_of_employees;

  // business_profile is rebuilt only from the validated extras above; a client
  // copy inside category_details would bypass their length and enum checks.
  const { business_profile: _clientProfile, ...clientDetails } = sanitizeCategoryDetails(
    data.category as BusinessCategory,
    data.category_details
  );
  const categoryDetails: Record<string, unknown> = { ...clientDetails };
  if (data.contact_methods) categoryDetails.contact_methods = data.contact_methods;
  const parsedAccess = customerAccessSchema.safeParse(categoryDetails.customer_access);
  const access = parsedAccess.success ? cleanCustomerAccess(parsedAccess.data) : undefined;
  if (access) categoryDetails.customer_access = access;
  const hideAddress = access ? !access.publishAddress : false;

  return {
    business_type: access ? primaryBusinessType(access) : data.business_type,
    business_name: data.business_name,
    slug: data.slug,
    description: data.description,
    category: data.category,
    subcategory: data.subcategory || null,
    category_details:
      Object.keys(businessProfile).length > 0
        ? { ...categoryDetails, business_profile: businessProfile }
        : categoryDetails,
    logo_url: data.logo_url || null,
    cover_photo: data.cover_photo || null,
    cover_video: data.cover_video || null,
    video_thumbnail: data.video_thumbnail || null,
    gallery_photos: data.gallery_photos || [],
    location_province: data.location_province,
    location_city: data.location_city,
    location_town: data.location_town || null,
    location_address: hideAddress ? null : data.location_address || null,
    store_number:
      hideAddress || (access && !access.methods.includes("visit"))
        ? null
        : data.store_number || null,
    map_directions: hideAddress ? null : data.map_directions || null,
    phone:
      data.contact_methods && !data.contact_methods.includes("call") ? null : data.phone || null,
    whatsapp:
      data.contact_methods && !data.contact_methods.includes("whatsapp")
        ? null
        : data.whatsapp || null,
    email:
      data.contact_methods && !data.contact_methods.includes("email") ? null : data.email || null,
    website:
      data.contact_methods && !data.contact_methods.includes("website")
        ? null
        : data.website || null,
    social_links: data.social_links || null,
    services_offered: data.services_offered,
    service_areas: access
      ? access.methods.includes("travel")
        ? {
            areas: access
              .serviceAreas!.split(",")
              .map((a) => a.trim())
              .filter(Boolean),
          }
        : null
      : data.service_areas || null,
    // Legacy details survive only while they still describe the derived business type.
    business_details: withoutHiddenStreet(
      access
        ? data.business_details && primaryBusinessType(access) === data.business_type
          ? data.business_details
          : null
        : data.business_details || null,
      hideAddress
    ),
    operating_hours: data.operating_hours,
    payment_methods_accepted: data.payment_methods_accepted,
    delivery_options: access
      ? access.methods.includes("delivery")
        ? access.nationwide
          ? ["delivery", "nationwide"]
          : ["delivery"]
        : []
      : data.delivery_options,
    layout_template: data.layout_template || null,
    media_width:
      data.media_width !== undefined ? data.media_width : (mediaFallbacks?.media_width ?? null),
    media_height:
      data.media_height !== undefined ? data.media_height : (mediaFallbacks?.media_height ?? null),
    focal_x: data.focal_x ?? mediaFallbacks?.focal_x ?? 0.5,
    focal_y: data.focal_y ?? mediaFallbacks?.focal_y ?? 0.5,
  };
}

/** A shop that keeps its address private must not publish it through its shop details. */
function withoutHiddenStreet<T extends { type: string } | null | undefined>(
  details: T,
  hideAddress: boolean
): T {
  if (!hideAddress || !details || details.type !== "standalone_shop") return details;
  const {
    street_address: _street,
    suite_or_unit: _unit,
    ...rest
  } = details as T & {
    street_address?: string;
    suite_or_unit?: string;
  };
  return rest as T;
}
