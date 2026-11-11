import { NextRequest } from "next/server";
import { z } from "zod";

import { PREMISES_TYPES } from "@/lib/business-verification/seen";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";
import { currentBusinessClaim } from "@/lib/foundation/business-seen";

const log = createLogger("AdminBusinessVerificationVisit");

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule"),
    expectedUpdatedAt: z.string().min(10).max(64),
    scheduledFor: z.string().datetime({ offset: true }),
  }),
  z.object({
    action: z.literal("report"),
    expectedUpdatedAt: z.string().min(10).max(64),
    outcome: z.enum(["seen", "not_confirmed"]),
    identityConfirmed: z.boolean(),
    signage: z.boolean(),
    productsSeen: z.string().trim().min(3).max(500),
    premisesType: z.enum(PREMISES_TYPES),
    notes: z.string().trim().max(1000).nullable(),
    /** Visits: the town or city where the business was seen (public on the sticker). */
    city: z.string().trim().max(80).nullable().optional(),
  }),
]);

/**
 * POST /api/admin/business-verification/[id]/visit
 * "schedule": the verifier takes the check and books a time (the owner is
 * told the date and the verifier's first name). "report": the verifier who
 * took it records what they saw; a different staff member approves.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "business-verification:visit",
    mutate: true,
    requireCaller: true,
    maxBytes: 10000,
    signInMessage: "Sign in to work on business checks",
    unavailableMessage: "The check could not be updated. Reload the case.",
    refusal: staffCommandRefusal,
    command: async (api, payload, caller) => {
      const id = z.uuid().parse((await params).id);
      const input = schema.parse(payload);
      const expected = z.iso.datetime({ offset: true }).parse(input.expectedUpdatedAt);
      if (!caller) throw new Error("Verified reviewer required");
      let rpc;
      if (input.action === "schedule") {
        const claim = await currentBusinessClaim(api, caller.accountId, id, false);
        rpc = api.rpc(
          "schedule_frontend_seen_check",
          {
            p_case: id,
            p_expected: expected,
            p_scheduled: input.scheduledFor,
            ...(claim ? { p_generation: claim.generation, p_nonce: claim.nonce } : {}),
          },
          { get: false }
        );
      } else {
        const { action: _action, expectedUpdatedAt: _expected, ...report } = input;
        rpc = api.rpc(
          "report_frontend_seen_check",
          { p_case: id, p_expected: expected, p_report: report },
          { get: false }
        );
      }
      return settleStaffCommand(
        rpc,
        z.strictObject({ ok: z.literal(true), updatedAt: z.iso.datetime({ offset: true }) })
      );
    },
  });
}
