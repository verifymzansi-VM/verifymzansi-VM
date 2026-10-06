import { NextResponse, type NextRequest } from "next/server";

import { approvedOffice, isIdReviewed } from "@/lib/business-verification/service";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "./_lib/owner-guard";

const log = createLogger("BusinessVerificationState");

/**
 * GET /api/businesses/[id]/verification
 * The owner's view: sticker state, their cases (without staff-only findings),
 * the message thread, and other verified profiles this one can join.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireVerificationOwner(request, params, { log, requireIdReviewed: false });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;

    const [idReviewed, fullOffice, bizRes, casesRes, linkableRes] = await Promise.all([
      isIdReviewed(admin, userId),
      approvedOffice(admin, business.id),
      admin
        .from("businesses")
        .select(
          "cipc_verified_at, cipc_expires_at, cipc_registration_number, cipc_registered_name, show_full_registered_office, seen_verified_at, seen_expires_at, seen_method, seen_city, owner_verified_role, owner_position_title"
        )
        .eq("id", business.id)
        .single(),
      admin
        .from("business_verifications")
        .select(
          "id, kind, status, route, registration_number, reason_code, review_note, created_at, decided_at, expires_at, seen, representative"
        )
        .eq("business_id", business.id)
        // Only this owner's own cases: after a change of owner, the previous
        // owner's notes and messages stay private.
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("businesses")
        .select("id, business_name, cipc_registration_number, cipc_registered_name")
        .eq("owner_id", userId)
        .neq("id", business.id)
        .not("cipc_verified_at", "is", null)
        // Only live stickers can be joined (the daily job clears expired ones later).
        .gt("cipc_expires_at", new Date().toISOString()),
    ]);
    if (bizRes.error) throw new Error(bizRes.error.message);
    if (casesRes.error) throw new Error(casesRes.error.message);
    if (linkableRes.error) throw new Error(linkableRes.error.message);

    const cases = casesRes.data ?? [];
    const caseIds = cases.map((c) => c.id);
    const messagesRes = caseIds.length
      ? await admin
          .from("business_verification_messages")
          .select("id, case_id, author_role, body, created_at")
          .in("case_id", caseIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (messagesRes.error) throw new Error(messagesRes.error.message);

    const b = bizRes.data;
    const now = Date.now();
    const live = (verifiedAt: string | null, expiresAt: string | null) =>
      Boolean(verifiedAt) && (!expiresAt || Date.parse(expiresAt) > now);

    return NextResponse.json({
      business: { id: business.id, name: business.business_name },
      stickers: {
        idReviewed,
        cipc: live(b.cipc_verified_at, b.cipc_expires_at)
          ? {
              verifiedAt: b.cipc_verified_at,
              expiresAt: b.cipc_expires_at,
              registrationNumber: b.cipc_registration_number,
              registeredName: b.cipc_registered_name,
              role: b.owner_verified_role,
              position: b.owner_position_title,
              showFullRegisteredOffice: b.show_full_registered_office,
              // Owner only: the full office, for "Use registered office" on the edit form.
              registeredOffice: fullOffice,
            }
          : null,
        seen: live(b.seen_verified_at, b.seen_expires_at)
          ? {
              verifiedAt: b.seen_verified_at,
              expiresAt: b.seen_expires_at,
              method: b.seen_method,
              city: b.seen_city,
            }
          : null,
      },
      cases: cases.map((c) => ({
        id: c.id,
        kind: c.kind,
        status: c.status,
        route: c.route,
        registrationNumber: c.registration_number,
        reasonCode: c.reason_code,
        note: c.review_note,
        createdAt: c.created_at,
        decidedAt: c.decided_at,
        expiresAt: c.expires_at,
        seenMethod: (c.seen as { method?: string } | null)?.method ?? null,
        seenScheduledFor: (c.seen as { scheduledFor?: string } | null)?.scheduledFor ?? null,
        // Representative progress for the owner; codes and staff notes stay server-side.
        representative:
          c.route === "representative"
            ? {
                email: (c.representative as { email?: string } | null)?.email ?? null,
                position: (c.representative as { position?: string } | null)?.position ?? null,
                emailVerified: Boolean(
                  (c.representative as { emailVerifiedAt?: string } | null)?.emailVerifiedAt
                ),
                codeSent: Boolean((c.representative as { codeHash?: string } | null)?.codeHash),
              }
            : null,
        messages: (messagesRes.data ?? [])
          .filter((m) => m.case_id === c.id)
          .map((m) => ({
            id: m.id,
            from: m.author_role === "staff" ? "VerifyMzansi team" : "You",
            mine: m.author_role === "owner",
            body: m.body,
            createdAt: m.created_at,
          })),
      })),
      linkable: (linkableRes.data ?? []).map((l) => ({
        businessId: l.id,
        businessName: l.business_name,
        registrationNumber: l.cipc_registration_number,
        registeredName: l.cipc_registered_name,
      })),
    });
  } catch (error) {
    log.error("Failed to load business verification state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not load verification status" }, { status: 500 });
  }
}
