import { staffVerifyHref } from "./staff-mfa-links";
import { getDataBackend } from "../data-backend";
import { createClient } from "../supabase/client";

/** Preserve API error bodies while giving reviewers a safe re-verification path. */
export async function fetchStaffEvidence(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const path = typeof input === "string" ? input.split("?")[0] : "";
  const sensitiveRead =
    path === "/api/admin/verification/evidence" ||
    path === "/api/admin/verification/evidence/metadata" ||
    path === "/api/foundation/verification/evidence";
  return handleStaffEvidenceResponse(await fetch(input, init), sensitiveRead);
}

/** Also wraps the existing bounded/retrying evidence transport. */
export async function handleStaffEvidenceResponse(
  response: Response,
  sensitiveRead = false
): Promise<Response> {
  if (sensitiveRead && response.ok && getDataBackend() === "foundation") {
    const actor = response.headers.get("X-VerifyMzansi-Actor");
    if (!actor) throw new Error("Evidence authorization could not be confirmed. Reload the queue.");
    const current = await createClient().auth.getUser();
    if (current.error || current.data.user?.id !== actor)
      throw new Error("Staff account changed. Reload this page before viewing evidence.");
  }
  if (response.status !== 403 || typeof window === "undefined") return response;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    if (body.code === "mfa_required" || body.code === "step_up_required") {
      const verifyUrl =
        body.code === "step_up_required" ? "/staff/two-step?confirm=1" : "/staff/two-step";
      const next = window.location.pathname + window.location.search;
      // Use our fixed local destination, never an arbitrary URL in the payload.
      window.location.assign(staffVerifyHref(verifyUrl, next));
    }
  } catch {
    // A malformed/non-MFA denial retains the caller's ordinary error handling.
  }
  return response;
}
