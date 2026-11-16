import { renderHook, waitFor } from "@testing-library/react";
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
