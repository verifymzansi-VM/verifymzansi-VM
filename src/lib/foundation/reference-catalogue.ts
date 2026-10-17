import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const label = z.string().min(1).max(200);
const category = z
  .strictObject({
    key,
    label: label.max(120),
    kind: z.enum(["listing", "business", "event"]),
    area: z.enum(["market", "business", "tourism_events"]),
    activity_required: z.boolean(),
  })
  .refine((value) =>
    value.kind === "listing"
      ? value.area === "market"
      : value.kind === "event"
        ? value.area === "tourism_events"
        : value.area !== "market"
  );
const option = z.union([label, z.strictObject({ value: label, label })]);
const field = z
  .strictObject({
    category: key,
    key,
    label,
    renderer: z.enum(["text", "number", "select", "boolean", "checklist", "money", "combobox"]),
    required: z.boolean(),
    options: z.array(option).max(1000).optional(),
    unit: label.optional(),
    facet: z.enum(["choice", "contains", "boolean", "range"]).optional(),
  })
  .refine(
    (value) =>
      !value.options ||
      new Set(value.options.map((row) => (typeof row === "string" ? row : row.value))).size ===
        value.options.length
  )
  .refine((value) => !value.facet || !["text", "combobox"].includes(value.renderer));
const catalogue = z
  .strictObject({
    version: z.number().int().min(1).max(2147483647),
    content_hash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    categories: z.array(category).max(1000),
    activities: z
      .array(
        z.strictObject({
          category: key,
          key,
          label: label.max(120),
          field_group: z.enum(["A", "B", "C", "D", "E", "F"]).nullable(),
        })
      )
      .max(10000),
    provinces: z
      .array(z.strictObject({ id: key, code: z.string().min(1).max(16), label }))
      .max(1000),
    cities: z.array(z.strictObject({ id: key, province: key, label })).max(10000),
    fields: z.array(field).max(10000),
  })
  .refine((value) => {
    const unique = <T>(rows: T[], identity: (row: T) => string) =>
      new Set(rows.map(identity)).size === rows.length;
    return (
      unique(value.categories, (row) => row.key) &&
      unique(value.activities, (row) => `${row.category}/${row.key}`) &&
      unique(value.provinces, (row) => row.id) &&
      unique(value.cities, (row) => row.id) &&
      unique(value.fields, (row) => `${row.category}/${row.key}`)
    );
  })
  .refine((value) => {
    const categories = new Set(value.categories.map((row) => row.key)),
      provinces = new Set(value.provinces.map((row) => row.id));
    return (
      value.activities.every((row) => categories.has(row.category)) &&
      value.fields.every((row) => categories.has(row.category)) &&
      value.cities.every((row) => provinces.has(row.province)) &&
      value.categories.every(
        (row) =>
          !row.activity_required ||
          value.activities.some((activity) => activity.category === row.key)
      )
    );
  });
export type FoundationReferenceCatalogue = z.infer<typeof catalogue>;

/** Display/reference DTO only. Conditional form validation/option authority is
 * a separately versioned contract; this metadata grants no write permissions.
 */
export function parseFoundationReferenceCatalogue(input: unknown): FoundationReferenceCatalogue {
  const result = catalogue.safeParse(input);
  if (!result.success) throw new Error("Invalid foundation reference catalogue");
  return result.data;
}
export async function readFoundationReferenceCatalogue(
  api: FoundationPublicApi
): Promise<FoundationReferenceCatalogue> {
  const { data, error } = await api.rpc("reference_catalog");
  if (error) throw new Error("Foundation reference catalogue unavailable");
  return parseFoundationReferenceCatalogue(data);
}
