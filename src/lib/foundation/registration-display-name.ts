import { isPersonName, normalizePersonName } from "./person-name";

/** The preserved form accepts two independent 50-character name parts;
 * the canonical public display name is limited to 50. Keep the complete
 * claimed parts in registration metadata and use the first name when their
 * combination would exceed that limit. Neither value verifies an identity. */
export function registrationDisplayName(firstName: string, lastName: string) {
  const full = normalizePersonName(`${firstName} ${lastName}`);
  return isPersonName(full) ? full : normalizePersonName(firstName);
}
