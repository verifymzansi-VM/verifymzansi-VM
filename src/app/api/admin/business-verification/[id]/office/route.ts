import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { logAuditEvent } from "@/lib/services/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationOffice");

const text = (max: number) => z.string().trim().max(max).nullable();
const schema = z.object({
  streetLines: z.array(z.string().trim().min(1).max(120)).max(3),
  suburb: text(80),
  city: z.string().trim().min(1).max(80),
  province: z.string().trim().min(1).max(50),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/)
    .nullable(),
});

/**
 * PATCH /api/admin/business-verification/[id]/office
 * Staff correct how we read the registered office before approving.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireStaffCase(request, params, { log });
    if (guard instanceof NextResponse) return guard;

    const body = await parseAndValidateJsonRequest(request, schema, {
      validationErrorMessage: "Check the address fields",
      includeValidationDetails: true,
    });
    if (!body.success) return body.response;

    const province = normalizeProvinceName(body.data.province);
    if (!province)
      return NextResponse.json({ error: "Choose a South African province." }, { status: 400 });
    const resolvedCity = resolveCityName(province, body.data.city);
    const office = {
      streetLines: body.data.streetLines,
      suburb: body.data.suburb || null,
      city: resolvedCity ?? body.data.city,
      province,
      postalCode: body.data.postalCode,
      cityKnown: resolvedCity !== null,
    };

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("business_verifications")
      .update({ registered_office: office })
      .eq("id", guard.caseId)
      .eq("kind", "cipc")
      .in("status", ["pending", "info_requested"])
      .select("business_id");
    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ error: "Open case not found" }, { status: 404 });

    await logAuditEvent({
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      action: "business_verification_office_corrected",
      targetType: "business",
      targetId: data[0].business_id as string,
      area: "MZANSI_BUSINESS",
      metadata: { caseId: guard.caseId },
    });
    return NextResponse.json({ registeredOffice: office });
  } catch (error) {
    logApiError(log, "Correcting registered office failed", error);
    return internalApiError();
  }
}
