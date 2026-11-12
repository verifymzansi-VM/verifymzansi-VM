import { z } from "zod";
import type { FoundationRefusal } from "./owner-route";
export class FoundationStaffCommandError extends Error {
  override name = "FoundationStaffCommandError";
  constructor(
    readonly status: number,
    message: string,
    readonly mfaRequired = false
  ) {
    super(message);
  }
}
import { isStaffSecondFactorRefusal } from "./error-reasons";
export async function settleStaffCommand<T>(
  result: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  schema: z.ZodType<T>
): Promise<T> {
  const { data, error } = await result;
  if (error) {
    if (error.code === "42501") {
      const mfa = isStaffSecondFactorRefusal(error);
      throw new FoundationStaffCommandError(
        403,
        mfa
          ? "Verify your authenticator again, then reload the queue."
          : "Staff access or the claim changed. Reload the queue before continuing.",
        mfa
      );
    }
    // Approving a post that no plan or free week can fund any more.
    if (error.code === "PT402")
      throw new FoundationStaffCommandError(
        409,
        "No plan or free week is left to fund this post. Reject it with a reason, or ask the member to choose a plan."
      );
    throw new FoundationStaffCommandError(
      error.code === "PT409"
        ? 409
        : error.code === "PT429"
          ? 429
          : error.code === "22023"
            ? 422
            : 503,
      error.code === "PT429"
        ? "The queue limit has been reached. Reload the queue."
        : "The item could not be confirmed. Reload the queue before continuing."
    );
  }
  try {
    return schema.parse(data);
  } catch {
    throw new FoundationStaffCommandError(
      503,
      "The response could not be confirmed. Reload the queue before continuing."
    );
  }
}
export function staffCommandRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof z.ZodError)
    return {
      status: 422,
      error: "Reload the queue and check the decision details.",
      reason: "invalid_staff_command",
    };
  if (!(error instanceof FoundationStaffCommandError)) return null;
  return {
    status: error.status,
    error: error.message,
    reason: error.mfaRequired ? "staff_mfa_required" : "staff_command_refused",
    ...(error.mfaRequired ? { redirectUrl: "/staff/two-step", code: "step_up_required" } : {}),
  };
}
