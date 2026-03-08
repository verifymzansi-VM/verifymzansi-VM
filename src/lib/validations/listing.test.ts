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
      attributes: { part_type: "brake pads" },
    });
    expect(result.success).toBe(true);
  });

  // ── Electronics ─────────────────────────────────────────

  it("accepts valid electronics listing", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      category: "electronics",
      attributes: { brand: "Samsung" },
    });
    expect(result.success).toBe(true);
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
      attributes: { job_type: "full_time" },
    });
    expect(result.success).toBe(true);
  });

  // ── Common validation ──────────────────────────────────

  it("rejects listing with title too short", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      title: "Hi",
      category: "electronics",
      attributes: { brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects listing with no images", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      images: [],
      category: "electronics",
      attributes: { brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects listing with too many images", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      images: Array(11).fill("https://example.com/img.jpg"),
      category: "electronics",
      attributes: { brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects listing images hosted outside the platform", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      images: ["https://evil.example.com/image.jpg"],
      category: "electronics",
      attributes: { brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative price", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      price_zar: -100,
      category: "electronics",
      attributes: { brand: "LG" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects description too short", () => {
    const result = listingSchema.safeParse({
      ...baseFields,
      description: "Too short",
      category: "electronics",
      attributes: { brand: "LG" },
    });
    expect(result.success).toBe(false);
  });
});
