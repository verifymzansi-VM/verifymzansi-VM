/**
 * Server errors name fields by dotted paths such as `service_areas.areas` or
 * `attributes.property_type`. These helpers turn those paths into the form's
 * step and label, and raw schema messages into plain words.
 */

/** Finds the value for a dotted path, trying the full path, then shorter prefixes. */
export function lookupFieldPath<T>(key: string, map: Record<string, T>): T | undefined {
  const parts = key.split(".");
  for (let length = parts.length; length > 0; length -= 1) {
    const value = map[parts.slice(0, length).join(".")];
    if (value !== undefined) return value;
  }
  return undefined;
}

const CONTAINER_SEGMENTS = new Set([
  "attributes",
  "category_details",
  "customer_access",
  "business_details",
  "event_details",
]);

/** The form's label for a field path, or a plain sentence-case name built from the path. */
export function fieldLabelFor(key: string, labels?: Record<string, string>): string {
  const explicit = labels ? lookupFieldPath(key, labels)?.trim() : undefined;
  if (explicit) return explicit;
  const segments = key.split(".").filter((s) => s && !/^\d+$/.test(s));
  const name = segments.find((s) => !CONTAINER_SEGMENTS.has(s)) ?? segments.at(-1) ?? key;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SIZE_MESSAGE =
  /^Too (small|big): expected (string|number|array) to (?:have|be) [<>]=?\s*(\d+(?:\.\d+)?)/;

/** Replaces raw schema wording with plain words; written messages pass through unchanged. */
export function plainFieldMessage(message: string): string {
  const size = SIZE_MESSAGE.exec(message);
  if (size) {
    const bound = size[1] === "small" ? "at least" : "at most";
    const plural = size[3] === "1" ? "" : "s";
    const unit =
      size[2] === "string" ? ` character${plural}` : size[2] === "array" ? ` item${plural}` : "";
    return `Must be ${bound} ${size[3]}${unit}`;
  }
  if (/^Invalid (option|enum value)/.test(message)) return "Choose one of the options.";
  if (/^(Invalid input|Invalid type|Too small|Too big|Expected |Required$)/.test(message))
    return "Check this field.";
  return message;
}
