import { z } from "zod";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";

/** The URL selects the resource. Reject a second identity in the body instead
 * of silently accepting a conflicting resource identifier. */
export function bindFoundationPathInput(
  field: "id" | "organisation_id",
  id: string,
  value: unknown
) {
  const body = z.record(z.string(), z.unknown()).safeParse(value);
  if (!z.uuid().safeParse(id).success || !body.success || Object.hasOwn(body.data, field))
    throw new FoundationOrganisationError("invalid");
  return { ...body.data, [field]: id };
}
