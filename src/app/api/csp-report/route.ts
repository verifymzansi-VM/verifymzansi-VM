import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const log = createLogger("CSP");

const MAX_BODY_SIZE = 10_240; // 10 KB
const cspTextField = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(max).optional());
const cspReportSchema = z
  .object({
    "blocked-uri": cspTextField(200),
    "violated-directive": cspTextField(100),
    "document-uri": cspTextField(200),
    "effective-directive": cspTextField(100),
    "source-file": cspTextField(200),
    "line-number": z.number().int().min(0).max(10_000_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (!Object.values(value).some((field) => field !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CSP report must include at least one known field",
      });
    }
  });

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

  let report: unknown = parsed;
  if (Array.isArray(parsed)) {
    const firstReport = parsed[0];
    report =
      firstReport && typeof firstReport === "object" && "body" in firstReport
        ? (firstReport as Record<string, unknown>).body
        : firstReport;
  } else if (parsed && typeof parsed === "object" && "csp-report" in parsed) {
    report = (parsed as Record<string, unknown>)["csp-report"];
  }

  const parsedReport = cspReportSchema.safeParse(report);
  if (!parsedReport.success) {
    return new NextResponse(null, { status: 400 });
  }

  log.warn("CSP violation", {
    blockedUri: parsedReport.data["blocked-uri"],
    violatedDirective: parsedReport.data["violated-directive"],
    documentUri: parsedReport.data["document-uri"],
    effectiveDirective: parsedReport.data["effective-directive"],
    sourceFile: parsedReport.data["source-file"],
    lineNumber: parsedReport.data["line-number"],
    ip,
  });

  return new NextResponse(null, { status: 204 });
}
