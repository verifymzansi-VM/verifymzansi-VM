import { type NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
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
}
