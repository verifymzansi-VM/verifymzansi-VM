import type { BusinessCategory } from "@/types/enums";
import type { BusinessDetailsFieldConfig } from "./business-type-details";
import {
  TOURISM_ACCOMMODATION_TYPES,
  TOURISM_AMENITIES,
  TOURISM_CANCELLATION_POLICIES,
  TOURISM_MEAL_OPTIONS,
  TOURISM_PRICE_RANGES,
} from "@/lib/constants/categories";

/**
 * Extra fields that appear on the form when a specific business category is
 * selected.  These are stored in the `category_details` JSONB column.
 *
 * Not every category needs extra fields — categories without entries simply
 * don't show anything additional.
 */
export const CATEGORY_DETAIL_FIELDS: Partial<
  Record<BusinessCategory, BusinessDetailsFieldConfig[]>
> = {
  health_beauty: [
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
  ],

  trade_maintenance: [
    {
      name: "emergency_available",
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
    },
    {
      name: "check_out_time",
      label: "Check-out time",
      kind: "text",
      placeholder: "e.g. 10:00",
    },
    {
      name: "price_range",
      label: "Price range",
      kind: "select",
      options: TOURISM_PRICE_RANGES.map((p) => ({ value: p.value, label: p.label })),
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
    },
    {
      name: "cancellation_policy",
      label: "Cancellation policy",
      kind: "select",
      options: TOURISM_CANCELLATION_POLICIES.map((p) => ({ value: p.value, label: p.label })),
    },
    {
      name: "booking_url",
      label: "Booking URL",
      kind: "url",
      placeholder: "https://…",
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
  ],
};

/** Return the extra fields for a given category, or an empty array. */
export function getCategoryDetailFields(
  category: BusinessCategory | null | undefined
): BusinessDetailsFieldConfig[] {
  if (!category) return [];
  return CATEGORY_DETAIL_FIELDS[category] ?? [];
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
        defaults[f.name] = false;
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
