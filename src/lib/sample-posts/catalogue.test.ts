import { describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES, CATEGORIES, EVENT_TYPES } from "@/lib/constants/categories";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import {
  APPROVED_SAMPLE_POSTS,
  SAMPLE_BUSINESS_CATEGORIES,
  SAMPLE_EVENT_TYPES,
  SAMPLE_LISTING_CATEGORIES,
  SAMPLE_PROVINCES,
  isPublishedSampleSlug,
  samplePostsEnabled,
  validateSamplePost,
  type SamplePostEntry,
} from "./catalogue";

const valid: SamplePostEntry = {
  slug: "example-bakery-cakes",
  area: "business",
  category: "food_dining",
  title: "Celebration cakes baked to order",
  description: "Birthday and wedding cakes, baked fresh to order every week.",
  province: "KwaZulu-Natal",
  city: "Richards Bay",
  videoKey: "media/samples/example-bakery-cakes.mp4",
  posterKey: "media/samples/example-bakery-cakes.webp",
  businessName: "Example Bakery",
};

function errorsFor(value: unknown, source: "committed" | "local" = "committed") {
  const result = validateSamplePost(value, source);
  return result.ok ? [] : result.errors;
}

describe("committed sample catalogue", () => {
  it("contains only valid entries with unique slugs", () => {
    const slugs = new Set<string>();
    for (const entry of APPROVED_SAMPLE_POSTS) {
      expect(errorsFor(entry), entry.slug).toEqual([]);
      expect(slugs.has(entry.slug), `duplicate slug ${entry.slug}`).toBe(false);
      slugs.add(entry.slug);
    }
  });

  it("only shows contact details the business approved", () => {
    for (const entry of APPROVED_SAMPLE_POSTS) {
      if (entry.contact) expect(entry.contact.approvedByBusiness).toBe(true);
    }
  });
});

describe("valid values stay in step with the site's own lists", () => {
  it("matches the listing categories", () => {
    expect([...SAMPLE_LISTING_CATEGORIES].sort()).toEqual(CATEGORIES.map((c) => c.value).sort());
  });

  it("matches the business categories offered to new posts, plus tourism", () => {
    // Tourism & Events businesses are stored as tourism_hospitality.
    expect([...SAMPLE_BUSINESS_CATEGORIES].sort()).toEqual(
      [...BUSINESS_CATEGORIES.map((c) => c.value), "tourism_hospitality"].sort()
    );
  });

  it("matches the event types", () => {
    expect([...SAMPLE_EVENT_TYPES].sort()).toEqual(EVENT_TYPES.map((t) => t.value).sort());
  });

  it("matches the province names", () => {
    expect([...SAMPLE_PROVINCES].sort()).toEqual(SA_PROVINCES.map((p) => p.name).sort());
  });
});

describe("validateSamplePost", () => {
  it("accepts a complete entry", () => {
    expect(validateSamplePost(valid)).toEqual({ ok: true, entry: valid });
  });

  it.each([
    ["title too short", { title: "Cake" }, "title"],
    ["title too long", { title: "x".repeat(101) }, "title"],
    ["description too short", { description: "Fresh cakes." }, "description"],
    ["description too long", { description: "x".repeat(5001) }, "description"],
    ["category from another area", { category: "vehicles" }, "category"],
    ["unknown area", { area: "property" }, "area"],
    ["unknown province", { province: "Natal" }, "province"],
    ["bad slug", { slug: "Example Bakery" }, "slug"],
    ["video outside the samples folder", { videoKey: "media/other/x.mp4" }, "videoKey"],
    ["poster that is a video", { posterKey: "media/samples/x.mp4" }, "posterKey"],
    ["missing business name", { businessName: "" }, "businessName"],
  ])("rejects %s", (_label, change, field) => {
    expect(errorsFor({ ...valid, ...change }).join("\n")).toContain(field);
  });

  it("rejects contact details the business did not approve", () => {
    expect(errorsFor({ ...valid, contact: { phone: "0821234567" } }).join("\n")).toContain(
      "approvedByBusiness"
    );
    expect(
      errorsFor({ ...valid, contact: { approvedByBusiness: "yes", phone: "0821234567" } }).join()
    ).toContain("approvedByBusiness");
  });

  it("rejects numbers placed outside the approved contact block", () => {
    expect(errorsFor({ ...valid, phone: "0821234567" }).join()).toContain('unknown field "phone"');
  });

  it("rejects an approved contact without a valid SA number", () => {
    expect(errorsFor({ ...valid, contact: { approvedByBusiness: true } }).join()).toContain(
      "phone or whatsapp"
    );
    expect(
      errorsFor({ ...valid, contact: { approvedByBusiness: true, phone: "12345" } }).join()
    ).toContain("contact.phone");
  });

  it("accepts an approved contact", () => {
    const entry = { ...valid, contact: { approvedByBusiness: true, whatsapp: "0821234567" } };
    expect(validateSamplePost(entry).ok).toBe(true);
  });

  it("keeps local preview media to plain file names", () => {
    const local = { ...valid, videoKey: "cakes.mp4", posterKey: "cakes.webp" };
    expect(errorsFor(local, "local")).toEqual([]);
    expect(errorsFor(local, "committed").join()).toContain("videoKey");
    expect(errorsFor({ ...local, videoKey: "../secret.mp4" }, "local").join()).toContain(
      "videoKey"
    );
    expect(errorsFor({ ...local, posterKey: "sub/cakes.webp" }, "local").join()).toContain(
      "posterKey"
    );
  });
});

describe("the switch", () => {
  it("is off unless SAMPLE_POSTS_ENABLED is true", () => {
    expect(samplePostsEnabled({})).toBe(false);
    expect(samplePostsEnabled({ SAMPLE_POSTS_ENABLED: "" })).toBe(false);
    expect(samplePostsEnabled({ SAMPLE_POSTS_ENABLED: "false" })).toBe(false);
    expect(samplePostsEnabled({ SAMPLE_POSTS_ENABLED: "1" })).toBe(false);
    expect(samplePostsEnabled({ SAMPLE_POSTS_ENABLED: "true" })).toBe(true);
    expect(samplePostsEnabled({ SAMPLE_POSTS_ENABLED: " TRUE " })).toBe(true);
  });

  it("publishes a slug only when the switch is on and a valid committed entry has it", () => {
    const on = { SAMPLE_POSTS_ENABLED: "true" };
    expect(isPublishedSampleSlug(valid.slug, on, [valid])).toBe(true);
    expect(isPublishedSampleSlug(valid.slug, {}, [valid])).toBe(false);
    expect(isPublishedSampleSlug("someone-else", on, [valid])).toBe(false);
    expect(isPublishedSampleSlug(valid.slug, on, [{ ...valid, title: "x" }])).toBe(false);
    expect(isPublishedSampleSlug("", on, [valid])).toBe(false);
  });
});
