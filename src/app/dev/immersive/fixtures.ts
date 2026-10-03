import type {
  BusinessDetailRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import type { ListingDetailRecord } from "@/components/listings/listing-detail-content";
import type { PromotionDetailRecord } from "@/components/listings/promotion-detail-content";
import {
  presentBusinessSlide,
  presentEventSlide,
  presentListingSlide,
} from "@/lib/feed/presenters";
import type { FeedSlide } from "@/lib/feed/types";

/** Design-preview posts only. Not real people or businesses. */
const photo = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1080&q=70`;
const engagement = (views: number, likes: number) => ({
  views,
  likes,
  shares: 0,
  viewerHasLiked: false,
});
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const vehicle: ListingDetailRecord = {
  id: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a01",
  owner_id: "00000000-0000-4000-8000-000000000001",
  title: "2019 Mercedes-Benz GLE Coupé 400d 4MATIC",
  description:
    "One owner, full service history at a Mercedes-Benz dealer. AMG line, panoramic roof, Burmester sound, 360 camera.\n\nNever off-road, always garaged. Viewing by appointment in Richards Bay; happy to meet at a dealership for an inspection.",
  price_cents: 89_500_000,
  price_negotiable: true,
  category: "vehicles",
  condition: "like_new",
  attributes: {
    make: "Mercedes-Benz",
    model: "GLE Coupé",
    year: 2019,
    mileage_km: 68_400,
    transmission: "automatic",
    fuel_type: "diesel",
    body_type: "suv",
  },
  photos: [photo("photo-1618843479313-40f8afb4b4d8"), photo("photo-1606664515524-ed2f786a0bd6")],
  videos: ["/video/seller-story/market.mp4"],
  video_thumbnail: photo("photo-1618843479313-40f8afb4b4d8"),
  logo_url: null,
  location_province: "KwaZulu-Natal",
  location_city: "Richards Bay",
  location_suburb: "Meerensee",
  location_address: null,
  contact_methods: ["call", "whatsapp", "form"],
  created_at: inDays(-3),
};

const flat: ListingDetailRecord = {
  ...vehicle,
  id: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a02",
  title: "Two-bedroom flat with a sea view, Umhlanga Ridge",
  description: "Open-plan kitchen, two bathrooms, secure parking for two cars and a fibre line.",
  price_cents: 1_450_000,
  price_negotiable: false,
  category: "property",
  condition: null,
  attributes: { property_type: "apartment", listing_intent: "rent", bedrooms: 2 },
  photos: [
    photo("photo-1502672260266-1c1ef2d93688"),
    photo("photo-1522708323590-d24dbb6b0267"),
    photo("photo-1560448204-e02f11c3d0e2"),
  ],
  videos: [],
  video_thumbnail: null,
  contact_methods: ["whatsapp"],
};

const bare: ListingDetailRecord = {
  ...flat,
  id: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a06",
  title: "Hand-made beadwork, wholesale orders",
  description: null,
  price_cents: null,
  category: "other_items",
  attributes: null,
  photos: [],
  videos: [],
  contact_methods: ["form"],
};

const salon = {
  id: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a03",
  owner_id: "00000000-0000-4000-8000-000000000002",
  business_name: "Imvelo Hair and Beauty Studio",
  description:
    "Natural hair care, braids, locs and bridal styling in Durban North. Walk-ins welcome before noon; bookings recommended for bridal parties.",
  status: "live",
  business_type: "physical_store",
  category: "health_beauty",
  subcategory: null,
  area: "MZANSI_BUSINESS",
  category_details: { contact_methods: ["call", "whatsapp", "form"] },
  logo_url: null,
  cover_photo: photo("photo-1560066984-138dadb4c035"),
  cover_video: "/video/seller-story/business.mp4",
  video_thumbnail: photo("photo-1560066984-138dadb4c035"),
  gallery_photos: [photo("photo-1522337360788-8b13dee7a37e")],
  location_province: "KwaZulu-Natal",
  location_city: "Durban",
  location_town: "Durban North",
  location_address: "41 Kensington Drive",
  social_links: { instagram: "https://instagram.com/" },
  phone: "0821234567",
  whatsapp: "0821234567",
  email: "hello@example.co.za",
  website: "https://example.co.za",
  store_number: null,
  map_directions: "https://maps.google.com/?q=Durban+North",
  business_details: null,
  services_offered: ["Braids", "Locs", "Silk press", "Bridal styling", "Kids' cuts"],
  service_areas: null,
  operating_hours: { Mon_Fri: "08:00-17:30", Sat: "8am - 2pm", Sun: "Closed" },
  payment_methods_accepted: ["cash", "card", "snapscan"],
  delivery_options: null,
} as unknown as BusinessDetailRecord;

const lodge = {
  ...salon,
  id: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a04",
  business_name: "Mpushini Ridge Guest Lodge",
  description:
    "Six thatched rooms above the Mpushini valley, 20 minutes from Pietermaritzburg. Breakfast included; dinners on request.",
  category: "tourism_hospitality",
  subcategory: "guest_house",
  area: "PROMOTIONS_EVENTS",
  cover_video: null,
  cover_photo: photo("photo-1566073771259-6a8506099945"),
  gallery_photos: [
    photo("photo-1582719478250-c89cae4dc85b"),
    photo("photo-1590490360182-c33d57733427"),
  ],
  services_offered: [],
  operating_hours: null,
  category_details: {
    star_rating: 4,
    tgcsa_grading: "4_star",
    number_of_rooms: 6,
    check_in_time: "14:00",
    check_out_time: "10:00",
    amenities: ["pool", "wifi", "braai_area", "secure_parking"],
    languages_spoken: "English, isiZulu",
    cancellation_policy: "moderate",
    minimum_stay_nights: 2,
    child_policy: "children_over_6",
    meal_options: ["Breakfast included"],
    nearby_attractions: "Mpushini Falls, Ashburton bird sanctuary, the Comrades route",
    booking_url: "https://example.co.za/book",
    contact_methods: ["call", "whatsapp"],
  },
} as unknown as BusinessDetailRecord;

const festival: PromotionDetailRecord = {
  id: "0f6c2a8e-1b7d-4e0a-9a51-3c2d9e7b1a05",
  owner_id: "00000000-0000-4000-8000-000000000003",
  business_id: null,
  title: "Durban Jazz on the Lawn",
  description:
    "An afternoon of live jazz under the trees at the Botanic Gardens. Bring a blanket; food trucks and a craft beer garden on site.",
  promotion_type: "event",
  category: null,
  category_key: null,
  photos: [photo("photo-1514525253161-7a46d19cd819")],
  videos: ["/video/seller-story/tourism.mp4"],
  video_thumbnail: photo("photo-1514525253161-7a46d19cd819"),
  price_cents: null,
  price_negotiable: false,
  location_province: "KwaZulu-Natal",
  location_city: "Durban",
  location_town: "Berea",
  location_address: "9A John Zikhali Road",
  contact_methods: ["whatsapp", "form"],
  start_date: inDays(9),
  end_date: inDays(9.3),
  boost_until: null,
  featured_until: null,
  view_count: 0,
  created_at: inDays(-5),
  logo_url: null,
  event_details: {
    event_type: "music",
    venue_name: "Durban Botanic Gardens",
    venue_capacity: 1500,
    ticket_tiers: [
      { name: "General", price_cents: 25_000 },
      { name: "Picnic for two", price_cents: 60_000 },
      { name: "Under 12", price_cents: null },
    ],
    tickets_url: "https://example.co.za/tickets",
    age_restriction: "all_ages",
    parking_available: true,
    food_drinks_available: true,
    lineup: "Sibusiso Mash\nThandi Ntuli Quartet\nDurban Youth Big Band",
    rain_policy: "postponed",
    accessibility: ["Wheelchair access", "Accessible toilets"],
    bring_your_own: "Blankets and camp chairs. No glass.",
  },
};

const seller = {
  display_name: "Siphesihle Biyela",
  account_verification_status: "verified",
  phone: "0836558782",
};

export function buildFixtureSlides(): FeedSlide[] {
  const lodgePosts: Pick<
    BusinessPromotionRecord,
    "id" | "title" | "photos" | "video_thumbnail" | "start_date" | "location_city"
  >[] = [
    {
      id: festival.id,
      title: festival.title,
      photos: festival.photos,
      video_thumbnail: festival.video_thumbnail,
      start_date: festival.start_date,
      location_city: festival.location_city,
    },
  ];
  return [
    presentListingSlide(vehicle, seller, engagement(1434, 247)),
    presentBusinessSlide(
      salon,
      { display_name: "Nomvula Dlamini", account_verification_status: "pending_review" },
      [],
      engagement(512, 61)
    ),
    presentEventSlide(
      festival,
      {
        display_name: "Durban Live",
        account_verification_status: "verified",
        phone: "0311234567",
      },
      null,
      engagement(2210, 389)
    ),
    presentBusinessSlide(
      lodge,
      { display_name: "Mpushini Ridge", account_verification_status: "verified" },
      lodgePosts,
      engagement(98, 12)
    ),
    presentListingSlide(flat, seller, engagement(40, 3)),
    presentListingSlide(bare, null, engagement(0, 0)),
  ];
}
