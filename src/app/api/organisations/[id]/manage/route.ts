import { NextRequest } from "next/server";
import { z } from "zod";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import { input, settle } from "@/lib/foundation/organisations";

const uuid = z.uuid();

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("decide"),
    applicationId: uuid,
    decision: z.enum(["approve", "decline", "request_info"]),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("revoke"),
    affiliationId: uuid,
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("sponsor"),
    affiliationId: uuid,
    sponsorType: z.enum(["ORGANISATION", "VERIFYMZANSI_FOUNDING"]),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("set_type"),
    affiliationId: uuid,
    affiliationType: z.enum(["participant", "member", "affiliate"]),
  }),
  z.object({
    action: z.literal("end_sponsorship"),
    sponsorshipId: uuid,
    reason: z.string().trim().min(5).max(500),
  }),
]);

/**
 * POST /api/organisations/:id/manage
 * Organisation administrators (and VerifyMzansi commercial staff) decide
 * affiliation requests and manage sponsorships. Each RPC re-checks that the
 * caller administers the organisation that owns the record.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleOrganisationRoute(
    request instanceof NextRequest ? request : new NextRequest(request),
    "organisation:manage",
    true,
    async (api, body) => {
      const org = input(uuid, (await context.params).id);
      const value = input(schema, body);
      const item =
        value.action === "decide"
          ? value.applicationId
          : value.action === "end_sponsorship"
            ? value.sponsorshipId
            : value.affiliationId;
      let args: { p_value?: string; p_note?: string } = {};
      switch (value.action) {
        case "decide":
          args = { p_value: value.decision, ...(value.note ? { p_note: value.note } : {}) };
          break;
        case "revoke":
          args = { p_value: value.reason };
          break;
        case "set_type":
          args = { p_value: value.affiliationType };
          break;
        case "sponsor":
          args = {
            p_value: value.sponsorType === "ORGANISATION" ? "organisation" : "founding",
            p_note: value.reason,
          };
          break;
        case "end_sponsorship":
          args = { p_note: value.reason };
          break;
      }
      const data = await settle(
        api.rpc(
          "execute_frontend_organisation_action",
          {
            p_org: org,
            p_item: item,
            p_action: value.action,
            ...args,
          },
          { get: false }
        ),
        z.looseObject({ id: z.uuid() })
      );
      return { success: true, data };
    }
  );
}
