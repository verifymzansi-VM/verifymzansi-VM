import { describe, expect, it } from "vitest";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import type { ListingDetailRecord } from "@/components/listings/listing-detail-content";
import type { PromotionDetailRecord } from "@/components/listings/promotion-detail-content";
import { presentBusinessSlide, presentEventSlide, presentListingSlide } from "./presenters";

const engagement = { views: 3, likes: 1, viewerHasLiked: false };
const owner = {
  display_name: "Thandi Ntuli",
  account_verification_status: "verified",
  phone: "0821234567",
};

const listing: ListingDetailRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "2019 BMW 320i",
  description: "Clean.",
  price_cents: 22_000_000,
  price_negotiable: true,
  category: "vehicles",
  condition: "good",
  attributes: { make: "BMW", model: "3 Series", year: 2019 },
  photos: ["https://media.verifymzansi.com/a.webp"],
  videos: ["https://media.verifymzansi.com/a.mp4"],
  video_thumbnail: null,
  location_province: "Gauteng",
  location_city: "Johannesburg",
  location_suburb: null,
  location_address: null,
  contact_methods: ["form"],
  created_at: "2026-09-15T10:00:00Z",
};

const business = {
  id: "00000000-0000-4000-8000-000000000002",
  owner_id: "x",
  business_name: "Home Bakes",
  description: null,
  status: "live",
  business_type: "home_business",
  category: "food_beverage",
  subcategory: null,
  category_details: { contact_methods: ["call"] },
  logo_url: null,
  cover_photo: null,
  cover_video: null,
  video_thumbnail: null,
  gallery_photos: [],
  location_province: "KwaZulu-Natal",
  location_city: "Durban",
  location_town: null,
  location_address: null,
  social_links: {},
  phone: "0821234567",
  whatsapp: null,
  email: null,
  website: "javascript:alert(1)",
  store_number: null,
  map_directions: "https://maps.google.com/?q=my+house",
  business_details: null,
  services_offered: [],
  service_areas: null,
  operating_hours: { Mon_Fri: "08:00-17:00" },
  payment_methods_accepted: [],
  delivery_options: null,
} as unknown as BusinessDetailRecord;

const event: PromotionDetailRecord = {
  id: "00000000-0000-4000-8000-000000000003",
  owner_id: "y",
  business_id: null,
  title: "Jazz on the Lawn",
  description: "Live jazz.",
  promotion_type: "event",
  category: null,
  category_key: null,
  photos: [],
  videos: [],
  video_thumbnail: null,
  price_cents: null,
  price_negotiable: false,
  location_province: "KwaZulu-Natal",
  location_city: "Richards Bay",
  location_town: "Meerensee",
  location_address: null,
  contact_methods: ["form"],
  start_date: "2026-10-31T16:00:00Z",
  end_date: null,
  boost_until: null,
  featured_until: null,
  view_count: 0,
  created_at: "2026-09-01T00:00:00Z",
  event_details: {
    venue_name: "Pelican Island, Meerensee, Richards Bay",
    ticket_tiers: [
      { name: "General", price_cents: 15_000 },
      { name: "VIP", price_cents: 70_000 },
    ],
  },
};

describe("presentListingSlide", () => {
  it("never publishes a phone number the seller did not choose", () => {
    const slide = presentListingSlide(listing, owner, engagement);
    expect(slide.contact.phone).toBeNull();
    expect(slide.contact.whatsapp).toBeNull();
    expect(JSON.stringify(slide)).not.toContain("0821234567");
  });

  it("publishes the chosen methods", () => {
    const slide = presentListingSlide(
      { ...listing, contact_methods: ["call", "whatsapp"] },
      owner,
      engagement
    );
    // Numbers never enter a slide; the chosen methods are revealed on tap.
    expect(slide.contact.phone).toBeNull();
    expect(slide.contact.whatsapp).toBeNull();
    expect(slide.contact.revealable).toEqual({ phone: true, whatsapp: true });
    expect(JSON.stringify(slide)).not.toContain("0821234567");
  });

  it("puts videos first and shows price, negotiable and canonical link", () => {
    const slide = presentListingSlide(listing, owner, engagement);
    expect(slide.media.map((item) => item.kind)).toEqual(["video", "photo"]);
    expect(slide.headline.figure?.note).toBe("Negotiable");
    expect(slide.href).toBe(`/listing/${listing.id}`);
  });

  it("never shows a job without a salary as R0", () => {
    const slide = presentListingSlide(
      { ...listing, category: "jobs_services", price_cents: 0 },
      owner,
      engagement
    );
    expect(slide.headline.figure?.value).toBe("Salary not provided");
  });
});

