import { describe, expect, it } from "vitest";
import {
  customerAccessSchema,
  cleanCustomerAccess,
  legacyAccessFromRecord,
} from "@/lib/forms/customer-access";
import { businessSchema } from "@/lib/validations/business-unified";
import { buildBusinessMutationPayload } from "@/app/api/businesses/_lib/build-business-mutation-payload";
import {
  BUSINESS_CATEGORIES,
  businessCategoryMatches,
  businessCategoryFilterValues,
} from "@/lib/constants/categories";
import { eventTimeToIso } from "@/lib/forms/event-time";

describe("customer access", () => {
  it("supports a home salon with call-outs without publishing an address", () => {
    const access = customerAccessSchema.parse({
      version: 2,
      methods: ["visit", "travel"],
      premises: "home_business",
      serviceAreas: "Soweto, Sandton",
    });
    expect(access.publishAddress).toBe(false);
    const data = businessSchema.parse({
      business_name: "Nomsa's salon",
      slug: "nomsa-salon",
      description: "Braiding and haircuts",
      category: "beauty_personal",
      business_type: "home_business",
      phone: "0821234567",
      location_province: "Gauteng",
      location_city: "Soweto",
      location_address: "Private home",
      map_directions: "https://maps.example.com/private",
      category_details: { customer_access: access },
    });
    const saved = buildBusinessMutationPayload(data);
    expect(saved.location_address).toBeNull();
    expect(saved.map_directions).toBeNull();
    expect(saved.business_details).toBeNull();
    expect(saved.service_areas).toEqual({ areas: ["Soweto", "Sandton"] });
    expect(saved.category_details.customer_access).toMatchObject({ methods: ["visit", "travel"] });
  });
  it("keeps a private shop's street out of its public shop details", () => {
    const data = businessSchema.parse({
      business_name: "Corner tailor",
      slug: "corner-tailor",
      description: "Alterations while you wait",
      category: "professional_services",
      business_type: "standalone_shop",
      phone: "0821234567",
      location_province: "Gauteng",
      location_city: "Soweto",
      business_details: {
        type: "standalone_shop",
        street_address: "12 Private Rd",
        suite_or_unit: "Flat 4",
        suburb: "Orlando",
      },
      category_details: {
        customer_access: { version: 2, methods: ["visit"], premises: "standalone_shop" },
      },
    });
    const saved = buildBusinessMutationPayload(data);
    expect(saved.business_details).toEqual({ type: "standalone_shop", suburb: "Orlando" });
  });
  it("requires service and delivery areas only when relevant", () => {
    expect(customerAccessSchema.safeParse({ version: 2, methods: ["travel"] }).success).toBe(false);
    expect(customerAccessSchema.safeParse({ version: 2, methods: ["delivery"] }).success).toBe(
      false
    );
    expect(
      customerAccessSchema.safeParse({ version: 2, methods: ["delivery"], nationwide: true })
        .success
    ).toBe(true);
    expect(customerAccessSchema.safeParse({ version: 2, methods: ["online"] }).success).toBe(true);
  });
  it("allows an online consultant without a physical address or checkout URL", () => {
    expect(
      businessSchema.safeParse({
        business_name: "Online consulting",
        slug: "online-consulting",
        description: "Advice by video call",
        category: "professional_services",
        business_type: "online_only",
        email: "hello@example.com",
        category_details: { customer_access: { version: 2, methods: ["online"] } },
      }).success
    ).toBe(true);
  });
  it("requires a venue for a stall but no stall number", () => {
    expect(
      customerAccessSchema.safeParse({ version: 2, methods: ["visit"], premises: "market_stall" })
        .success
    ).toBe(false);
    expect(
      customerAccessSchema.safeParse({
        version: 2,
        methods: ["visit"],
        premises: "market_stall",
        venue: "Neighbourgoods Market",
      }).success
    ).toBe(true);
  });
  it("excludes inactive conditional answers", () => {
    expect(
      cleanCustomerAccess({
        version: 2,
        methods: ["online"],
        premises: "home_business",
        venue: "Private",
        serviceAreas: "Soweto",
        deliveryAreas: "Durban",
        publishAddress: true,
      })
    ).toEqual({ version: 2, methods: ["online"], publishAddress: false });
  });
});

describe("posting taxonomy and time", () => {
  it("has 18 distinct business categories and no duplicate activity routes", () => {
    expect(BUSINESS_CATEGORIES).toHaveLength(18);
    const activities = BUSINESS_CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.value));
    expect(new Set(activities).size).toBe(activities.length);
    expect(activities).not.toContain("community_notice");
  });
  it("finds common words and preserves broad legacy URL searches", () => {
    expect(
      BUSINESS_CATEGORIES.filter((c) => businessCategoryMatches(c, "braids")).map((c) => c.value)
    ).toContain("beauty_personal");
    expect(businessCategoryFilterValues("health_beauty")).toContain("health_medical");
  });
  it("interprets times as SAST independently of the computer timezone", () => {
    expect(eventTimeToIso("2026-10-02T18:30")).toBe("2026-10-02T16:30:00.000Z");
    expect(eventTimeToIso("2026-10-02", true)).toBe("2026-10-02T21:59:00.000Z");
  });
});

describe("legacyAccessFromRecord", () => {
  it("keeps delivery, venue and service areas from a pre-v2 record", () => {
    const access = legacyAccessFromRecord({
      businessType: "mall_store",
      venue: "Rosebank Mall",
      serviceAreas: [],
      deliveryAvailable: true,
      nationwide: false,
      city: "Johannesburg",
      hasAddress: true,
    });
    expect(access.methods).toEqual(["visit", "delivery"]);
    expect(access.venue).toBe("Rosebank Mall");
    expect(access.deliveryAreas).toBe("Johannesburg");
    expect(customerAccessSchema.safeParse(access).success).toBe(true);
  });

  it("treats a Nationwide delivery region as nationwide delivery and keeps homes private", () => {
    const access = legacyAccessFromRecord({
      businessType: "home_business",
      deliveryRegions: ["Nationwide"],
      deliveryAvailable: true,
      nationwide: false,
      hasAddress: true,
    });
    expect(access.nationwide).toBe(true);
    expect(access.publishAddress).toBe(false);
  });
});

describe("tour meeting point (server)", () => {
  const tour = (details: Record<string, unknown>, address?: string) =>
    businessSchema.safeParse({
      business_name: "Soweto Heritage Walk",
      slug: "soweto-heritage-walk",
      description: "A guided walking tour through Orlando West.",
      category: "tourism_hospitality",
      subcategory: "tour_operator",
      business_type: "standalone_shop",
      location_province: "Gauteng",
      location_city: "Johannesburg",
      location_address: address,
      contact_methods: ["form"],
      category_details: {
        customer_access: {
          version: 2,
          methods: ["visit"],
          premises: "standalone_shop",
          publishAddress: Boolean(address),
        },
        ...details,
      },
    });

  it("rejects a tour that visitors join with neither a meeting point nor an address", () => {
    const result = tour({});
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain(
      "category_details.meeting_point"
    );
  });

  it("accepts a meeting point or an address", () => {
    expect(tour({ meeting_point: "Outside the Hector Pieterson Museum" }).success).toBe(true);
    expect(tour({}, "8288 Vilakazi Street").success).toBe(true);
  });
});
