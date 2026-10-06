import { NextResponse } from "next/server";
import { z } from "zod";

import { notifyOwner } from "@/lib/business-verification/decide";
import { logAuditEvent } from "@/lib/services/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationMessage");

const schema = z.object({ body: z.string().trim().min(1).max(2000) });

/**
 * POST /api/admin/business-verification/[id]/message
 * A note to the owner that does not change the case status. To pause the
 * case for the owner, use the "request info" decision instead.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireStaffCase(request, params, {
      log,
      capability: "case:add_note",
      requireClaim: false,
    });
    if (guard instanceof NextResponse) return guard;

    const body = await parseAndValidateJsonRequest(request, schema, {
      validationErrorMessage: "Write a message",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("business_verifications")
      .select("id, owner_id, business_id, kind, status")
      .eq("id", guard.caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return NextResponse.json({ error: "Case not found" }, { status: 404 });
    if (row.owner_id === guard.user.id) {
      return NextResponse.json({ error: "You can't review your own business." }, { status: 403 });
    }

    const { error: insertError } = await admin.from("business_verification_messages").insert({
      case_id: row.id,
      author_id: guard.user.id,
      author_role: "staff",
      body: body.data.body,
    });
    if (insertError) throw new Error(insertError.message);

    await Promise.all([
      notifyOwner(admin, row, "message", body.data.body),
      logAuditEvent({
        actorId: guard.user.id,
        actorRole: guard.actorRole,
        action: "business_verification_staff_message",
        targetType: "business",
        targetId: row.business_id,
        area: "MZANSI_BUSINESS",
        metadata: { caseId: row.id },
      }),
    ]);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    logApiError(log, "Staff verification message failed", error);
    return internalApiError();
  }
}
