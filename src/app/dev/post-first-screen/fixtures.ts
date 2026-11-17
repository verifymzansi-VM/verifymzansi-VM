import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import type {
  ListingDetailRecord,
  ListingSellerRecord,
} from "@/components/listings/listing-detail-content";
import type {
  PromotionAdvertiserRecord,
  PromotionDetailRecord,
} from "@/components/listings/promotion-detail-content";
import { formatZARShort } from "@/lib/utils/format";

/**
 * Browser-test posts for the post pages' first phone screen. Not real people
 * or businesses. Local pictures only, so the page needs no network.
 */
const MARKET_PHOTO = "/images/showrooms/market-v2-mobile.avif";
const BUSINESS_PHOTO = "/images/showrooms/business-v2-mobile.avif";
const TOURISM_PHOTO = "/images/showrooms/tourism-v2-mobile.avif";
const FIXED_DATE = "2026-11-01T08:00:00.000Z";

export const FIRST_SCREEN_LISTING: ListingDetailRecord = {
  id: "5d1c6a0e-7b2f-4c1a-8e3d-1a2b3c4d5e01",
  owner_id: "00000000-0000-4000-8000-0000000000a1",
  title: "Two-seater leather couch, barely used",
  description: "Dark brown leather, no tears or marks. Collection only.",
  price_cents: 145_000,
  price_mode: "amount",
  price_negotiable: true,
  category: "home_lifestyle",
  condition: "like_new",
  attributes: null,
  photos: [MARKET_PHOTO, BUSINESS_PHOTO],
  videos: [],
  video_thumbnail: null,
  logo_url: null,
  location_province: "KwaZulu-Natal",
  location_city: "Richards Bay",
  location_suburb: "Meerensee",
  contact_methods: ["call", "whatsapp"],
  created_at: FIXED_DATE,
};

export const FIRST_SCREEN_VIDEO_LISTING: ListingDetailRecord = {
  ...FIRST_SCREEN_LISTING,
  id: "5d1c6a0e-7b2f-4c1a-8e3d-1a2b3c4d5e02",
  title: "Hand-made beaded necklaces, any colour to order",
  description: "Zulu beadwork made to order; send the colours you want.",
  price_cents: null,
  price_mode: "on_request",
  price_negotiable: false,
  category: "clothing_accessories",
  condition: "new",
  photos: [MARKET_PHOTO],
  // Never loaded: the player waits for a tap (no autoplay on phones).
  videos: ["/video/seller-story/market.mp4"],
  video_thumbnail: MARKET_PHOTO,
};

export const FIRST_SCREEN_SELLER: ListingSellerRecord = {
  display_name: "Thando D.",
  location_province: "KwaZulu-Natal",
  location_city: "Richards Bay",
  account_verification_status: "verified",
  phone: null,
  masked_phone_public: null,
  has_phone: true,
};

export const FIRST_SCREEN_BUSINESS = {
  id: "5d1c6a0e-7b2f-4c1a-8e3d-1a2b3c4d5e03",
  owner_id: "00000000-0000-4000-8000-0000000000a2",
  business_name: "Ubuntu Tyre and Exhaust Centre",
  description: "Tyres, exhausts and wheel alignment while you wait.",
  // Not "live": the page then counts no view for this fixture.
  status: "approved",
  business_type: "physical_store",
  category: "automotive_services",
  subcategory: null,
  category_details: null,
  cover_photo: BUSINESS_PHOTO,
  logo_url: null,
  cover_video: null,
  video_thumbnail: null,
  gallery_photos: [MARKET_PHOTO],
  social_links: null,
  operating_hours: null,
  services_offered: ["Tyres", "Exhausts", "Wheel alignment"],
  payment_methods_accepted: ["cash", "card"],
  delivery_options: null,
  service_areas: null,
  location_city: "Empangeni",
  location_province: "KwaZulu-Natal",
  location_town: null,
  contact_available: { phone: true, whatsapp: false, email: false },
  website: null,
  store_number: null,
  business_details: null,
  view_count: 0,
} satisfies BusinessDetailRecord;

export const FIRST_SCREEN_EVENT: PromotionDetailRecord = {
  id: "5d1c6a0e-7b2f-4c1a-8e3d-1a2b3c4d5e04",
  owner_id: "00000000-0000-4000-8000-0000000000a3",
  business_id: null,
  title: "Zululand Craft and Food Market",
  description: "Local crafts, food stalls and live music on the lawn.",
  promotion_type: "event",
  category: null,
  category_key: null,
  photos: [TOURISM_PHOTO, MARKET_PHOTO],
  videos: [],
  video_thumbnail: null,
  price_cents: null,
  price_negotiable: false,
  location_province: "KwaZulu-Natal",
  location_city: "Richards Bay",
  location_town: null,
  location_address: null,
  contact_methods: ["call", "form"],
  start_date: "2026-12-05T08:00:00.000Z",
  end_date: "2026-12-05T15:00:00.000Z",
  boost_until: null,
  featured_until: null,
  view_count: 0,
  created_at: FIXED_DATE,
  logo_url: null,
  event_details: {
    event_type: "market_expo",
    venue_name: "Meerensee Mall lawn",
    ticket_tiers: [
      { name: "Adult", price_cents: 5_000 },
      { name: "Child", price_cents: 2_000 },
    ],
  },
};

export const FIRST_SCREEN_ADVERTISER: PromotionAdvertiserRecord = {
  display_name: "Thando D.",
  account_verification_status: "verified",
  phone: null,
  masked_phone_public: null,
  has_phone: true,
};

/** What each type's strip must show: the card's price line and the title. */
export const FIRST_SCREEN_EXPECTED = {
  listing: { title: FIRST_SCREEN_LISTING.title, price: formatZARShort(145_000) },
  "listing-video": { title: FIRST_SCREEN_VIDEO_LISTING.title, price: "Price on request" },
  business: { title: FIRST_SCREEN_BUSINESS.business_name, price: null },
  event: { title: FIRST_SCREEN_EVENT.title, price: `From ${formatZARShort(2_000)}` },
} as const;

export type FirstScreenType = keyof typeof FIRST_SCREEN_EXPECTED;
