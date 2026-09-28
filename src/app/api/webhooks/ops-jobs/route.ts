import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runOperationJobs } from "@/lib/services/operation-jobs";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OpsJobsWebhook");

function authorized(request: Request): boolean {
  const expected = process.env.OPS_JOBS_SECRET;
  if (!expected || expected.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/webhooks/ops-jobs
 *
 * Called every minute by the verifymzansi-ops-jobs worker to run due
 * operation jobs (moderation notices, auth metadata sync). Authenticated
 * with OPS_JOBS_SECRET; refuses to run if the secret is not configured.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runOperationJobs(20);
    return NextResponse.json(summary);
  } catch (err) {
    log.error("Operation job run failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}
