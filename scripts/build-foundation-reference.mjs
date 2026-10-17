import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const evidence = "docs/backend-foundation/evidence/source-reference.json";
const source = JSON.parse(readFileSync(evidence));
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("base64url");
for (const [file, expected] of Object.entries(source.sourceHashes))
  if (hash(file) !== expected) throw Error("Reference source drift");
const slug = (value) =>
  value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
const categories = source.listing.map((c) => ({
  key: c.key,
  label: c.label,
  kind: "listing",
  area: "market",
  activityRequired: false,
}));
categories.push(
  ...source.business.map((c) => ({
    key: c.key,
    label: c.label,
    kind: "business",
    area: c.key === "tourism_hospitality" ? "tourism_events" : "business",
    activityRequired: c.key === "tourism_hospitality",
  }))
);
if (!categories.some((c) => c.key === "tourism_hospitality"))
  categories.push({
    key: "tourism_hospitality",
    label: "Tourism & Hospitality",
    kind: "business",
    area: "tourism_events",
    activityRequired: true,
  });
categories.push({
  key: "events",
  label: "Events",
  kind: "event",
  area: "tourism_events",
  activityRequired: true,
});
const activities = source.business.flatMap((c) =>
  (c.key === "tourism_hospitality" ? source.tourism : c.activities).map((a) => ({
    category: c.key,
    key: a.value,
    label: a.label,
    ...(a.fieldGroup ? { fieldGroup: a.fieldGroup } : {}),
  }))
);
if (!source.business.some((c) => c.key === "tourism_hospitality"))
  activities.push(
    ...source.tourism.map((a) => ({
      category: "tourism_hospitality",
      key: a.value,
      label: a.label,
      fieldGroup: a.fieldGroup,
    }))
  );
