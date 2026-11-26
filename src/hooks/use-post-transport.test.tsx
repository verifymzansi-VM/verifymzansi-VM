import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { usePostTransport } from "./use-post-transport";
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "posting-v1",
        document_hash: "a".repeat(43),
        document_path: "/terms/versions/posting-v1",
        accepted_at: null,
      }),
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("loads a version-bound policy and preserves the same receipt across repeated submits", async () => {
  const { result, rerender } = renderHook(() => usePostTransport());
  await waitFor(() => expect(result.current.fields().postingTerms?.version).toBe("posting-v1"));
  const first = result.current.fields();
  rerender();
  expect(result.current.fields()).toEqual(first);
  expect(first).not.toHaveProperty("termsAccepted");
  expect(fetch).toHaveBeenCalledWith(
    "/api/foundation/posting-terms",
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" })
  );
});
it("requires the actually loaded revision for edits without inventing consent", async () => {
  const { result } = renderHook(() => usePostTransport());
  await waitFor(() => expect(result.current.fields().postRequestId).toBeTruthy());
  expect(() => result.current.fields(true)).toThrow("Reload your post");
  result.current.captureRevision({ revision: 7 });
  expect(result.current.fields(true)).toMatchObject({ expectedRevision: 7 });
  expect(result.current.fields(true)).not.toHaveProperty("termsAccepted");
  expect(() => result.current.captureRevision({ revision: "8" })).toThrow(
    "revision could not be loaded"
  );
});
it("records consent for a form that saves an existing post, and renews the request", async () => {
  const { result } = renderHook(() => usePostTransport());
  await waitFor(() => expect(result.current.needsTerms).toBe(true));
  const before = result.current.fields().postRequestId;
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      version: "posting-v1",
      document_hash: "a".repeat(43),
      document_path: "/terms/versions/posting-v1",
      accepted_at: "2026-11-21T10:00:00.000Z",
    }),
  } as Response);
  await act(async () => {
    await result.current.acceptTerms();
  });
  expect(result.current.needsTerms).toBe(false);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/foundation/posting-terms",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        version: "posting-v1",
        document_hash: "a".repeat(43),
        accepted: true,
      }),
    })
  );
  result.current.renewRequest();
  expect(result.current.fields().postRequestId).not.toBe(before);
});
it("refuses to continue when the acceptance is not confirmed", async () => {
  const { result } = renderHook(() => usePostTransport());
  await waitFor(() => expect(result.current.needsTerms).toBe(true));
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
  await expect(result.current.acceptTerms()).rejects.toThrow("could not be accepted");
  expect(result.current.needsTerms).toBe(true);
});
it("says the terms could not be reached on a network failure, not the upload service", async () => {
  const { result } = renderHook(() => usePostTransport());
  await waitFor(() => expect(result.current.needsTerms).toBe(true));
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(result.current.acceptTerms()).rejects.toThrow(
    "We couldn't reach VerifyMzansi to accept the posting terms. Check your connection and try again."
  );
  expect(result.current.needsTerms).toBe(true);
});
