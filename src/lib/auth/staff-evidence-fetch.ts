import { staffVerifyHref } from "./staff-mfa-links";

/** Preserve API error bodies while giving reviewers a safe re-verification path. */
export async function fetchStaffEvidence(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return handleStaffEvidenceResponse(await fetch(input, init));
}

/** Also wraps the existing bounded/retrying evidence transport. */
export async function handleStaffEvidenceResponse(response: Response): Promise<Response> {
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
