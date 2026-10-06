import { NextResponse, type NextRequest } from "next/server";

import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";

/** Matches the owner page, which offers Renew from 60 days before expiry. */
const RENEWAL_WINDOW_DAYS = 60;

const log = createLogger("BusinessVerificationRenew");

/**
 * POST /api/businesses/[id]/verification/renew
 * One-tap renewal: no new upload. Staff fetch a fresh copy from CIPC and
 * decide as usual; the owner only uploads if staff ask for it.
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

    // What the business holds now decides whether a renewal makes sense.
    const [{ data: latest }, { data: biz }] = await Promise.all([
      admin
        .from("business_verifications")
        .select("kind, status")
        .eq("business_id", business.id)
        .eq("owner_id", userId)
        .in("kind", ["cipc", "cipc_link"])
        .in("status", ["approved", "expired", "revoked"])
        .order("decided_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      admin.from("businesses").select("cipc_expires_at").eq("id", business.id).maybeSingle(),
    ]);
    if (latest?.status === "revoked") {
      return NextResponse.json(
        { error: "This sticker was removed. Send a new CIPC document instead.", code: "revoked" },
        { status: 409 }
      );
    }
    if (latest?.kind === "cipc_link") {
      return NextResponse.json(
        {
          error: "This profile renews together with your main company profile. Renew that one.",
          code: "renews_with_source",
        },
        { status: 409 }
      );
    }
    const expiresAt = biz?.cipc_expires_at ? Date.parse(biz.cipc_expires_at as string) : null;
    if (expiresAt && expiresAt - Date.now() > RENEWAL_WINDOW_DAYS * 86_400_000) {
      return NextResponse.json(
        {
          error: `Renewal opens ${RENEWAL_WINDOW_DAYS} days before your sticker expires.`,
          code: "too_early",
        },
        { status: 409 }
      );
    }

    const { data: previous, error } = await admin
      .from("business_verifications")
      .select(
        "id, route, registration_number, parsed, director_id_hmacs, registered_office, representative"
      )
      .eq("business_id", business.id)
      .eq("owner_id", userId)
      .eq("kind", "cipc")
      .in("status", ["approved", "expired"])
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!previous?.registration_number) {
      return NextResponse.json(
        {
          error: "There's nothing to renew yet. Send a CIPC document instead.",
          code: "nothing_to_renew",
        },
        { status: 400 }
      );
    }

    const { data: created, error: insertError } = await admin
      .from("business_verifications")
      .insert({
        business_id: business.id,
        owner_id: userId,
        kind: "cipc",
        route: previous.route,
        registration_number: previous.registration_number,
        parsed: previous.parsed,
        director_id_hmacs: previous.director_id_hmacs,
        registered_office: previous.registered_office,
        linked_case_id: previous.id,
        findings: [
          {
            code: "renewal",
            severity: "check",
            title: "Renewal — no new upload",
            detail:
              "Fetch a fresh copy from CIPC: directors or status may have changed since last year.",
          },
        ],
        // A representative is re-confirmed on every renewal.
        representative: previous.route === "representative" ? { confirmed: false } : null,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      if (insertError?.code === "23505") {
        return NextResponse.json(
          { error: "This business already has a verification in review.", code: "case_open" },
          { status: 409 }
        );
      }
      throw new Error(insertError?.message ?? "insert failed");
    }

    await Promise.all([
      logAuditEvent({
        actorId: userId,
        actorRole: "member",
        action: "business_verification_renewal_requested",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: { caseId: created.id, previousCaseId: previous.id },
      }),
      notifyStaffForAdminEvent({
        capability: "queue:view",
        type: "info",
        title: "CIPC renewal requested",
        message: `${business.business_name} asked to renew its CIPC sticker.`,
        href: `/admin/business-verification/${created.id}`,
        excludeUserId: userId,
      }),
    ]);
    return NextResponse.json({ caseId: created.id, status: "pending" }, { status: 201 });
  } catch (error) {
    log.error("Renewal failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "We couldn't start the renewal. Please try again." },
      { status: 500 }
    );
  }
}
