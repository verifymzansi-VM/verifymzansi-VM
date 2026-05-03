import { describe, it, expect } from "vitest";
import {
  mapLegacyContactMethod,
  mapLegacyReportValues,
  mapListingCategory,
  mapDbCategoryToUi,
  normalizePaymentStatus,
  normalizePlanTier,
} from "./enum-compat";

// ── mapLegacyContactMethod ──────────────────────────────────

describe("mapLegacyContactMethod", () => {
  it('maps legacy "in_app" to "form"', () => {
    expect(mapLegacyContactMethod("in_app")).toBe("form");
  });

  it("passes through canonical values unchanged", () => {
    expect(mapLegacyContactMethod("form")).toBe("form");
    expect(mapLegacyContactMethod("whatsapp")).toBe("whatsapp");
    expect(mapLegacyContactMethod("call")).toBe("call");
  });

  it('defaults unknown values to "form"', () => {
    expect(mapLegacyContactMethod("email")).toBe("form");
    expect(mapLegacyContactMethod("")).toBe("form");
  });
});

// ── mapLegacyReportValues ───────────────────────────────────

describe("mapLegacyReportValues", () => {
  it('maps "fake_listing" reason to "misleading_info" category', () => {
    const result = mapLegacyReportValues({
      reason: "fake_listing",
      targetType: "listing",
    });
    expect(result.category).toBe("misleading_info");
  });

  it('maps "spam" and "other" reasons to "misleading_info"', () => {
    expect(mapLegacyReportValues({ reason: "spam", targetType: "listing" }).category).toBe(
      "misleading_info"
    );
    expect(mapLegacyReportValues({ reason: "other", targetType: "listing" }).category).toBe(
      "misleading_info"
    );
  });

  it("passes through canonical reason values unchanged", () => {
    expect(mapLegacyReportValues({ reason: "scam", targetType: "listing" }).category).toBe("scam");
    expect(mapLegacyReportValues({ reason: "harassment", targetType: "listing" }).category).toBe(
      "harassment"
    );
    expect(mapLegacyReportValues({ reason: "impersonation", targetType: "listing" }).category).toBe(
      "impersonation"
    );
    expect(
      mapLegacyReportValues({ reason: "prohibited_item", targetType: "listing" }).category
    ).toBe("prohibited_item");
  });

  it('defaults unknown reason to "misleading_info"', () => {
    expect(mapLegacyReportValues({ reason: "unknown_thing", targetType: "listing" }).category).toBe(
      "misleading_info"
    );
  });

  it('maps legacy "business" targetType to "business"', () => {
    const result = mapLegacyReportValues({
      reason: "scam",
      targetType: "business",
    });
    expect(result.targetType).toBe("business");
  });

  it("passes through canonical targetType values unchanged", () => {
    expect(mapLegacyReportValues({ reason: "scam", targetType: "listing" }).targetType).toBe(
      "listing"
    );
    expect(
      mapLegacyReportValues({ reason: "scam", targetType: "account_profile" }).targetType
    ).toBe("account_profile");
    expect(mapLegacyReportValues({ reason: "scam", targetType: "storefront" }).targetType).toBe(
      "business"
    );
    expect(
      mapLegacyReportValues({ reason: "scam", targetType: "business_profile" }).targetType
    ).toBe("business");
  });

  it("resolves MarketplaceArea from canonical targetType", () => {
    expect(mapLegacyReportValues({ reason: "scam", targetType: "listing" }).area).toBe(
      "MZANSI_MARKET"
    );
    expect(mapLegacyReportValues({ reason: "scam", targetType: "account_profile" }).area).toBe(
      "MZANSI_MARKET"
    );
    expect(mapLegacyReportValues({ reason: "scam", targetType: "storefront" }).area).toBe(
      "MZANSI_BUSINESS"
    );
    expect(mapLegacyReportValues({ reason: "scam", targetType: "business" }).area).toBe(
      "MZANSI_BUSINESS"
    );
  });

  it('defaults unknown targetType area to "MZANSI_MARKET"', () => {
    expect(mapLegacyReportValues({ reason: "scam", targetType: "unknown" }).area).toBe(
      "MZANSI_MARKET"
    );
  });
});

// ── normalizePaymentStatus ──────────────────────────────────

describe("normalizePaymentStatus", () => {
  it('maps "completed" → "complete"', () => {
    expect(normalizePaymentStatus("completed")).toBe("complete");
  });

  it('maps "cancelled" → "failed"', () => {
    expect(normalizePaymentStatus("cancelled")).toBe("failed");
  });

  it("passes through canonical statuses unchanged", () => {
    expect(normalizePaymentStatus("pending")).toBe("pending");
    expect(normalizePaymentStatus("complete")).toBe("complete");
    expect(normalizePaymentStatus("failed")).toBe("failed");
    expect(normalizePaymentStatus("refunded")).toBe("refunded");
  });

  it("returns unknown statuses as-is (no silent swallow)", () => {
    expect(normalizePaymentStatus("mystery")).toBe("mystery");
  });
});

// ── mapListingCategory (UI → DB) ────────────────────────────

describe("mapListingCategory", () => {
  it("maps UI slugs to DB enum values", () => {
    expect(mapListingCategory("property")).toBe("property");
    expect(mapListingCategory("vehicles")).toBe("vehicles");
    expect(mapListingCategory("auto_parts")).toBe("auto_parts");
    expect(mapListingCategory("electronics")).toBe("electronics");
    expect(mapListingCategory("home_lifestyle")).toBe("home_lifestyle");
    expect(mapListingCategory("jobs_services")).toBe("jobs_services");
    expect(mapListingCategory("farming_agriculture")).toBe("farming_agriculture");
    expect(mapListingCategory("baby_kids")).toBe("baby_kids");
  });

  it("passes through unknown categories as-is", () => {
    expect(mapListingCategory("unknown_cat")).toBe("unknown_cat");
  });
});

// ── mapDbCategoryToUi (DB → UI) ──────────────────────────────

describe("mapDbCategoryToUi", () => {
  it("maps DB enum values back to UI slugs", () => {
    expect(mapDbCategoryToUi("vehicles")).toBe("vehicles");
    expect(mapDbCategoryToUi("auto_parts")).toBe("auto_parts");
    expect(mapDbCategoryToUi("electronics")).toBe("electronics");
    expect(mapDbCategoryToUi("jobs_services")).toBe("jobs_services");
    expect(mapDbCategoryToUi("property")).toBe("property");
    expect(mapDbCategoryToUi("home_lifestyle")).toBe("home_lifestyle");
    expect(mapDbCategoryToUi("farming_agriculture")).toBe("farming_agriculture");
    expect(mapDbCategoryToUi("baby_kids")).toBe("baby_kids");
  });

  it("passes through unknown DB categories as-is", () => {
    expect(mapDbCategoryToUi("mystery")).toBe("mystery");
  });
});

// ── normalizePlanTier (pass-through) ────────────────────────

describe("normalizePlanTier", () => {
  it("passes through all plan tiers unchanged", () => {
    expect(normalizePlanTier("basic")).toBe("basic");
    expect(normalizePlanTier("starter")).toBe("starter");
    expect(normalizePlanTier("growth")).toBe("growth");
    expect(normalizePlanTier("pro")).toBe("pro");
  });
});
