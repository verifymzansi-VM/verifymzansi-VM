import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isRepresentativeConfirmed,
  type RepresentativeState,
} from "@/lib/business-verification/representative";
import { logAuditEvent } from "@/lib/services/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationRepresentative");

const schema = z.object({
  expectedUpdatedAt: z.string().min(10).max(64),
  domainConfirmed: z.boolean(),
  callback: z.object({
    numberSource: z.string().trim().min(5).max(200),
    spokeTo: z.string().trim().min(2).max(120),
    confirmedPosition: z.string().trim().min(2).max(40),
    confirmed: z.boolean(),
    notes: z.string().trim().max(1000).nullable(),
  }),
});

/**
 * POST /api/admin/business-verification/[id]/representative
 * Staff record that the work email's domain is the company's own website and
 * log the call-back: the number's source (found by staff, never supplied by
 * the applicant), who confirmed, and the confirmed position.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireStaffCase(request, params, { log });
    if (guard instanceof NextResponse) return guard;

    const body = await parseAndValidateJsonRequest(request, schema, {
      includeValidationDetails: true,
    });
    if (!body.success) return body.response;

    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("business_verifications")
      .select("id, business_id, owner_id, route, status, representative, updated_at")
      .eq("id", guard.caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (
      !row ||
      row.route !== "representative" ||
      !["pending", "info_requested"].includes(row.status)
    ) {
      return NextResponse.json({ error: "Open representative case not found" }, { status: 404 });
    }
    if (row.owner_id === guard.user.id) {
      return NextResponse.json({ error: "You can't review your own business." }, { status: 403 });
    }

    const next: RepresentativeState = {
      ...((row.representative ?? {}) as RepresentativeState),
      domainConfirmed: body.data.domainConfirmed,
      position: body.data.callback.confirmedPosition,
      callback: { ...body.data.callback, by: guard.user.id, at: new Date().toISOString() },
    };
    next.confirmed = isRepresentativeConfirmed(next);

    const { data: updated, error: updateError } = await admin
      .from("business_verifications")
      .update({ representative: next })
      .eq("id", row.id)
      .eq("updated_at", body.data.expectedUpdatedAt)
      .select("id");
    if (updateError) throw new Error(updateError.message);
    if (!updated?.length) {
      return NextResponse.json(
        { error: "This case changed. Reload and check again." },
        { status: 409 }
      );
    }

    await logAuditEvent({
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      action: "business_verification_callback_logged",
      targetType: "business",
      targetId: row.business_id,
      area: "MZANSI_BUSINESS",
      metadata: {
        caseId: row.id,
        confirmed: next.confirmed,
        numberSource: body.data.callback.numberSource,
      },
    });
    return NextResponse.json({ confirmed: next.confirmed });
  } catch (error) {
    logApiError(log, "Logging representative call-back failed", error);
    return internalApiError();
  }
}
