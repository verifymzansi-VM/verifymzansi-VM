import { z } from "zod";
import raw from "./reference.json";
type Rule = {
  type: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  items?: Rule;
  minItems?: number;
  maxItems?: number;
};
type Field = {
  category: string;
  key: string;
  required: boolean;
  validation: Rule;
  dependsOn?: string;
  dependsOnValues?: string[];
  dynamicMaximum?: string;
};
const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z
    .strictObject({
      type: z.enum(["string", "number", "integer", "boolean", "array"]),
      enum: z.array(z.string()).min(1).optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      format: z.literal("date").optional(),
      items: ruleSchema.optional(),
      minItems: z.number().int().nonnegative().optional(),
      maxItems: z.number().int().nonnegative().optional(),
    })
    .superRefine((rule, context) => {
      if (
        (rule.enum ||
          rule.format ||
          rule.minLength !== undefined ||
          rule.maxLength !== undefined) &&
        rule.type !== "string"
      )
        context.addIssue({ code: "custom", message: "String constraints require a string" });
      if (
        (rule.minimum !== undefined || rule.maximum !== undefined) &&
        !["number", "integer"].includes(rule.type)
      )
        context.addIssue({ code: "custom", message: "Numeric constraints require a number" });
      if (
        Boolean(rule.items) !== (rule.type === "array") ||
        ((rule.minItems !== undefined || rule.maxItems !== undefined) && rule.type !== "array")
      )
        context.addIssue({ code: "custom", message: "Array item constraints required" });
      for (const [min, max] of [
        [rule.minimum, rule.maximum],
        [rule.minLength, rule.maxLength],
        [rule.minItems, rule.maxItems],
      ])
        if (min !== undefined && max !== undefined && min > max)
          context.addIssue({ code: "custom", message: "Contradictory field bounds" });
    })
);
const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const fieldSchema = z.strictObject({
  category: identifier,
  key: identifier,
  sourceKey: identifier,
  label: z.string().min(1).max(160),
  renderer: z.enum(["text", "number", "select", "boolean", "checklist", "money", "combobox"]),
  optionAuthority: z.enum(["closed", "suggestions", "none"]),
  required: z.boolean(),
  validation: ruleSchema,
  unit: z.string().optional(),
  options: z
    .array(z.union([z.string(), z.strictObject({ value: z.string(), label: z.string() })]))
    .optional(),
  dependsOn: identifier.optional(),
  dependsOnValues: z.array(z.string()).min(1).optional(),
  dynamicMaximum: z.literal("south_african_year_plus_one").optional(),
  visibility: z.literal("public_owner_assertion"),
  retentionClass: z.literal("post_content"),
});
export function validateAttributeRegistry(input: unknown) {
  const rows = z.array(fieldSchema).parse(input);
  const identities = new Map(rows.map((row) => [`${row.category}/${row.key}`, row]));
  if (identities.size !== rows.length) throw new Error("Duplicate attribute rule");
  for (const row of rows) {
    if (
      !raw.categories.some(
        (category) => category.kind === "listing" && category.key === row.category
      )
    )
      throw new Error("Unknown attribute category");
    if (row.dependsOn && !identities.has(`${row.category}/${row.dependsOn}`))
      throw new Error("Missing parent field");
    if (row.dependsOnValues && !row.dependsOn) throw new Error("Missing conditional parent");
    if (row.renderer === "select" && !row.validation.enum)
      throw new Error("Select requires closed choices");
    if (
      row.renderer === "combobox" &&
      (row.optionAuthority !== "suggestions" ||
        row.validation.enum ||
        row.validation.type !== "string")
    )
      throw new Error("Combobox requires text suggestions");
    if (row.renderer === "money" && (row.validation.type !== "integer" || row.unit !== "ZAR_cents"))
      throw new Error("Money requires integer cents");
    if (row.dynamicMaximum && row.validation.type !== "integer")
      throw new Error("Dynamic model year requires an integer");
    const seen = new Set<string>();
    let current: typeof row | undefined = row;
    while (current?.dependsOn) {
      if (seen.has(current.key)) throw new Error("Cyclic field dependency");
      seen.add(current.key);
      current = identities.get(`${row.category}/${current.dependsOn}`);
    }
  }
  return rows;
}
const fields: Field[] = validateAttributeRegistry(raw.listingFields);
const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number(value.slice(0, 4)) >= 1 &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function scalar(rule: Rule): z.ZodType {
  const known = new Set([
    "type",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "format",
    "items",
    "minItems",
    "maxItems",
  ]);
  if (Object.keys(rule).some((key) => !known.has(key)))
    throw new Error("Unsupported field validation keyword");
  if (rule.enum) {
    if (rule.type !== "string" || !rule.enum.length) throw new Error("Invalid choice rule");
    return z.enum(rule.enum as [string, ...string[]]);
  }
  if (rule.type === "string") {
    let schema = z.string().trim();
    if (rule.minLength !== undefined)
      schema = schema.refine((value) => value.length >= rule.minLength!);
    if (rule.maxLength !== undefined)
      schema = schema.refine((value) => value.length <= rule.maxLength!);
    if (rule.format && rule.format !== "date") throw new Error("Unsupported field format");
    return rule.format === "date"
      ? schema.refine(isDate, "Use a valid date in YYYY-MM-DD format")
      : schema;
  }
  if (rule.type === "number" || rule.type === "integer") {
    let schema = rule.type === "integer" ? z.number().int() : z.number();
    if (rule.minimum !== undefined) schema = schema.min(rule.minimum);
    if (rule.maximum !== undefined) schema = schema.max(rule.maximum);
    return schema;
  }
  if (rule.type === "boolean") return z.boolean();
  if (rule.type === "array" && rule.items) {
    let schema = z.array(scalar(rule.items));
    if (rule.minItems !== undefined) schema = schema.min(rule.minItems);
    if (rule.maxItems !== undefined) schema = schema.max(rule.maxItems);
    return schema.refine(
      (values) => new Set(values).size === values.length,
      "Choose each value once"
    );
  }
  throw new Error("Unsupported field type");
}
const active = (field: Field, values: Record<string, unknown>) =>
  !field.dependsOn ||
  (Object.hasOwn(values, field.dependsOn) &&
    (field.dependsOnValues?.includes(String(values[field.dependsOn])) ?? true));
