/**
 * verifymzansi-ops-jobs — runs the app's durable operation jobs every minute.
 *
 * The jobs themselves (moderation notices, auth metadata sync) run in the
 * app at /api/webhooks/ops-jobs, which claims due jobs from operation_jobs
 * and reports each outcome back to the database. This worker only triggers
 * the run on a schedule.
 */

import { triggerBoundAppJob } from "./app-job-trigger";
import type { FoundationCompanionBindings } from "./companion-bindings";

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
};

async function trigger(env: Env): Promise<void> {
  try {
    await triggerBoundAppJob(env, "/api/webhooks/ops-jobs", env.OPS_JOBS_SECRET);
  } catch (error) {
    console.error(
      `ops-jobs run failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

const worker = {
  // Scheduled-only worker; answer HTTP probes instead of throwing (error 1101).
  async fetch(): Promise<Response> {
    return Response.json({ worker: "verifymzansi-ops-jobs", status: "healthy" });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(trigger(env));
  },
};

export default worker;
