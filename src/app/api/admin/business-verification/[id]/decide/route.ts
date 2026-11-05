import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { decideBusinessVerification } from "@/lib/business-verification/decide";
import { CIPC_REASON_CODES } from "@/lib/cipc/screen";
import { checkQueueClaim, releaseDecidedClaim } from "@/lib/services/queue-claims";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "@/lib/foundation/staff-command";
import { currentBusinessClaim } from "@/lib/foundation/business-seen";

import { requireStaffCase } from "../../_lib/staff-guard";

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

/** Sensitive outcomes need a recent second factor. */
const STEP_UP = new Set(["confirm_exception", "revoke"]);

/** POST /api/admin/business-verification/[id]/decide — staff decide a case. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (getDataBackend() === "foundation")
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
        let rpc;
        let status: "approved" | "rejected" | "withdrawn" | "info_requested";
        if (input.action === "revoke") {
          status = "withdrawn";
          rpc = api.rpc(
            "revoke_frontend_seen_check",
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
            input.action !== "approve" &&
            input.action !== "reject" &&
            input.action !== "request_info"
          )
            throw new FoundationStaffCommandError(422, "Choose an action for this visit check.");
          const claim = await currentBusinessClaim(api, caller.accountId, id, true);
          if (!claim) throw new Error("Current claim required");
          status =
            input.action === "approve"
              ? "approved"
              : input.action === "reject"
                ? "rejected"
                : "info_requested";
          rpc = api.rpc(
            "decide_frontend_seen_check",
            {
              p_case: id,
              p_expected: expected,
              p_action: input.action,
              p_generation: claim.generation,
              p_nonce: claim.nonce,
              ...(input.note ? { p_note: input.note } : {}),
              ...(input.reasonCode ? { p_reason: input.reasonCode } : {}),
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
  try {
    const guard = await requireStaffCase(request, params, { log, requireClaim: false });
    if (guard instanceof NextResponse) return guard;

    const body = await parseAndValidateJsonRequest(request, schema, {
      validationErrorMessage: "Invalid decision",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    if (STEP_UP.has(body.data.action)) {
      const mfaBlock = await checkStaffApiMfa(await createClient(), guard.user.id, {
        stepUp: true,
      });
      if (mfaBlock) return mfaBlock;
    }

    const item = { type: "business_verification" as const, id: guard.caseId };
    const actorRole = guard.actorRole as "moderator" | "governance_controller" | "admin";
    // Queue work follows claims; removing a granted sticker is a separate,
    // senior action on a closed case.
    if (body.data.action !== "revoke") {
      const refused = await checkQueueClaim(guard.user.id, item);
      if (refused) return refused;
    }

    const result = await decideBusinessVerification(createAdminClient(), {
      action: body.data.action,
      caseId: guard.caseId,
      expectedUpdatedAt: body.data.expectedUpdatedAt,
      actorId: guard.user.id,
      actorRole,
      reasonCode: body.data.reasonCode ?? null,
      note: body.data.note ?? null,
      checks: body.data.checks,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      );
    }
    // Release after every action, including a proposed exception: the second
    // reviewer who confirms it must be able to claim the case.
    await releaseDecidedClaim(guard.user.id, item);
    return NextResponse.json({ status: result.status });
  } catch (error) {
    logApiError(log, "Business verification decision failed", error);
    return internalApiError();
  }
}
