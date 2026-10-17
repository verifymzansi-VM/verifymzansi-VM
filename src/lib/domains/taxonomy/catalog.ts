import { z } from "zod";
import raw from "./reference.json";

const key = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const category = z.strictObject({
  key,
  label: z.string().min(1).max(120),
  kind: z.enum(["listing", "business", "event"]),
  area: z.enum(["market", "business", "tourism_events"]),
  activityRequired: z.boolean(),
});
const catalog = z
  .object({
    version: z.literal(1),
    categories: z.array(category),
    activities: z.array(
      z.strictObject({
        category: key,
        key,
        label: z.string().min(1).max(120),
        fieldGroup: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
      })
    ),
    provinces: z.array(z.strictObject({ id: key, label: z.string(), code: z.string() })),
    cities: z.array(
      z.strictObject({ id: key, province: key, label: z.string(), aliases: z.array(z.string()) })
    ),
  })
  .parse(raw);
const categories = new Map(catalog.categories.map((row) => [row.key, row]));
const activities = new Map(catalog.activities.map((row) => [`${row.category}/${row.key}`, row]));
const provinces = new Map(catalog.provinces.map((row) => [row.id, row]));
const cities = new Map(catalog.cities.map((row) => [row.id, row]));
if (
  categories.size !== catalog.categories.length ||
  activities.size !== catalog.activities.length ||
  cities.size !== catalog.cities.length ||
  provinces.size !== catalog.provinces.length
)
  throw new Error("Duplicate reference identity");
for (const row of catalog.activities)
  if (!categories.has(row.category)) throw new Error("Orphan reference activity");
for (const row of catalog.cities)
  if (!provinces.has(row.province)) throw new Error("Orphan reference city");

export function validatePostTaxonomy(input: unknown) {
  const value = z
    .strictObject({
      kind: category.shape.kind,
      area: category.shape.area,
      category_key: key,
      activity_key: key.nullable().optional(),
    })
    .parse(input);
  const selected = categories.get(value.category_key);
  if (!selected || selected.kind !== value.kind || selected.area !== value.area)
    throw new Error("Category does not belong to this post kind and area");
  if (selected.activityRequired && !value.activity_key) throw new Error("Choose an activity");
  if (value.activity_key && !activities.has(`${value.category_key}/${value.activity_key}`))
    throw new Error("Activity does not belong to this category");
  return { ...value, activity_key: value.activity_key ?? null };
}

export function listPostCategories(area: "market" | "business" | "tourism_events") {
  return catalog.categories.filter((row) => row.area === area).map((row) => ({ ...row }));
}
export function listCategoryActivities(categoryKey: string) {
  if (!categories.has(categoryKey)) throw new Error("Unknown category");
  return catalog.activities
    .filter((row) => row.category === categoryKey)
    .map((row) => ({ ...row }));
}

const publicLabel = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value),
    "Use ordinary locality text"
  );
/** Self-declared public locality only; exact addresses and verified account location are separate. */
export function parsePostLocality(input: unknown) {
  const value = z
    .strictObject({
      province_id: key,
      city_id: key.optional(),
      city_label: publicLabel.max(80).optional(),
      town_label: publicLabel.max(120).optional(),
    })
    .parse(input);
  const province = provinces.get(value.province_id);
  if (!province) throw new Error("Unknown province");
  if (Boolean(value.city_id) === Boolean(value.city_label))
    throw new Error("Choose a known city or provide an explicit unlisted locality");
  const city = value.city_id ? cities.get(value.city_id) : null;
  if (value.city_id && (!city || city.province !== province.id))
    throw new Error("City does not belong to this province");
  return {
    province_id: province.id,
    province_label: province.label,
    city_id: city?.id ?? null,
    city_label: city?.label ?? value.city_label!,
    town_label: value.town_label ?? null,
    assertion: "self_declared" as const,
  };
}

export function resolveReferenceCity(provinceId: string, label: string) {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[()]/g, " ")
      .replace(/[^a-zA-Z0-9\s-]+/g, " ")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  if (!provinces.has(provinceId)) throw new Error("Unknown province");
  const matches = catalog.cities.filter(
    (row) =>
      row.province === provinceId &&
      row.aliases.some((alias) => normalize(alias) === normalize(label))
  );
  if (matches.length > 1) throw new Error("Ambiguous locality alias");
  return matches[0]?.id ?? null;
}
