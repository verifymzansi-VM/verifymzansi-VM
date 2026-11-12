import { type NextRequest } from "next/server";
import { z } from "zod";
import { dsarRequestSchema } from "@/lib/validations/verification";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { createLogger } from "@/lib/utils/logger";
import { getClientIp } from "@/lib/utils/rate-limit";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";

const log = createLogger("DSAR");
const dsarSubmitSchema = dsarRequestSchema.extend({
  turnstileToken: z.string().min(1, "CAPTCHA verification required").max(2048),
});
class PrivacySubmissionRefusal extends Error {
  override name = "PrivacySubmissionRefusal";
  constructor(
    readonly status: 400 | 403 | 429 | 503,
    message: string
  ) {
    super(message);
  }
}

/**
 * POST /api/dsar/submit
 *
 * Submit a Data Subject Access Request (POPIA Section 23).
 * Requires an authenticated account session.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "dsar:submit",
    mutate: true,
    requireCaller: true,
    maxBytes: 15000,
    signInMessage: "Sign in to submit a data request",
    unavailableMessage:
      "Your data request could not be confirmed. Try again or contact the privacy team.",
    refusal: (error) => {
      if (error instanceof PrivacySubmissionRefusal)
        return {
          status: error.status,
          error: error.message,
          reason: "privacy_submission_refused",
        };
      if (error instanceof z.ZodError)
        return {
          status: 422,
          error: "Check the data request details",
          reason: "invalid_privacy_request",
        };
      return null;
    },
    command: async (_api, body, caller) => {
      if (!caller) throw new Error("Verified privacy caller required");
      const input = dsarSubmitSchema.strict().parse(body);
      const captcha = await verifyTurnstileToken({
        token: input.turnstileToken,
        remoteIp: getClientIp(request),
      });
      const hostname = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).hostname;
      if (captcha.temporary) throw new PrivacySubmissionRefusal(503, "CAPTCHA service unavailable");
      if (
        !captcha.success ||
        ((process.env.NODE_ENV === "production" || captcha.hostname) &&
          captcha.hostname !== hostname)
      )
        throw new PrivacySubmissionRefusal(400, "CAPTCHA verification failed");
      const { data, error } = await createFoundationServiceApi().rpc(
        "record_frontend_privacy_request",
        {
          p_account: caller.accountId,
          p_session: caller.sessionId,
          p_type: input.type,
          p_name: input.name.trim(),
          p_last_four: input.idNumber.slice(-4),
          p_details: input.details?.trim() || null,
        },
        { get: false }
      );
      if (error?.code === "42501")
        throw new PrivacySubmissionRefusal(403, "Confirm your email and sign in again.");
      if (error?.code === "22023")
        throw new PrivacySubmissionRefusal(400, "Check your request details.");
      if (error?.code === "PT429")
        throw new PrivacySubmissionRefusal(429, "Too many data requests. Try again later.");
      if (error) throw new Error("Privacy request unavailable");
      const row = z
        .strictObject({
          id: z.uuid(),
          due_by: z.iso.datetime({ offset: true }),
          reused: z.boolean().optional(),
        })
        .safeParse(data);
      if (!row.success) throw new Error("Privacy request receipt unavailable");
      return {
        success: true,
        requestId: row.data.id,
        reference: `DSAR-${row.data.id.slice(0, 8).toUpperCase()}`,
        dueBy: new Date(row.data.due_by).toISOString(),
      };
    },
  });
}
