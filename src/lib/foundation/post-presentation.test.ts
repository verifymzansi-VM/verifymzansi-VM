import { it, expect } from "vitest";
import { frontendPostPresentationSchema, presentedFormFields } from "./post-presentation";
it("returns chosen business numbers only for a business presentation", () => {
  const value = frontendPostPresentationSchema.parse({
    data: { website: "https://example.com" },
    media: [],
    business_contacts: { phone: "+27700000123", whatsapp: null },
  });
  expect(presentedFormFields(value, true)).toMatchObject({
    phone: "+27700000123",
    website: "https://example.com",
  });
  expect(presentedFormFields(value, false)).not.toHaveProperty("phone");
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
