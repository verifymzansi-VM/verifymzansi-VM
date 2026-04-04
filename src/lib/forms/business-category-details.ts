import type { BusinessCategory } from "@/types/enums";
import type { BusinessDetailsFieldConfig } from "./business-type-details";

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
