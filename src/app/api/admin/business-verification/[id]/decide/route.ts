import { NextResponse } from "next/server";
import { z } from "zod";

import { decideBusinessVerification } from "@/lib/business-verification/decide";
import { CIPC_REASON_CODES } from "@/lib/cipc/screen";
import { checkQueueClaim, releaseDecidedClaim } from "@/lib/services/queue-claims";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationDecide");

const REASONS = [...CIPC_REASON_CODES, "visit_not_confirmed", "other"] as const;

const schema = z.object({
  action: z.enum([
    "approve",
    "propose_exception",
    "confirm_exception",
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
