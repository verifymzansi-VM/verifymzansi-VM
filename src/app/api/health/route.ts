import { NextResponse } from "next/server";
import { getLaunchHealthSnapshot } from "@/lib/health/launch-health";
import { createLogger } from "@/lib/utils/logger";

// No explicit `runtime = "edge"` needed — the entire app runs on Cloudflare
// Workers (edge) via @opennextjs/cloudflare. Declaring it here would disable
// static generation and trigger a build warning.

const logger = createLogger("HealthRoute");
const HEALTH_SNAPSHOT_TIMEOUT_MS = 1200;

function publicHealthPayload(status: "ok" | "degraded") {
  return {
    status,
    readiness: status,
    timestamp: new Date().toISOString(),
  };
}

async function getLaunchHealthSnapshotWithinTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getLaunchHealthSnapshot(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Health snapshot timed out"));
        }, HEALTH_SNAPSHOT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function GET() {
  try {
    const snapshot = await getLaunchHealthSnapshotWithinTimeout();
    const status = snapshot.status === "ok" ? "ok" : "degraded";

    if (status === "degraded") {
      logger.error("Health snapshot degraded", { snapshot });
    }

    return NextResponse.json(publicHealthPayload(status), {
      status: 200,
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
