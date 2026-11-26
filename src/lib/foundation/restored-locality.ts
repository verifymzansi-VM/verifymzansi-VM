import reference from "../domains/taxonomy/reference.json";
import { formatSaLongDate } from "../utils/format";
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
/** A province label, code or ID as its canonical ID, or null. */
export function resolveRestoredProvince(province: string): string | null {
  return (
    reference.provinces.find((row) =>
      [row.id, row.code, row.label].some((v) => normalize(v) === normalize(province))
    )?.id ?? null
  );
}
/** The refusal for a second place change within 15 days; `hint` is the
 * database's next allowed time (location_change_cooldown). */
export function locationCooldownMessage(hint: string | null | undefined) {
  const allowedFrom = new Date(hint ?? "");
  return Number.isNaN(allowedFrom.getTime())
    ? "You can change your province and city once every 15 days."
    : `You can change your province and city again after ${formatSaLongDate(allowedFrom)}.`;
}
