import { describe, expect, it } from "vitest";
import { storefrontSchema, storefrontPostSchema } from "./storefront";

describe("storefrontSchema", () => {
  const valid = {
    name: "My Store",
    slug: "my-store",
    province: "western_cape",
    city: "Cape Town",
  };

  it("accepts valid storefront", () => {
    expect(storefrontSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional fields", () => {
    expect(
      storefrontSchema.safeParse({
        ...valid,
        tagline: "Best store in SA",
        description: "A detailed description of the store",
        logo_url: "https://example.com/logo.png",
        whatsapp: "+27821234567",
        operating_hours: "Mon-Fri 9-5",
      }).success
    ).toBe(true);
  });

  it("accepts empty optional strings", () => {
    expect(
      storefrontSchema.safeParse({
        ...valid,
        logo_url: "",
        banner_url: "",
        whatsapp: "",
      }).success
    ).toBe(true);
  });

  it("rejects short store name", () => {
    expect(storefrontSchema.safeParse({ ...valid, name: "XY" }).success).toBe(false);
  });

  it("rejects invalid slug", () => {
    expect(storefrontSchema.safeParse({ ...valid, slug: "CAPS NOT OK" }).success).toBe(false);
  });

  it("rejects missing province", () => {
    expect(storefrontSchema.safeParse({ ...valid, province: "" }).success).toBe(false);
  });
});

describe("storefrontPostSchema", () => {
  it("accepts valid post", () => {
    expect(storefrontPostSchema.safeParse({ title: "New Arrival!" }).success).toBe(true);
  });

  it("accepts all post types", () => {
    for (const t of ["update", "promotion", "event"]) {
      expect(storefrontPostSchema.safeParse({ title: "Post", post_type: t }).success).toBe(true);
    }
  });

  it("rejects title too short", () => {
    expect(storefrontPostSchema.safeParse({ title: "Hi" }).success).toBe(false);
  });

  it("rejects too many media URLs", () => {
    expect(
      storefrontPostSchema.safeParse({
        title: "Post",
        media_urls: Array(6).fill("https://example.com/img.jpg"),
      }).success
    ).toBe(false);
  });
});
