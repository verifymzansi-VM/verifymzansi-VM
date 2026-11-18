import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import { input } from "@/lib/foundation/organisations";
import { revealFoundationApplicantContact } from "@/lib/foundation/organisation-management-data";

const uuid = z.uuid();
const body = z.strictObject({ applicationId: uuid });

/**
 * POST /api/organisations/:id/applicant-contact  { applicationId }
 * "Show contact" for one pending application on the organisation dashboard:
 * the business contact the applicant's live public profile shows. The page's
 * own data carries no applicant contacts; the database answers only an
 * administrator of the application's organisation (or staff with
 * organisation:manage), only while the application is pending, and the reveal
 * is rate limited like a post's "Show number".
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleOrganisationRoute(request, "contact:reveal", true, async (api, payload) => {
    input(uuid, (await context.params).id);
    const { applicationId } = input(body, payload);
    return revealFoundationApplicantContact(api, applicationId);
  });
}
