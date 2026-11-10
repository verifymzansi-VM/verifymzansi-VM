import { afterEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useErrorReference } from "./use-error-reference";

const RAY = "8f1a2b3c4d5e6f70-JNB";

function pageLoad(serverTiming: Array<{ name: string; description: string }>, name?: string) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { name: name ?? window.location.href, serverTiming } as unknown as PerformanceEntry,
  ]);
}

afterEach(() => vi.restoreAllMocks());

it("shows the page load's request reference for a server error", () => {
  pageLoad([{ name: "cfray", description: RAY }]);
  const { result } = renderHook(() => useErrorReference({ digest: "2817364519" }));
  expect(result.current).toBe(RAY);
});

it("falls back to the digest after a client-side navigation or without a reference", () => {
  pageLoad([{ name: "cfray", description: RAY }], "https://verifymzansi.com/elsewhere");
  expect(renderHook(() => useErrorReference({ digest: "2817364519" })).result.current).toBe(
    "2817364519"
  );
  pageLoad([{ name: "cfray", description: "<b>not a ray</b>" }]);
  expect(renderHook(() => useErrorReference({ digest: "2817364519" })).result.current).toBe(
    "2817364519"
  );
});

it("shows nothing for errors that never reached the server", () => {
  pageLoad([{ name: "cfray", description: RAY }]);
  expect(renderHook(() => useErrorReference({})).result.current).toBeUndefined();
});
