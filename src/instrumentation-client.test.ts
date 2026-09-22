import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  replayIntegration: vi.fn(() => ({ name: "Replay" })),
}));

vi.mock("@sentry/nextjs", () => sentryMock);

/**
 * Force the iOS-Safari fallback path (setTimeout after `load`) so tests do
 * not depend on jsdom implementing requestIdleCallback.
 */
function forceTimerFallback() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).requestIdleCallback;
}

async function settleAsyncWork() {
  await vi.advanceTimersByTimeAsync(2500);
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
}

describe("instrumentation-client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@example.ingest.sentry.io/1");
    forceTimerFallback();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not initialise Sentry synchronously at import time", async () => {
    await import("./instrumentation-client");
    expect(sentryMock.init).not.toHaveBeenCalled();

    // Let the deferred load run so its global listeners clean themselves up.
    window.dispatchEvent(new Event("load"));
    await settleAsyncWork();
    expect(sentryMock.init).toHaveBeenCalledTimes(1);
  });

  it("buffers early errors and loads Sentry immediately on a crash", async () => {
    await import("./instrumentation-client");
    expect(sentryMock.init).not.toHaveBeenCalled();

    const boom = new Error("boom");
    window.dispatchEvent(new ErrorEvent("error", { error: boom, message: "boom" }));

    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        mechanism: expect.objectContaining({ type: "onerror", handled: false }),
      })
    );
  });

  it("initialises with the same sampling config after the fallback timer", async () => {
    await import("./instrumentation-client");

    window.dispatchEvent(new Event("load"));
    await settleAsyncWork();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.replayIntegration).toHaveBeenCalled();
    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@example.ingest.sentry.io/1",
        replaysSessionSampleRate: 0.01,
        replaysOnErrorSampleRate: 1.0,
      })
    );
  });

  it("forwards router transitions to Sentry once loaded", async () => {
    const mod = await import("./instrumentation-client");

    mod.onRouterTransitionStart("/pricing", "push");
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);

    expect(sentryMock.captureRouterTransitionStart).toHaveBeenCalledWith("/pricing", "push");
  });

  it("never downloads Sentry when no DSN is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const mod = await import("./instrumentation-client");

    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    mod.onRouterTransitionStart("/", "push");
    window.dispatchEvent(new Event("load"));
    await settleAsyncWork();

    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  it("keeps buffering and does not flush when Sentry init itself fails", async () => {
    sentryMock.init.mockImplementationOnce(() => {
      throw new Error("CSP blocked");
    });
    await import("./instrumentation-client");

    const boom = new Error("boom");
    window.dispatchEvent(new ErrorEvent("error", { error: boom, message: "boom" }));
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    // Init failed — nothing should be flushed into the broken SDK.
    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });
});
