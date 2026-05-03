/**
 * Enum Compatibility Layer
 *
 * Maps legacy UI/request values to canonical DB enum values.
 * Ensures backwards-compatible API acceptance while writing valid DB data.
 */

import type { ReportCategory, MarketplaceArea, ContactEventType } from "@/types/enums";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("EnumCompat");

// ── Contact Method Mapping ──────────────────────────────────

const CONTACT_METHOD_MAP: Record<string, ContactEventType> = {
  in_app: "form",
  form: "form",
  whatsapp: "whatsapp",
  call: "call",
};

/**
 * Map legacy contact method values (e.g. "in_app") to canonical contact_type enum.
 */
export function mapLegacyContactMethod(method: string): ContactEventType {
  return CONTACT_METHOD_MAP[method] || "form";
}

// ── Report Reason → Category Mapping ────────────────────────

const REPORT_REASON_TO_CATEGORY: Record<string, ReportCategory> = {
  scam: "scam",
  misleading: "misleading_info",
  expired: "misleading_info",
  fake_listing: "misleading_info",
  prohibited_item: "prohibited_item",
  harassment: "harassment",
  impersonation: "impersonation",
  spam: "misleading_info",
  other: "misleading_info",
};

// ── Report Target Type → Area Mapping ───────────────────────

const TARGET_TYPE_CANONICAL: Record<string, string> = {
  listing: "listing",
  promotion: "promotion",
  storefront: "business",
  business: "business",
  business_profile: "business",
  account_profile: "account_profile",
};

const TARGET_TYPE_TO_AREA: Record<string, MarketplaceArea> = {
  listing: "MZANSI_MARKET",
  account_profile: "MZANSI_MARKET",
  promotion: "PROMOTIONS_EVENTS",
  business: "MZANSI_BUSINESS",
  storefront: "MZANSI_BUSINESS",
  business_profile: "MZANSI_BUSINESS",
};

/**
 * Map legacy report reason/targetType values to canonical DB enums.
 */
export function mapLegacyReportValues(input: { reason: string; targetType: string }): {
  category: ReportCategory;
  targetType: string;
  area: MarketplaceArea;
} {
  const category = REPORT_REASON_TO_CATEGORY[input.reason];
  if (!category) {
    log.warn("Unknown report reason — defaulting to misleading_info", { reason: input.reason });
  }
  const targetType = TARGET_TYPE_CANONICAL[input.targetType];
  if (!targetType) {
    log.warn("Unknown report target type — using raw value", { targetType: input.targetType });
  }
  const resolvedTargetType = targetType || input.targetType;
  const area = TARGET_TYPE_TO_AREA[resolvedTargetType] || "MZANSI_MARKET";

  return { category: category || "misleading_info", targetType: resolvedTargetType, area };
}

// ── Listing Category Mapping ────────────────────────────────

/** UI slug → DB enum value for listing_category.
 *  After migration 20260225 the DB enum values match the UI slugs,
 *  so all mappings are now identity. Kept for forward-compat. */
const LISTING_CATEGORY_UI_TO_DB: Record<string, string> = {
  property: "property",
  vehicles: "vehicles",
  auto_parts: "auto_parts",
  electronics: "electronics",
  home_lifestyle: "home_lifestyle",
  jobs_services: "jobs_services",
  farming_agriculture: "farming_agriculture",
  baby_kids: "baby_kids",
};

/** DB enum value → UI slug (reverse of above). */
const LISTING_CATEGORY_DB_TO_UI: Record<string, string> = Object.fromEntries(
  Object.entries(LISTING_CATEGORY_UI_TO_DB).map(([ui, db]) => [db, ui])
);

/**
 * Map UI listing category slugs to valid DB enum values.
 * e.g. "vehicles" → "cars_vehicles"
 */
export function mapListingCategory(uiCategory: string): string {
  const mapped = LISTING_CATEGORY_UI_TO_DB[uiCategory];
  if (!mapped) {
    log.warn("Listing category not in UI-to-DB map, using raw value", { uiCategory });
  }
  return mapped ?? uiCategory;
}

/**
 * Map DB listing_category enum values back to UI slugs.
 * e.g. "cars_vehicles" → "vehicles"
 */
export function mapDbCategoryToUi(dbCategory: string): string {
  return LISTING_CATEGORY_DB_TO_UI[dbCategory] ?? dbCategory;
}

// ── Payment Status Normalization ────────────────────────────

const PAYMENT_STATUS_CANONICAL: Record<string, string> = {
  pending: "pending",
  processing: "processing",
  complete: "complete",
  completed: "complete",
  failed: "failed",
  cancelled: "failed",
  expired: "expired",
  refunded: "refunded",
};

/**
 * Normalize payment status to canonical DB enum value.
 * Accepts legacy values like "completed" and "cancelled".
 */
export function normalizePaymentStatus(status: string): string {
  return PAYMENT_STATUS_CANONICAL[status] || status;
}

// ── Plan Tier Aliasing ──────────────────────────────────────

/**
 * Map "basic" plan tier alias to valid behavior.
 * The DB has: basic, starter, growth, pro.
 * "basic" is a valid tier but some legacy code may treat it as "starter".
 */
export function normalizePlanTier(tier: string): string {
  return tier; // Currently all tiers are valid DB values
}
