import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  foundationOrganisationTypes,
  foundationOrganisationStatuses,
  input,
  instant,
  key,
  objectKey,
  settle,
  FoundationOrganisationError,
  slug,
} from "./organisations";
const count = z.number().int().nonnegative();
// The RPC includes an operator row; project an explicit editor subset before
// passing it to the browser. Unknown future/private columns are discarded.
const organisation = z.object({
  id: z.uuid(),
  slug,
  name: z.string(),
  organisation_type: z.enum(foundationOrganisationTypes),
  description: z.string().nullable(),
  programme_description: z.string().nullable(),
  service_area: z.string().nullable(),
  province_id: key.nullable(),
  website: z.string().nullable(),
  public_email: z.string().nullable(),
  public_phone: z.string().nullable(),
  programme_status: z.enum(foundationOrganisationStatuses),
  programme_starts_at: instant.nullable(),
  programme_ends_at: instant.nullable(),
  affiliation_wording: z.string(),
  sponsorship_wording: z.string(),
  sponsored_capacity: count,
  admin_limit: count.min(1).max(50),
  accepting_applications: z.boolean(),
  is_public: z.boolean(),
  show_on_strip: z.boolean(),
  show_on_home: z.boolean(),
  display_order: count,
  revision: count.min(1),
  logo_object_id: z.uuid().nullable(),
  logo_object_key: objectKey.nullable(),
  logo_permission_at: instant.nullable(),
  logo_permission_reference: z.string().nullable(),
  active_affiliations: count,
  open_applications: count,
  admins: z
    .array(
      z.strictObject({
        account_id: z.uuid(),
        role: z.enum(["owner", "admin"]),
        display_name: z.string().nullable(),
        created_at: instant,
      })
    )
    .max(50),
  open_invites: z
    .array(z.strictObject({ id: z.uuid(), email: z.string(), expires_at: instant }))
    .max(200),
  programmes: z
    .array(z.strictObject({ id: z.uuid(), slug, name: z.string(), active: z.boolean() }))
    .max(1000),
  notes: z.array(z.strictObject({ id: z.uuid(), note: z.string(), created_at: instant })).max(50),
});
export async function readFoundationStaffOrganisation(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const { id } = input(z.strictObject({ id: z.uuid() }), value);
  const record = await settle(
    api.rpc("staff_get_organisation", { p_id: id.toLowerCase() }),
    organisation.nullable()
  );
  if (record && record.id !== id.toLowerCase())
    throw new FoundationOrganisationError("unavailable");
  return record;
}
