import { NextResponse } from "next/server";
import { getLaunchHealthSnapshot } from "@/lib/health/launch-health";
import { createLogger } from "@/lib/utils/logger";

// No explicit `runtime = "edge"` needed — the entire app runs on Cloudflare
// Workers (edge) via @opennextjs/cloudflare. Declaring it here would disable
// static generation and trigger a build warning.

const logger = createLogger("HealthRoute");

function publicHealthPayload(status: "ok" | "degraded") {
  return {
    status,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const snapshot = await getLaunchHealthSnapshot();
    const status = snapshot.status === "ok" ? "ok" : "degraded";

    if (status === "degraded") {
      logger.error("Health snapshot degraded", { snapshot });
    }

    return NextResponse.json(publicHealthPayload(status), {
      status: status === "ok" ? 200 : 503,
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Health snapshot generation failed", { error: message });

    return NextResponse.json(publicHealthPayload("degraded"), {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
