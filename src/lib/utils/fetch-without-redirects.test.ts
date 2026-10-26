/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import { fetchWithoutRedirects } from "./fetch-without-redirects";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
afterEach(() => vi.unstubAllGlobals());
it("uses the redirect mode supported by Workers without changing credentials or body", async () => {
  const result = new Response("{}", { status: 200 });
  const fetcher = vi.fn().mockResolvedValue(result);
  const options = {
    method: "POST",
    headers: { Authorization: "Bearer synthetic-fixture" },
    body: "payload",
  };
  expect(await fetchWithoutRedirects("https://owned.example.invalid", options, fetcher)).toBe(
    result
  );
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://owned.example.invalid", {
    ...options,
    redirect: "manual",
  });
});
it.each([300, 301, 302, 303, 304, 307, 308, 399])(
  "refuses HTTP %i without forwarding credentials to the redirect target",
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status, headers: { Location: "https://untrusted.example.invalid" } })
      );
    await expect(
      fetchWithoutRedirects(
        "https://owned.example.invalid",
        { headers: { apikey: "synthetic-only" } },
        fetcher
      )
    ).rejects.toThrow("Unexpected redirect refused");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);
it("refuses opaque browser redirects as well", async () => {
  const response = new Response();
  Object.defineProperty(response, "type", { value: "opaqueredirect" });
  await expect(
    fetchWithoutRedirects("https://owned.example.invalid", {}, vi.fn().mockResolvedValue(response))
  ).rejects.toThrow("Unexpected redirect refused");
});
it("preserves normal HTTP failures for the caller's existing error handling", async () => {
  const response = new Response("{}", { status: 401 });
  expect(
    await fetchWithoutRedirects(
      "https://owned.example.invalid",
      {},
      vi.fn().mockResolvedValue(response)
    )
  ).toBe(response);
});
it("adapts a Supabase error-mode request to manual mode while retaining its deadline", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  await createTimeoutFetch(1000)("https://owned.example.invalid", { redirect: "error" });
  expect(fetcher).toHaveBeenCalledWith(
    "https://owned.example.invalid",
    expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) })
  );
});
it("enforces a no-redirect policy carried by a Request input", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    createTimeoutFetch()(new Request("https://owned.example.invalid", { redirect: "error" }))
  ).rejects.toThrow("Unexpected redirect refused");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
