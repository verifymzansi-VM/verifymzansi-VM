/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import worker from "../../workers/site-monitor";
import {
  classifyPublicEdge,
  isCloudflareChallenge,
  publicEdgeReport,
} from "../../scripts/lib/public-edge";
import { checkSiteMonitorHomepage, siteMonitorTransport } from "../../scripts/lib/site-monitor";

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
    return new Response(
      "<html>https://gntzjtuncsyefujajmjy.supabase.co PRIVATE_UPSTREAM_BODY</html>",
      {
        headers: { "content-type": "text/html" },
      }
    );
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
it.each([
  "<html>No backend configuration</html>",
  "<html>https://tnygdgormnofpgjknlhr.supabase.co</html>",
  "<html>https://gntzjtuncsyefujajmjy.supabase.co https://abcdefghijklmnopqrst.supabase.co</html>",
])("rejects missing, retired and mixed HTML backend references: %s", async (html) => {
  env.APP.fetch.mockResolvedValueOnce(
    new Response(html, { headers: { "content-type": "text/html" } })
  );
  const response = await worker.fetch(request(), env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    checks: expect.arrayContaining([
      { name: "Homepage", status: "FAIL", httpStatus: 200, projectHosts: expect.any(Array) },
    ]),
  });
});
it("verifies live origin HTML through the pinned authenticated monitor", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => worker.fetch(request(), env));
  await expect(
    checkSiteMonitorHomepage(
      { SITE_MONITOR_API_KEY: key },
      "gntzjtuncsyefujajmjy.supabase.co",
      fetcher
    )
  ).resolves.toBeUndefined();
  expect(String(fetcher.mock.calls[0][0])).toBe(monitorUrl);
});
it.each([
  [],
  [{ name: "Homepage", status: "PASS", httpStatus: 200 }],
  [
    {
      name: "Homepage",
      status: "FAIL",
      httpStatus: 200,
      projectHosts: ["gntzjtuncsyefujajmjy.supabase.co"],
    },
  ],
  [
    {
      name: "Homepage",
      status: "PASS",
      httpStatus: 200,
      projectHosts: ["tnygdgormnofpgjknlhr.supabase.co"],
    },
  ],
  [
    {
      name: "Homepage",
      status: "PASS",
      httpStatus: 200,
      projectHosts: ["gntzjtuncsyefujajmjy.supabase.co", "abcdefghijklmnopqrst.supabase.co"],
    },
  ],
])("refuses incomplete or mismatched origin proof %#", async (...items) => {
  const fetcher = vi.fn(async () =>
    Response.json({
      status: "ok",
      readiness: "ok",
      scope: "live-service-smoke",
      checks: items,
    })
  );
  await expect(
    checkSiteMonitorHomepage(
      { SITE_MONITOR_API_KEY: key },
      "gntzjtuncsyefujajmjy.supabase.co",
      fetcher
    )
  ).rejects.toThrow();
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
it("cannot be redirected to an inactive app version", async () => {
  const version = "00000000-0000-4000-8000-000000000001";
  const response = await worker.fetch(request({ "x-monitor-worker-version": version }), env);
  expect(response.status).toBe(400);
  const forged = await worker.fetch(
    request({ "Cloudflare-Workers-Version-Overrides": `verifymzansi="${version}"` }),
    env
  );
  expect(forged.status).toBe(400);
  expect(env.APP.fetch).not.toHaveBeenCalled();
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

it("treats a Cloudflare challenge as inconclusive, never as a pass", () => {
  const ray = { "cf-ray": "synthetic-ray" };
  const page = '<script src="https://gntzjtuncsyefujajmjy.supabase.co"></script>';
  expect(classifyPublicEdge(200, new Headers(ray), page)).toBe("pass");
  for (const [status, headers, body] of [
    [403, { ...ray, "cf-mitigated": "challenge" }, ""],
    [503, { ...ray, "cf-mitigated": "challenge" }, page],
    [403, ray, "<title>Just a moment...</title><script>window._cf_chl_opt={}</script>"],
    [403, ray, '<div id="cf-error-details">Blocked</div>'],
  ] as const) {
    expect(classifyPublicEdge(status, new Headers(headers), body)).toBe("inconclusive");
    const report = publicEdgeReport("inconclusive", status);
    expect(report.line).toMatch(/^::warning .*INCONCLUSIVE.*not a pass/);
    expect(report.summary).toMatch(/INCONCLUSIVE.*not a pass/);
    expect(report.line).not.toMatch(/PASS:/);
  }
  // Ordinary errors, a missing challenge marker or the retired backend fail.
  for (const [status, headers, body] of [
    [403, ray, '{"error":"Forbidden"}'],
    [503, {}, '<div id="cf-error-details">Blocked</div>'],
    // Cloudflare's error page on a 503 is a real outage (e.g. the Worker failed).
    [503, ray, '<div id="cf-error-details">Worker exceeded resource limits</div>'],
    [500, ray, page],
    [200, ray, "<html>no backend marker</html>"],
    [200, ray, page + "tnygdgormnofpgjknlhr"],
  ] as const)
    expect(classifyPublicEdge(status, new Headers(headers), body)).toBe("fail");
  expect(publicEdgeReport("fail", 500)).toMatchObject({ exitCode: 1 });
  expect(publicEdgeReport("pass", 200)).toMatchObject({
    exitCode: 0,
    summary: "Public edge: PASS",
  });
});

it("fails the live check when the homepage lacks a required security header", async () => {
  const { securityHeaderProblems } = await import("../../scripts/lib/security-header-policy.mjs");
  const production = {
    "content-security-policy":
      "default-src 'self'; script-src 'self' 'nonce-x'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  };
  expect(securityHeaderProblems(new Headers(production))).toEqual([]);
  const without = (name: string, value?: string) => {
    const headers = new Headers(production);
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
    return securityHeaderProblems(headers);
  };
  expect(without("content-security-policy")).toEqual(["Content-Security-Policy missing"]);
  expect(
    without("content-security-policy", "default-src 'self'; object-src 'none'; frame-ancestors *")
  ).toEqual(["CSP does not set frame-ancestors 'none'"]);
  expect(without("content-security-policy", "default-src 'self'; frame-ancestors 'none'")).toEqual([
    "CSP does not set object-src 'none'",
  ]);
  expect(without("x-content-type-options")).toEqual(["X-Content-Type-Options is not nosniff"]);
  expect(without("x-frame-options", "SAMEORIGIN")).toEqual(["X-Frame-Options is not DENY"]);
  expect(without("strict-transport-security", "max-age=300")).toEqual([
    "Strict-Transport-Security max-age under one year",
  ]);
  const report = publicEdgeReport("fail", 200, ["X-Frame-Options is not DENY"]);
  expect(report).toMatchObject({ exitCode: 1 });
  expect(report.line).toMatch(/^::error::FAIL: .*security headers: X-Frame-Options is not DENY\./);
  expect(report.summary).toBe("Public edge: FAIL (security headers: X-Frame-Options is not DENY)");
});

it("builds the production CSP the live check expects", async () => {
  const { securityHeaderProblems } = await import("../../scripts/lib/security-header-policy.mjs");
  const { buildCsp } = await import("@/lib/middleware/security-headers");
  const csp = buildCsp("nonce-for-test");
  const problems = securityHeaderProblems(
    new Headers({
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    })
  );
  expect(problems).toEqual([]);
});
