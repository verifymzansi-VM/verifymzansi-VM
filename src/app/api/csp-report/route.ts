import { type NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const log = createLogger("CSP");

const MAX_BODY_SIZE = 10_240; // 10 KB

/**
 * POST /api/csp-report
 *
 * Receives Content-Security-Policy violation reports from the browser.
 * Accepts both `application/csp-violation-report` (CSP Level 2)
 * and `application/reports+json` (Reporting API v1).
 */
export async function POST(request: NextRequest) {
  // Rate-limit to prevent log flooding from a single IP
  const ip = getClientIp(request);
  const rl = checkLocalRateLimit(ip, "csp-report");
  if (rl.limited) {
    return new NextResponse(null, {
      status: 429,
      headers: rl.retryAfter ? { "Retry-After": String(rl.retryAfter) } : undefined,
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/csp-violation-report") &&
    !contentType.includes("application/reports+json") &&
    !contentType.includes("application/json")
  ) {
    return new NextResponse(null, { status: 415 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_SIZE) {
    return new NextResponse(null, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Extract the violation details safely
  const report =
    parsed && typeof parsed === "object" && "csp-report" in parsed
      ? (parsed as Record<string, unknown>)["csp-report"]
      : parsed;

  if (!report || typeof report !== "object") {
    return new NextResponse(null, { status: 400 });
  }

  const r = report as Record<string, unknown>;
  log.warn("CSP violation", {
    blockedUri: typeof r["blocked-uri"] === "string" ? r["blocked-uri"].slice(0, 200) : undefined,
    violatedDirective:
      typeof r["violated-directive"] === "string"
        ? r["violated-directive"].slice(0, 100)
        : undefined,
    documentUri:
      typeof r["document-uri"] === "string" ? r["document-uri"].slice(0, 200) : undefined,
    effectiveDirective:
      typeof r["effective-directive"] === "string"
        ? r["effective-directive"].slice(0, 100)
        : undefined,
    sourceFile: typeof r["source-file"] === "string" ? r["source-file"].slice(0, 200) : undefined,
    lineNumber: typeof r["line-number"] === "number" ? r["line-number"] : undefined,
    ip,
  });

  return new NextResponse(null, { status: 204 });
}
