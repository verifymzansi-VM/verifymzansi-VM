import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import {
  applyToFoundationOrganisation,
  FoundationOrganisationError,
  input,
  updateMyFoundationApplication,
} from "@/lib/foundation/organisations";
import { readAffiliationWorkspace } from "@/lib/foundation/affiliation-workspace";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"),
    businessId: z.uuid(),
    organisationId: z.uuid(),
    programmeId: z.uuid().optional(),
    reason: z.string().trim().max(1000).optional(),
    reference: z.string().trim().max(120).optional(),
    consent: z.object({
      accepted: z.literal(true),
      shareRepresentativeName: z.boolean().default(false),
    }),
  }),
  z.object({
    action: z.enum(["respond", "withdraw"]),
    applicationId: z.uuid(),
    response: z.string().trim().max(2000).optional(),
  }),
]);

/** GET /api/affiliations — the member's own applications and affiliations. */
export async function GET(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:read", false, async (api) => {
    const { applications, affiliations } = await readAffiliationWorkspace(api);
    return {
      applications,
      affiliations: affiliations.map((row) => ({ ...row, status: "active" })),
    };
  });
}

/** POST /api/affiliations — request affiliation (with consent), respond, withdraw. */
export async function POST(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:apply", true, async (api, body) => {
    const value = input(schema, body);
    if (value.action === "submit") {
      const result = await applyToFoundationOrganisation(api, {
        organisation_id: value.organisationId,
        post_id: value.businessId,
        programme_id: value.programmeId,
        share_representative_name: value.consent.shareRepresentativeName,
        consent: value.consent.accepted,
        reason: value.reason || undefined,
        member_reference: value.reference || undefined,
      });
      return { success: true, data: result.id };
    }
    const result = await updateMyFoundationApplication(api, {
      application_id: value.applicationId,
      action: value.action,
      ...(value.action === "respond" ? { response: value.response } : {}),
    });
    if (!result) throw new FoundationOrganisationError("not_found");
    return { success: true, data: result.id };
  });
}
