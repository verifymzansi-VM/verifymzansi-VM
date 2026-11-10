// Local workerd transport fixture only. Never deploy or install provider keys.
const received: string[] = [];
// After POST /fail every job request is refused, to prove failed runs surface.
let failing = false;
const worker = {
  async fetch(request: Request, env: { JOB_KEY: string; OPS_KEY: string }) {
    const url = new URL(request.url);
    if (url.pathname === "/snapshot") return Response.json({ received });
    if (url.pathname === "/fail" && request.method === "POST") {
      failing = true;
      return Response.json({ failing });
    }
    const allowed = [
      "/api/internal/payments/reconcile",
      "/api/internal/retention/run",
      "/api/webhooks/ops-jobs",
    ];
    const key = url.pathname === "/api/webhooks/ops-jobs" ? env.OPS_KEY : env.JOB_KEY;
    if (
      url.origin !== "https://verifymzansi.com" ||
      request.method !== "POST" ||
      !allowed.includes(url.pathname) ||
      request.headers.get("Authorization") !== `Bearer ${key}`
    )
      return new Response("Fixture request refused", { status: 401 });
    if (failing) return new Response("Fixture job incomplete", { status: 503 });
    received.push(url.pathname);
    return Response.json({ completed: true });
  },
};
export default worker;
