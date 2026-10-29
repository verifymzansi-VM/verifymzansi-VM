import { checks } from "../../src/lib/monitoring/smoke-contract";
const worker = {
  async fetch(request: Request, env: { DEGRADED?: string }) {
    if (request.headers.has("authorization") || request.headers.has("cookie"))
      return new Response("Caller credentials leaked", { status: 500 });
    const url = new URL(request.url);
    if (url.pathname === "/api/health")
      return Response.json(
        { status: env.DEGRADED ? "degraded" : "ok", readiness: env.DEGRADED ? "degraded" : "ok" },
        { status: env.DEGRADED ? 503 : 200 }
      );
    const check = checks.find((item) => item.path === url.pathname);
    if (!check || request.method !== (check.method ?? "GET"))
      return new Response("Unexpected request", { status: 500 });
    if (request.method === "POST") return new Response("PRIVATE_UPSTREAM_BODY", { status: 401 });
    return new Response(
      "<html>https://gntzjtuncsyefujajmjy.supabase.co PRIVATE_UPSTREAM_BODY</html>",
      {
        headers: { "content-type": "text/html" },
      }
    );
  },
};
export default worker;
