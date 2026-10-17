import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CATEGORIES,
  BUSINESS_CATEGORIES,
  ALL_BUSINESS_CATEGORIES,
  TOURISM_SUBCATEGORIES,
  TOURISM_SUBCATEGORY_FIELD_GROUPS,
  EVENT_TYPES,
} from "../src/lib/constants/categories";
import { SA_PROVINCES } from "../src/lib/constants/sa-provinces";
import { listingSchema } from "../src/lib/validations/listing";
import { LISTING_CONDITION_LABELS } from "../src/types/enums";

// Build-time source examination only. Production will load reviewed static reference data.
const sources = [
  "src/lib/constants/categories.ts",
  "src/types/enums.ts",
  "src/lib/constants/sa-provinces.ts",
  "src/lib/constants/sa-vehicles.ts",
  "src/lib/validations/listing.ts",
];
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("base64url");
const options = listingSchema.options;
const conditionSchema = z.toJSONSchema(options[0].shape.condition.unwrap());
for (const option of options) {
  if (
    JSON.stringify(z.toJSONSchema(option.shape.condition.unwrap())) !==
    JSON.stringify(conditionSchema)
  )
    throw Error("Source common condition rules differ by listing category");
}
const { $schema: _conditionDialect, ...conditionValidation } = conditionSchema;
void _conditionDialect;
const listing = CATEGORIES.map((category) => {
  const schema = options.find((option) => option.shape.category.value === category.value);
  if (!schema) throw Error("Missing source attribute schema");
  const attributes = z.toJSONSchema(schema.shape.attributes);
  const properties = Object.keys(attributes.properties ?? {});
  const ui = category.attributeFields.map((field) => field.name);
  return {
    key: category.value,
    label: category.label,
    description: category.description,
    fields: category.attributeFields,
    attributeSchema: attributes,
    uiOnly: ui.filter((name) => !properties.includes(name)),
    validatorOnly: properties.filter((name) => !ui.includes(name)),
  };
});
const report = {
  schemaVersion: 1,
  scope: "Observed source reference data; not approved target seeds or field dispositions",
  sourceHashes: Object.fromEntries(sources.map((file) => [file, hash(file)])),
  commonListingFields: [
    {
      name: "condition",
      label: "Condition",
      type: "select",
      required: false,
      validation: conditionValidation,
      options: Object.entries(LISTING_CONDITION_LABELS).map(([value, label]) => ({ value, label })),
      // listingSchema's final refinement rejects condition for jobs_services.
      // Auto-parts UI omits this input, but the validator still accepts its
      // separate common condition; preserve that source fact without translating it.
      categories: listing
        .filter((category) => category.key !== "jobs_services")
        .map((category) => category.key),
    },
  ],
  listing,
  business: BUSINESS_CATEGORIES.map(({ value, label, subcategories, serviceSuggestions }) => ({
    key: value,
    label,
    activities: subcategories,
    serviceSuggestions,
  })),
  legacyOnlyBusiness: ALL_BUSINESS_CATEGORIES.filter(
    (category) => !BUSINESS_CATEGORIES.some((active) => active.value === category.value)
  ).map(({ value, label, subcategories }) => ({ key: value, label, activities: subcategories })),
  tourism: TOURISM_SUBCATEGORIES.map((activity) => ({
    ...activity,
    fieldGroup: TOURISM_SUBCATEGORY_FIELD_GROUPS[activity.value],
  })),
  events: EVENT_TYPES,
  provinces: SA_PROVINCES,
};
writeFileSync(
  "docs/backend-foundation/evidence/source-reference.json",
  JSON.stringify(report, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    market: listing.length,
    business: report.business.length,
    legacyOnlyBusiness: report.legacyOnlyBusiness.map((c) => c.key),
    tourism: report.tourism.length,
    events: report.events.length,
    provinces: report.provinces.length,
    listingMismatches: listing
      .filter((c) => c.uiOnly.length || c.validatorOnly.length)
      .map(({ key, uiOnly, validatorOnly }) => ({ key, uiOnly, validatorOnly })),
  })
);
