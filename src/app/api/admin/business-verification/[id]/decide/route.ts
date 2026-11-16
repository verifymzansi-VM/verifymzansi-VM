import { NextRequest } from "next/server";
import { z } from "zod";

import { CIPC_REASON_CODES } from "@/lib/cipc/screen";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "@/lib/foundation/staff-command";
import { currentBusinessClaim, readStaffSeenCase } from "@/lib/foundation/business-seen";

const log = createLogger("AdminBusinessVerificationDecide");

const REASONS = [...CIPC_REASON_CODES, "visit_not_confirmed", "other"] as const;

const schema = z.object({
  action: z.enum([
    "approve",
    "propose_exception",
    "confirm_exception",
    "withdraw_exception",
    "request_info",
    "reject",
    "revoke",
  ]),
  expectedUpdatedAt: z.string().min(10).max(64),
  reasonCode: z.enum(REASONS).optional(),
  note: z.string().trim().max(2000).optional(),
  checks: z
    .object({ inBusiness: z.boolean().optional(), ownerConfirmed: z.boolean().optional() })
    .optional(),
});

/** POST /api/admin/business-verification/[id]/decide — staff decide a case. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "business-verification:decide",
    mutate: true,
    requireCaller: true,
    signInMessage: "Sign in to decide business verification",
    unavailableMessage: "The review could not be confirmed. Reload the case.",
    refusal: staffCommandRefusal,
    command: async (api, payload, caller) => {
      if (!caller) throw new Error("Verified reviewer required");
      const id = z.uuid().parse((await params).id);
      const input = schema.strict().parse(payload);
      const expected = z.iso.datetime({ offset: true }).parse(input.expectedUpdatedAt);
      const isSeen = Boolean(await readStaffSeenCase(api, id));
      let rpc;
      let status: "approved" | "rejected" | "withdrawn" | "info_requested" | "pending";
      if (input.action === "revoke") {
        status = "withdrawn";
        rpc = api.rpc(
          isSeen ? "revoke_frontend_seen_check" : "revoke_frontend_cipc",
          {
            p_case: id,
            p_expected: expected,
            p_note: input.note ?? "",
            p_reason: input.reasonCode ?? "other",
          },
          { get: false }
        );
      } else {
        if (
          isSeen &&
          input.action !== "approve" &&
          input.action !== "reject" &&
          input.action !== "request_info"
        )
          throw new FoundationStaffCommandError(422, "Choose an action for this visit check.");
        const claim = await currentBusinessClaim(api, caller.accountId, id, true);
        if (!claim) throw new Error("Current claim required");
        status =
          input.action === "approve" || input.action === "confirm_exception"
            ? "approved"
            : input.action === "reject"
              ? "rejected"
              : input.action === "request_info"
                ? "info_requested"
                : "pending";
        rpc = api.rpc(
          isSeen ? "decide_frontend_seen_check" : "decide_frontend_cipc",
          {
            p_case: id,
            p_expected: expected,
            p_action: input.action,
            p_generation: claim.generation,
            p_nonce: claim.nonce,
            ...(input.note ? { p_note: input.note } : {}),
            ...(input.reasonCode ? { p_reason: input.reasonCode } : {}),
            ...(!isSeen
              ? { p_confirmed: Boolean(input.checks?.inBusiness && input.checks.ownerConfirmed) }
              : {}),
          },
          { get: false }
        );
      }
      return settleStaffCommand(
        rpc,
        z.strictObject({ caseId: z.literal(id), status: z.literal(status) })
      );
    },
  });
}
