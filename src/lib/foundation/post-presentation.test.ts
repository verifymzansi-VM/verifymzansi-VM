import { it, expect } from "vitest";
import {
  businessContactAvailability,
  frontendPostPresentationSchema,
  presentedFormFields,
} from "./post-presentation";
const parse = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  frontendPostPresentationSchema.parse({ data, media: [], ...extra });
it("never puts business numbers into the page fields", () => {
  const value = frontendPostPresentationSchema.parse({
    data: { website: "https://example.com" },
    media: [],
    business_contacts: { phone: "+27700000123", whatsapp: "0821234567" },
  });
  // A rolled-back database's business_contacts is dropped by the parse.
  expect(value).not.toHaveProperty("business_contacts");
  const fields = presentedFormFields(value);
  expect(fields).toEqual({ website: "https://example.com" });
  expect(JSON.stringify(fields)).not.toContain("700000123");
});
it("says which business numbers the click-to-view route can serve, never the numbers", () => {
  expect(
    businessContactAvailability(
      parse({ business_contact_options: { call: true, whatsapp: false } })
    )
  ).toEqual({ phone: true, whatsapp: false, email: false });
  expect(
    businessContactAvailability(
      parse({ business_contact_options: { call: false, whatsapp: true } })
    )
  ).toEqual({ phone: false, whatsapp: true, email: false });
  // Without the database's answer (or with a malformed one): no buttons, even
  // when an older reply still carries numbers.
  for (const value of [
    parse({}, { business_contacts: { phone: "031 123 4567", whatsapp: "0821234567" } }),
    parse({ business_contact_options: { call: "yes", whatsapp: true } }),
    parse({ business_contact_options: { phone: true, whatsapp: true } }),
    undefined,
  ])
    expect(businessContactAvailability(value)).toEqual({
      phone: false,
      whatsapp: false,
      email: false,
    });
  // The options are never a page field.
  expect(
    presentedFormFields(parse({ business_contact_options: { call: true, whatsapp: true } }))
  ).toEqual({});
});
it("never maps a presentation email", () => {
  expect(
    presentedFormFields(parse({ email: "owner@example.invalid", website: "https://example.com" }))
  ).toEqual({ website: "https://example.com" });
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
