/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { waitForDeploymentHealth } from "../../scripts/lib/deployment-health";
import { readFileSync } from "node:fs";
import {
  LiveCheckError,
  PermanentLiveCheckError,
  liveCheckFailureReason,
  readLiveJson,
  retryLiveCheck,
} from "../../scripts/lib/live-retry";
import { RATE_LIMITER_URL, checkRateLimiterKey } from "../../scripts/lib/rate-limiter-probe";
import {
  SITE_MONITOR_URL,
  siteMonitorTransport,
  waitForLiveHomepage,
} from "../../scripts/lib/site-monitor";

const key = "synthetic-site-monitor-credential-only-".repeat(2);
const approved = "gntzjtuncsyefujajmjy.supabase.co";
const retired = "tnygdgormnofpgjknlhr.supabase.co";
const noSleep = () => Promise.resolve();

const monitorReport = (
  ok: boolean,
  homepage: { status: "PASS" | "FAIL"; httpStatus: number; projectHosts?: string[] }
) =>
  Response.json(
    {
      status: ok ? "ok" : "degraded",
      readiness: ok ? "ok" : "degraded",
      scope: "live-service-smoke",
      checks: [
        { name: "Homepage", ...homepage },
        { name: "Deep readiness", status: ok ? "PASS" : "FAIL", httpStatus: ok ? 200 : 503 },
      ],
    },
    { status: ok ? 200 : 503 }
  );
const healthy = () =>
  monitorReport(true, { status: "PASS", httpStatus: 200, projectHosts: [approved] });
// Observed cold start: the app's homepage probe timed out inside the monitor.
const cold = () => monitorReport(false, { status: "FAIL", httpStatus: 0 });
// Also observed: the homepage is already warm but the deep snapshot is not.
const warmingUp = () =>
  monitorReport(false, { status: "PASS", httpStatus: 200, projectHosts: [approved] });
const challenge = () =>
  new Response("<title>Just a moment...</title>", {
    status: 403,
    headers: { "content-type": "text/html", "cf-ray": "synthetic-ray" },
  });

