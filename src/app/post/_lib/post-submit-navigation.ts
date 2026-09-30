import { sanitizeReturnUrl } from "@/lib/utils/navigation";

const POST_SUBMIT_FALLBACK_PATH = "/dashboard/listings";

/**
 * Shown when a create-post API call answers 401. Text fields are autosaved as
 * a draft on this device (keyed by user), but File objects are never
 * persisted, so the poster has to re-attach media after signing in.
 */
export const POST_SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Sign in again to finish posting. Your text details are saved as a draft on this device, but you'll need to re-attach your photos and videos after signing in.";

/**
 * Resolves a server-provided navigation target (e.g. the phone-gate
 * `redirectUrl`) to a safe same-origin path on a known route. Anything that is
 * not a string, not a relative path, or not on an allowed prefix falls back to
 * the dashboard listings page instead of being handed to the router.
 */
export function resolveServerRedirect(
  value: unknown,
  fallback: string = POST_SUBMIT_FALLBACK_PATH
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const trimmed = value.trim();
  const sanitized = sanitizeReturnUrl(trimmed);
  // sanitizeReturnUrl collapses every rejected value to "/".
  if (sanitized === "/" && trimmed !== "/") return fallback;
  return sanitized;
}
