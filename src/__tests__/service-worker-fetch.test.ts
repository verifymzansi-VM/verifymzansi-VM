import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/sw.js", "utf8");
function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = { put: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    match: vi.fn().mockResolvedValue(new Response("old")),
    keys: vi
      .fn()
      .mockResolvedValue([
        "verifymzansi-media-v1",
        "verifymzansi-v5-no-next-static-cache",
        "unrelated-cache",
      ]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi.fn().mockResolvedValue(new Response("fresh"));
  runInNewContext(source, {
    self: {
      location: { origin: "https://verifymzansi.com" },
      addEventListener: (name: string, fn: (event: unknown) => void) => {
        handlers[name] = fn;
      },
      clients: { claim: vi.fn() },
    },
    caches,
    fetch,
    URL,
    Response,
  });
  return { handlers, caches, fetch, cache };
}

describe("service worker freshness and media streaming", () => {
  it.each([
    ["/mzansi-market?_rsc=123", { RSC: "1" }],
    ["/api/media/serve/media/clip.mp4", { Range: "bytes=100-200" }],
    ["/api/media/serve/media/photo.webp", {}],
  ])("leaves %s to native fetch and HTTP cache semantics", (path, headers) => {
    const { handlers, caches } = worker();
    const respondWith = vi.fn();
    handlers.fetch({
      request: new Request(`https://verifymzansi.com${path}`, { headers }),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(caches.match).not.toHaveBeenCalled();
  });

  it("revalidates mutable artwork instead of serving an old cached image", async () => {
    const { handlers, fetch } = worker();
    const respondWith = vi.fn();
    handlers.fetch({
      request: new Request("https://verifymzansi.com/images/banner.webp"),
      respondWith,
      waitUntil: vi.fn(),
    });
    const response = await respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("fresh");
    expect(fetch).toHaveBeenCalledWith(expect.anything(), { cache: "no-cache" });
  });

  it("retains the offline page fallback", async () => {
    const { handlers, fetch } = worker();
    fetch.mockRejectedValue(new Error("offline"));
    const respondWith = vi.fn();
    handlers.fetch({
      request: new Request("https://verifymzansi.com/", { headers: { accept: "text/html" } }),
      respondWith,
    });
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe("old");
  });

  it("removes previous app and media caches without deleting other caches", async () => {
    const { handlers, caches } = worker();
    const waitUntil = vi.fn();
    handlers.activate({ waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(caches.delete.mock.calls.map(([key]) => key)).toEqual([
      "verifymzansi-media-v1",
      "verifymzansi-v5-no-next-static-cache",
    ]);
  });
});
