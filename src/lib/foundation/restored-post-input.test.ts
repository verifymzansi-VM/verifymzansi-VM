import { afterEach, it, expect, vi } from "vitest";
import { buildRestoredPostInput, restoredMediaKey } from "./restored-post-input";
const id = "11111111-1111-4111-8111-111111111111",
  photo = `https://media.verifymzansi.com/media/${id}`;
const transport = {
  postRequestId: "22222222-2222-4222-8222-222222222222",
  postingTerms: { version: "posting-v1", document_hash: "a".repeat(43) },
  termsAccepted: true,
};
const listing = {
  ...transport,
  title: "Example property listing",
  description: "A sufficiently detailed property description.",
  price_zar: 1234.56,
  province: "Gauteng",
  city: "Johannesburg",
  category: "property",
  attributes: {
    property_type: "house",
    listing_intent: "sale",
    levy_zar: 12.34,
    rates_taxes_zar: 9.87,
  },
  images: [photo],
  town: "Example suburb",
  address: "Example address",
  contactMethods: ["form", "in_app"],
};
it("maps canonical cents and attributes while retaining the selected form's address and source details", () => {
  const command = buildRestoredPostInput("listings", listing);
  expect(command).toMatchObject({
    context: { kind: "listing", area: "market", category: "property" },
    content: { province_id: "gp", city_id: "gp_johannesburg" },
    listing_terms: { price: { mode: "amount", amount_cents: 123456 } },
    attributes: { levy_cents: 1234, rates_taxes_cents: 987 },
    detail: { contact_channels: ["form"] },
    presentation: { location_address: "Example address", location_town: "Example suburb" },
    media: [{ object_key: `media/${id}`, purpose: "cover", focal_x: 0.5, focal_y: 0.5 }],
  });
});
it("distinguishes salary not provided from a free item and keeps salary assertions", () => {
  const command = buildRestoredPostInput("listings", {
    ...listing,
    category: "jobs_services",
    attributes: {
      job_type: "full_time",
      location_type: "on_site",
      salary_min: 10000,
      salary_max: 20000,
    },
    price_zar: 0,
    images: [],
  });
  expect(command).toMatchObject({
    listing_terms: { price: { mode: "on_request" } },
    presentation: { source_attributes: { salary_min: 10000, salary_max: 20000 } },
  });
});
it("passes the seller's explicit price choice: Free, or Price on request with Negotiable", () => {
  expect(
    buildRestoredPostInput("listings", { ...listing, price_zar: 0, price_mode: "free" })
  ).toMatchObject({ listing_terms: { price: { mode: "free" }, negotiable: false } });
  expect(
    buildRestoredPostInput("listings", {
      ...listing,
      price_zar: 0,
      price_mode: "on_request",
      negotiable: true,
    })
  ).toMatchObject({ listing_terms: { price: { mode: "on_request" }, negotiable: true } });
  expect(
    buildRestoredPostInput("listings", { ...listing, price_mode: "amount", negotiable: true })
  ).toMatchObject({
    listing_terms: { price: { mode: "amount", amount_cents: 123456 }, negotiable: true },
  });
});
it("refuses an Amount without a price and Negotiable with Free", () => {
  expect(() =>
    buildRestoredPostInput("listings", { ...listing, price_zar: 0, price_mode: "amount" })
  ).toThrow("Enter a valid price");
  expect(() =>
    buildRestoredPostInput("listings", {
      ...listing,
      price_zar: 0,
      price_mode: "free",
      negotiable: true,
    })
  ).toThrow("Negotiable");
  expect(() =>
    buildRestoredPostInput("listings", { ...listing, price_mode: "sometimes" })
  ).toThrow();
});
it("keeps the older reading when no price choice is sent: zero is Free", () => {
  expect(buildRestoredPostInput("listings", { ...listing, price_zar: 0 })).toMatchObject({
    listing_terms: { price: { mode: "free" } },
  });
});
it("does not accept an older unjournalled URL, forged cross-host media or absent explicit consent", () => {
  expect(() => restoredMediaKey("https://media.verifymzansi.com/media/listing/old.jpg")).toThrow(
    "older upload"
  );
  expect(() => restoredMediaKey(`https://untrusted.example/media/${id}`)).toThrow(
    "Upload the media"
  );
  expect(() => buildRestoredPostInput("listings", { ...listing, termsAccepted: false })).toThrow(
    "Accept the posting terms"
  );
});
it("preserves the edit form's existing-consent flow and requires its loaded revision", () => {
  expect(
    buildRestoredPostInput(
      "listings",
      { ...listing, expectedRevision: 4, termsAccepted: false },
      undefined,
      true
    )
  ).toMatchObject({ expected_revision: 4, terms_accepted: false });
  expect(() =>
    buildRestoredPostInput("listings", { ...listing, termsAccepted: false }, undefined, true)
  ).toThrow("Reload your post");
});
it("keeps logo and video poster references separate from gallery allowance", () => {
  const command = buildRestoredPostInput("listings", {
    ...listing,
    logo_url: photo,
    videoThumbnail: photo,
  });
  expect(command.presentation_media).toEqual([
    { object_key: `media/${id}`, purpose: "logo", position: 0 },
    { object_key: `media/${id}`, purpose: "poster", position: 0 },
  ]);
});
it("uses the confirmed locality only as an online business's administrative locality and preserves the empty public address", () => {
  const command = buildRestoredPostInput(
    "businesses",
    {
      ...transport,
      business_name: "Example online shop",
      slug: "example-online-shop",
      category: "general_other",
      description: "An example online business.",
      business_type: "online_only",
      business_details: {
        type: "online_only",
        primary_order_channel: "website",
        order_url: "https://example.com",
      },
      contact_methods: ["website"],
      website: "https://example.com",
      location_province: "",
      location_city: "",
    },
    { province: "Gauteng", city: "Johannesburg" }
  );
  expect(command).toMatchObject({
    context: { kind: "business", area: "business" },
    business_type: "online_only",
    content: { province_id: "gp", city_id: "gp_johannesburg" },
    presentation: {
      location_province: "",
      location_city: "",
      location_address: null,
      website: "https://example.com",
    },
  });
});
it("maps event activity and true SAST window without converting an event into a paid plan", () => {
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  const command = buildRestoredPostInput("promotions", {
    ...transport,
    title: "Example local event",
    description: "A sufficiently detailed event description.",
    promotion_type: "event",
    province: "Gauteng",
    city: "Johannesburg",
    images: [photo],
    contact_methods: ["form"],
    start_date: start,
    end_date: end,
    event_details: { event_type: "festival_concert" },
    price_zar: 10,
  });
  expect(command).toMatchObject({
    context: {
      kind: "event",
      area: "tourism_events",
      category: "events",
      activity: "festival_concert",
    },
    detail: { starts_at: start, ends_at: end, timezone: "Africa/Johannesburg" },
    trial_days: null,
    presentation: { ticket_price_cents: 1000 },
  });
});