describe("presentBusinessSlide", () => {
  it("hides a home business's map pin and drops unsafe links", () => {
    const slide = presentBusinessSlide(business, owner, [], engagement);
    const links = slide.right.find((section) => section.type === "links");
    expect(JSON.stringify(slide)).not.toContain("my+house");
    expect(JSON.stringify(slide)).not.toContain("javascript:");
    expect(links).toBeUndefined();
    expect(slide.headline.hours).toEqual({ Mon_Fri: "08:00-17:00" });
    expect(slide.kind).toBe("business");
  });

  it("routes tourism stays to Tourism & Events with booking as the main action", () => {
    const slide = presentBusinessSlide(
      {
        ...business,
        business_type: "physical_store",
        category: "tourism_hospitality",
        category_details: { booking_url: "https://example.co.za/book", tgcsa_grading: "4_star" },
      } as unknown as BusinessDetailRecord,
      owner,
      [],
      engagement
    );
    expect(slide.kind).toBe("tourism");
    expect(slide.href).toBe(`/tourism-events/${business.id}`);
    expect(slide.contact.cta?.href).toBe("https://example.co.za/book");
    expect(slide.headline.figure?.value).toBe("4-star graded");
  });
});

describe("presentBusinessSlide shows each fact once", () => {
  const shop = {
    ...business,
    business_type: "standalone_shop",
    category: "general_other",
    location_town: "Richards Bay",
    location_city: "Richards Bay",
    location_address: "9B Dollar Drive, Richards Bay Central",
    website: "Website:https://www.skytentsa.co.za",
    operating_hours: { Mon_Fri: "00:00 - 00:00", Sat: "08:00 - 13:00" },
    services_offered: ["Tent hire, gazebos; tables and chairs", "Tent hire"],
    business_details: {
      type: "standalone_shop",
      street_address: "9B Dollar Drive",
      suburb: "Richards Bay central",
      landmark: "Next to the Spar",
    },
  } as unknown as BusinessDetailRecord;

  it("drops repeated place names, address parts and services", () => {
    const slide = presentBusinessSlide(shop, owner, [], engagement);
    expect(slide.headline.meta[0]?.text).toBe("Richards Bay, KwaZulu-Natal");
    const location = slide.right.find((section) => section.id === "location");
    expect(location?.type === "rows" && location.rows.map((row) => row.label)).toEqual([
      "Address",
      "Landmark",
    ]);
    const services = slide.left.find((section) => section.id === "services");
    expect(services?.type === "chips" && services.items).toEqual([
      "Tent hire",
      "Gazebos",
      "Tables and chairs",
    ]);
  });

  it("reads equal opening and closing times as 24 hours and recovers a labelled link", () => {
    const slide = presentBusinessSlide(shop, owner, [], engagement);
    expect(slide.headline.hours).toEqual({ Mon_Fri: "Open 24 hours", Sat: "08:00 - 13:00" });
    expect(slide.website).toBe("https://www.skytentsa.co.za");
  });
});

describe("presentEventSlide", () => {
  it("leads with the lowest ticket price and keeps the venue line readable", () => {
    const slide = presentEventSlide(event, owner, null, engagement);
    expect(slide.headline.figure?.value).toBe("From R150");
    const location = slide.headline.meta.find((item) => item.icon === "location");
    expect(location?.text).toBe("Pelican Island, Meerensee, Richards Bay, KwaZulu-Natal");
    expect(slide.targetType).toBe("promotion");
    expect(slide.contact.phone).toBeNull();
  });
});
