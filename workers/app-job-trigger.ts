import type { FoundationCompanionBindings } from "./companion-bindings";
import type { AbortSignal as WorkerAbortSignal } from "@cloudflare/workers-types";

type AppBinding = Pick<FoundationCompanionBindings, "APP" | "APP_URL">;
type JobPath =
  "/api/internal/payments/reconcile" | "/api/internal/retention/run" | "/api/webhooks/ops-jobs";
export type FoundationJobEnv = AppBinding & {
  DATA_BACKEND: "foundation";
  WORKER_API_KEY: string;
};
/** Companion Workers hold only a scoped job credential. Database and R2
 * authority stay on the app's journal-backed commands. Never forward secrets. */
export async function triggerFoundationJob(
  env: FoundationJobEnv,
  path: "/api/internal/payments/reconcile" | "/api/internal/retention/run"
) {
  await triggerBoundAppJob(env, path, env.WORKER_API_KEY);
}

export async function triggerBoundAppJob(env: AppBinding, path: JobPath, credential: string) {
  let app: URL;
  try {
    app = new URL(env.APP_URL);
  } catch {
    throw new Error("Invalid job configuration");
  }
  if (
    app.origin !== "https://verifymzansi.com" ||
    app.username ||
    app.password ||
    app.pathname !== "/" ||
    app.search ||
    app.hash ||
    !credential ||
    credential.length < 32 ||
    !env.APP ||
    typeof env.APP.fetch !== "function" ||
    ![
      "/api/internal/payments/reconcile",
      "/api/internal/retention/run",
      "/api/webhooks/ops-jobs",
    ].includes(path)
  )
    throw new Error("Invalid job configuration");
  let response;
  try {
    response = await env.APP.fetch(new URL(path, app).href, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}` },
      redirect: "manual",
      // Next's project uses DOM declarations; this worker runs with workerd's
      // native AbortSignal. Bridge only that platform declaration boundary.
      signal: AbortSignal.timeout(
        path === "/api/webhooks/ops-jobs" ? 50000 : 45000
      ) as WorkerAbortSignal,
    });
  } catch {
    throw new Error("App job request failed");
  }
  // Never read, forward or log private upstream response bodies.
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error(`App job returned HTTP ${response.status}`);
}
