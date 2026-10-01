import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapCommercialError } from "@/lib/commercial/errors";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("TrialExtensionResponse");
const schema = z.object({ decision: z.enum(["accept", "decline"]) });

/**
 * POST /api/trial-extensions/:id  { decision: "accept" | "decline" }
 * Only the offer's recipient (or the programme's current owner) can answer.
 * The database locks the offer, rejects second answers and expired offers,
 * and moves the end date only on acceptance.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (checkLocalRateLimit(user.id, "trial-extension:respond", 20).limited) {
    return NextResponse.json({ error: "Too many requests. Please wait." }, { status: 429 });
  }

  const parsed = await parseAndValidateJsonRequest(request, schema, {
    invalidJsonMessage: "Invalid request",
    validationErrorMessage: "Choose accept or decline",
    includeValidationDetails: false,
  });
  if (!parsed.success) return parsed.response;

  const { data, error } = await createAdminClient().rpc("respond_trial_extension", {
    p_user: user.id,
    p_offer: id,
    p_accept: parsed.data.decision === "accept",
  });
  if (error) {
    const mapped = mapCommercialError(error.message);
    if (!mapped) log.warn("Extension response failed", { code: error.code });
    return NextResponse.json(
      { error: mapped?.message ?? "Your answer could not be saved. Please try again." },
      { status: mapped?.status ?? 409 }
    );
  }
  return NextResponse.json({ success: true, data });
}
