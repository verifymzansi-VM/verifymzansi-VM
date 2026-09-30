import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimeoutFetch } from "./fetch-with-timeout";

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightSupabaseStubMode: () => false,
}));

function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(init.signal.reason);
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })
  );
}

describe("createTimeoutFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("aborts a request that does not answer within the deadline", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const timedFetch = createTimeoutFetch(20);
    await expect(timedFetch("https://example.supabase.co/rest/v1/x")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("still honours a caller-supplied abort signal", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const pending = createTimeoutFetch(10_000)("https://example.supabase.co/rest/v1/x", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller aborted"));
    await expect(pending).rejects.toThrow("caller aborted");
  });

  it("honours cancellation carried by a Request input", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const request = new Request("https://example.supabase.co/rest/v1/x", {
      signal: controller.signal,
    });
    const pending = createTimeoutFetch(10_000)(request);
    controller.abort(new Error("request cancelled"));
    await expect(pending).rejects.toThrow("request cancelled");
  });

  it("keeps the deadline when AbortSignal.any is unavailable", async () => {
    const nativeAbortSignal = AbortSignal;
    vi.stubGlobal("AbortSignal", { timeout: (ms: number) => nativeAbortSignal.timeout(ms) });
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    await expect(
      createTimeoutFetch(20)("https://example.supabase.co/rest/v1/x", { signal: controller.signal })
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("preserves a caller abort and removes fallback listeners", async () => {
    const nativeAbortSignal = AbortSignal;
    vi.stubGlobal("AbortSignal", { timeout: (ms: number) => nativeAbortSignal.timeout(ms) });
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = createTimeoutFetch(10_000)("https://example.supabase.co/rest/v1/x", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toThrow("caller cancelled");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("createAdminClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends every request with a timeout abort signal", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createAdminClient } = await import("./admin");
    await createAdminClient().from("audit_logs").select("id").limit(1);

    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

vi.mock("@/lib/utils/request-context", () => ({
  getOptionalCookieStore: async () => ({ get: () => undefined, set: () => undefined }),
  readCookieValue: () => undefined,
}));

describe("server createClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends every request with a timeout abort signal", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createClient } = await import("./server");
    const supabase = await createClient();
    await supabase.from("listings").select("id").limit(1);

    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
