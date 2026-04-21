import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "./fetch-retry";

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns response on first success", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry("/api/test");
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on TypeError and succeeds on second attempt", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse);

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries twice with exponential backoff then succeeds", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse);

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const promise = fetchWithRetry("/api/test");
    // Prevent vitest's unhandled-rejection handler from firing before
    // the assertion below can catch the rejection.
    promise.catch(() => {});

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("Failed to fetch");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-TypeError errors", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Abort"));

    await expect(fetchWithRetry("/api/test")).rejects.toThrow("Abort");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on DOMException AbortError (timeout) and succeeds", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"))
      .mockResolvedValueOnce(mockResponse);

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on DOMException AbortError", async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    const promise = fetchWithRetry("/api/test");
    promise.catch(() => {});

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("The operation was aborted");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("respects custom maxRetries", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse);

    const promise = fetchWithRetry("/api/test", undefined, 1);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("passes through init options to fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse);

    const init = { method: "POST", body: "data" };
    await fetchWithRetry("/api/test", init);

    expect(fetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ method: "POST", body: "data" })
    );
  });

  it("aborts a stalled request after the per-attempt timeout and retries", async () => {
    const mockResponse = new Response("ok", { status: 200 });

    vi.mocked(fetch)
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("The operation was aborted", "AbortError")),
              { once: true }
            );
          })
      )
      .mockResolvedValueOnce(mockResponse);

    const promise = fetchWithRetry("/api/test", undefined, 1, 50);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller aborts the request", async () => {
    const controller = new AbortController();

    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true }
          );
        })
    );

    const promise = fetchWithRetry("/api/test", { signal: controller.signal }, 2, 50);
    promise.catch(() => {});

    await Promise.resolve();
    controller.abort();
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("The operation was aborted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
