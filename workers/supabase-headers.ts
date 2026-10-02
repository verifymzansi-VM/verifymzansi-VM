/**
 * REST headers for a Supabase service key.
 *
 * Works with both the legacy JWT `service_role` key and the new
 * `sb_secret_...` keys that replace it (legacy keys are retired at the end of
 * 2026). New keys are not JWTs: the API gateway rejects them in
 * `Authorization: Bearer` with "Invalid JWT", so they go in `apikey` only.
 */
export function supabaseServiceHeaders(
  key: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    apikey: key,
    ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
    ...extra,
  };
}
