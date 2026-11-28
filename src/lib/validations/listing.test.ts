import { describe, expect, it } from "vitest";
import { listingSchema } from "./listing";

// ── Listing Schema ──────────────────────────────────────────────────────────

const baseFields = {
  title: "Valid Listing Title Here",
  description: "This is a detailed description of the listing with enough characters.",
  price_zar: 500,
  negotiable: false,
  province: "gauteng",
  city: "Johannesburg",
  images: ["https://media.verifymzansi.com/image.jpg"],
};

describe("listingSchema", () => {
  // ── Property ────────────────────────────────────────────

  it("accepts valid property listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "property",
      attributes: {
        property_type: "apartment",
        listing_intent: "sale",
        bedrooms: 2,
        bathrooms: 1,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects property listing without property_type", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "property",
      attributes: { bedrooms: 2 },
    });
    expect(result.success).toBe(false);
  });

  // ── Cars ────────────────────────────────────────────────

  it("accepts valid cars listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "vehicles",
      attributes: {
        make: "Toyota",
        model: "Corolla",
        year: 2022,
        mileage_km: 35000,
        transmission: "manual",
        fuel_type: "petrol",
        service_history: "full",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects cars with future year beyond limit", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "vehicles",
      attributes: {
        make: "Toyota",
        model: "X",
        year: 2090,
        mileage_km: 0,
        transmission: "automatic",
        fuel_type: "diesel",
      },
    });
    expect(result.success).toBe(false);
  });

  // ── Auto Parts ──────────────────────────────────────────

  it("accepts valid auto_parts listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "auto_parts",
      attributes: { part_type: "brake pads", part_condition: "new" },
    });
    expect(result.success).toBe(true);
  });

  // ── Electronics ─────────────────────────────────────────

  it("accepts valid electronics listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "Samsung" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects electronics listing without device_type", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "electronics",
      attributes: { brand: "Samsung" },
    });
    expect(result.success).toBe(false);
  });

  // ── Home & Lifestyle ───────────────────────────────────

  it("accepts valid home_lifestyle listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "home_lifestyle",
      attributes: { sub_category: "furniture" },
    });
    expect(result.success).toBe(true);
  });

  // ── Jobs ────────────────────────────────────────────────

  it("accepts valid jobs listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "jobs_services",
      attributes: { job_type: "full_time", location_type: "on_site" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects condition on jobs listings", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "jobs_services",
      condition: "good",
      attributes: { job_type: "full_time", location_type: "on_site" },
    });
    expect(result.success).toBe(false);
  });

  // ── Common validation ──────────────────────────────────

  it("rejects titles with hidden text-direction characters", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      title: `iPhone 15 for R${String.fromCharCode(0x202e)}0001`,
      category: "electronics",
      attributes: { device_type: "phone" },
    });
    expect(result.success).toBe(false);
  });

  it("trims titles and caps attribute lists", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      title: "   Valid Listing Title Here   ",
      category: "property",
      attributes: {
        property_type: "apartment",
        listing_intent: "sale",
        security_features: Array.from({ length: 31 }, (_, i) => `feature ${i}`),
      },
    });
    expect(result.success).toBe(false);
    const ok = listingSchema.safeParse({
      ...baseFields,
      title: "   Valid Listing Title Here   ",
      category: "property",
      attributes: { property_type: "apartment", listing_intent: "sale" },
    });
    expect(ok.success && ok.data.title).toBe("Valid Listing Title Here");
  });

  it("rejects listing with title too short", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      title: "Hi",
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects listing with no images", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      images: [],
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects listing with too many images", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      images: Array(11).fill("https://example.com/img.jpg"),
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects listing images hosted outside the platform", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      images: ["https://evil.example.com/image.jpg"],
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative price", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      price_zar: -100,
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects description too short", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      description: "Too short",
      category: "electronics",
      attributes: { device_type: "Smartphone", brand: "LG" },
    });
    expect(result.success).toBe(false);
  });
});

describe("listingSchema: Market fields saved with the post", () => {
  it("accepts and keeps how the buyer gets it, size and gender, and strips unknown keys", () => {
    const result = listingSchema.parse({
      ...baseFields,
      category: "clothing_accessories",
      attributes: {
        size: " M ",
        gender: "women",
        delivery_methods: ["collect", "meet_public", "courier", "seller_delivers"],
        not_a_field: "x",
      },
    });
    expect(result.attributes).toEqual({
      size: "M",
      gender: "women",
      delivery_methods: ["collect", "meet_public", "courier", "seller_delivers"],
    });
  });

  it("rejects a size over 20 characters, an unknown gender and an unknown delivery method", () => {
    for (const attributes of [
      { size: "x".repeat(21) },
      { gender: "adults" },
      { delivery_methods: ["teleport"] },
    ])
      expect(
        listingSchema.safeParse({ ...baseFields, category: "sports_hobbies", attributes }).success
      ).toBe(false);
  });

  it("accepts the property rental and sale details and the pets choice", () => {
    const result = listingSchema.parse({
      ...baseFields,
      category: "property",
      attributes: {
        property_type: "house",
        listing_intent: "rent",
        available_from: "2026-12-01",
        deposit_zar: 9000,
        lease_term: "12_months",
        utilities_included: ["prepaid_electricity", "water"],
        occupation_date: "2027-01-15",
        pets_policy: "ask",
      },
    });
    expect(result.attributes).toMatchObject({
      deposit_zar: 9000,
      lease_term: "12_months",
      utilities_included: ["prepaid_electricity", "water"],
      occupation_date: "2027-01-15",
      pets_policy: "ask",
    });
    expect(
      listingSchema.safeParse({
        ...baseFields,
        category: "property",
        attributes: { property_type: "house", listing_intent: "sale", occupation_date: "soon" },
      }).success
    ).toBe(false);
  });

  it("accepts website and social links, keeps only the known networks, and rejects a bad link", () => {
    const result = listingSchema.parse({
      ...baseFields,
      category: "electronics",
      attributes: { device_type: "Laptop", brand: "Dell" },
      website: "https://shop.example.co.za",
      social_links: {
        facebook: "https://facebook.com/shop",
        youtube: "https://youtube.com/@shop",
        myspace: "https://myspace.com/shop",
      },
    });
    expect(result.website).toBe("https://shop.example.co.za");
    expect(result.social_links).toEqual({
      facebook: "https://facebook.com/shop",
      youtube: "https://youtube.com/@shop",
    });
    expect(
      listingSchema.safeParse({
        ...baseFields,
        category: "electronics",
        attributes: { device_type: "Laptop", brand: "Dell" },
        website: "not a link",
      }).success
    ).toBe(false);
  });

  it("still accepts older posts without the new fields", () => {
    expect(
      listingSchema.safeParse({
        ...baseFields,
        category: "property",
        attributes: { property_type: "house", listing_intent: "sale", pets_allowed: true },
      }).success
    ).toBe(true);
  });
});
