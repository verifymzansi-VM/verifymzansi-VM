import { describe, it, expect } from "vitest";
import { promotionSchema } from "./promotion";
import { SOCIAL_AUTHORIZATION_VERSION } from "@/lib/promotions/social-authorization";

const VALID_IMAGE = "https://media.verifymzansi.com/promotions/photo.jpg";
const VALID_VIDEO = "https://media.verifymzansi.com/promotions/video.mp4";
const VALID_INPUT = {
  title: "Great Deal on Electronics",
  description:
    "This is a detailed description of our amazing promotion with at least 20 characters.",
  promotion_type: "event" as const,
  province: "Gauteng",
  city: "Johannesburg",
  contact_methods: ["call" as const],
  images: [VALID_IMAGE],
};

describe("promotionSchema", () => {
  it("accepts valid input", () => {
    const result = promotionSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("only accepts event promotion type", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, promotion_type: "event" });
    expect(result.success).toBe(true);

    for (const type of ["product", "service", "deal", "general"]) {
      const rejected = promotionSchema.safeParse({ ...VALID_INPUT, promotion_type: type });
      expect(rejected.success).toBe(false);
    }
  });

  it("rejects invalid promotion type", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, promotion_type: "invalid" });
    expect(result.success).toBe(false);
  });

  // Title validation
  it("rejects title shorter than 5 characters", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, title: "Abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("5 characters");
    }
  });

  it("rejects title longer than 120 characters", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, title: "A".repeat(121) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("120 characters");
    }
  });

  // Description validation
  it("rejects description shorter than 20 characters", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, description: "Too short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("20 characters");
    }
  });

  it("rejects description longer than 5000 characters", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, description: "A".repeat(5001) });
    expect(result.success).toBe(false);
  });

  // Province/city required
  it("rejects empty province", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, province: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty city", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, city: "" });
    expect(result.success).toBe(false);
  });

  // Contact methods
  it("rejects empty contact_methods array", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, contact_methods: [] });
    expect(result.success).toBe(false);
  });

  it("accepts multiple contact methods", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      contact_methods: ["call", "whatsapp", "form"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid contact method", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      contact_methods: ["email"],
    });
    expect(result.success).toBe(false);
  });

  // Images validation
  it("rejects empty images array", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, images: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 images", () => {
    const images = Array.from(
      { length: 11 },
      (_, i) => `https://media.verifymzansi.com/promotions/photo${i}.jpg`
    );
    const result = promotionSchema.safeParse({ ...VALID_INPUT, images });
    expect(result.success).toBe(false);
  });

  it("rejects images not hosted on platform", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      images: ["https://example.com/photo.jpg"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts images from supabase storage", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      images: ["https://abc.supabase.co/storage/v1/object/public/media/photo.jpg"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts images from R2 storage", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      images: ["https://bucket.r2.cloudflarestorage.com/photo.jpg"],
    });
    expect(result.success).toBe(true);
  });

  // Videos
  it("defaults videos to empty array", () => {
    const result = promotionSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.videos).toEqual([]);
    }
  });

  it("rejects more than 3 videos", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      videos: [
        "https://media.verifymzansi.com/v1.mp4",
        "https://media.verifymzansi.com/v2.mp4",
        "https://media.verifymzansi.com/v3.mp4",
        "https://media.verifymzansi.com/v4.mp4",
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects videos not hosted on platform", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      videos: ["https://example.com/promo.mp4"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts platform-hosted videos", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      videos: [VALID_VIDEO],
    });
    expect(result.success).toBe(true);
  });

  // Optional fields
  it("accepts optional price_zar", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, price_zar: 99.99 });
    expect(result.success).toBe(true);
  });

  it("defaults negotiable to false", () => {
    const result = promotionSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.negotiable).toBe(false);
    }
  });

  it("accepts optional start_date and end_date", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      start_date: "2026-03-01T00:00:00.000Z",
      end_date: "2026-04-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional category", () => {
    const result = promotionSchema.safeParse({ ...VALID_INPUT, category: "electronics" });
    expect(result.success).toBe(true);
  });

  it("accepts optional video_thumbnail", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      video_thumbnail: "https://media.verifymzansi.com/thumb.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects video_thumbnail not hosted on platform", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      video_thumbnail: "https://example.com/thumb.jpg",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid social distribution authorization", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      socialAuthorization: {
        granted: true,
        authorizerName: "Nomsa Dlamini",
        authorizerRole: "Owner",
        relationship: "owner",
        monetizationAcknowledged: true,
        acceptedVersion: SOCIAL_AUTHORIZATION_VERSION,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects incomplete social distribution authorization", () => {
    const result = promotionSchema.safeParse({
      ...VALID_INPUT,
      socialAuthorization: {
        granted: true,
        authorizerName: "Nomsa Dlamini",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toEqual(
        expect.arrayContaining([
          "socialAuthorization.authorizerRole",
          "socialAuthorization.relationship",
          "socialAuthorization.monetizationAcknowledged",
          "socialAuthorization.acceptedVersion",
        ])
      );
    }
  });
});