describe("bounded live retry", () => {
  it("passes once a cold failure is followed by success", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new LiveCheckError("cold"))
      .mockResolvedValueOnce(undefined);
    const onRetry = vi.fn();
    await expect(retryLiveCheck(run, { sleep: noSleep, onRetry })).resolves.toBe(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(LiveCheckError));
  });

  it("fails with the last error after the bounded attempts, sleeping between them", async () => {
    const run = vi.fn().mockRejectedValue(new LiveCheckError("still degraded"));
    const sleep = vi.fn(noSleep);
    await expect(retryLiveCheck(run, { sleep })).rejects.toThrow("still degraded");
    expect(run).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it("stops at the first permanent failure", async () => {
    const run = vi.fn().mockRejectedValue(new PermanentLiveCheckError("wrong backend"));
    const sleep = vi.fn(noSleep);
    await expect(retryLiveCheck(run, { sleep })).rejects.toThrow("wrong backend");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([0, 11, 1.5, Number.NaN])("refuses an unbounded attempt count %s", async (attempts) => {
    const run = vi.fn();
    await expect(retryLiveCheck(run, { attempts })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([-1, 60_001, Number.POSITIVE_INFINITY, Number.NaN])(
    "refuses an unbounded delay %s",
    async (delayMs) => {
      const run = vi.fn();
      await expect(retryLiveCheck(run, { delayMs })).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    }
  );

  it("keeps a body-read timeout reported as a timeout", async () => {
    const timedOut = {
      json: () => Promise.reject(new DOMException("timeout", "TimeoutError")),
    } as unknown as Response;
    const error = await readLiveJson(timedOut, "malformed").catch((caught: unknown) => caught);
    expect(liveCheckFailureReason(error)).toBe("request timed out");
    const garbled = new Response("{not json");
    await expect(readLiveJson(garbled, "malformed")).rejects.toThrow("malformed");
  });

  it("logs only fixed reasons, never provider text or URLs", () => {
    expect(liveCheckFailureReason(new LiveCheckError("Readiness returned HTTP 503"))).toBe(
      "Readiness returned HTTP 503"
    );
    expect(liveCheckFailureReason(new Error(`fetch failed for ${SITE_MONITOR_URL}?k=${key}`))).toBe(
      "request failed"
    );
    expect(liveCheckFailureReason(new DOMException("timeout", "TimeoutError"))).toBe(
      "request timed out"
    );
    expect(liveCheckFailureReason("raw string")).toBe("request failed");
  });
});

describe("monitor deep readiness with retry", () => {
  it("passes a cold start and keeps the credential on the pinned monitor URL", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cold())
      .mockResolvedValueOnce(healthy());
    const monitor = siteMonitorTransport({ SITE_MONITOR_API_KEY: key }, fetchImpl);
    await expect(
      waitForDeploymentHealth(monitor.url, { fetchImpl: monitor.fetcher, sleep: noSleep })
    ).resolves.toBe(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).toBe(SITE_MONITOR_URL);
      expect(init?.redirect).toBe("error");
    }
  });

  it("still fails an edge challenge after every attempt", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => challenge());
    const monitor = siteMonitorTransport({ SITE_MONITOR_API_KEY: key }, fetchImpl);
    await expect(
      waitForDeploymentHealth(monitor.url, { fetchImpl: monitor.fetcher, sleep: noSleep })
    ).rejects.toThrow("Readiness returned HTTP 403");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

describe("live homepage project references with retry", () => {
  const env = { SITE_MONITOR_API_KEY: key };

  it("passes a cold monitor once it reports the approved project", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cold())
      .mockResolvedValueOnce(cold())
      .mockResolvedValueOnce(healthy());
    const onRetry = vi.fn();
    await expect(
      waitForLiveHomepage(env, approved, { fetchImpl, sleep: noSleep, onRetry })
    ).resolves.toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).toBe(SITE_MONITOR_URL);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
    }
  });

  it("passes when only the deep snapshot was still warming up", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(warmingUp())
      .mockResolvedValueOnce(healthy());
    await expect(waitForLiveHomepage(env, approved, { fetchImpl, sleep: noSleep })).resolves.toBe(
      2
    );
  });

  it("finds a wrong backend even when another probe entry has an unexpected shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          status: "degraded",
          checks: [
            { name: "Homepage", status: "FAIL", httpStatus: 200, projectHosts: [retired] },
            { name: "Future probe", status: "SKIPPED" },
          ],
        },
        { status: 503 }
      )
    );
    await expect(waitForLiveHomepage(env, approved, { fetchImpl, sleep: noSleep })).rejects.toThrow(
      "does not identify only the approved backend"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401])("stops at once when the monitor refuses the request (%s)", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "Unauthorized" }, { status })
    );
    await expect(waitForLiveHomepage(env, approved, { fetchImpl, sleep: noSleep })).rejects.toThrow(
      "Site monitor refused the request"
    );
    const monitor = siteMonitorTransport(env, fetchImpl);
    await expect(
      waitForDeploymentHealth(monitor.url, { fetchImpl: monitor.fetcher, sleep: noSleep })
    ).rejects.toThrow("Site monitor refused the request");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    `synthetic-monitor-key-with-a-line${String.fromCharCode(10)}break-inside-it-0000`,
    `synthetic-monitor-key-with-a-nul${String.fromCharCode(0)}-inside-it-000000`,
    "synthetic monitor key with spaces inside it 000000",
  ])("refuses a key that could be echoed by a header error: %j", async (bad) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => healthy());
    const error = await waitForLiveHomepage({ SITE_MONITOR_API_KEY: bad }, approved, {
      fetchImpl,
      sleep: noSleep,
    }).catch((caught: unknown) => caught);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(liveCheckFailureReason(error)).not.toContain(bad);
  });

  it("fails a persistently degraded monitor after the bounded attempts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => cold());
    const sleep = vi.fn(noSleep);
    await expect(waitForLiveHomepage(env, approved, { fetchImpl, sleep })).rejects.toThrow(
      "unavailable or degraded"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(5);
  });

  it.each([
    [
      "degraded report naming the retired project",
      () => monitorReport(false, { status: "FAIL", httpStatus: 200, projectHosts: [retired] }),
    ],
    [
      "degraded report naming two projects",
      () =>
        monitorReport(false, {
          status: "FAIL",
          httpStatus: 200,
          projectHosts: [approved, retired],
        }),
    ],
    [
      "healthy report naming another project",
      () => monitorReport(true, { status: "PASS", httpStatus: 200, projectHosts: [retired] }),
    ],
    [
      "healthy report without project proof",
      () => monitorReport(true, { status: "PASS", httpStatus: 200 }),
    ],
  ])("fails a wrong backend identity at once: %s", async (_name, response) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const sleep = vi.fn(noSleep);
    await expect(waitForLiveHomepage(env, approved, { fetchImpl, sleep })).rejects.toThrow(
      "does not identify only the approved backend"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    ["edge challenge", challenge],
    [
      "HTML with HTTP 200",
      () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    ],
    [
      "malformed JSON",
      () => new Response("{not json", { headers: { "content-type": "application/json" } }),
    ],
  ])("never passes a non-JSON or malformed monitor answer: %s", async (_name, response) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    await expect(
      waitForLiveHomepage(env, approved, { fetchImpl, sleep: noSleep })
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("refuses an unpinned monitor URL before sending anything, without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => healthy());
    const sleep = vi.fn(noSleep);
    await expect(
      waitForLiveHomepage(
        { ...env, SITE_MONITOR_URL: "https://untrusted.example.invalid/" },
        approved,
        { fetchImpl, sleep }
      )
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reads the public homepage without any credential when no monitor key is set", async () => {
    const html = (hosts: string) =>
      new Response(`<script src="https://${hosts}"></script>`, {
        headers: { "content-type": "text/html" },
      });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(html(approved));
    await expect(waitForLiveHomepage({}, approved, { fetchImpl, sleep: noSleep })).resolves.toBe(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).toBe("https://verifymzansi.com");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
    const wrong = vi.fn<typeof fetch>(async () => html(retired));
    await expect(
      waitForLiveHomepage({}, approved, { fetchImpl: wrong, sleep: noSleep })
    ).rejects.toThrow("does not identify only the approved backend");
    expect(wrong).toHaveBeenCalledTimes(1);
    const none = vi.fn<typeof fetch>(async () => html("example.invalid"));
    await expect(
      waitForLiveHomepage({}, approved, { fetchImpl: none, sleep: noSleep })
    ).rejects.toThrow("names no backend project");
    expect(none).toHaveBeenCalledTimes(6);
  });
});

