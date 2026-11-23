import { withCsrfHeaders } from "@/lib/utils/csrf";

/** The answer of a staff screen's guarded command route, as the screen needs it. */
export type StaffCommandAnswer =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string | null; message: string; verifyUrl?: string };

/**
 * Posts one command to a staff screen's guarded route (same origin, CSRF
 * header) and reads its answer: the data on success; otherwise the route's
 * stable reason and message, and where to verify the authenticator again when
 * the route asks for it. `unconfirmed` is shown when no answer arrives.
 */
export async function postStaffCommand(
  endpoint: string,
  body: Record<string, unknown>,
  unconfirmed: string
): Promise<StaffCommandAnswer> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data };
    return {
      ok: false,
      reason: typeof data.reason === "string" ? data.reason : null,
      message:
        typeof data.error === "string" ? data.error : "Something went wrong. Please try again.",
      ...(data.code === "step_up_required"
        ? { verifyUrl: typeof data.redirectUrl === "string" ? data.redirectUrl : "/staff/two-step" }
        : {}),
    };
  } catch {
    return { ok: false, reason: null, message: unconfirmed };
  }
}
