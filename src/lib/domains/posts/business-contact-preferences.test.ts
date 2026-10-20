/** @vitest-environment node */
import { expect, it } from "vitest";
import {
  buildBusinessContactPreferences,
  storedBusinessContactPreferencesSchema,
} from "./business-contact-preferences";

const empty = () => ({ channels: [], phone: null, whatsapp: null, email: null, website: null });

it("requires explicit selection and rejects client authority or proof assertions", () => {
  for (const value of [
    undefined,
    {},
    { channels: null },
    { channels: ["sms"] },
    { channels: ["in_app"] },
    { channels: [], owner_id: "other" },
    { channels: [], verified: true },
    { channels: [], phone_proof_id: "proof" },
    { channels: [], expected_revision: 1 },
  ])
    expect(() => buildBusinessContactPreferences(value)).toThrow(
      /^Invalid business contact preferences$/
    );
});

it("preserves all five choices as a canonical explicit set", () => {
  expect(
    buildBusinessContactPreferences({ channels: ["website", "email", "call", "whatsapp", "form"] })
  ).toEqual({ ...empty(), channels: ["call", "whatsapp", "email", "website", "form"] });
  expect(buildBusinessContactPreferences({ channels: ["form", "call", "call"] }).channels).toEqual([
    "call",
    "form",
  ]);
});

it("clears stale deselected values without validating or retaining them", () => {
  expect(
    buildBusinessContactPreferences({
      channels: [],
      phone: "not a number",
      whatsapp: { private: "stale" },
      email: "bad",
      website: "javascript:bad",
    })
  ).toEqual(empty());
  expect(buildBusinessContactPreferences({ channels: ["form"], phone: "0112345678" })).toEqual({
    ...empty(),
    channels: ["form"],
  });
});

it("normalises each selected number independently and never copies an account or another channel", () => {
  const result = buildBusinessContactPreferences({
    channels: ["call", "whatsapp"],
    phone: "011 234 5678",
    whatsapp: "071 234 5678",
  });
  expect(result).toEqual({
    ...empty(),
    channels: ["call", "whatsapp"],
    phone: "+27112345678",
    whatsapp: "+27712345678",
  });
  expect(
    buildBusinessContactPreferences({ channels: ["call", "whatsapp"], phone: "0112345678" })
      .whatsapp
  ).toBeNull();
  expect(Object.keys(result).sort()).toEqual(["channels", "email", "phone", "website", "whatsapp"]);
});

it("keeps incomplete private selections distinct from publication readiness", () => {
  expect(
    buildBusinessContactPreferences({
      channels: ["call", "email", "website"],
      phone: "",
      email: null,
    })
  ).toEqual({ ...empty(), channels: ["call", "email", "website"] });
  for (const value of [
    { channels: ["call"], phone: 112345678 },
    { channels: ["whatsapp"], whatsapp: "+447123456789" },
    { channels: ["email"], email: "other@example.invalid\r\nBcc: hidden@example.invalid" },
    { channels: ["website"], website: "javascript:alert(1)" },
    { channels: ["website"], website: "https://user:password@example.invalid" },
  ])
    expect(() => buildBusinessContactPreferences(value)).toThrow(
      /^Invalid business contact preferences$/
    );
});

it("preserves email case and normalises the current business form's website input without fetching it", () => {
  expect(
    buildBusinessContactPreferences({
      channels: ["email", "website"],
      email: " Owner@Example.invalid ",
      website: "www.example.invalid/contact",
    })
  ).toEqual({
    ...empty(),
    channels: ["email", "website"],
    email: "Owner@Example.invalid",
    website: "https://www.example.invalid/contact",
  });
});

it("rejects noncanonical stored channels/numbers, hidden retained values and proof metadata", () => {
  const view = { ...empty(), channels: ["call"], phone: "+27112345678" };
  expect(storedBusinessContactPreferencesSchema.safeParse(view).success).toBe(true);
  for (const value of [
    { ...view, phone: "0112345678" },
    { ...empty(), channels: ["website"], website: "www.example.invalid" },
    { ...empty(), channels: ["website"], website: " https://www.example.invalid " },
    { ...view, channels: ["call", "call"] },
    { ...view, channels: ["form", "call"] },
    { ...view, channels: [] },
    { ...view, verified: true },
    { ...view, proof_id: "private" },
    { ...view, phone_verified: true },
  ])
    expect(storedBusinessContactPreferencesSchema.safeParse(value).success).toBe(false);
});

it("keeps every accepted website builder result valid as its stored representation", () => {
  for (const value of [
    "www.example.invalid/contact",
    "Website: https:// www.example.invalid/path",
    "https://example.invalid/path",
    "http://example.invalid/path",
    "HTTPS://EXAMPLE.invalid/path",
  ]) {
    const built = buildBusinessContactPreferences({ channels: ["website"], website: value });
    expect(storedBusinessContactPreferencesSchema.safeParse(built).success).toBe(true);
  }
  for (const website of [
    "https:example.invalid",
    "http:/example.invalid",
    "https:/example.invalid",
  ])
    expect(() => buildBusinessContactPreferences({ channels: ["website"], website })).toThrow(
      /^Invalid business contact preferences$/
    );
});

it("preserves full-length unicode website and email values for a canonical SQL payload", () => {
  const prefix = "https://example.invalid/";
  const website = prefix + "😀".repeat(2000 - Array.from(prefix).length);
  const value = buildBusinessContactPreferences({
    channels: ["call", "whatsapp", "email", "website", "form"],
    phone: "0112345678",
    whatsapp: "0712345678",
    email:
      "a".repeat(63) + "@" + "b".repeat(60) + "." + "c".repeat(60) + "." + "d".repeat(60) + ".com",
    website,
  });
  expect(Array.from(value.website!).length).toBe(2000);
  expect(storedBusinessContactPreferencesSchema.safeParse(value).success).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeGreaterThan(8192);
});
