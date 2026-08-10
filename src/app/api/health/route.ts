import { NextResponse } from "next/server";
import { getLaunchHealthSnapshot, type LaunchHealthSnapshot } from "@/lib/health/launch-health";
import { createLogger } from "@/lib/utils/logger";

// No explicit `runtime = "edge"` needed — the entire app runs on Cloudflare
// Workers (edge) via @opennextjs/cloudflare. Declaring it here would disable
// static generation and trigger a build warning.

const logger = createLogger("HealthRoute");
const HEALTH_SNAPSHOT_TIMEOUT_MS = 1200;
const HEALTH_SNAPSHOT_CACHE_MS = 5000;

let cachedSnapshot:
  | {
      snapshot: LaunchHealthSnapshot;
      cachedAt: number;
    }
  | undefined;
let pendingSnapshot: Promise<LaunchHealthSnapshot> | undefined;

function publicChecks(snapshot: LaunchHealthSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.checks).map(([name, check]) => [
      name,
      {
        status: check.status,
        errorCount: check.errorCount,
        warningCount: check.warningCount,
        failureCount: check.failureCount,
      },
    ])
  );
}

function publicHealthPayload(status: "ok" | "degraded", snapshot?: LaunchHealthSnapshot) {
  return {
    status,
    readiness: status,
    timestamp: new Date().toISOString(),
    ...(snapshot ? { mode: snapshot.mode, checks: publicChecks(snapshot) } : {}),
  };
}

async function getLaunchHealthSnapshotWithinTimeout() {
  const now = Date.now();
  const useSnapshotCache = process.env.VITEST !== "true";
  if (
    useSnapshotCache &&
    cachedSnapshot &&
    now - cachedSnapshot.cachedAt < HEALTH_SNAPSHOT_CACHE_MS
  ) {
    return cachedSnapshot.snapshot;
  }

  if (useSnapshotCache && pendingSnapshot) {
    return pendingSnapshot;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    pendingSnapshot = Promise.race([
      getLaunchHealthSnapshot(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Health snapshot timed out"));
        }, HEALTH_SNAPSHOT_TIMEOUT_MS);
      }),
    ]);

    const snapshot = await pendingSnapshot;
    if (useSnapshotCache) {
      cachedSnapshot = { snapshot, cachedAt: Date.now() };
    }
    return snapshot;
  } finally {
    pendingSnapshot = undefined;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function healthHeaders() {
  // This path is excluded from the middleware matcher, so it never passes
  // through withSecurityHeaders — set the baseline security headers here.
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // JSON-only endpoint — a restrictive CSP is safe and prevents the response
    // from being loaded as a document/resource in a browsing context.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
  }
  return headers;
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  if (!deep) {
    return NextResponse.json(publicHealthPayload("ok"), {
      status: 200,
      headers: healthHeaders(),
    });
  }

  try {
    const snapshot = await getLaunchHealthSnapshotWithinTimeout();
    const status = snapshot.status === "ok" ? "ok" : "degraded";

    if (status === "degraded") {
      logger.error("Health snapshot degraded", { snapshot });
    }

    return NextResponse.json(publicHealthPayload(status, snapshot), {
      status: 200,
      headers: healthHeaders(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Health snapshot generation failed", { error: message });

    return NextResponse.json(publicHealthPayload("degraded"), {
      status: 503,
      headers: healthHeaders(),
    });
  }
}
