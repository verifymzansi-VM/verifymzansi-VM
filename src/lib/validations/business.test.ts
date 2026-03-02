import { describe, expect, it } from "vitest";
import { businessProfileSchema, businessPostSchema } from "./business";

describe("businessProfileSchema", () => {
  const valid = {
    business_name: "Test Business",
    slug: "test-business",
    industry: "technology",
    province: "gauteng",
    city: "Johannesburg",
  };

  it("accepts valid business profile", () => {
    expect(businessProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional fields", () => {
    expect(
      businessProfileSchema.safeParse({
        ...valid,
        description: "A test business description",
        website: "https://example.com",
        whatsapp: "+27821234567",
        email: "biz@test.com",
        logo_url: "https://example.com/logo.png",
        banner_url: "https://example.com/banner.jpg",
      }).success
    ).toBe(true);
  });

  it("accepts empty string for optional URL fields", () => {
    expect(
      businessProfileSchema.safeParse({
        ...valid,
        logo_url: "",
        banner_url: "",
        website: "",
        whatsapp: "",
        email: "",
      }).success
    ).toBe(true);
  });

  it("rejects short business name", () => {
    expect(businessProfileSchema.safeParse({ ...valid, business_name: "X" }).success).toBe(false);
  });

  it("rejects invalid slug", () => {
    expect(businessProfileSchema.safeParse({ ...valid, slug: "UPPER CASE" }).success).toBe(false);
  });

  it("rejects invalid whatsapp number", () => {
    expect(businessProfileSchema.safeParse({ ...valid, whatsapp: "12345" }).success).toBe(false);
  });
});

describe("businessPostSchema", () => {
  it("accepts valid post", () => {
    expect(businessPostSchema.safeParse({ title: "My Update" }).success).toBe(true);
  });

  it("accepts all post types", () => {
    for (const t of ["update", "case_study", "offer", "hiring"]) {
      expect(businessPostSchema.safeParse({ title: "Post", post_type: t }).success).toBe(true);
    }
  });

  it("rejects title too short", () => {
    expect(businessPostSchema.safeParse({ title: "Hi" }).success).toBe(false);
  });

  it("rejects too many media URLs", () => {
    expect(
      businessPostSchema.safeParse({
        title: "Post",
        media_urls: Array(9).fill("https://example.com/img.jpg"),
      }).success
    ).toBe(false);
  });
});
