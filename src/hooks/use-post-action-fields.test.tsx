import { renderHook } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { usePostActionFields } from "./use-post-action-fields";
afterEach(() => vi.unstubAllEnvs());
it("keeps a receipt across an uncertain retry and changes it for a new represented revision", () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  const { result } = renderHook(() => usePostActionFields());
  const first = result.current("fixture", 7, "delete", "MZANSI_MARKET", "listing");
  expect(result.current("fixture", 7, "delete", "MZANSI_MARKET", "listing")).toEqual(first);
  expect(result.current("fixture", 8, "delete", "MZANSI_MARKET", "listing").operationId).not.toBe(
    first.operationId
  );
  expect(() => result.current("fixture", undefined, "delete", "MZANSI_MARKET", "listing")).toThrow(
    "Reload your posts"
  );
});
it("does not change the source fixture request contract", () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "source");
  const { result } = renderHook(() => usePostActionFields());
  expect(result.current("fixture", undefined, "delete", undefined, undefined)).toEqual({});
});
