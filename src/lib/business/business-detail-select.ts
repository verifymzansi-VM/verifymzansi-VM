/**
 * Public business detail columns, newest schema first. Older databases miss a
 * few optional columns; each fallback drops them so profiles still load.
 */
const BUSINESS_DETAIL_SELECT = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, location_town, location_address, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, layout_template, view_count,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, location_town, location_address, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, view_count,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_VIEW_COUNT_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, location_town, location_address, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, layout_template,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_MIN_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, location_town, location_address, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_MIN_SCHEMA_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, location_town, location_address, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area,
  created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_CANDIDATES = [
  BUSINESS_DETAIL_SELECT,
  BUSINESS_DETAIL_SELECT_LEGACY,
  BUSINESS_DETAIL_SELECT_VIEW_COUNT_LEGACY,
  BUSINESS_DETAIL_SELECT_MIN_LEGACY,
  BUSINESS_DETAIL_SELECT_MIN_SCHEMA_LEGACY,
];

type QueryError = { code?: string | null; message?: string | null } | null;

function isMissingBusinessOptionalColumnError(error: QueryError) {
  if (!error || error.code !== "42703") return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("layout_template") ||
    message.includes("view_count") ||
    message.includes("expires_at")
  );
}

/** Run a business query with each select in turn until one fits the schema. */
export async function selectBusinessWithFallback<T>(
  run: (selectClause: string) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<{ data: T | null; error: QueryError }> {
  let data: T | null = null;
  let error: QueryError = null;
  for (const selectClause of BUSINESS_DETAIL_SELECT_CANDIDATES) {
    const result = await run(selectClause);
    data = (result.data as T | null) ?? null;
    error = (result.error as QueryError) ?? null;
    if (!error || !isMissingBusinessOptionalColumnError(error)) break;
  }
  return { data, error };
}
