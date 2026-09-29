import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";
import { decisionRefusalResponse, submitAppeal } from "@/lib/services/decision-ledger";
import { notifyStaffForAdminEvent } from "@/lib/notifications";

const log = createLogger("Appeals");

const appealSchema = z.object({
  decisionId: z.string().uuid(),
  reason: z.string().trim().min(20).max(2000),
});

/**
 * POST /api/appeals
 *
 * A member asks for an independent review of a decision that affects them.
 * Banned and suspended members can reach this route. The database checks
 * that the decision affects the signed-in member, can be appealed and has
 * not been appealed already; the appellant always comes from the session.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      return NextResponse.json({ error: "Sign in to ask for a review." }, { status: 401 });
    }

    const rl = await checkRateLimit({
      key: user.id,
      action: "appeals:submit",
      degradedMode: "local",
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const body = await parseAndValidateJsonRequest(request, appealSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Explain your appeal in 20 to 2000 characters.",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    const result = await submitAppeal(
      user.id,
      body.data.decisionId,
      sanitizeUserMessage(body.data.reason)
    );
    if (!result.ok) return decisionRefusalResponse(result.error);

    await notifyStaffForAdminEvent({
      type: "info",
      title: "New appeal to review",
      message: "A member asked for a review of a moderation decision.",
      href: `/admin/governance/appeals/${result.appeal_id}`,
      capability: "appeal:decide",
    }).catch((err: unknown) =>
      log.warn("Could not notify staff about an appeal", {
        error: err instanceof Error ? err.message : "unknown",
      })
    );

    return NextResponse.json({ status: "submitted", appealId: result.appeal_id }, { status: 201 });
  } catch (err) {
    logApiError(log, "Appeal submission failed", err);
    return internalApiError();
  }
}