const forCategory = (category: string) => {
  if (!raw.categories.some((row) => row.key === category && row.kind === "listing"))
    throw new Error("Unknown listing category");
  return fields.filter((field) => field.category === category);
};
function parseAttributes(category: string, input: unknown, now: Date, complete: boolean) {
  const selected = forCategory(category);
  const year = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Africa/Johannesburg", year: "numeric" }).format(now)
  );
  const shape: Record<string, z.ZodType> = {};
  for (const field of selected) {
    if (field.dynamicMaximum && field.dynamicMaximum !== "south_african_year_plus_one")
      throw new Error("Unsupported dynamic field limit");
    const rule =
      field.dynamicMaximum === "south_african_year_plus_one"
        ? { ...field.validation, maximum: year + 1 }
        : field.validation;
    const schema = scalar(rule);
    shape[field.key] =
      complete && field.required && !field.dependsOnValues ? schema : schema.optional();
  }
  const values = z.strictObject(shape).parse(input) as Record<string, unknown>;
  for (const field of selected) {
    if (!active(field, values) && Object.hasOwn(values, field.key))
      throw new Error(`Clear inactive field ${field.key}`);
    if (complete && active(field, values) && field.required && !Object.hasOwn(values, field.key))
      throw new Error(`Required field ${field.key}`);
  }
  return values;
}
/** Complete submission validation; missing required fields still fail. */
export function parseListingAttributes(category: string, input: unknown, now = new Date()) {
  return parseAttributes(category, input, now, true);
}
/** Restore or save an incomplete draft without accepting unknown/inactive/invalid fields. */
export function parseListingAttributeDraft(category: string, input: unknown, now = new Date()) {
  return parseAttributes(category, input, now, false);
}
/** Form transition helper; the command validator still rejects hidden/unknown fields. */
export function clearInactiveListingAttributes(category: string, input: unknown) {
  const values = z.record(z.string(), z.unknown()).parse(input);
  const selected = forCategory(category);
  const allowed = Object.fromEntries(
    selected
      .filter((field) => Object.hasOwn(values, field.key))
      .map((field) => [field.key, values[field.key]])
  );
  return Object.fromEntries(
    selected
      .filter((field) => Object.hasOwn(allowed, field.key) && active(field, allowed))
      .map((field) => [field.key, allowed[field.key]])
  );
}
export function parseAttributeMoney(text: string, maximumCents = 100_000_000_000) {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text.trim()))
    throw new Error("Use a rand amount with at most two decimal places");
  const [whole, fraction = ""] = text.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maximumCents)
    throw new Error("Amount exceeds field range");
  return cents;
}
