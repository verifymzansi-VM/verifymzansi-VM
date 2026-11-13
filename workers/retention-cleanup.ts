import { runAuthorizedWorkerTrigger } from "./manual-trigger";
import { triggerFoundationJob, type FoundationJobEnv } from "./app-job-trigger";
import { sendHeartbeat } from "./heartbeat";
import type { ScheduledWorker } from "./handler-types";

/**
 * Cloudflare Worker — data retention cleanup, every 5 minutes. The app's
 * journal-backed cleanup does the work (src/lib/foundation/retention-jobs.ts);
 * this Worker holds only the scoped job credential.
 */
type Env = FoundationJobEnv & { HEARTBEAT_URL_RETENTION_CLEANUP?: string };

const worker: ScheduledWorker<Env> = {
  /**
   * An incomplete run (app HTTP 503) throws, so Cloudflare marks the run
   * failed and no heartbeat is sent.
   */
  async scheduled(event, env) {
    await triggerFoundationJob(env, "/api/internal/retention/run");
    // Manual runs do not count as the schedule firing.
    if (event.cron !== "manual")
      await sendHeartbeat("retention-cleanup", env.HEARTBEAT_URL_RETENTION_CLEANUP);
  },

  /**
   * HTTP handler — health check / manual trigger
   */
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      return runAuthorizedWorkerTrigger(request, env.WORKER_API_KEY, () =>
        this.scheduled!({ cron: "manual", scheduledTime: Date.now() }, env, ctx)
      );
    }

    return new Response(
      JSON.stringify({
        worker: "verifymzansi-retention-cleanup",
        status: "healthy",
        schedule: "*/5 * * * *",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

export default worker;
