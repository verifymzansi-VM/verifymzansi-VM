import { sanitizeReturnUrl } from "@/lib/utils/navigation";

/**
 * Link to the staff two-step page that returns to `next` afterwards.
 * `verifyUrl` comes from an API `mfa_required` / `step_up_required` response.
 */
export function staffVerifyHref(verifyUrl: string, next: string): string {
  const separator = verifyUrl.includes("?") ? "&" : "?";
  return `${verifyUrl}${separator}next=${encodeURIComponent(next)}`;
}

/**
 * Where the staff two-step page returns to: a back-office path, or the staff
 * home. Only a single string is taken; a repeated `next` (an array) or any
 * other value falls back to the staff home.
 */
export function staffReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/admin";
  const next = sanitizeReturnUrl(value);
  return next === "/admin" || next.startsWith("/admin/") ? next : "/admin";
}