activities.push(
  ...source.events.map((a) => ({ category: "events", key: a.value, label: a.label }))
);
const provinces = source.provinces.map((p) => ({
  id: p.code.toLowerCase(),
  label: p.name,
  code: p.code,
}));
const cities = source.provinces.flatMap((p) =>
  p.cities.map((label) => ({
    id: `${p.code.toLowerCase()}_${slug(label)}`,
    province: p.code.toLowerCase(),
    label,
    aliases: [
      ...new Set([
        label,
        label.replace(/\s*\([^)]*\)\s*/g, " ").trim(),
        ...[...label.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]),
      ]),
    ],
  }))
);
const fields = source.listing.flatMap((c) =>
  c.fields.map((field) => {
    let key = field.name;
    const validation = structuredClone(c.attributeSchema.properties[field.name]);
    const originalUnit = field.unit;
    if (key.endsWith("_zar")) {
      key = key.replace(/_zar$/, "_cents");
      validation.type = "integer";
      validation.minimum = 0;
      validation.maximum *= 100;
    }
    if (field.type === "checklist" && field.options?.length)
      validation.items.enum = field.options.map((option) =>
        typeof option === "string" ? option : option.value
      );
    if (field.type === "select" && validation.enum && field.options?.length) {
      const choices = field.options.map((option) =>
        typeof option === "string" ? option : option.value
      );
      if (choices.some((choice) => !validation.enum.includes(choice)))
        throw Error(`Unreviewed select choice: ${c.key}/${field.name}`);
      validation.enum = choices;
    }
    const optionAuthority =
      validation.enum || field.type === "checklist"
        ? "closed"
        : field.type === "select"
          ? "suggestions"
          : "none";
    if (["available_from", "application_deadline"].includes(key)) validation.format = "date";
    const dynamicMaximum =
      c.key === "vehicles" && key === "year" ? "south_african_year_plus_one" : undefined;
    if (dynamicMaximum) delete validation.maximum;
    return {
      category: c.key,
      key,
      sourceKey: field.name,
      label: field.label,
      renderer: field.name.endsWith("_zar")
        ? "money"
        : field.type === "select" && optionAuthority === "suggestions"
          ? "combobox"
          : field.type,
      optionAuthority,
      required: field.required,
      validation,
      ...(originalUnit ? { unit: field.name.endsWith("_zar") ? "ZAR_cents" : originalUnit } : {}),
      ...(field.options ? { options: field.options } : {}),
      ...(field.dependsOn ? { dependsOn: field.dependsOn } : {}),
      ...(field.dependsOnValue
        ? {
            dependsOnValues: Array.isArray(field.dependsOnValue)
              ? field.dependsOnValue
              : [field.dependsOnValue],
          }
        : {}),
      ...(dynamicMaximum ? { dynamicMaximum } : {}),
      visibility: "public_owner_assertion",
      retentionClass: "post_content",
    };
  })
);
for (const field of source.commonListingFields) {
  if (field.name !== "condition" || field.required !== false || field.type !== "select")
    throw Error("Unreviewed common listing field");
  if (
    JSON.stringify(field.categories) !==
    JSON.stringify(source.listing.filter((c) => c.key !== "jobs_services").map((c) => c.key))
  )
    throw Error("Common condition applicability drift");
  if (JSON.stringify(field.validation.enum) !== JSON.stringify(field.options.map((o) => o.value)))
    throw Error("Common condition choices drift");
  for (const category of field.categories)
    fields.push({
      category,
      key: field.name,
      sourceKey: field.name,
      label: field.label,
      renderer: "select",
      optionAuthority: "closed",
      required: false,
      validation: structuredClone(field.validation),
      options: structuredClone(field.options),
      visibility: "public_owner_assertion",
      retentionClass: "post_content",
    });
}
for (const [name, rows, key] of [
  ["categories", categories, (r) => r.key],
  ["activities", activities, (r) => `${r.category}/${r.key}`],
  ["cities", cities, (r) => r.id],
  ["fields", fields, (r) => `${r.category}/${r.key}`],
]) {
  if (new Set(rows.map(key)).size !== rows.length) throw Error(`Duplicate ${name}`);
}
const catalog = { version: 1, categories, activities, provinces, cities, listingFields: fields };
mkdirSync("src/lib/domains/taxonomy", { recursive: true });
writeFileSync("src/lib/domains/taxonomy/reference.json", JSON.stringify(catalog, null, 2) + "\n");
const decisions = {
  scope:
    "Reference/attribute contract candidate; independent review and complete G1 gate still required",
  sourceSnapshotHash: hash(evidence),
  catalogHash: hash("src/lib/domains/taxonomy/reference.json"),
  retiredBusinessInputs: source.legacyOnlyBusiness.map((c) => ({
    key: c.key,
    action:
      "Reject new command; explicit browse alias/redirect contract still pending; no old-row conversion",
  })),
  retiredAttributes: source.listing.flatMap((c) =>
    c.validatorOnly.map((key) => ({
      category: c.key,
      key,
      action: ["monthly_rent_zar", "salary_min", "salary_max"].includes(key)
        ? "Retire duplicate amount fields; canonical listing terms are authoritative"
        : "Retire validator-only field absent from this category UI; explicit source disposition",
    }))
  ),
  retiredAttributeChoices: source.listing.flatMap((c) =>
    c.fields
      .filter(
        (field) =>
          field.type === "select" &&
          c.attributeSchema.properties[field.name].enum &&
          field.options?.length
      )
      .flatMap((field) => {
        const choices = field.options.map((option) =>
          typeof option === "string" ? option : option.value
        );
        return c.attributeSchema.properties[field.name].enum
          .filter((value) => !choices.includes(value))
          .map((value) => ({
            category: c.key,
            field: field.name,
            value,
            action:
              "Retire source validator choice absent from active UI; use the distinct top-level category instead",
          }));
      })
  ),
  suggestionFields: fields
    .filter((field) => field.optionAuthority === "suggestions")
    .map((field) => ({
      category: field.category,
      field: field.key,
      action:
        "Bounded owner text with optional suggestions/custom entry; options are not a verified whitelist; canonical enum values remain closed",
    })),
  changes: [
    "Common optional condition preserved as attributes.condition for the ten non-job source listing categories, including auto_parts; jobs_services rejects it; no translation to part_condition/equipment_condition",
    "Property levy/rates use integer cents, preserving source maximum with exact conversion",
    "Known checklist choices constrained to UI allowlist",
    "Available date and application deadline require valid date-only values",
    "Model year uses the South African calendar year plus one",
    "Tourism hospitality is business kind only in Tourism & Events",
    "Events have required canonical activity, independent of legacy form_version",
  ],
  limits: [
    "Source city list is a convenience list, not a complete geographic register",
    "Unlisted localities require explicit self-declared labels and no verified-location claim",
    "No production publication or retention capability is implied",
  ],
};
writeFileSync(
  "docs/backend-foundation/reference-contract-decisions.json",
  JSON.stringify(decisions, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    categories: categories.length,
    activities: activities.length,
    provinces: provinces.length,
    cities: cities.length,
    listingFields: fields.length,
    retiredAttributes: decisions.retiredAttributes.length,
  })
);
