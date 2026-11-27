import { it, expect } from "vitest";
import {
  businessContactAvailability,
  frontendPostPresentationSchema,
  presentedFormFields,
  revealableBusinessNumber,
} from "./post-presentation";
it("never puts business numbers into the page fields", () => {
  const value = frontendPostPresentationSchema.parse({
    data: { website: "https://example.com" },
    media: [],
    business_contacts: { phone: "+27700000123", whatsapp: "0821234567" },
  });
  const fields = presentedFormFields(value);
  expect(fields).toEqual({ website: "https://example.com" });
  expect(JSON.stringify(fields)).not.toContain("700000123");
});
it("says which business numbers the click-to-view route can serve", () => {
  const parse = (extra: Record<string, unknown>) =>
    frontendPostPresentationSchema.parse({ data: {}, media: [], ...extra });
  expect(
    businessContactAvailability(
      parse({ business_contacts: { phone: "031 123 4567", whatsapp: "0311234567" } })
    )
  ).toEqual({ phone: true, whatsapp: false, email: false });
  expect(
    businessContactAvailability(
      parse({ business_contacts: { phone: null, whatsapp: "+27821234567" } })
    )
  ).toEqual({ phone: false, whatsapp: true, email: false });
  // The database answer wins once it says which channels exist.
  expect(
    businessContactAvailability(
      parse({
        business_contact_options: { phone: true, whatsapp: false },
        business_contacts: { phone: null, whatsapp: "0821234567" },
      })
    )
  ).toEqual({ phone: true, whatsapp: false, email: false });
  expect(businessContactAvailability(undefined)).toEqual({
    phone: false,
    whatsapp: false,
    email: false,
  });
});
it("normalises business numbers like the database", () => {
  expect(revealableBusinessNumber("031 123-4567", "call")).toBe("+27311234567");
  expect(revealableBusinessNumber("(011) 123 4567", "call")).toBe("+27111234567");
  expect(revealableBusinessNumber("0821234567", "whatsapp")).toBe("+27821234567");
  expect(revealableBusinessNumber("27821234567", "call")).toBe("+27821234567");
  expect(revealableBusinessNumber("+27311234567", "whatsapp")).toBeNull();
  expect(revealableBusinessNumber("0911234567", "call")).toBeNull();
  expect(revealableBusinessNumber("12345", "call")).toBeNull();
  expect(revealableBusinessNumber(null, "call")).toBeNull();
});
it("refuses private authority fields and never maps presentation id, status or paid flags over canonical values", () => {
  expect(() =>
    frontendPostPresentationSchema.parse({ data: { owner_id: "fixture" }, media: [] })
  ).toThrow();
  expect(
    presentedFormFields({
      data: {
        id: "forged",
        boost_until: "2099-01-01T00:00:00Z",
        status: "live",
        website: "https://example.com",
      },
      media: [],
    })
  ).toEqual({ website: "https://example.com" });
});
