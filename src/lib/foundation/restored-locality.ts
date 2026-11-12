import reference from "../domains/taxonomy/reference.json";
export class LocalityInputError extends Error {
  override name = "LocalityInputError";
}
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
/** Map preserved form labels/aliases to canonical IDs; SQL rechecks the pair. */
export function resolveRestoredLocality(province: string, city: string) {
  if (!province || !city) throw new LocalityInputError("Select a province and city together");
  const p = reference.provinces.find((row) =>
    [row.id, row.code, row.label].some((v) => normalize(v) === normalize(province))
  );
  const matches = reference.cities.filter(
    (row) =>
      row.province === p?.id &&
      [row.id, row.label, ...row.aliases].some((v) => normalize(v) === normalize(city))
  );
  if (!p || matches.length !== 1) throw new LocalityInputError("Select a valid province and city");
  return { p_province: p.id, p_city: matches[0].id };
}
