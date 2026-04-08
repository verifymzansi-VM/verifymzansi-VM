import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { checkUploadServiceReachable, UploadServiceUnreachableError } from "./upload-preflight";

describe("checkUploadServiceReachable", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves when server returns 200", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
  });

  it("resolves when server returns 401 (server alive, user not authed)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
  });

  it("resolves when server returns 403 (CSRF rejected, but server alive)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
  });

  it("resolves when server returns 405 (method not allowed, but alive)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 405 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
  });

  it("resolves on 500 server error so the real upload can still be attempted", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
  });

  it("resolves on 503 server error so the real upload can still be attempted", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
  });

  it("throws UploadServiceUnreachableError on network failure (TypeError) after retries", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(checkUploadServiceReachable()).rejects.toThrow(UploadServiceUnreachableError);
  });

  it("throws UploadServiceUnreachableError on abort/timeout", async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(checkUploadServiceReachable()).rejects.toThrow(UploadServiceUnreachableError);
  });

  it("error has correct name property", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    try {
      await checkUploadServiceReachable();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UploadServiceUnreachableError);
      expect((err as Error).name).toBe("UploadServiceUnreachableError");
    }
  });

  it("sends HEAD request to /api/media/upload", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    await checkUploadServiceReachable();
    expect(fetch).toHaveBeenCalledWith(
      "/api/media/upload",
      expect.objectContaining({
        method: "HEAD",
      })
    );
  });

  it("recovers if first fetch fails but retry succeeds", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("works when AbortSignal.timeout is unavailable (iOS < 17.4)", async () => {
    const original = AbortSignal.timeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AbortSignal as any).timeout = undefined;
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    await expect(checkUploadServiceReachable()).resolves.toBeUndefined();
    AbortSignal.timeout = original;
  });
});
