/* ══════════════════════════════════════════════════════════════
   SHARED ENUMS — mirrors PostgreSQL enums in the database
   ══════════════════════════════════════════════════════════════ */

export type MarketplaceArea = "MZANSI_MARKET" | "BUSINESS_ADS" | "MALL_SHOPS";

export type VerificationStepType = "phone" | "id_doc" | "selfie" | "location";

export type VerificationStatus = "pending" | "approved" | "rejected" | "needs_resubmission";

export type SellerVerificationStatus = "incomplete" | "pending_review" | "verified";

export type DocumentType = "sa_id_card" | "sa_id_book" | "sa_passport" | "sa_drivers_license";

export type LocationMethod = "gps" | "proof_of_address";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RiskSignalSeverity = "info" | "warn" | "block";

export type ArtifactKind = "document" | "selfie" | "proof_of_address" | "liveness_frame";

export type ProviderDecision = "approved" | "rejected" | "needs_manual_review";

export type LocationConfidence = "high" | "medium" | "low" | "none";

export type ListingStatus =
  | "draft"
  | "pending_moderation"
  | "flagged_for_review"
  | "live"
  | "hidden"
  | "expired"
  | "sold"
  | "rejected";

export type ListingCategory =
  | "property"
  | "vehicles"
  | "auto_parts"
  | "electronics"
  | "home_lifestyle"
  | "jobs_services";

export type MallShopCategory =
  | "mall_fashion"
  | "mall_electronics"
  | "mall_groceries"
  | "mall_health_beauty"
  | "mall_home_decor"
  | "mall_sports_hobbies"
  | "mall_dining"
  | "mall_services";

export type BusinessAdCategory =
  | "biz_events"
  | "biz_government"
  | "biz_home_trades"
  | "biz_professional"
  | "biz_education"
  | "biz_automotive"
  | "biz_health"
  | "biz_general";

export type ContactMethod = "call" | "whatsapp" | "form";

export type PlanTier = "basic" | "starter" | "growth" | "pro";

export type EntitlementType = "subscription" | "trial" | "pay_per_post";

export type EntitlementStatus = "active" | "expired" | "cancelled";

export type PaymentStatus = "pending" | "complete" | "failed" | "refunded";

export type LeadStatus = "new" | "read" | "contacted" | "closed";

export type ContactEventType = "call" | "whatsapp" | "form";

export type ReportCategory =
  | "scam"
  | "prohibited_item"
  | "impersonation"
  | "harassment"
  | "misleading_info";

export type ReportSeverity = "high" | "standard";

export type ReportStatus = "open" | "in_progress" | "resolved" | "dismissed";

export type EnforcementAction = "warn" | "hide" | "suspend" | "ban" | "dismiss";

export type AccountStatus = "active" | "warned" | "suspended" | "banned";

export type UserRole = "seller" | "moderator" | "admin";

export type DsarType = "access" | "correction" | "deletion" | "objection";

export type DsarStatus =
  | "submitted"
  | "identity_pending"
  | "in_progress"
  | "completed"
  | "rejected";

export type BuyerTokenStatus = "valid" | "expired" | "revoked";

/* ── Media Upload Areas (R2 storage path prefixes) ──────── */
export const UPLOAD_AREAS = [
  "listing",
  "listing_video",
  "business",
  "business_logo",
  "business_cover",
  "storefront",
  "storefront_logo",
  "storefront_cover",
  "mall_cover",
] as const;
export type UploadArea = (typeof UPLOAD_AREAS)[number];

/* ── Trust Level (computed, not in DB) ───────────────────── */
export type TrustLevel = 0 | 1 | 2 | 3 | 4;

/* ── Marketplace Area Labels ─────────────────────────────── */
export const AREA_LABELS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "Mzansi Market",
  BUSINESS_ADS: "Business Ads",
  MALL_SHOPS: "Mall Shops",
};

export const AREA_SLUGS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "mzansi-market",
  BUSINESS_ADS: "business-ads",
  MALL_SHOPS: "mall-shops",
};

export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  property: "Property (For Sale & To Rent)",
  vehicles: "Vehicles (Cars, Bakkies & Commercial)",
  auto_parts: "Auto Parts & Accessories",
  electronics: "Electronics & Tech",
  home_lifestyle: "Home & Lifestyle",
  jobs_services: "Jobs, Services & Other",
};

export const MALL_SHOP_CATEGORY_LABELS: Record<MallShopCategory, string> = {
  mall_fashion: "Fashion & Accessories",
  mall_electronics: "Electronics & Tech",
  mall_groceries: "Groceries & Essentials",
  mall_health_beauty: "Health, Beauty & Wellness",
  mall_home_decor: "Home, Decor & Furniture",
  mall_sports_hobbies: "Sports, Toys & Hobbies",
  mall_dining: "Dining & Food Outlets",
  mall_services: "Specialty Services",
};

export const BUSINESS_AD_CATEGORY_LABELS: Record<BusinessAdCategory, string> = {
  biz_events: "Events & Entertainment",
  biz_government: "Government & Public Notices",
  biz_home_trades: "Home & Trade Services",
  biz_professional: "Professional & Corporate Services",
  biz_education: "Education & Training",
  biz_automotive: "Automotive & Transport",
  biz_health: "Health & Medical Services",
  biz_general: "General Business & Other",
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  basic: "Basic",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};
