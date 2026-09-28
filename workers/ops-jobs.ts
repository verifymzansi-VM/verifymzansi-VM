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

async function trigger(env: Env): Promise<void> {
  const response = await fetch(`${env.APP_URL.replace(/\/$/, "")}/api/webhooks/ops-jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPS_JOBS_SECRET}` },
  });
  if (!response.ok) {
    // Logged by Workers observability; the jobs stay queued for the next run.
    console.error(`ops-jobs run failed with status ${response.status}`);
    return;
  }
}

const worker = {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(trigger(env));
  },
};

export default worker;
