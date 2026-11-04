import { it, expect } from "vitest";
import { buildRestoredPostInput, restoredMediaObjectId } from "./restored-post-input";
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
    media: [{ object_id: id, purpose: "cover", focal_x: 0.5, focal_y: 0.5 }],
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
it("does not accept an older unjournalled URL, forged cross-host media or absent explicit consent", () => {
  expect(() =>
    restoredMediaObjectId("https://media.verifymzansi.com/media/listing/old.jpg")
  ).toThrow("older upload");
  expect(() => restoredMediaObjectId(`https://untrusted.example/media/${id}`)).toThrow(
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
    { object_id: id, purpose: "logo", position: 0 },
    { object_id: id, purpose: "poster", position: 0 },
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
