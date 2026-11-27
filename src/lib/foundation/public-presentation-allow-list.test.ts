/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCategoryDetailFields } from "@/lib/forms/business-category-details";
import { readPublishedCustomerAccess } from "@/lib/forms/customer-access-read";
import { BUSINESS_CATEGORY_LABELS, type BusinessCategory } from "@/types/enums";
import { presentedFormFields, presentedVideoLayout } from "./post-presentation";

// The public card read returns only the presentation keys listed in
// internal.public_post_presentation_data. A key a public page reads but the
// database does not list would silently disappear from the page, so these
// checks keep the two in step.
const allowList = readFileSync(
  "database/foundation/current/functions/internal/public_post_presentation_data.sql",
  "utf8"
);
const listed = (key: string) => allowList.includes(`'${key}'`);

/** Every own key `read` asks of an object. */
function keysRead(read: (value: Record<string, unknown>) => unknown) {
  const asked = new Set<string>();
  const probe = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      if (typeof key === "string") asked.add(key);
      return undefined;
    },
    has: (_target, key) => {
      if (typeof key === "string") asked.add(key);
      return false;
    },
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key === "string") asked.add(key);
      return undefined;
    },
  });
  read(probe);
  return [...asked];
}

describe("public presentation allow-list", () => {
  it("lists every presentation key the public form fields and video layout read", () => {
    const keys = [
      ...keysRead((data) => presentedFormFields({ data, media: [] })),
      ...keysRead((data) => presentedVideoLayout({ data, media: [] })),
      "ticket_price_cents",
      "category_label",
    ];
    // Email is no longer collected and is never public.
    const missing = keys.filter((key) => key !== "email" && !listed(key));
    expect(missing).toEqual([]);
    expect(keys).toContain("source_attributes");
  });

  it("lists every category detail field a public business page renders", () => {
    const fields = (Object.keys(BUSINESS_CATEGORY_LABELS) as BusinessCategory[]).flatMap(
      (category) => getCategoryDetailFields(category).map((field) => field.name)
    );
    expect(fields.length).toBeGreaterThan(40);
    expect(fields.filter((name) => !listed(name))).toEqual([]);
    for (const key of ["contact_methods", "customer_access", "venue_photos", "meeting_point"])
      expect(listed(key)).toBe(true);
  });

  it("lists every customer access key the public summary reads", () => {
    const asked = new Set<string>();
    const record = (key: string | symbol) => typeof key === "string" && asked.add(key);
    const access = {
      version: 2,
      methods: ["visit", "travel", "delivery"],
      premises: "mall_store",
      venue: "Fixture Mall",
      serviceAreas: "Durban",
      deliveryAreas: "Durban",
      nationwide: false,
      publishAddress: true,
    };
    const read = readPublishedCustomerAccess(
      new Proxy(access, {
        get: (target, key) => (record(key), Reflect.get(target, key)),
        has: (target, key) => (record(key), Reflect.has(target, key)),
      })
    );
    expect(read?.publishAddress).toBe(true);
    const keys = [...asked];
    expect(keys).toContain("publishAddress");
    expect(keys.filter((key) => !listed(key))).toEqual([]);
  });
});
