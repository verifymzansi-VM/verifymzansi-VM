/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import { HEARTBEAT_TIMEOUT_MS, sendHeartbeat } from "../../workers/heartbeat";

const url = "https://heartbeat.example.invalid/ping/synthetic-heartbeat-token";
afterEach(() => vi.restoreAllMocks());

it("does nothing when no heartbeat is configured", async () => {
  const fetcher = vi.fn();
  for (const unset of [undefined, ""])
    expect(await sendHeartbeat("job", unset, fetcher)).toBe("not-configured");
  expect(fetcher).not.toHaveBeenCalled();
});

it("pings with a short deadline and reports the outcome without throwing", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(HEARTBEAT_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  const ok = vi.fn().mockResolvedValue(new Response("OK"));
  expect(await sendHeartbeat("job", url, ok)).toBe("sent");
  const init = ok.mock.calls[0]![1] as RequestInit;
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(init.signal!.aborted).toBe(false);
  expect(
    await sendHeartbeat("job", url, vi.fn().mockResolvedValue(new Response("", { status: 404 })))
  ).toBe("failed");
  expect(await sendHeartbeat("job", url, vi.fn().mockRejectedValue(new Error(url)))).toBe("failed");
});

it("gives up when the monitor hangs past the deadline", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const hang = vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
      )
  );
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), 0);
    return controller.signal;
  });
  expect(await sendHeartbeat("job", url, hang)).toBe("failed");
  expect(timeout).toHaveBeenCalledExactlyOnceWith(HEARTBEAT_TIMEOUT_MS);
});

it("never logs the heartbeat URL", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await sendHeartbeat("job", url, vi.fn().mockRejectedValue(new TypeError(`failed ${url}`)));
  await sendHeartbeat("job", "http://heartbeat.example.invalid/x", vi.fn());
  expect(warn).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("heartbeat.example.invalid");
});
