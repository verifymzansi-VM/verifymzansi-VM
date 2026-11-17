import { afterEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useErrorReference } from "./use-error-reference";

const RAY = "8f1a2b3c4d5e6f70-JNB";
const DIGEST = "2817364519";

type Resource = { name: string; initiatorType: string };

function timings({
  serverTiming = [{ name: "cfray", description: RAY }],
  url = window.location.href,
  resources = [],
}: {
  serverTiming?: Array<{ name: string; description: string }>;
  url?: string;
  resources?: Resource[];
} = {}) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation(
    (type: string) =>
      (type === "navigation"
        ? [{ name: url, serverTiming }]
        : type === "resource"
          ? resources
          : []) as unknown as PerformanceEntryList
  );
}

const reference = (error: { digest?: string } = { digest: DIGEST }) =>
  renderHook(() => useErrorReference(error)).result.current;
const page = (path: string) => new URL(path, window.location.origin).href;

afterEach(() => vi.restoreAllMocks());

it("shows the page load's request reference for a server error on the loaded page", () => {
  timings({
    resources: [
      { name: page("/api/csrf"), initiatorType: "fetch" },
      { name: page("/_next/static/chunks/app.js"), initiatorType: "script" },
      { name: "https://images.example.net/a.webp", initiatorType: "img" },
    ],
  });
  expect(reference()).toBe(RAY);
});

it("shows the digest after a client navigation, refresh or server action", () => {
  // Soft navigation away and back, or router.refresh(): an RSC fetch of a page.
  timings({ resources: [{ name: page("/?_rsc=abc12"), initiatorType: "fetch" }] });
  expect(reference({ digest: DIGEST })).toBe(DIGEST);
  // A server action posts to the page itself.
  timings({ resources: [{ name: window.location.href, initiatorType: "fetch" }] });
  expect(reference({ digest: DIGEST })).toBe(DIGEST);
  // On another page than the one loaded.
  timings({ url: page("/elsewhere") });
  expect(reference({ digest: DIGEST })).toBe(DIGEST);
});

it("shows the digest when the timing buffer is full or the reference is malformed", () => {
  timings({
    resources: Array.from({ length: 250 }, (_, i) => ({
      name: page(`/api/item/${i}`),
      initiatorType: "fetch",
    })),
  });
  expect(reference({ digest: DIGEST })).toBe(DIGEST);
  timings({ serverTiming: [{ name: "cfray", description: "<b>not a ray</b>" }] });
  expect(reference({ digest: DIGEST })).toBe(DIGEST);
});

it("keeps the reference it first showed for an error", () => {
  timings();
  const error = { digest: DIGEST };
  const { result, rerender } = renderHook(() => useErrorReference(error));
  expect(result.current).toBe(RAY);
  timings({ resources: [{ name: page("/next?_rsc=1"), initiatorType: "fetch" }] });
  rerender();
  expect(result.current).toBe(RAY);
});

it("shows nothing for errors that never reached the server", () => {
  timings();
  expect(reference({})).toBeUndefined();
});
