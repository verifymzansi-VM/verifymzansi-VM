import { describe, expect, it } from "vitest";
import reference from "@/lib/domains/taxonomy/reference.json";
import {
  APPROVED_SAMPLE_POSTS,
  SAMPLE_BUSINESS_CATEGORIES,
  SAMPLE_EVENT_TYPES,
  SAMPLE_LISTING_CATEGORIES,
  SAMPLE_PROVINCES,
  SAMPLE_TOURISM_ACTIVITIES,
  isPublishedSampleSlug,
  isSampleSlug,
  samplePostsEnabled,
  southAfricanToday,
  upcomingEventDate,
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
};

const event: SamplePostEntry = {
  ...valid,
  slug: "beach-fish-braai",
  area: "event",
  category: "food_wine",
  videoKey: "media/samples/beach-fish-braai.mp4",
  posterKey: "media/samples/beach-fish-braai.webp",
  eventDate: "2026-12-16",
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
});

describe("valid values stay in step with the posting taxonomy", () => {
  const keys = (area: string, kind: string) =>
    reference.categories
      .filter((c) => c.area === area && c.kind === kind)
      .map((c) => c.key)
      .sort();
  const activities = (category: string) =>
    reference.activities
      .filter((a) => a.category === category)
      .map((a) => a.key)
      .sort();

  it("matches the Mzansi Market listing categories", () => {
    expect([...SAMPLE_LISTING_CATEGORIES].sort()).toEqual(keys("market", "listing"));
  });

  it("matches the Mzansi Business categories", () => {
    expect([...SAMPLE_BUSINESS_CATEGORIES].sort()).toEqual(keys("business", "business"));
  });

  it("matches the tourism activities (places to stay and experiences)", () => {
    expect(keys("tourism_events", "business")).toEqual(["tourism_hospitality"]);
    expect([...SAMPLE_TOURISM_ACTIVITIES].sort()).toEqual(activities("tourism_hospitality"));
  });

  it("matches the event types", () => {
    expect(keys("tourism_events", "event")).toEqual(["events"]);
    expect([...SAMPLE_EVENT_TYPES].sort()).toEqual(activities("events"));
  });

  it("matches the province names", () => {
    expect([...SAMPLE_PROVINCES].sort()).toEqual(reference.provinces.map((p) => p.label).sort());
  });
});

describe("validateSamplePost", () => {
  it("accepts a complete entry in each of the four areas", () => {
    expect(validateSamplePost(valid)).toEqual({ ok: true, entry: valid });
    expect(validateSamplePost(event)).toEqual({ ok: true, entry: event });
    for (const [area, category] of [
      ["market", "vehicles"],
      ["tourism", "guest_house_bnb"],
      ["tourism", "safari_wildlife"],
      ["event", "festival_concert"],
    ])
      expect(errorsFor({ ...valid, area, category })).toEqual([]);
  });

  it.each([
    ["title too short", { title: "Cake" }, "title"],
    ["title too long", { title: "x".repeat(101) }, "title"],
    ["description too short", { description: "Fresh cakes." }, "description"],
    ["description too long", { description: "x".repeat(5001) }, "description"],
    ["category from another area", { category: "vehicles" }, "category"],
    [
      "tourism business category in Mzansi Business",
      { category: "tourism_hospitality" },
      "category",
    ],
    ["unknown area", { area: "property" }, "area"],
    ["unknown province", { province: "Natal" }, "province"],
    ["bad slug", { slug: "Example Bakery" }, "slug"],
    ["video outside the samples folder", { videoKey: "media/other/x.mp4" }, "videoKey"],
    ["video of another slug", { videoKey: "media/samples/other.mp4" }, "videoKey"],
    [
      "poster that is a video",
      { posterKey: "media/samples/example-bakery-cakes.mp4" },
      "posterKey",
    ],
    [
      "poster that is not webp",
      { posterKey: "media/samples/example-bakery-cakes.jpg" },
      "posterKey",
    ],
  ])("rejects %s", (_label, change, field) => {
    expect(errorsFor({ ...valid, ...change }).join("\n")).toContain(field);
  });

  it.each(["businessName", "contact", "phone", "whatsapp", "logo"])(
    "names no business and carries no contact: rejects %s",
    (field) => {
      expect(errorsFor({ ...valid, [field]: "Example Bakery" }).join()).toContain(
        `unknown field "${field}"`
      );
    }
  );

  it("takes an event date only for events, as a real date", () => {
    expect(errorsFor({ ...valid, eventDate: "2026-12-16" }).join()).toContain("only for event");
    for (const eventDate of ["2026-02-30", "16-12-2026", "2026-12-16T10:00", "2019-12-16", ""])
      expect(errorsFor({ ...event, eventDate }).join(), eventDate).toContain("eventDate");
    const { eventDate: _unused, ...undated } = event;
    expect(errorsFor(undated)).toEqual([]);
  });

  it("accepts an internal locationConfirmed flag and never passes it on", () => {
    for (const locationConfirmed of [true, false]) {
      const result = validateSamplePost({ ...valid, locationConfirmed });
      expect(result).toEqual({ ok: true, entry: valid });
    }
    expect(errorsFor({ ...valid, locationConfirmed: "yes" }).join()).toContain("locationConfirmed");
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

describe("event dates", () => {
  // 15 December 2026, 23:30 in South Africa (21:30 UTC).
  const evening = new Date("2026-12-15T21:30:00Z");

  it("uses the South African day", () => {
    expect(southAfricanToday(evening)).toBe("2026-12-15");
    expect(southAfricanToday(new Date("2026-12-15T22:30:00Z"))).toBe("2026-12-16");
  });

  it("shows a date that is today or later, and hides a past one (not the sample)", () => {
    expect(upcomingEventDate(event, evening)).toBe("2026-12-16");
    expect(upcomingEventDate(event, new Date("2026-12-16T12:00:00Z"))).toBe("2026-12-16");
    expect(upcomingEventDate(event, new Date("2026-12-16T22:30:00Z"))).toBeNull();
    expect(upcomingEventDate({}, evening)).toBeNull();
  });
});

describe("slugs and the switch", () => {
  it("accepts 3 to 80 lowercase letters, digits and single hyphens", () => {
    expect(isSampleSlug("abc")).toBe(true);
    expect(isSampleSlug("x".repeat(80))).toBe(true);
    for (const slug of ["ab", "x".repeat(81), "a--b", "-ab", "ab-", "Ab-c", "a_b", "a b", 5])
      expect(isSampleSlug(slug), String(slug)).toBe(false);
  });

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
