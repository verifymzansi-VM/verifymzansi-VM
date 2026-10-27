/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import worker from "../../workers/site-monitor";
import { isCloudflareChallenge } from "../../scripts/lib/public-edge";
import { siteMonitorTransport } from "../../scripts/lib/site-monitor";

const key = "synthetic-site-monitor-credential-only-".repeat(2);
const monitorUrl = "https://verifymzansi-site-monitor.verifymzansi.workers.dev/";
const env = {
  APP_URL: "https://verifymzansi.com",
  MONITOR_API_KEY: key,
  APP: { fetch: vi.fn(), connect: vi.fn() },
};
beforeEach(() => {
  env.APP.fetch.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(new Headers(init.headers).has("cookie")).toBe(false);
    const path = new URL(url).pathname;
    if (path === "/api/health") return Response.json({ status: "ok", readiness: "ok" });
    if (init.method === "POST") return new Response("PRIVATE_UPSTREAM_BODY", { status: 401 });
    return new Response("<html>gntzjtuncsyefujajmjy PRIVATE_UPSTREAM_BODY</html>", {
      headers: { "content-type": "text/html" },
    });
  });
});
const request = (headers: Record<string, string> = {}) =>
  new Request(monitorUrl, { headers: { Authorization: `Bearer ${key}`, ...headers } });
it("rejects uncredentialed requests before any app work", async () => {
  expect((await worker.fetch(new Request(monitorUrl), env)).status).toBe(401);
  expect(env.APP.fetch).not.toHaveBeenCalled();
});
it("runs the shared smoke contract anonymously and returns only aggregate results", async () => {
  const response = await worker.fetch(
    request({ Cookie: "private-user-session=must-not-forward" }),
    env
  );
  const text = await response.text();
  expect(response.status).toBe(200);
  expect(JSON.parse(text)).toMatchObject({
    status: "ok",
    readiness: "ok",
    scope: "live-service-smoke",
  });
  expect(text).not.toContain("PRIVATE_UPSTREAM_BODY");
  expect(text).not.toContain(key);
  expect(env.APP.fetch.mock.calls.some(([url]) => url.endsWith("/tourism-events"))).toBe(true);
});
it("cannot turn a degraded or retired backend into a healthy monitor", async () => {
  env.APP.fetch.mockResolvedValue(
    new Response("<html>tnygdgormnofpgjknlhr</html>", { status: 503 })
  );
  const response = await worker.fetch(request(), env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: "degraded", readiness: "degraded" });
});
it("rejects arbitrary paths and malformed version selectors", async () => {
  expect(
    (
      await worker.fetch(
        new Request(monitorUrl + "api/admin", { headers: { Authorization: `Bearer ${key}` } }),
        env
      )
    ).status
  ).toBe(400);
  expect(
    (await worker.fetch(request({ "x-monitor-worker-version": "not-a-version" }), env)).status
  ).toBe(400);
  expect(env.APP.fetch).not.toHaveBeenCalled();
});
it("only forwards a validated candidate selector on the bound app request", async () => {
  const version = "00000000-0000-4000-8000-000000000001";
  const response = await worker.fetch(request({ "x-monitor-worker-version": version }), env);
  expect(response.status).toBe(200);
  expect(
    env.APP.fetch.mock.calls.every(
      ([, init]) =>
        new Headers(init.headers).get("Cloudflare-Workers-Version-Overrides") ===
        `verifymzansi="${version}"`
    )
  ).toBe(true);
});
it("pins the monitor credential to its exact owned endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "ok" }));
  expect(() =>
    siteMonitorTransport(
      { SITE_MONITOR_API_KEY: key, SITE_MONITOR_URL: "https://untrusted.example.invalid/" },
      fetcher
    )
  ).toThrow();
  const transport = siteMonitorTransport({ SITE_MONITOR_API_KEY: key }, fetcher);
  expect(() => transport.fetcher("https://untrusted.example.invalid/", {})).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await transport.fetcher(monitorUrl);
  expect(new Headers(fetcher.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${key}`);
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
it("distinguishes a real edge challenge from ordinary app errors and injected JS detection", () => {
  const headers = new Headers({ "cf-ray": "synthetic-ray" });
  expect(isCloudflareChallenge(403, headers, '<div id="cf-error-details">Blocked</div>')).toBe(
    true
  );
  expect(isCloudflareChallenge(403, headers, '{"error":"Forbidden"}')).toBe(false);
  expect(
    isCloudflareChallenge(
      503,
      headers,
      '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>App unavailable'
    )
  ).toBe(false);
  expect(
    isCloudflareChallenge(403, new Headers(), '<div id="cf-error-details">Blocked</div>')
  ).toBe(false);
});
