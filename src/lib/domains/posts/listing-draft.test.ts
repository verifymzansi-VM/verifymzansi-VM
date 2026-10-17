import { describe, it, expect } from "vitest";
import { restoreCoreListingDraft, buildCoreListingTermsCommand } from "./listing-draft";
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "listing",
  area: "market",
  category_key: "electronics",
  status: "draft",
  revision: 1,
};
describe("shared listing price draft", () => {
  it("requires an explicit choice for an unpriced identity", () => {
    const restored = restoreCoreListingDraft({
      ...base,
      price_mode: null,
      price_cents: null,
      price_negotiable: false,
    });
    expect(restored.form.mode).toBe("");
    expect(() => buildCoreListingTermsCommand(restored)).toThrow();
    expect(() =>
      restoreCoreListingDraft({
        ...base,
        price_mode: null,
        price_cents: 0,
        price_negotiable: false,
      })
    ).toThrow();
  });
  it("restores negotiable request terms and builds only actor-free parameters", () => {
    const restored = restoreCoreListingDraft({
      ...base,
      price_mode: "on_request",
      price_cents: null,
      price_negotiable: true,
    });
    expect(buildCoreListingTermsCommand(restored)).toEqual({
      p_id: base.id,
      p_expected_revision: 1,
      p_terms: { price: { mode: "on_request" }, negotiable: true },
    });
    expect(() => buildCoreListingTermsCommand({ ...restored, owner_id: base.id })).toThrow();
    expect(() =>
      buildCoreListingTermsCommand({ ...restored, expected_revision: 2147483647 })
    ).toThrow();
  });
  it.each([
    { status: "live" },
    { kind: "business" },
    { area: "tourism_events" },
    { owner_id: base.id },
    { category_key: "invented" },
    { price_mode: "free", price_cents: 0, price_negotiable: true },
  ])("rejects incompatible or overbroad DTO %j", (bad) => {
    expect(() =>
      restoreCoreListingDraft({
        ...base,
        price_mode: "amount",
        price_cents: 29,
        price_negotiable: false,
        ...bad,
      })
    ).toThrow();
  });
});
