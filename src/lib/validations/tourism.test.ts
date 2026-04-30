import { describe, expect, it } from "vitest";
import { tourismBusinessSchema, eventSchema, tourismSchema } from "./tourism";

/* ── Helper: minimal valid tourism business ─────────────── */

const TRUSTED_IMG = "https://media.verifymzansi.com/img/1.jpg";

function validTourismBusiness(overrides: Record<string, unknown> = {}) {
  return {
    listing_type: "tourism_business",
    title: "Beach Bungalows Guest House",
    description: "A lovely guest house near the beach with ocean views and great hospitality.",
    province: "Western Cape",
    city: "Cape Town",
    contact_methods: ["call"],
    images: [TRUSTED_IMG],
    category_details: {},
    ...overrides,
  };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    listing_type: "event",
    title: "Jazz Festival 2026",
    description: "Annual jazz festival featuring top SA and international artists.",
    province: "Gauteng",
    city: "Johannesburg",
    contact_methods: ["whatsapp"],
    images: [TRUSTED_IMG],
    start_date: "2026-12-01T18:00:00Z",
    event_details: {},
    ...overrides,
  };
}

describe("tourism validation schemas", () => {
  // ── Tourism business schema ─────────────────────────────

  describe("tourismBusinessSchema", () => {
    it("accepts a minimal valid tourism business", () => {
      const result = tourismBusinessSchema.safeParse(validTourismBusiness());
      expect(result.success).toBe(true);
    });

    it("rejects title shorter than 5 characters", () => {
      const result = tourismBusinessSchema.safeParse(validTourismBusiness({ title: "Hi" }));
      expect(result.success).toBe(false);
    });

    it("rejects title longer than 120 characters", () => {
      const result = tourismBusinessSchema.safeParse(
        validTourismBusiness({ title: "x".repeat(121) })
      );
      expect(result.success).toBe(false);
    });

    it("rejects description shorter than 20 characters", () => {
      const result = tourismBusinessSchema.safeParse(
        validTourismBusiness({ description: "Short." })
      );
      expect(result.success).toBe(false);
    });

    it("requires at least one image", () => {
      const result = tourismBusinessSchema.safeParse(validTourismBusiness({ images: [] }));
      expect(result.success).toBe(false);
    });

    it("rejects non-platform image URLs", () => {
      const result = tourismBusinessSchema.safeParse(
        validTourismBusiness({ images: ["https://evil.com/img.jpg"] })
      );
      expect(result.success).toBe(false);
    });

    it("requires at least one contact method", () => {
      const result = tourismBusinessSchema.safeParse(validTourismBusiness({ contact_methods: [] }));
      expect(result.success).toBe(false);
    });

    it("validates SA phone number format", () => {
      const valid = tourismBusinessSchema.safeParse(
        validTourismBusiness({ phone: "+27612345678" })
      );
      expect(valid.success).toBe(true);

      const invalid = tourismBusinessSchema.safeParse(validTourismBusiness({ phone: "1234" }));
      expect(invalid.success).toBe(false);
    });

    it("accepts valid category details with subcategory", () => {
      const result = tourismBusinessSchema.safeParse(
        validTourismBusiness({
          category_details: {
            subcategory: "hotel_resort",
            star_rating: 4,
            price_range: "midrange",
            cancellation_policy: "moderate",
          },
        })
      );
      expect(result.success).toBe(true);
    });

    it("validates check_in_time HH:mm format", () => {
      const valid = tourismBusinessSchema.safeParse(
        validTourismBusiness({
          category_details: { check_in_time: "14:00" },
        })
      );
      expect(valid.success).toBe(true);

      const invalid = tourismBusinessSchema.safeParse(
        validTourismBusiness({
          category_details: { check_in_time: "2pm" },
        })
      );
      expect(invalid.success).toBe(false);
    });

    it("accepts optional operating hours", () => {
      const result = tourismBusinessSchema.safeParse(
        validTourismBusiness({
          operating_hours: {
            weekday: "08:00-17:00",
            saturday: "09:00-13:00",
          },
        })
      );
      expect(result.success).toBe(true);
    });

    it("normalizes accidental spaces in website and booking URLs", () => {
      const result = tourismBusinessSchema.safeParse(
        validTourismBusiness({
          website: "https:// www.booking.co.za",
          category_details: {
            booking_url: "https:// www.hilton.co.za/en",
          },
        })
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.website).toBe("https://www.booking.co.za");
        expect(result.data.category_details.booking_url).toBe("https://www.hilton.co.za/en");
      }
    });
  });

  // ── Event schema ────────────────────────────────────────

  describe("eventSchema", () => {
    it("accepts a minimal valid event", () => {
      const result = eventSchema.safeParse(validEvent());
      expect(result.success).toBe(true);
    });

    it("requires start_date", () => {
      const { start_date: _, ...noStart } = validEvent();
      const result = eventSchema.safeParse(noStart);
      expect(result.success).toBe(false);
    });

    it("rejects end_date before start_date", () => {
      const result = eventSchema.safeParse(
        validEvent({
          start_date: "2026-12-15T18:00:00Z",
          end_date: "2026-12-10T18:00:00Z",
        })
      );
      expect(result.success).toBe(false);
    });

    it("accepts end_date equal to start_date", () => {
      const result = eventSchema.safeParse(
        validEvent({
          start_date: "2026-12-15T18:00:00Z",
          end_date: "2026-12-15T18:00:00Z",
        })
      );
      expect(result.success).toBe(true);
    });

    it("accepts valid event details", () => {
      const result = eventSchema.safeParse(
        validEvent({
          event_details: {
            event_type: "festival_concert",
            venue_name: "FNB Stadium",
            venue_capacity: 50000,
            age_restriction: "18_plus",
            parking_available: true,
          },
        })
      );
      expect(result.success).toBe(true);
    });

    it("accepts ticket tiers", () => {
      const result = eventSchema.safeParse(
        validEvent({
          event_details: {
            ticket_tiers: [
              { name: "General", price_cents: 15000 },
              { name: "VIP", price_cents: 50000 },
            ],
          },
        })
      );
      expect(result.success).toBe(true);
    });

    it("rejects more than 10 ticket tiers", () => {
      const tiers = Array.from({ length: 11 }, (_, i) => ({
        name: `Tier ${i}`,
        price_cents: 1000 * (i + 1),
      }));
      const result = eventSchema.safeParse(validEvent({ event_details: { ticket_tiers: tiers } }));
      expect(result.success).toBe(false);
    });
  });

  // ── Discriminated union ─────────────────────────────────

  describe("tourismSchema", () => {
    it("dispatches to tourism_business schema", () => {
      const result = tourismSchema.safeParse(validTourismBusiness());
      expect(result.success).toBe(true);
    });

    it("dispatches to event schema", () => {
      const result = tourismSchema.safeParse(validEvent());
      expect(result.success).toBe(true);
    });

    it("rejects unknown listing_type", () => {
      const result = tourismSchema.safeParse({
        ...validTourismBusiness(),
        listing_type: "unknown",
      });
      expect(result.success).toBe(false);
    });
  });
});
