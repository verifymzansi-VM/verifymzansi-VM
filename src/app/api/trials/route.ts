import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceAuthenticatedMutationRequest } from "@/lib/utils/authenticated-mutation-route";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";

const schema = z.object({ claimId: z.uuid(), action: z.enum(["choose_seven", "renew"]) });
const log = createLogger("IntroTrials");
export async function POST(request: Request) {
  const guard = await enforceAuthenticatedMutationRequest({
    request,
    logger: log,
    rateLimitAction: "trial:update",
  });
  if (!guard.success) return guard.response;
  const body = await parseAndValidateJsonRequest(request, schema);
  if (!body.success) return body.response;
  const { error } = await createAdminClient().rpc("update_own_intro_trial", {
    p_user_id: guard.user.id,
    p_claim_id: body.data.claimId,
    p_action: body.data.action,
  });
  if (error) {
    log.warn("Trial update refused", { code: error.code });
    return NextResponse.json(
      {
        error:
          "Unable to update this trial. Check that your paid plan is active, has room for this post, supports its photos and videos, and your verification is complete. Ended events cannot be renewed. Seven-day changes are available only before approval.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true });
}
