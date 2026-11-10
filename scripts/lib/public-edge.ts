/** A challenge or a 403 block of the automated request. Cloudflare's own error
 * page (`cf-error-details`) also serves real outages such as a 503 when the
 * Worker fails, so on its own it counts only with 403, never with 503. */
export function isCloudflareChallenge(status: number, headers: Headers, body: string) {
  return (
    [403, 503].includes(status) &&
    Boolean(headers.get("cf-ray")) &&
    (headers.get("cf-mitigated") === "challenge" ||
      (body.includes("window._cf_chl_opt") && /<title>Just a moment/i.test(body)) ||
      (status === 403 && body.includes('id="cf-error-details"')))
  );
}

/** "inconclusive" means Cloudflare challenged the robot, so the page was never
 * seen. It is not a pass; any other non-matching answer is a failure. */
export type PublicEdgeVerdict = "pass" | "inconclusive" | "fail";

export function classifyPublicEdge(
  status: number,
  headers: Headers,
  body: string
): PublicEdgeVerdict {
  if (isCloudflareChallenge(status, headers, body)) return "inconclusive";
  return status === 200 &&
    body.includes("gntzjtuncsyefujajmjy") &&
    !body.includes("tnygdgormnofpgjknlhr")
    ? "pass"
    : "fail";
}

/** What the scheduled check prints, adds to the run summary and exits with. */
export function publicEdgeReport(verdict: PublicEdgeVerdict, status: number) {
  if (verdict === "pass")
    return {
      line: "PASS: the public homepage serves the deployed foundation configuration.",
      summary: "Public edge: PASS",
      exitCode: 0,
    };
  if (verdict === "inconclusive")
    return {
      line: `::warning title=Public edge check inconclusive::INCONCLUSIVE: Cloudflare challenged the automated request (HTTP ${status}), so the public homepage was not checked. This is not a pass; the authenticated smoke and readiness check must still pass on its own.`,
      summary: `Public edge: INCONCLUSIVE (Cloudflare challenge, HTTP ${status}); not a pass`,
      exitCode: 0,
    };
  return {
    line: `::error::FAIL: the public homepage failed deployment alignment (HTTP ${status}).`,
    summary: `Public edge: FAIL (HTTP ${status})`,
    exitCode: 1,
  };
}
