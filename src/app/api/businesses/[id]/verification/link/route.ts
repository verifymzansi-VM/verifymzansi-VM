import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";

const log = createLogger("BusinessVerificationLink");

const bodySchema = z.object({ sourceBusinessId: z.string().uuid() });

/**
 * POST /api/businesses/[id]/verification/link
 * A second profile (branch, brand) of a company this owner already verified.
 * No documents: staff confirm the link with one click.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      rateAction: "business-verification:renew",
    });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;

    const parsed = await parseAndValidateJsonRequest(request, bodySchema);
    if (!parsed.success) return parsed.response;

    const { data: source, error: sourceError } = await admin
      .from("businesses")
      .select(
        "id, owner_id, business_name, cipc_verified_at, cipc_expires_at, cipc_registration_number"
      )
      .eq("id", parsed.data.sourceBusinessId)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    const live =
      source?.cipc_verified_at &&
      (!source.cipc_expires_at || Date.parse(source.cipc_expires_at) > Date.now());
    if (
      !source ||
      source.id === business.id ||
      source.owner_id !== userId ||
      !live ||
      !source.cipc_registration_number
    ) {
      return NextResponse.json(
        { error: "Pick one of your CIPC-verified profiles." },
        { status: 400 }
      );
    }

    const { data: sourceCase } = await admin
      .from("business_verifications")
      .select("id")
      .eq("business_id", source.id)
      .in("kind", ["cipc", "cipc_link"])
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await admin
      .from("business_verifications")
      .insert({
        business_id: business.id,
        owner_id: userId,
        kind: "cipc_link",
        registration_number: source.cipc_registration_number,
        linked_case_id: sourceCase?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !created) {
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: "This business already has a verification in review.", code: "case_open" },
          { status: 409 }
        );
      }
      throw new Error(error?.message ?? "insert failed");
    }

    await Promise.all([
      logAuditEvent({
        actorId: userId,
        actorRole: "member",
        action: "business_verification_link_requested",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: { caseId: created.id, sourceBusinessId: source.id },
      }),
      notifyStaffForAdminEvent({
        capability: "queue:view",
        type: "info",
        title: "Business profile link requested",
        message: `${business.business_name} wants to join ${source.business_name}'s CIPC sticker.`,
        href: `/admin/business-verification/${created.id}`,
        excludeUserId: userId,
      }),
    ]);

    return NextResponse.json({ caseId: created.id, status: "pending" }, { status: 201 });
  } catch (error) {
    log.error("Profile link request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "We couldn't send that. Please try again." },
      { status: 500 }
    );
  }
}
