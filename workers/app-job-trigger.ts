export interface FoundationJobEnv {
  DATA_BACKEND: "foundation";
  APP_URL: string;
  WORKER_API_KEY: string;
}
/** Companion Workers hold only a scoped job credential. Database and R2
 * authority stay on the app's journal-backed commands. Never forward secrets. */
export async function triggerFoundationJob(
  env: FoundationJobEnv,
  path: "/api/internal/payments/reconcile" | "/api/internal/retention/run"
) {
  const app = new URL(env.APP_URL);
  if (
    app.origin !== "https://verifymzansi.com" ||
    app.username ||
    app.password ||
    app.pathname !== "/" ||
    app.search ||
    app.hash ||
    !env.WORKER_API_KEY ||
    env.WORKER_API_KEY.length < 32
  )
    throw new Error("Invalid job configuration");
  const response = await fetch(new URL(path, app), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WORKER_API_KEY}` },
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Foundation job returned HTTP ${response.status}`);
}
