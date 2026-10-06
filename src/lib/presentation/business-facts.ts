import type {
  BusinessDetailRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import {
  BUSINESS_CATEGORIES,
  TOURISM_AGE_RESTRICTIONS,
  TOURISM_CANCELLATION_POLICIES,
  TOURISM_DIFFICULTY_LEVELS,
  TOURISM_PRICE_RANGES,
  TOURISM_SUBCATEGORIES,
  TOURISM_TOUR_DURATIONS,
  TOURISM_VISIT_DURATIONS,
} from "@/lib/constants/categories";
import type { BusinessProfileFamily } from "@/lib/presentation/profile-variants";
import { humanizeKey, type FactItem } from "@/lib/presentation/listing-facts";
import {
  PRIMARY_ORDER_CHANNEL_LABELS,
  WALK_IN_POLICY_LABELS,
} from "@/lib/forms/business-type-details";
import { formatRandAmount } from "@/lib/utils/format";
import type { BusinessDetails } from "@/types/business-details";

export interface SpotlightFact extends FactItem {
  /** Long free text that reads better across the full width. */
  wide?: boolean;
}

export const SOCIAL_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  website: "Website",
};

const BBBEE_LEVEL_LABELS: Record<string, string> = {
  level_1: "Level 1",
  level_2: "Level 2",
  level_3: "Level 3",
  level_4: "Level 4",
  level_5: "Level 5",
  level_6: "Level 6",
  level_7: "Level 7",
  level_8: "Level 8",
  non_compliant: "Non-Compliant",
  exempt: "Exempt (EME)",
};

const EMPLOYEE_COUNT_LABELS: Record<string, string> = {
  "1": "1 (Solo)",
  "2_5": "2 – 5",
  "6_10": "6 – 10",
  "11_50": "11 – 50",
  "51_200": "51 – 200",
  "200_plus": "200+",
};

const CHILD_POLICY_LABELS: Record<string, string> = {
  children_welcome: "Children welcome",
  children_over_6: "Children 6+",
  children_over_12: "Children 12+",
  adults_only: "Adults only",
};

