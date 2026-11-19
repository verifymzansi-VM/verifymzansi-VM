import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  readFoundationOrganisationAffiliations,
  readFoundationOrganisationApplications,
  settle,
} from "./organisations";
import { readFoundationOrganisationSponsorships } from "./organisation-sponsorships";

export const applicationPublicContacts = z
  .array(
    z.strictObject({
      application_id: z.uuid(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      website: z.string().nullable(),
    })
  )
  .max(200);

export async function readFoundationOrganisationManagementData(
  api: FoundationAuthenticatedApi,
  id: string,
  contacts: z.infer<typeof applicationPublicContacts>,
  { pendingOnly = false }: { pendingOnly?: boolean } = {}
) {
  const scope = { organisation_id: id };
  const [applications, affiliations, sponsorships] = await Promise.all([
    readFoundationOrganisationApplications(api, scope),
    readFoundationOrganisationAffiliations(api, scope),
    readFoundationOrganisationSponsorships(api, scope),
  ]);
  const open = new Map(
    sponsorships.items
      .filter((row) => row.status === "active" || row.status === "waitlisted")
      .map((row) => [row.affiliation_id, row])
  );
  const published = new Map(contacts.map((row) => [row.application_id, row]));
  return {
    applications: applications.map((row) => {
      // An organisation's administrators see an applicant's contact only while
      // the application is pending (owner decision, 18 November 2026).
      const fields =
        pendingOnly && row.status !== "submitted" && row.status !== "more_info_required"
          ? undefined
          : published.get(row.id);
      return {
        ...row,
        business_id: row.post_id,
        business_name: row.business_name ?? "Business",
        business_phone: fields?.phone ?? null,
        business_email: fields?.email ?? null,
        business_website: fields?.website ?? null,
      };
    }),
    members: affiliations.map((row) => {
      const sponsor = open.get(row.id);
      return {
        ...row,
        affiliation_id: row.id,
        business_id: row.post_id,
        business_name: row.business_name ?? "Business",
        business_status: row.live ? "live" : "not_live",
        sponsorship_id: sponsor?.id ?? null,
        sponsorship_status: sponsor?.status ?? null,
        sponsor_type: sponsor
          ? sponsor.sponsor_type === "founding"
            ? "VERIFYMZANSI_FOUNDING"
            : "ORGANISATION"
          : null,
        sponsorship_ends_at: sponsor?.ends_at ?? null,
      };
    }),
    sponsorships: { active: sponsorships.active, waitlisted: sponsorships.waitlisted },
  };
}

/** The public business contact of one pending application, revealed on
 * request (20261118072601_staff_data_minimisation.sql). */
export function revealFoundationApplicantContact(
  api: FoundationAuthenticatedApi,
  applicationId: string
) {
  return settle(
    api.rpc(
      "reveal_organisation_applicant_contact",
      { p_application: applicationId },
      { get: false }
    ),
    z.strictObject({
      application_id: z.literal(applicationId),
      phone: z.string().max(40).nullable(),
      email: z.string().max(254).nullable(),
      website: z.string().max(300).nullable(),
    })
  );
}
