import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { mapCommercialError } from "@/lib/commercial/errors";

const log = createLogger("OrganisationManage");
const uuid = z.uuid();

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("decide"),
    applicationId: uuid,
    decision: z.enum(["approve", "decline", "request_info"]),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("revoke"),
    affiliationId: uuid,
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("sponsor"),
    affiliationId: uuid,
    sponsorType: z.enum(["ORGANISATION", "VERIFYMZANSI_FOUNDING"]),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("end_sponsorship"),
    sponsorshipId: uuid,
    reason: z.string().trim().min(5).max(500),
  }),
]);

/**
 * POST /api/organisations/:id/manage
 * Organisation administrators (and VerifyMzansi commercial staff) decide
 * affiliation requests and manage sponsorships. Each RPC re-checks that the
 * caller administers the organisation that owns the record.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkLocalRateLimit(user.id, "organisation:manage", 60);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const parsed = await parseAndValidateJsonRequest(request, schema, {
    invalidJsonMessage: "Invalid JSON payload",
    validationErrorMessage: "Invalid request",
    includeValidationDetails: false,
  });
  if (!parsed.success) return parsed.response;
  const body = parsed.data;
  const db = createAdminClient();

  // Every record must belong to this organisation (the RPCs check the caller).
  const ownership =
    body.action === "decide"
      ? await db
          .from("organisation_applications")
          .select("organisation_id")
          .eq("id", body.applicationId)
          .maybeSingle()
      : body.action === "end_sponsorship"
        ? await db
            .from("organisation_sponsorships")
            .select("organisation_id")
            .eq("id", body.sponsorshipId)
            .maybeSingle()
        : await db
            .from("organisation_affiliations")
            .select("organisation_id")
            .eq("id", body.affiliationId)
            .maybeSingle();
  if (ownership.error || ownership.data?.organisation_id !== id) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const result =
    body.action === "decide"
      ? await db.rpc("org_decide_application", {
          p_user: user.id,
          p_application: body.applicationId,
          p_decision: body.decision,
          p_note: body.note ?? null,
        })
      : body.action === "revoke"
        ? await db.rpc("org_revoke_affiliation", {
            p_user: user.id,
            p_affiliation: body.affiliationId,
            p_reason: body.reason,
          })
        : body.action === "sponsor"
          ? await db.rpc("sponsor_business", {
              p_user: user.id,
              p_affiliation: body.affiliationId,
              p_sponsor_type: body.sponsorType,
              p_reason: body.reason,
            })
          : await db.rpc("end_sponsorship", {
              p_user: user.id,
              p_sponsorship: body.sponsorshipId,
              p_reason: body.reason,
            });

  if (result.error) {
    const mapped = mapCommercialError(result.error.message);
    if (!mapped)
      log.warn("Organisation action failed", { action: body.action, code: result.error.code });
    return NextResponse.json(
      { error: mapped?.message ?? "The change could not be applied." },
      { status: mapped?.status ?? 409 }
    );
  }
  return NextResponse.json({ success: true, data: result.data ?? null });
}
