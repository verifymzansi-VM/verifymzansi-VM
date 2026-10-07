import type { BusinessCategory } from "@/types/enums";
import type { BusinessDetailsFieldConfig } from "./business-type-details";
import {
  TOURISM_ACCOMMODATION_TYPES,
  TOURISM_AMENITIES,
  TOURISM_CANCELLATION_POLICIES,
  TOURISM_MEAL_OPTIONS,
  TOURISM_PRICE_RANGES,
  TOURISM_TREATMENT_TYPES,
  TOURISM_TOUR_DURATIONS,
  TOURISM_DIFFICULTY_LEVELS,
  TOURISM_AGE_RESTRICTIONS,
  TOURISM_VISIT_DURATIONS,
  TOURISM_VEHICLE_TYPES,
  TOURISM_TRAVEL_SERVICES,
  TOURISM_TRAVEL_SPECIALIZATIONS,
} from "@/lib/constants/categories";

/**
 * Extra fields that appear on the form when a specific business category is
 * selected.  These are stored in the `category_details` JSONB column.
 *
 * Not every category needs extra fields — categories without entries simply
 * don't show anything additional.
 */
const CATEGORY_DETAIL_FIELDS: Partial<Record<BusinessCategory, BusinessDetailsFieldConfig[]>> = {
  health_medical: [
    {
      name: "practice_number",
      label: "Practice number",
      kind: "text",
      placeholder: "e.g. PR1234567890",
      description: "HPCSA or BHF practice number (doctors, dentists, physios).",
    },
    {
      name: "medical_aid_accepted",
      label: "Medical aid accepted",
      kind: "checkbox",
    },
    {
      name: "accepted_medical_aids",
      label: "Accepted medical aids",
      kind: "text",
      placeholder: "e.g. Discovery, Momentum, Bonitas",
      description: "Comma-separated list of medical aids you accept.",
    },
  ],

  automotive_transport: [
    {
      name: "brands_serviced",
      label: "Brands serviced",
      kind: "list",
      placeholder: "e.g. Toyota, VW, BMW",
      description: "Separate brand names with commas.",
    },
    {
      name: "roadside_assistance",
      label: "Roadside / roadside assistance",
      kind: "checkbox",
    },
  ],

  professional_services: [
    {
      name: "registration_body",
      label: "Professional body",
      kind: "text",
      placeholder: "e.g. LSSA, SAICA, SACAP",
      description: "The professional body you are registered with.",
    },
    {
      name: "registration_number",
      label: "Registration / practice number",
      kind: "text",
      placeholder: "e.g. 2024/123456",
    },
    {
      name: "virtual_consultations",
      label: "Virtual / online consultations available",
      kind: "checkbox",
    },
  ],

  education_training: [
    {
      name: "accreditation",
      label: "Accreditation",
      kind: "text",
      placeholder: "e.g. Umalusi, SETA, QCTO",
    },
    {
      name: "age_range",
      label: "Age group",
      kind: "text",
      placeholder: "e.g. 3-6 years, Adults",
    },
  ],

  food_dining: [
    {
      name: "dietary_options",
      label: "Dietary options",
      kind: "list",
      placeholder: "e.g. Halal, Vegan, Gluten-free",
      description: "Separate options with commas.",
    },
    {
      name: "seating_capacity",
      label: "Seating capacity",
      kind: "number",
      min: 0,
      step: "1",
      placeholder: "e.g. 40",
    },
    {
      name: "byob_allowed",
      label: "BYOB allowed (bring your own)",
      kind: "checkbox",
    },
    {
      name: "halal_certified",
      label: "Halal certified",
      kind: "checkbox",
    },
    {
      name: "liquor_license",
      label: "Liquor license",
      kind: "checkbox",
    },
  ],

  trade_maintenance: [
    {
      name: "emergency_callout",
      label: "24/7 or emergency callouts",
      kind: "checkbox",
    },
    {
      name: "free_quotes",
      label: "Free quotes available",
      kind: "checkbox",
    },
  ],

  tourism_hospitality: [
    {
      name: "star_rating",
      label: "Star rating",
      kind: "number",
      min: 1,
      step: "1",
      placeholder: "1 – 5",
      description: "Official grading (1–5 stars).",
    },
    {
      name: "number_of_rooms",
      label: "Number of rooms / units",
      kind: "number",
      min: 0,
      step: "1",
      placeholder: "e.g. 24",
      description: "Total available rooms or self-catering units.",
    },
    {
      name: "accommodation_types",
      label: "Accommodation types",
      kind: "list",
      placeholder: TOURISM_ACCOMMODATION_TYPES.join(", "),
      description: "Separate types with commas.",
    },
    {
      name: "check_in_time",
      label: "Check-in time",
      kind: "text",
      placeholder: "e.g. 14:00",
      description: "Standard guest check-in time.",
    },
    {
      name: "check_out_time",
      label: "Check-out time",
      kind: "text",
      placeholder: "e.g. 10:00",
      description: "Standard guest check-out time.",
    },
    {
      name: "price_range",
      label: "Price range",
      kind: "select",
      options: TOURISM_PRICE_RANGES.map((p) => ({ value: p.value, label: p.label })),
      description: "Gives visitors a quick idea of your pricing.",
    },
    {
      name: "amenities",
      label: "Amenities",
      kind: "list",
      placeholder: TOURISM_AMENITIES.slice(0, 5).join(", ") + ", …",
      description: "Separate amenities with commas.",
    },
    {
      name: "meal_options",
      label: "Meal options",
      kind: "list",
      placeholder: TOURISM_MEAL_OPTIONS.join(", "),
      description: "Separate options with commas.",
    },
    {
      name: "languages_spoken",
      label: "Languages spoken",
      kind: "text",
      placeholder: "e.g. English, Zulu, Afrikaans",
      description: "Comma-separated list of languages your staff speaks.",
    },
    {
      name: "cancellation_policy",
      label: "Cancellation policy",
      kind: "select",
      options: TOURISM_CANCELLATION_POLICIES.map((p) => ({ value: p.value, label: p.label })),
      description: "Your standard terms for cancellations and refunds.",
    },
    {
      name: "booking_url",
      label: "Booking URL",
      kind: "url",
      placeholder: "https://…",
      description: "Direct link where customers can make bookings online.",
    },
    {
      name: "tgcsa_grading",
      label: "TGCSA grading",
      kind: "select",
      options: [
        { value: "1_star", label: "1 Star" },
        { value: "2_star", label: "2 Stars" },
        { value: "3_star", label: "3 Stars" },
        { value: "4_star", label: "4 Stars" },
        { value: "5_star", label: "5 Stars" },
      ],
      description: "Tourism Grading Council SA rating.",
    },
    {
      name: "minimum_stay_nights",
      label: "Minimum stay (nights)",
      kind: "number",
      min: 1,
      step: "1",
      placeholder: "e.g. 2",
    },
    {
      name: "child_policy",
      label: "Child policy",
      kind: "select",
      options: [
        { value: "children_welcome", label: "Children Welcome" },
        { value: "children_over_6", label: "Children Over 6" },
        { value: "children_over_12", label: "Children Over 12" },
        { value: "adults_only", label: "Adults Only" },
      ],
    },
    {
      name: "nearby_attractions",
      label: "Nearby attractions",
      kind: "text",
      placeholder: "e.g. Kruger National Park, Table Mountain",
    },
    {
      name: "seasonal_pricing",
      label: "Has peak / off-peak seasonal pricing",
      kind: "checkbox",
    },
    {
      name: "pets_allowed",
      label: "Pets allowed",
      kind: "checkbox",
    },
    {
      name: "smoking_allowed",
      label: "Smoking allowed",
      kind: "checkbox",
    },
    // Spa fields
    {
      name: "treatment_types",
      label: "Treatment types",
      kind: "list",
      placeholder: TOURISM_TREATMENT_TYPES.slice(0, 4).join(", ") + ", …",
      description: "Separate types with commas.",
    },
    // Tour / Safari / Adventure fields
    {
      name: "activity_types",
      label: "Activity types",
      kind: "list",
      placeholder: "e.g. Game Drives, Bush Walks",
      description: "Separate activities with commas.",
    },
    {
      name: "tour_duration",
      label: "Tour duration",
      kind: "select",
      options: TOURISM_TOUR_DURATIONS.map((d) => ({ value: d.value, label: d.label })),
      description: "Typical length of the tour or experience.",
    },
    {
      name: "max_group_size",
      label: "Max group size",
      kind: "number",
      min: 1,
      step: "1",
      placeholder: "e.g. 12",
      description: "Maximum participants per group or booking.",
    },
    {
      name: "difficulty_level",
      label: "Difficulty level",
      kind: "select",
      options: TOURISM_DIFFICULTY_LEVELS.map((d) => ({ value: d.value, label: d.label })),
      description: "Physical effort required for this activity.",
    },
    {
      name: "equipment_provided",
      label: "Equipment provided",
      kind: "checkbox",
    },
    {
      name: "whats_included",
      label: "What's included",
      kind: "text",
      placeholder: "e.g. Transport, lunch, park fees",
      description: "List everything guests receive with the booking.",
    },
    {
      name: "age_restriction",
      label: "Age restriction",
      kind: "select",
      options: TOURISM_AGE_RESTRICTIONS.map((a) => ({ value: a.value, label: a.label })),
      description: "Minimum age requirement, if any.",
    },
    // Attraction fields
    {
      name: "guided_tours",
      label: "Guided tours available",
      kind: "checkbox",
    },
    {
      name: "audio_guide",
      label: "Audio guide available",
      kind: "checkbox",
    },
    {
      name: "visit_duration",
      label: "Typical visit duration",
      kind: "select",
      options: TOURISM_VISIT_DURATIONS.map((d) => ({ value: d.value, label: d.label })),
      description: "How long a typical visit takes.",
    },
    // Travel agency fields
    {
      name: "services_offered",
      label: "Services offered",
      kind: "list",
      placeholder: TOURISM_TRAVEL_SERVICES.slice(0, 4).join(", ") + ", …",
      description: "Separate services with commas.",
    },
    {
      name: "specializations",
      label: "Specializations",
      kind: "list",
      placeholder: TOURISM_TRAVEL_SPECIALIZATIONS.slice(0, 4).join(", ") + ", …",
      description: "Separate specializations with commas.",
    },
    // Car rental fields
    {
      name: "vehicle_types",
      label: "Vehicle types",
      kind: "list",
      placeholder: TOURISM_VEHICLE_TYPES.slice(0, 4).join(", ") + ", …",
      description: "Separate types with commas.",
    },
    {
      name: "delivery_collection",
      label: "Delivery & collection",
      kind: "checkbox",
    },
    {
      name: "min_driver_age",
      label: "Minimum driver age",
      kind: "number",
      min: 16,
      step: "1",
      placeholder: "e.g. 21",
      description: "Minimum age to rent a vehicle.",
    },
    {
      name: "insurance_included",
      label: "Insurance included",
      kind: "checkbox",
    },
    {
      name: "gps_available",
      label: "GPS available",
      kind: "checkbox",
    },
  ],
};

