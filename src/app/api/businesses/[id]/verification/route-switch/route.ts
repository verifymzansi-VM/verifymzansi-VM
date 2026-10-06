import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { withoutException } from "@/lib/business-verification/decide";
import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";

import { loadOwnCase, requireOwnerJson } from "../_lib/owner-guard";

const log = createLogger("BusinessVerificationRouteSwitch");

const schema = z.object({ caseId: z.string().uuid() });

/**
 * POST /api/businesses/[id]/verification/route-switch
 * An owner who isn't a director moves their open CIPC request to the company
 * representative route (work-email code and a call-back), keeping their
 * document and messages instead of cancelling and starting again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireOwnerJson(request, params, schema, {
      log,
      rateAction: "business-verification:settings",
    });
    if (gate instanceof NextResponse) return gate;
    const { ctx, body } = gate;
    const { admin, business, userId } = ctx;

    const row = await loadOwnCase<{
      id: string;
      kind: string;
      route: string | null;
      status: string;
      checks: unknown;
      updated_at: string;
    }>(ctx, body.caseId, "id, kind, route, status, checks, updated_at");
    if (
      !row ||
      row.kind !== "cipc" ||
      row.route === "representative" ||
      !["pending", "info_requested"].includes(row.status)
    ) {
      return NextResponse.json({ error: "No open director request to switch." }, { status: 404 });
    }

    const { data: updated, error: updateError } = await admin
      .from("business_verifications")
      .update({
        route: "representative",
        representative: {},
        status: "pending",
        checks: withoutException(row.checks as Record<string, unknown> | null),
      })
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (updateError) throw new Error(updateError.message);
    if (!updated?.length) {
      return NextResponse.json(
        { error: "Your request just changed. Reload the page and try again." },
        { status: 409 }
      );
    }

    await admin.from("business_verification_messages").insert({
      case_id: row.id,
      author_id: userId,
      author_role: "owner",
      body: "I'm not a director. I'm switching to the company representative route.",
    });
    await Promise.all([
      logAuditEvent({
        actorId: userId,
        actorRole: "member",
        action: "business_verification_route_switched",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: { caseId: row.id },
      }),
      notifyStaffForAdminEvent({
        capability: "queue:view",
        type: "info",
        title: "Business verification moved to representative route",
        message: `${business.business_name} switched to the company representative route.`,
        href: `/admin/business-verification/${row.id}`,
        excludeUserId: userId,
      }),
    ]);
    return NextResponse.json({ route: "representative" });
  } catch (error) {
    log.error("Route switch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not switch. Please try again." }, { status: 500 });
  }
}