afterEach(() => vi.unstubAllEnvs());
it("reads the key after the configured media address's own path, and only there", () => {
  // Production's media address has no path.
  vi.stubEnv("NEXT_PUBLIC_MEDIA_URL", "https://media.verifymzansi.com");
  expect(restoredMediaKey(photo)).toBe(`media/${id}`);
  expect(() => restoredMediaKey(`https://media.verifymzansi.com/e2e-media/media/${id}`)).toThrow(
    "older upload"
  );
  // The browser-test copy serves media under /e2e-media on its own host.
  vi.stubEnv("NEXT_PUBLIC_MEDIA_URL", "https://media.verifymzansi.com/e2e-media/");
  expect(restoredMediaKey(`https://media.verifymzansi.com/e2e-media/media/${id}`)).toBe(
    `media/${id}`
  );
  expect(restoredMediaKey(photo)).toBe(`media/${id}`);
  expect(() =>
    restoredMediaKey(`https://media.verifymzansi.com/e2e-media/other/media/${id}`)
  ).toThrow("older upload");
  vi.stubEnv("NEXT_PUBLIC_MEDIA_URL", "not a url");
  expect(restoredMediaKey(photo)).toBe(`media/${id}`);
});
/** The listing command, typed as one (the builder returns any of the three kinds). */
function listingCommand(input: Record<string, unknown>) {
  const command = buildRestoredPostInput("listings", input);
  return command as Extract<typeof command, { listing_terms: unknown }>;
}
it("saves a listing's links and new Market answers in its presentation", () => {
  const command = listingCommand({
    ...listing,
    attributes: {
      property_type: "house",
      listing_intent: "rent",
      available_from: "2026-12-01",
      deposit_zar: 9000,
      lease_term: "12_months",
      utilities_included: ["water"],
      occupation_date: "2027-01-01",
      pets_policy: "allowed",
    },
    website: "https://home.example.co.za",
    social_links: { facebook: "https://facebook.com/home", youtube: "", tiktok: undefined },
  });
  expect(command.presentation).toMatchObject({
    website: "https://home.example.co.za",
    social_links: { facebook: "https://facebook.com/home" },
    source_attributes: {
      available_from: "2026-12-01",
      deposit_zar: 9000,
      lease_term: "12_months",
      utilities_included: ["water"],
      pets_policy: "allowed",
      pets_allowed: true,
    },
  });
  expect(command.presentation.social_links).toEqual({ facebook: "https://facebook.com/home" });
  // A sale date is not kept on a rental; the pets choice reaches the searchable field.
  expect(command.presentation.source_attributes).not.toHaveProperty("occupation_date");
  expect(command.attributes).toMatchObject({ pets_allowed: true, available_from: "2026-12-01" });
});
it("leaves pets_allowed out for 'Ask', and links out when none are given", () => {
  const command = listingCommand({
    ...listing,
    attributes: { property_type: "house", listing_intent: "sale", pets_policy: "ask" },
  });
  expect(command.presentation.source_attributes).not.toHaveProperty("pets_allowed");
  expect(command.attributes).not.toHaveProperty("pets_allowed");
  expect(command.presentation).not.toHaveProperty("website");
  expect(command.presentation).not.toHaveProperty("social_links");
});
it("keeps how the buyer gets it, size and gender for clothing", () => {
  const command = listingCommand({
    ...listing,
    category: "clothing_accessories",
    attributes: { size: "M", gender: "unisex", delivery_methods: ["collect", "courier"] },
  });
  expect(command.presentation.source_attributes).toEqual({
    size: "M",
    gender: "unisex",
    delivery_methods: ["collect", "courier"],
  });
});
