/* ══════════════════════════════════════════════════════════════
   SHARED ENUMS — mirrors PostgreSQL enums in the database
   ══════════════════════════════════════════════════════════════ */

export type MarketplaceArea = "MZANSI_MARKET" | "MZANSI_BUSINESS" | "BUSINESS_ADS" | "MALL_SHOPS";

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

/* ── Mzansi Business Enums ──────────────────────────────── */
export type BusinessType =
  | "mall_store"
  | "standalone_shop"
  | "home_business"
  | "mobile_service"
  | "online_only"
  | "market_stall";

export type BusinessCategory =
  | "fashion_accessories"
  | "electronics_tech"
  | "groceries_essentials"
  | "health_beauty"
  | "home_living"
  | "food_dining"
  | "trade_maintenance"
  | "professional_services"
  | "education_training"
  | "events_entertainment"
  | "automotive_transport"
  | "general_other";

/* ── Promotion Enums ────────────────────────────────────── */
export type PromotionType = "product" | "service" | "event" | "deal" | "general";

export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  product: "Product",
  service: "Service",
  event: "Event",
  deal: "Deal",
  general: "General",
};

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
  "promotion",
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
  MZANSI_BUSINESS: "Mzansi Business",
  BUSINESS_ADS: "Business Ads",
  MALL_SHOPS: "Mall Shops",
};

export const AREA_SLUGS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "mzansi-market",
  MZANSI_BUSINESS: "mzansi-business",
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

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  mall_store: "Mall Store",
  standalone_shop: "Standalone Shop",
  home_business: "Home Business",
  mobile_service: "Mobile Service",
  online_only: "Online Only",
  market_stall: "Market Stall",
};

export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategory, string> = {
  fashion_accessories: "Fashion & Accessories",
  electronics_tech: "Electronics & Tech",
  groceries_essentials: "Groceries & Essentials",
  health_beauty: "Health, Beauty & Wellness",
  home_living: "Home & Living",
  food_dining: "Food & Dining",
  trade_maintenance: "Trade & Maintenance",
  professional_services: "Professional Services",
  education_training: "Education & Training",
  events_entertainment: "Events & Entertainment",
  automotive_transport: "Automotive & Transport",
  general_other: "General & Other",
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  basic: "Basic",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};
