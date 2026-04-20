import { NextResponse } from "next/server";
import { getLaunchHealthSnapshot } from "@/lib/health/launch-health";
import { resolveLaunchValidationMode } from "@/lib/config/launch-validation";
import { createLogger } from "@/lib/utils/logger";

// No explicit `runtime = "edge"` needed — the entire app runs on Cloudflare
// Workers (edge) via @opennextjs/cloudflare. Declaring it here would disable
// static generation and trigger a build warning.

const logger = createLogger("HealthRoute");

export async function GET() {
  try {
    const snapshot = await getLaunchHealthSnapshot();

    return NextResponse.json(snapshot, {
      status: snapshot.status === "ok" ? 200 : 503,
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Health snapshot generation failed", { error: message });

    return NextResponse.json(
      {
        status: "degraded",
        mode: resolveLaunchValidationMode(process.env),
        timestamp: new Date().toISOString(),
        checks: {
          config: {
            status: "degraded",
            detail: "Health snapshot generation failed",
            failedChecks: ["health_snapshot_generation"],
            failedDetails: ["Health snapshot generation failed before probes completed"],
          },
          supabase: {
            status: "skipped",
            detail: "Health snapshot aborted before Supabase probe completed",
          },
          schema: {
            status: "skipped",
            detail: "Health snapshot aborted before schema probe completed",
          },
          audit: {
            status: "skipped",
            detail: "Health snapshot aborted before audit probe completed",
          },
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  }
}
