import { runAuthorizedWorkerTrigger } from "./manual-trigger";
import { triggerFoundationJob, type FoundationJobEnv } from "./app-job-trigger";
import { sendHeartbeat } from "./heartbeat";
import type { ScheduledWorker } from "./handler-types";

/**
 * Cloudflare Worker — payment reconciliation, every 10 minutes. The app's
 * journal-backed reconciliation does the work; this Worker holds only the
 * scoped job credential.
 */
type Env = FoundationJobEnv & { HEARTBEAT_URL_PAYMENT_CLEANUP?: string };

const worker: ScheduledWorker<Env> = {
  async scheduled(event, env) {
    // Throws on any failure, so Cloudflare marks the run failed and no
    // heartbeat is sent. Manual runs do not count as the schedule firing.
    await triggerFoundationJob(env, "/api/internal/payments/reconcile");
    if (event.cron !== "manual")
      await sendHeartbeat("payment-cleanup", env.HEARTBEAT_URL_PAYMENT_CLEANUP);
  },

  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      return runAuthorizedWorkerTrigger(request, env.WORKER_API_KEY, () =>
        this.scheduled!({ cron: "manual", scheduledTime: Date.now() }, env, ctx)
      );
    }

    return new Response(
      JSON.stringify({
        worker: "verifymzansi-payment-cleanup",
        status: "healthy",
        schedule: "*/10 * * * *",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

export default worker;
