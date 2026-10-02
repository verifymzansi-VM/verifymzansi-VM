// Public detail columns only: select("*") would hand every visitor any
// internal column added to promotions later.
export const PROMOTION_DETAIL_SELECT =
  "id, owner_id, business_id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, location_town, location_address, contact_methods, start_date, end_date, boost_until, featured_until, view_count, created_at, logo_url, event_details, media_width, media_height";
