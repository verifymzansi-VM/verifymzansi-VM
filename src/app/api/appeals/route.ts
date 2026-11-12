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
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";

class AppealSubmissionRefusal extends Error {
  override name = "AppealSubmissionRefusal";
  constructor(
    readonly status: 403 | 409 | 422,
    message: string
  ) {
    super(message);
  }
}

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
  if (getDataBackend() === "foundation")
    return handleFoundationOwnerRoute({
      request,
      log,
      action: "appeals:submit",
      mutate: true,
      successStatus: 201,
      maxBytes: 13000,
      signInMessage: "Sign in to ask for a review.",
      unavailableMessage:
        "Your appeal could not be confirmed. Check your decisions before trying again.",
      refusal: (error) => {
        if (error instanceof AppealSubmissionRefusal)
          return { status: error.status, error: error.message, reason: "appeal_refused" };
        if (error instanceof z.ZodError)
          return {
            status: 422,
            error: "Explain your appeal in 20 to 2000 characters.",
            reason: "invalid_appeal",
          };
        return null;
      },
      command: async (api, body) => {
        const { decisionId, reason } = appealSchema.strict().parse(body);
        const { data, error } = await api.rpc(
          "submit_my_frontend_appeal",
          { p_action: decisionId, p_reason: reason },
          { get: false }
        );
        if (error?.code === "42501")
          throw new AppealSubmissionRefusal(403, "Sign in again to submit your appeal.");
        if (error?.code === "PT409")
          throw new AppealSubmissionRefusal(
            409,
            "This decision cannot be appealed. Check your decisions for an existing appeal."
          );
        if (error?.code === "22023")
          throw new AppealSubmissionRefusal(422, "Check your appeal explanation and try again.");
        if (error) throw new Error("Appeal unavailable");
        const result = z
          .strictObject({
            appeal_id: z.uuid(),
            status: z.literal("submitted"),
            reused: z.boolean().optional(),
          })
          .safeParse(data);
        if (!result.success) throw new Error("Appeal acknowledgement unavailable");
        return { status: result.data.status, appealId: result.data.appeal_id };
      },
    });
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
