import type { AbortSignal as WorkerAbortSignal } from "@cloudflare/workers-types";
import type { FoundationCompanionBindings } from "./companion-bindings";
import { timingSafeEqual } from "./timing-safe-equal";
import { checks, type SmokeCheck } from "../src/lib/monitoring/smoke-contract";

type Env = Pick<FoundationCompanionBindings, "APP" | "APP_URL"> & { MONITOR_API_KEY: string };
const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };
async function boundedText(response: Awaited<ReturnType<Env["APP"]["fetch"]>>) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return text + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Oversized probe response");
      }
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
async function probe(env: Env, check: SmokeCheck, override: string | null) {
  let httpStatus = 0;
  try {
    const requestHeaders = new Headers(check.headers);
    // Authentication and cookies from the caller never reach the application.
    if (override)
      requestHeaders.set("Cloudflare-Workers-Version-Overrides", `verifymzansi="${override}"`);
    const response = await env.APP.fetch(env.APP_URL + check.path, {
      method: check.method ?? "GET",
      redirect: "manual",
      headers: Object.fromEntries(requestHeaders.entries()),
      body:
        typeof check.body === "string"
          ? check.body
          : check.body === undefined
            ? undefined
            : JSON.stringify(check.body),
      // The worker's native signal bridges the Next project's DOM declarations.
      signal: AbortSignal.timeout(15000) as WorkerAbortSignal,
    });
    httpStatus = response.status;
    let ok = check.expectStatuses.includes(httpStatus);
    if (check.validateJsonStatusKey || check.path === "/") {
      const text = await boundedText(response);
      if (check.path === "/")
        ok =
          ok &&
          response.headers.get("content-type")?.includes("text/html") === true &&
          text.includes("gntzjtuncsyefujajmjy") &&
          !text.includes("tnygdgormnofpgjknlhr");
      else {
        const body: unknown = JSON.parse(text);
        ok =
          ok &&
          httpStatus === 200 &&
          Boolean(
            body &&
            typeof body === "object" &&
            "status" in body &&
            body.status === "ok" &&
            (!check.path.includes("deep=1") || ("readiness" in body && body.readiness === "ok"))
          );
      }
    } else await response.body?.cancel().catch(() => {});
    return { name: check.name, status: ok ? "PASS" : "FAIL", httpStatus };
  } catch {
    return { name: check.name, status: "FAIL", httpStatus };
  }
}
const worker = {
  async fetch(request: Request, env: Env) {
    const key = env.MONITOR_API_KEY;
    const auth = request.headers.get("authorization") ?? "";
    if (!key || key.length < 32 || auth.length > 512 || !timingSafeEqual(auth, `Bearer ${key}`))
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/")
      return Response.json({ error: "Unsupported probe" }, { status: 400, headers });
    const version = request.headers.get("x-monitor-worker-version");
    if (version && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(version))
      return Response.json({ error: "Invalid version" }, { status: 400, headers });
    if (env.APP_URL !== "https://verifymzansi.com" || !env.APP)
      return Response.json({ status: "degraded", readiness: "degraded" }, { status: 503, headers });
    const outcomes = await Promise.all(
      [
        ...checks,
        {
          name: "Deep readiness",
          path: "/api/health?deep=1",
          expectStatuses: [200],
          validateJsonStatusKey: true,
        },
      ].map((check) => probe(env, check, version))
    );
    const ok = outcomes.every((check) => check.status === "PASS");
    return Response.json(
      {
        status: ok ? "ok" : "degraded",
        readiness: ok ? "ok" : "degraded",
        scope: version ? "candidate-service-smoke" : "live-service-smoke",
        checks: outcomes,
      },
      { status: ok ? 200 : 503, headers }
    );
  },
};
export default worker;
