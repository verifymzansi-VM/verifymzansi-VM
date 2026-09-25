import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { mapCommercialError } from "@/lib/commercial/errors";
import { logAuditEvent } from "@/lib/services/audit";
import { SHARED_WITH_ORGANISATION } from "@/lib/organisations/affiliations";

const log = createLogger("Affiliations");

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"),
    businessId: z.uuid(),
    organisationId: z.uuid(),
    programmeId: z.uuid().optional(),
    reason: z.string().trim().max(1000).optional(),
    reference: z.string().trim().max(120).optional(),
    consent: z.object({
      accepted: z.literal(true),
      shareRepresentativeName: z.boolean().default(false),
    }),
  }),
  z.object({
    action: z.enum(["respond", "withdraw"]),
    applicationId: z.uuid(),
    response: z.string().trim().max(2000).optional(),
  }),
]);

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** GET /api/affiliations — the member's own applications and affiliations. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: businesses } = await db.from("businesses").select("id").eq("owner_id", user.id);
  const ids = (businesses ?? []).map((b) => b.id);
  const [applications, affiliations] = await Promise.all([
    db
      .from("organisation_applications")
      .select(
        "id, organisation_id, business_id, status, info_request, decision_note, created_at, organisations(name, slug)"
      )
      .eq("applicant_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    ids.length
      ? db
          .from("organisation_affiliations")
          .select(
            "id, organisation_id, business_id, status, confirmed_at, organisations(name, slug, affiliation_wording)"
          )
          .in("business_id", ids)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
  ]);
  return NextResponse.json({
    applications: applications.data ?? [],
    affiliations: affiliations.data ?? [],
  });
}

/** POST /api/affiliations — request affiliation (with consent), respond, withdraw. */
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (checkLocalRateLimit(user.id, "affiliations:write", 20).limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  const parsed = await parseAndValidateJsonRequest(request, schema, {
    invalidJsonMessage: "Invalid JSON payload",
    validationErrorMessage: "Please complete the form and confirm consent.",
    includeValidationDetails: false,
  });
  if (!parsed.success) return parsed.response;
  const body = parsed.data;
  const db = createAdminClient();

  const result =
    body.action === "submit"
      ? await db.rpc("submit_affiliation_application", {
          p_user: user.id,
          p_business: body.businessId,
          p_org: body.organisationId,
          p_programme: body.programmeId ?? null,
          p_reason: body.reason ?? null,
          p_reference: body.reference ?? null,
          p_consent: {
            ...body.consent,
            fields: SHARED_WITH_ORGANISATION,
            consentedAt: new Date().toISOString(),
          },
        })
      : await db.rpc("member_affiliation_action", {
          p_user: user.id,
          p_application: body.applicationId,
          p_action: body.action,
          p_response: body.response ?? null,
        });

  if (result.error) {
    const mapped = mapCommercialError(result.error.message);
    if (!mapped) log.warn("Affiliation request failed", { code: result.error.code });
    return NextResponse.json(
      { error: mapped?.message ?? result.error.message.replace(/^[A-Z_]+: /, "") },
      { status: mapped?.status ?? 409 }
    );
  }

  if (body.action === "submit") {
    await logAuditEvent({
      actorId: user.id,
      actorRole: "owner",
      action: "affiliation_requested",
      targetType: "organisation_application",
      targetId: typeof result.data === "string" ? result.data : undefined,
      metadata: { organisationId: body.organisationId, businessId: body.businessId },
    });
  }
  return NextResponse.json({ success: true, data: result.data ?? null });
}
