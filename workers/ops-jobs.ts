/**
 * verifymzansi-ops-jobs — runs the app's durable operation jobs every minute.
 *
 * The jobs themselves (moderation notices, auth metadata sync) run in the
 * app at /api/webhooks/ops-jobs, which claims due jobs from operation_jobs
 * and reports each outcome back to the database. This worker only triggers
 * the run on a schedule.
 *
 * A failed run rejects the scheduled handler so Cloudflare records the
 * invocation as failed. Only a successful run sends the optional heartbeat.
 */

import { triggerBoundAppJob } from "./app-job-trigger";
import type { FoundationCompanionBindings } from "./companion-bindings";
import { sendHeartbeat } from "./heartbeat";

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type Env = Pick<FoundationCompanionBindings, "APP" | "APP_URL"> & {
  OPS_JOBS_SECRET: string;
  HEARTBEAT_URL_OPS_JOBS?: string;
};

const worker = {
  // Scheduled-only worker; answer HTTP probes instead of throwing (error 1101).
  async fetch(): Promise<Response> {
    return Response.json({ worker: "verifymzansi-ops-jobs", status: "healthy" });
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    // Throws on any failure; awaited (not waitUntil) so the run is marked failed.
    await triggerBoundAppJob(env, "/api/webhooks/ops-jobs", env.OPS_JOBS_SECRET);
    await sendHeartbeat("ops-jobs", env.HEARTBEAT_URL_OPS_JOBS);
  },
};

export default worker;
