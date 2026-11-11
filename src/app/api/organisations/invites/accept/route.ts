import { NextRequest } from "next/server";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import { acceptFoundationOrganisationInvite } from "@/lib/foundation/organisations";

/**
 * POST /api/organisations/invites/accept
 * Accepts a sponsor administrator invitation for the signed-in member. The
 * database checks the link is unused and unexpired, that the member's email
 * matches the invitation and that their identity has been reviewed.
 */
export async function POST(request: Request) {
  return handleOrganisationRoute(
    request instanceof NextRequest ? request : new NextRequest(request),
    "organisation:invite",
    true,
    async (api, body) => {
      const data = await acceptFoundationOrganisationInvite(api, body);
      return {
        success: true,
        data: { organisationSlug: data.organisation_slug, role: data.role },
      };
    }
  );
}
