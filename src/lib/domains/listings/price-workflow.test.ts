import { describe, it, expect } from "vitest";
import { storeListingPriceTerms, readListingPriceTerms } from "./price-terms";
import { parseListingPriceFilter } from "./price-filter";
import { restoreListingPriceDraft, buildListingPriceDraftCommand } from "./price-draft";
import {
  parseListingPriceAmount,
  changeListingPriceMode,
  changeListingPriceCategory,
  listingPriceFormToTerms,
  restoreListingPriceForm,
  type ListingPriceForm,
} from "./price-form";

describe("explicit listing price workflow", () => {
  it("roundtrips negotiable Price on request without a hidden amount", () => {
    const form: ListingPriceForm = { mode: "on_request", amount: "", negotiable: true };
    const terms = listingPriceFormToTerms(form, "electronics");
    const stored = storeListingPriceTerms(terms, "electronics");
    expect(stored).toEqual({ price_mode: "on_request", price_cents: null, price_negotiable: true });
    expect(restoreListingPriceForm(stored, "electronics")).toEqual(form);
    expect(changeListingPriceCategory(form, "vehicles").negotiable).toBe(true);
    expect(changeListingPriceCategory(form, "jobs_services").negotiable).toBe(false);
    expect(() => listingPriceFormToTerms({ ...form, amount: "10" }, "electronics")).toThrow();
    expect(() => listingPriceFormToTerms(form, "jobs_services")).toThrow();
  });
  it("restores the full RPC DTO without treating metadata as hidden price fields", () => {
    const restored = restoreListingPriceDraft({
      category_key: "electronics",
      price_mode: "amount",
      price_cents: 29,
      price_negotiable: true,
      revision: 4,
      expires_at: "2026-10-27T18:00:00+00:00",
    });
    expect(restored.form).toEqual({ mode: "amount", amount: "0.29", negotiable: true });
    expect(() => buildListingPriceDraftCommand(restored)).toThrow(); // expiry is display metadata, not a command field
    expect(
      buildListingPriceDraftCommand({
        category: restored.category,
        expected_revision: restored.expected_revision,
        form: changeListingPriceMode(restored.form, "free"),
      })
    ).toEqual({
      p_category_key: "electronics",
      p_expected_revision: 4,
      p_terms: { price: { mode: "free" }, negotiable: false },
    });
    expect(() =>
      restoreListingPriceDraft({
        category_key: "electronics",
        price_mode: "free",
        price_cents: 0,
        price_negotiable: false,
        revision: 4,
        expires_at: "invalid",
      })
    ).toThrow();
  });
  it("keeps numeric ranges distinct from Free and undisclosed queries", () => {
    expect(parseListingPriceFilter({ min_cents: 0 })).toEqual({ mode: "amount", min_cents: 0 });
    expect(parseListingPriceFilter({ mode: "free" })).toEqual({ mode: "free" });
    expect(() => parseListingPriceFilter({ mode: "free", max_cents: 0 })).toThrow();
    expect(() => parseListingPriceFilter({ min_cents: 10, max_cents: 1 })).toThrow();
    expect(() => parseListingPriceFilter({ min_cents: Infinity })).toThrow();
    expect(() => parseListingPriceFilter({ owner_id: "foreign" })).toThrow();
  });
  it.each(["0", "-1", "+1", "1e3", "0x10", "1,000", "1.001", "Infinity", "99999999.01", "", "1."])(
    "rejects unsafe decimal text %j",
    (text) => {
      expect(() => parseListingPriceAmount(text)).toThrow();
    }
  );
  it.each([
    ["0.01", 1],
    ["0.29", 29],
    ["19.99", 1999],
    ["99999999", 9999999900],
  ])("converts exact decimal text %s", (text, cents) => {
    expect(parseListingPriceAmount(String(text))).toBe(cents);
  });
  it("clears amount and negotiability when selecting another mode", () => {
    const free = changeListingPriceMode(
      { mode: "amount", amount: "123.45", negotiable: true },
      "free"
    );
    expect(free).toEqual({ mode: "free", amount: "", negotiable: false });
    expect(changeListingPriceMode(free, "amount")).toEqual({
      mode: "amount",
      amount: "",
      negotiable: false,
    });
    expect(() => listingPriceFormToTerms({ ...free, amount: "123.45" }, "electronics")).toThrow();
  });
  it("requires a fresh selection when changing Free to a job and clears salary negotiations", () => {
    expect(
      changeListingPriceCategory({ mode: "free", amount: "", negotiable: false }, "jobs_services")
        .mode
    ).toBe("");
    expect(
      changeListingPriceCategory(
        { mode: "amount", amount: "100", negotiable: true },
        "jobs_services"
      ).negotiable
    ).toBe(false);
  });
  it.each(["amount", "free", "on_request"] as const)(
    "roundtrips a persisted %s draft to form and command",
    (mode) => {
      const terms = {
        price: mode === "amount" ? { mode, amount_cents: 9999999900 } : { mode },
        negotiable: mode === "amount",
      };
      const stored = storeListingPriceTerms(terms, "electronics");
      expect(
        listingPriceFormToTerms(restoreListingPriceForm(stored, "electronics"), "electronics")
      ).toEqual(terms);
    }
  );
  it("rejects ambiguous legacy drafts and unknown categories/authority fields", () => {
    expect(() =>
      restoreListingPriceForm({ price_cents: 0, price_negotiable: false }, "electronics")
    ).toThrow();
    expect(() => storeListingPriceTerms({ price: { mode: "free" } }, "invented")).toThrow();
    expect(() =>
      storeListingPriceTerms({ price: { mode: "free" }, owner_id: "foreign" }, "electronics")
    ).toThrow();
  });
  it.each(["free"] as const)(
    "rejects hidden negotiability for %s in input and stored DTO",
    (mode) => {
      expect(() =>
        storeListingPriceTerms({ price: { mode }, negotiable: true }, "electronics")
      ).toThrow();
      expect(() =>
        readListingPriceTerms(
          { price_mode: mode, price_cents: mode === "free" ? 0 : null, price_negotiable: true },
          "electronics"
        )
      ).toThrow();
    }
  );
});
