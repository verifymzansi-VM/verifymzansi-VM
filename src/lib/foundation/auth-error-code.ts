/**
 * Auth's machine-readable error code from a refused request's JSON body.
 * Requests that send `X-Supabase-Api-Version: 2024-01-01` get it as `code`
 * (`{ "code": "same_password", "message": ... }`); older replies carry a
 * numeric `code` and the string in `error_code`. Anything else is null.
 */
export function authErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { code, error_code: legacy } = body as Record<string, unknown>;
  if (typeof code === "string" && code) return code;
  return typeof legacy === "string" && legacy ? legacy : null;
}
