import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { foundationOrganisationStatuses, instant, settle, slug } from "./organisations";

const organisation = z.strictObject({ name: z.string(), slug });
const id = z.uuid();
const count = z.number().int().nonnegative();
const role = z.enum(["owner", "admin"]);
const programmeStatus = z.enum(foundationOrganisationStatuses);
const workspace = z.strictObject({
  account_id: id,
  businesses: z.array(z.strictObject({ id, name: z.string(), status: z.string() })).max(1000),
  applications: z
    .array(
      z.strictObject({
        id,
        organisation_id: id,
        business_id: id,
        status: z.enum(["submitted", "more_info_required", "approved", "declined", "withdrawn"]),
        info_request: z.string().nullable(),
        decision_note: z.string().nullable(),
        created_at: instant,
        organisations: organisation,
      })
    )
    .max(100),
  affiliations: z
    .array(
      z.strictObject({
        id,
        organisation_id: id,
        business_id: id,
        confirmed_at: instant,
        organisations: organisation.extend({ affiliation_wording: z.string() }),
      })
    )
    .max(1000),
  administered: z.array(organisation.extend({ programme_status: programmeStatus })),
  preselected: organisation.nullable(),
});
export function readAffiliationWorkspace(
  api: FoundationAuthenticatedApi,
  organisationSlug?: string
) {
  return settle(
    api.rpc(
      "get_frontend_affiliation_workspace",
      organisationSlug ? { p_slug: organisationSlug } : {},
      { get: false }
    ),
    workspace
  );
}

const dashboard = organisation
  .extend({
    id,
    account_id: id,
    viewer_role: role,
    programme_status: programmeStatus,
    starts_at: instant.nullable(),
    ends_at: instant.nullable(),
    sponsored_capacity: count,
    admin_limit: count.min(1).max(50),
    is_public: z.boolean(),
    affiliation_wording: z.string(),
    applications: z.strictObject({
      pending: count,
      moreInfo: count,
      approved: count,
      declined: count,
    }),
    public_contacts: z
      .array(
        z.strictObject({
          application_id: id,
          phone: z.string().nullable(),
          email: z.string().nullable(),
          website: z.string().nullable(),
        })
      )
      .max(200),
    affiliated: count,
    admins: z
      .array(z.strictObject({ user_id: id, role, display_name: z.string().nullable() }))
      .max(50),
  })
  .strict();

export function readAffiliationOrganisationDashboard(
  api: FoundationAuthenticatedApi,
  orgSlug: string
) {
  return settle(
    api.rpc("get_frontend_organisation_dashboard", { p_slug: orgSlug }, { get: false }),
    dashboard.nullable()
  );
}