describe("rate limiter key probe with retry", () => {
  const rateKey = "synthetic-rate-limiter-credential-only-".repeat(2);

  it("passes a cold Worker and only ever calls the pinned read-only probe", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(
      retryLiveCheck(() => checkRateLimiterKey(rateKey, fetchImpl), { sleep: noSleep })
    ).resolves.toBe(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).toBe(RATE_LIMITER_URL);
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toMatchObject({ readOnly: true });
    }
  });

  it("refuses a key with control characters before sending it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    await expect(
      checkRateLimiterKey(`${rateKey}${String.fromCharCode(13, 10)}`, fetchImpl)
    ).rejects.toThrow("invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops at once when the key is refused", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
    await expect(
      retryLiveCheck(() => checkRateLimiterKey(rateKey, fetchImpl), { sleep: noSleep })
    ).rejects.toThrow("refused the key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails when the Worker never confirms the probe", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: false }));
    await expect(
      retryLiveCheck(() => checkRateLimiterKey(rateKey, fetchImpl), { sleep: noSleep })
    ).rejects.toThrow("HTTP 200");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

describe("post-deploy alignment wiring", () => {
  it("runs every live Worker check through the bounded retry", () => {
    const source = readFileSync("scripts/check-backend-alignment.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const name of [
      "Live deep readiness",
      "Local key against deployed rate limiter",
      "Live HTML project references",
    ])
      expect(source).toContain(`retried("${name}"`);
    expect(source).toMatch(/waitForDeploymentHealth\(/);
    expect(source).toMatch(/waitForLiveHomepage\(/);
    expect(source).toMatch(/retryLiveCheck\(\(\) => checkRateLimiterKey\(/);
    // No single-shot path or shortened retry remains. The only direct fetch is
    // the Supabase Auth settings read, which does not go through a Worker.
    expect(source).not.toMatch(
      /checkDeploymentHealth|checkSiteMonitorHomepage|checkPublicHomepage/
    );
    expect(source).not.toMatch(/\b(attempts|delayMs)\s*:/);
    expect(source.match(/\bfetch\(/g)).toHaveLength(1);
    expect(source).toMatch(/fetch\(`\$\{connection\.url\}\/auth\/v1\/settings`/);
  });
});
