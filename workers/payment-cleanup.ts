import { runAuthorizedWorkerTrigger } from "./manual-trigger";
import { triggerFoundationJob, type FoundationJobEnv } from "./app-job-trigger";
import { sendHeartbeat } from "./heartbeat";
import type { ScheduledWorker } from "./handler-types";

/**
 * Cloudflare Worker — payment reconciliation, every 10 minutes, and the daily
 * Ozow refund check (05:15 UTC, 07:15 South African time). The app's
 * journal-backed reconciliation and the read-only refund check do the work;
 * this Worker holds only the scoped job credential.
 */
type Env = FoundationJobEnv & { HEARTBEAT_URL_PAYMENT_CLEANUP?: string };

/** The daily refund check's schedule (wrangler.payment-cleanup.toml). */
const DAILY_REFUND_CHECK_CRON = "15 5 * * *";

const worker: ScheduledWorker<Env> = {
  async scheduled(event, env) {
    // Throws on any failure, so Cloudflare marks the run failed and no
    // heartbeat is sent. Manual runs do not count as the schedule firing.
    if (event.cron === DAILY_REFUND_CHECK_CRON) {
      await triggerFoundationJob(env, "/api/internal/payments/refunds/reconcile");
      return;
    }
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
        refundCheck: DAILY_REFUND_CHECK_CRON,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  },
};

export default worker;
