/**
 * verifymzansi-ops-jobs — runs the app's durable operation jobs every minute.
 *
 * The jobs themselves (moderation notices, auth metadata sync) run in the
 * app at /api/webhooks/ops-jobs, which claims due jobs from operation_jobs
 * and reports each outcome back to the database. This worker only triggers
 * the run on a schedule.
 */

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface Env {
  APP_URL: string;
  OPS_JOBS_SECRET: string;
}

const RUN_TIMEOUT_MS = 50_000;

async function trigger(env: Env): Promise<void> {
  try {
    const response = await fetch(`${env.APP_URL.replace(/\/$/, "")}/api/webhooks/ops-jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPS_JOBS_SECRET}` },
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Logged by Workers observability; the jobs stay queued for the next run.
      console.error(`ops-jobs run failed with status ${response.status}`);
    }
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
