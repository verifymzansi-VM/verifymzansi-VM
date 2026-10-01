import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapCommercialError } from "@/lib/commercial/errors";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OrganisationInviteAccept");
const schema = z.object({ token: z.string().min(20).max(200) });

/**
 * POST /api/organisations/invites/accept
 * Accepts a sponsor administrator invitation for the signed-in member. The
 * database checks the link is unused and unexpired, that the member's email
 * matches the invitation and that their identity has been reviewed.
 */
export async function POST(request: Request) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to accept" }, { status: 401 });

  if (checkLocalRateLimit(user.id, "organisation:invite-accept", 10).limited) {
    return NextResponse.json({ error: "Too many attempts. Please wait." }, { status: 429 });
  }
  const parsed = await parseAndValidateJsonRequest(request, schema, {
    invalidJsonMessage: "Invalid request",
    validationErrorMessage: "Invalid invitation link",
    includeValidationDetails: false,
  });
  if (!parsed.success) return parsed.response;

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const { data, error } = await createAdminClient().rpc("accept_organisation_admin_invite", {
    p_user: user.id,
    p_token_hash: tokenHash,
  });
  if (error) {
    const mapped = mapCommercialError(error.message);
    if (!mapped) log.warn("Invite acceptance failed", { code: error.code });
    return NextResponse.json(
      { error: mapped?.message ?? "The invitation could not be accepted." },
      { status: mapped?.status ?? 409 }
    );
  }
  return NextResponse.json({ success: true, data });
}