export function getSubcategoryLabel(category: string, subcategory: string | null | undefined) {
  if (!subcategory) return null;
  const categoryDefinition = BUSINESS_CATEGORIES.find((item) => item.value === category);
  const match =
    categoryDefinition?.subcategories.find((item) => item.value === subcategory) ??
    TOURISM_SUBCATEGORIES.find((item) => item.value === subcategory);
  return match?.label ?? humanizeKey(subcategory);
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

/** Profiles saved with explicit contact methods only show the inbox when the owner chose it. */
export function acceptsInboxEnquiries(categoryDetails: unknown): boolean {
  const methods = (categoryDetails as { contact_methods?: unknown } | null)?.contact_methods;
  return !Array.isArray(methods) || methods.includes("form");
}

/**
 * Facts the owner entered under "Additional Business Details" in the create
 * form. The API folds them into `category_details.business_profile` — render
 * them so the form data actually reaches the public profile.
 */
export function getBusinessProfileFacts(
  business: BusinessDetailRecord,
  options?: { includeLanguages?: boolean }
): FactItem[] {
  const details = (business.category_details ?? {}) as Record<string, unknown>;
  const profile = details.business_profile;
  if (!profile || typeof profile !== "object") return [];
  const p = profile as Record<string, unknown>;
  const facts: FactItem[] = [];

  if (typeof p.year_established === "number" && p.year_established > 0) {
    facts.push({ label: "Established", value: String(p.year_established) });
  }
  if (typeof p.number_of_employees === "string" && p.number_of_employees) {
    facts.push({
      label: "Team Size",
      value: EMPLOYEE_COUNT_LABELS[p.number_of_employees] ?? p.number_of_employees,
    });
  }
  if (typeof p.bbbee_level === "string" && p.bbbee_level) {
    facts.push({ label: "B-BBEE", value: BBBEE_LEVEL_LABELS[p.bbbee_level] ?? p.bbbee_level });
  }
  if (typeof p.cipc_registration === "string" && p.cipc_registration) {
    facts.push({ label: "CIPC Reg.", value: p.cipc_registration });
  }
  if (
    options?.includeLanguages !== false &&
    typeof p.languages_spoken === "string" &&
    p.languages_spoken
  ) {
    facts.push({ label: "Languages", value: p.languages_spoken });
  }
  if (p.load_shedding_ready === true) {
    facts.push({ label: "Load-Shedding", value: "Backup power ready" });
  }

  return facts;
}

export function getBusinessQuickFacts(
  family: BusinessProfileFamily,
  business: BusinessDetailRecord,
  deliveryAvailable: boolean,
  promotions: Pick<BusinessPromotionRecord, "id">[]
): FactItem[] {
  const servicesCount = business.services_offered?.length ?? 0;
  const galleryCount = business.gallery_photos?.length ?? 0;
  const paymentCount = business.payment_methods_accepted?.length ?? 0;
  const serviceAreaCount = business.service_areas?.areas?.length ?? 0;

  // A stay's rooms, rates and times are all in its details card; don't repeat them.
  if (family === "tourism") return [];

  if (family === "professional") {
    return [
      serviceAreaCount > 0 ? { label: "Service Areas", value: `${serviceAreaCount} listed` } : null,
      servicesCount > 0 ? { label: "Services", value: `${servicesCount} offered` } : null,
      deliveryAvailable ? { label: "Delivery", value: "Available" } : null,
      business.map_directions ? { label: "Directions", value: "Map link available" } : null,
      business.website ? { label: "Website", value: "Public website" } : null,
    ].filter((fact): fact is FactItem => Boolean(fact));
  }

  return [
    galleryCount > 0
      ? { label: "Gallery", value: `${galleryCount} ${galleryCount === 1 ? "photo" : "photos"}` }
      : null,
    servicesCount > 0 ? { label: "Range", value: `${servicesCount} highlights` } : null,
    paymentCount > 0 ? { label: "Payments", value: `${paymentCount} supported` } : null,
    promotions.length > 0 ? { label: "Offers", value: `${promotions.length} live` } : null,
  ].filter((fact): fact is FactItem => Boolean(fact));
}

/** Stay facts the tourism details card does not show (grading, minimum stay, children…). */
export function getTourismSpotlightFacts(details: Record<string, unknown>): SpotlightFact[] {
  const facts: SpotlightFact[] = [];
  if (typeof details.tgcsa_grading === "string" && details.tgcsa_grading) {
    facts.push({
      label: "TGCSA Grading",
      value: details.tgcsa_grading.replace(/_star$/, "-star").replace(/_/g, " "),
    });
  }
  if (typeof details.minimum_stay_nights === "number") {
    facts.push({
      label: "Minimum stay",
      value: `${details.minimum_stay_nights} ${details.minimum_stay_nights === 1 ? "night" : "nights"}`,
    });
  }
  if (typeof details.child_policy === "string" && details.child_policy) {
    facts.push({
      label: "Child policy",
      value: CHILD_POLICY_LABELS[details.child_policy] ?? details.child_policy.replace(/_/g, " "),
    });
  }
  if (details.seasonal_pricing === true) {
    facts.push({ label: "Seasonal pricing", value: "Peak / off-peak rates apply" });
  }
  if (typeof details.nearby_attractions === "string" && details.nearby_attractions) {
    facts.push({ label: "Nearby attractions", value: details.nearby_attractions, wide: true });
  }
  return facts;
}

export function isTourismBusinessRecord(business: {
  area?: string | null;
  category?: string | null;
}) {
  return business.area === "PROMOTIONS_EVENTS" || business.category === "tourism_hospitality";
}

export interface TourismViewerDetails {
  /** Numbers and single choices: rooms, check-in, price range, tour length… */
  facts: FactItem[];
  /** Multi-choice lists the owner ticked: amenities, meals, treatments… */
  lists: { label: string; items: string[] }[];
  /** House rules and yes/no answers: cancellation, pets, smoking, insurance… */
  rules: FactItem[];
  /** Free text that reads best on its own line. */
  notes: FactItem[];
}

function optionLabel(list: ReadonlyArray<{ value: string; label: string }>, value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return list.find((item) => item.value === value)?.label ?? humanizeKey(value);
}

function yesNo(value: unknown) {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : null;
}

/**
 * Every tourism field the create form collects (businesses.category_details),
 * grouped for the desktop viewer. Fields the owner left empty are left out.
 */
export function getTourismViewerDetails(details: Record<string, unknown>): TourismViewerDetails {
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const count = (value: unknown, unit?: string) =>
    typeof value === "number" && value > 0 ? (unit ? `${value} ${unit}` : String(value)) : null;
  const fact = (label: string, value: string | null) => (value ? { label, value } : null);

  const facts = [
    fact("Rooms / units", count(details.number_of_rooms)),
    fact("Check-in", text(details.check_in_time)),
    fact("Check-out", text(details.check_out_time)),
    fact("Price range", optionLabel(TOURISM_PRICE_RANGES, details.price_range)),
    fact("Tour duration", optionLabel(TOURISM_TOUR_DURATIONS, details.tour_duration)),
    fact("Visit duration", optionLabel(TOURISM_VISIT_DURATIONS, details.visit_duration)),
    fact("Group size", count(details.max_group_size, "guests")),
    fact("Difficulty", optionLabel(TOURISM_DIFFICULTY_LEVELS, details.difficulty_level)),
    fact("Age restriction", optionLabel(TOURISM_AGE_RESTRICTIONS, details.age_restriction)),
    fact("Minimum driver age", count(details.min_driver_age)),
    fact("Languages", text(details.languages_spoken)),
  ].filter((item): item is FactItem => Boolean(item));

  const list = (label: string, value: unknown) => {
    const items = normalizeList(value).map((item) =>
      /^[a-z0-9]+(_[a-z0-9]+)+$/.test(item) ? humanizeKey(item) : item
    );
    return items.length > 0 ? { label, items } : null;
  };
  const lists = [
    list("Accommodation types", details.accommodation_types),
    list("Amenities", details.amenities),
    list("Meals", details.meal_options),
    list("Treatments", details.treatment_types),
    list("Activities", details.activity_types),
    list("Services", details.services_offered),
    list("Specialisations", details.specializations),
    list("Vehicles", details.vehicle_types),
  ].filter((item): item is { label: string; items: string[] } => Boolean(item));

  const minimumStay = count(details.minimum_stay_nights);
  const rules = [
    fact("Cancellation", optionLabel(TOURISM_CANCELLATION_POLICIES, details.cancellation_policy)),
    fact(
      "Minimum stay",
      minimumStay ? `${minimumStay} ${minimumStay === "1" ? "night" : "nights"}` : null
    ),
    fact(
      "Children",
      typeof details.child_policy === "string" && details.child_policy
        ? (CHILD_POLICY_LABELS[details.child_policy] ?? humanizeKey(details.child_policy))
        : null
    ),
    fact("Pets allowed", yesNo(details.pets_allowed)),
    fact("Smoking allowed", yesNo(details.smoking_allowed)),
    fact("Equipment provided", yesNo(details.equipment_provided)),
    fact("Guided tours", yesNo(details.guided_tours)),
    fact("Audio guide", yesNo(details.audio_guide)),
    fact("Delivery and collection", yesNo(details.delivery_collection)),
    fact("Insurance included", yesNo(details.insurance_included)),
    fact("GPS available", yesNo(details.gps_available)),
    fact("Seasonal pricing", details.seasonal_pricing === true ? "Peak and off-peak rates" : null),
  ].filter((item): item is FactItem => Boolean(item));

  const notes = [
    fact("What's included", text(details.whats_included)),
    fact("Nearby attractions", text(details.nearby_attractions)),
  ].filter((item): item is FactItem => Boolean(item));

  return { facts, lists, rules, notes };
}

/**
 * What the business-type step of the form collected (mall store, shop, home
 * business, mobile service, online shop, market stall), for the viewer.
 */
export function getBusinessTypeDetails(business: BusinessDetailRecord): {
  rows: FactItem[];
  orderUrl: string | null;
  lists: { label: string; items: string[] }[];
} {
  const details = business.business_details as BusinessDetails | null;
  const rows: FactItem[] = [];
  const lists: { label: string; items: string[] }[] = [];
  let orderUrl: string | null = null;
  const add = (label: string, value: string | null | undefined) => {
    if (value && String(value).trim()) rows.push({ label, value: String(value).trim() });
  };
  if (!details || typeof details !== "object") return { rows, orderUrl, lists };

  switch (details.type) {
    case "mall_store":
      add("Mall", details.mall_name);
      add("Mall address", details.mall_address);
      add("Floor or wing", details.floor_or_wing);
      add("Nearest entrance", details.nearest_entrance);
      add("Parking", details.parking_notes);
      break;
    case "standalone_shop":
      add("Building", details.building_name);
      add("Unit", details.suite_or_unit);
      add("Street", details.street_address);
      add("Suburb", details.suburb);
      add("Landmark", details.landmark);
      add(
        "Walk-ins",
        details.walk_in_policy ? WALK_IN_POLICY_LABELS[details.walk_in_policy] : null
      );
      break;
    case "home_business":
      // The suburb served, never the home address itself.
      add("Area served", details.service_suburb);
      add("Appointment needed", details.appointment_required ? "Yes" : "No");
      add("Collection from the owner", details.customer_pickup_allowed ? "Yes" : "No");
      add("Visitor notes", details.visitor_notes);
      break;
    case "mobile_service":
      add(
        "Travels up to",
        typeof details.travel_radius_km === "number" ? `${details.travel_radius_km} km` : null
      );
      add(
        "Callout fee from",
        typeof details.callout_fee_from === "number"
          ? `R ${formatRandAmount(details.callout_fee_from)}`
          : null
      );
      add("Emergency callouts", details.emergency_callouts ? "Yes" : "No");
      break;
    case "online_only":
      add(
        "Order through",
        details.primary_order_channel
          ? PRIMARY_ORDER_CHANNEL_LABELS[details.primary_order_channel]
          : null
      );
      // The form's choices already start with "Within"; don't say it twice.
      add("Replies within", details.support_response_time?.replace(/^within\s+/i, ""));
      orderUrl = details.order_url ?? null;
      if (details.delivery_regions?.length) {
        lists.push({ label: "Delivers to", items: details.delivery_regions });
      }
      break;
    case "market_stall":
      add("Market", details.market_name);
      add("Stall", details.stall_label);
      add("Trading hours", details.trading_hours);
      if (details.trading_days?.length)
        lists.push({ label: "Trading days", items: details.trading_days });
      break;
  }
  return { rows, orderUrl, lists };
}
