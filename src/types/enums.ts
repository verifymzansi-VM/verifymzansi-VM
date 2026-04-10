/* ══════════════════════════════════════════════════════════════
   SHARED ENUMS — mirrors PostgreSQL enums in the database
   ══════════════════════════════════════════════════════════════ */

export type MarketplaceArea =
  | "MZANSI_MARKET"
  | "MZANSI_BUSINESS"
  | "PROMOTIONS_EVENTS"
  | "BUSINESS_ADS"
  | "MALL_SHOPS";

export type VerificationStepType = "phone" | "id_doc" | "selfie" | "location";

export type VerificationStatus = "pending" | "approved" | "rejected" | "needs_resubmission";

export type AccountVerificationStatus = "incomplete" | "pending_review" | "verified" | "rejected";

export type DocumentType = "sa_id_card" | "sa_id_book" | "sa_passport" | "sa_drivers_license";

export type LocationMethod = "gps" | "proof_of_address" | "manual" | "manual_with_gps";

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
  | "jobs_services"
  | "farming_agriculture"
  | "baby_kids";

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "for_parts";

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
  | "tourism_hospitality"
  | "general_other";

/* ── Promotion Enums ────────────────────────────────────── */
export type PromotionType = "product" | "service" | "event" | "deal" | "general";
export type PromotionEventState = "upcoming" | "ongoing" | "ended";
export type SocialAuthorizerRelationship =
  | "owner"
  | "business_representative"
  | "agency_or_marketing_partner";
export type SocialAuthorizationStatus = "authorized" | "not_authorized" | "revoked";

export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
  product: "Promotions",
  service: "Promotions",
  event: "Events",
  deal: "Deals",
  general: "Ads",
};

export const PROMOTION_EVENT_STATE_LABELS: Record<PromotionEventState, string> = {
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  ended: "Ended",
};

export const SOCIAL_AUTHORIZER_RELATIONSHIP_LABELS: Record<SocialAuthorizerRelationship, string> = {
  owner: "Owner",
  business_representative: "Business Representative",
  agency_or_marketing_partner: "Agency or Marketing Partner",
};

export type ContactMethod = "call" | "whatsapp" | "form" | "in_app";

export type PlanTier = "basic" | "starter" | "growth" | "pro";

export type EntitlementType = "subscription" | "trial" | "pay_per_post";

export type EntitlementStatus = "active" | "expired" | "cancelled";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "complete"
  | "failed"
  | "expired"
  | "refunded";

export type PaymentProvider = "ozow";

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

export type UserRole = "member" | "moderator" | "governance_controller" | "admin";
export type CompatibleUserRole = UserRole;

/** Staff roles that can access the back-office. */
export type StaffRole = "moderator" | "governance_controller" | "admin";

/* ── Decision Lifecycle Enums ───────────────────────────── */

/** Status of a decision record flowing through the recommendation → approval chain. */
export type DecisionStatus =
  | "recommended"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "escalated"
  | "appealed"
  | "overridden"
  | "cancelled";

/** Category of actions that require the full decision chain. */
export type SensitiveActionCategory =
  | "kyc_override"
  | "account_ban"
  | "account_suspend"
  | "content_removal"
  | "data_deletion"
  | "role_change"
  | "policy_exception";

/** Status of an appeal/reconsideration case. */
export type AppealStatus =
  | "submitted"
  | "under_review"
  | "upheld"
  | "overturned"
  | "partially_overturned"
  | "dismissed";

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
  "listing_logo",
  "listing_video",
  "business",
  "business_logo",
  "business_cover",
  "business_gallery",
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
  PROMOTIONS_EVENTS: "Tourism & Events",
  BUSINESS_ADS: "Business Ads",
  MALL_SHOPS: "Mall Shops",
};

export const AREA_SLUGS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "mzansi-market",
  MZANSI_BUSINESS: "mzansi-business",
  PROMOTIONS_EVENTS: "promotions-events",
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
  farming_agriculture: "Farming & Agriculture",
  baby_kids: "Baby & Kids",
};

export const LISTING_CONDITION_LABELS: Record<ListingCondition, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
  for_parts: "For Parts",
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
  tourism_hospitality: "Tourism & Hospitality",
  general_other: "General & Other",
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  basic: "Basic",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};
