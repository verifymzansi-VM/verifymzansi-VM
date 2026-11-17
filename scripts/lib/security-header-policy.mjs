// The browser security headers every HTML page must carry in production
// (set by src/lib/middleware/security-headers.ts). Shared by the built-Worker
// startup check (scripts/check-cloudflare-startup.mjs) and the scheduled live
// check of the public homepage (scripts/check-public-edge.ts). Returns plain
// descriptions of what is missing; never header values.

const HSTS_MIN_SECONDS = 31_536_000;

/**
 * @param {{ get(name: string): string | null }} headers
 * @returns {string[]} problems; empty when every header is as required
 */
export function securityHeaderProblems(headers) {
  const problems = [];
  const csp = headers.get("content-security-policy") ?? "";
  if (!csp) problems.push("Content-Security-Policy missing");
  else {
    if (!/(^|;)\s*default-src\s/.test(csp)) problems.push("CSP has no default-src");
    if (!/(^|;)\s*frame-ancestors\s+'none'\s*(;|$)/.test(csp))
      problems.push("CSP does not set frame-ancestors 'none'");
    if (!/(^|;)\s*object-src\s+'none'\s*(;|$)/.test(csp))
      problems.push("CSP does not set object-src 'none'");
  }
  if ((headers.get("x-content-type-options") ?? "").trim().toLowerCase() !== "nosniff")
    problems.push("X-Content-Type-Options is not nosniff");
  if ((headers.get("x-frame-options") ?? "").trim().toUpperCase() !== "DENY")
    problems.push("X-Frame-Options is not DENY");
  const hsts = headers.get("strict-transport-security") ?? "";
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
  if (maxAge < HSTS_MIN_SECONDS) problems.push("Strict-Transport-Security max-age under one year");
  return problems;
}
