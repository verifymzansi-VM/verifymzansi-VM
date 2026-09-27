/**
 * Link to the staff two-step page that returns to `next` afterwards.
 * `verifyUrl` comes from an API `mfa_required` / `step_up_required` response.
 */
export function staffVerifyHref(verifyUrl: string, next: string): string {
  const separator = verifyUrl.includes("?") ? "&" : "?";
  return `${verifyUrl}${separator}next=${encodeURIComponent(next)}`;
}