/** Return the extra fields for a given category, or an empty array. */
export function getCategoryDetailFields(
  category: BusinessCategory | null | undefined
): BusinessDetailsFieldConfig[] {
  if (!category) return [];
  return (
    CATEGORY_DETAIL_FIELDS[
      category === "automotive_services" ? "automotive_transport" : category
    ] ?? []
  );
}

/** Build a default empty object for a given category's extra fields. */
export function getDefaultCategoryDetails(
  category: BusinessCategory | null | undefined
): Record<string, unknown> {
  const fields = getCategoryDetailFields(category);
  const defaults: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f.kind) {
      case "checkbox":
        defaults[f.name] = undefined;
        break;
      case "number":
        defaults[f.name] = undefined;
        break;
      case "list":
        defaults[f.name] = [];
        break;
      default:
        defaults[f.name] = "";
    }
  }
  return defaults;
}

const MAX_TEXT = 500;
const MAX_LIST_ITEMS = 30;
const MAX_LIST_ITEM = 120;

/** Keys the app itself stores in category_details (not per-category fields). */
const SYSTEM_KEYS = new Set([
  "contact_methods",
  "customer_access",
  "business_profile",
  "venue_photos",
  "meeting_point",
  "subcategory",
]);

function cleanField(field: BusinessDetailsFieldConfig, value: unknown): unknown {
  switch (field.kind) {
    case "checkbox":
      return typeof value === "boolean" ? value : undefined;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) && n >= (field.min ?? 0) && n <= 1_000_000 ? n : undefined;
    }
    case "list":
      return Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim().slice(0, MAX_LIST_ITEM))
            .slice(0, MAX_LIST_ITEMS)
        : undefined;
    case "select":
      return typeof value === "string" &&
        (!field.options || field.options.some((option) => option.value === value))
        ? value
        : undefined;
    case "url":
      return typeof value === "string" && /^https?:\/\//i.test(value.trim())
        ? value.trim().slice(0, MAX_TEXT)
        : undefined;
    default:
      return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : undefined;
  }
}

/**
 * Server-side shape check for the per-category details a client sends: each
 * configured field keeps its expected type and a size cap; unknown keys are
 * dropped. A wrong type (e.g. a string where the page maps over a list) used
 * to be stored and then crashed the public business page.
 */
export function sanitizeCategoryDetails(
  category: BusinessCategory | null | undefined,
  details: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!details || typeof details !== "object") return out;
  const fields = new Map(getCategoryDetailFields(category).map((field) => [field.name, field]));
  for (const [key, value] of Object.entries(details)) {
    const field = fields.get(key);
    if (field) {
      const cleaned = cleanField(field, value);
      if (cleaned !== undefined) out[key] = cleaned;
    } else if (key === "venue_photos") {
      if (Array.isArray(value)) {
        out.venue_photos = value
          .filter((url): url is string => typeof url === "string" && url.length <= MAX_TEXT)
          .slice(0, 10);
      }
    } else if (key === "meeting_point" || key === "subcategory") {
      if (typeof value === "string") out[key] = value.trim().slice(0, MAX_TEXT);
    } else if (SYSTEM_KEYS.has(key)) {
      out[key] = value; // validated separately (contact methods, access, profile)
    }
  }
  return out;
}
