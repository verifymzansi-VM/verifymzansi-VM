import { NextResponse } from "next/server";

// No explicit `runtime = "edge"` needed — the entire app runs on Cloudflare
// Workers (edge) via @opennextjs/cloudflare. Declaring it here would disable
// static generation and trigger a build warning.

export async function GET() {
  // Lightweight health check — returns quickly without DB calls.
  // Audit failure count is imported dynamically to avoid bundling
  // server-only code in the edge runtime build.
  let auditFailures = 0;
  try {
    const { getAuditFailureCount } = await import("@/lib/services/audit");
    auditFailures = getAuditFailureCount();
  } catch {
    // Audit module unavailable in edge — acceptable
  }

  const healthy = auditFailures < 5;
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        auditFailures,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
