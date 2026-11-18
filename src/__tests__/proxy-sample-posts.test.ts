import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as Catalogue from "@/lib/sample-posts/catalogue";

const { checkFoundationPageAccess, loadHiddenSampleSlugs, isPublishedSampleSlug } = vi.hoisted(
  () => ({
    checkFoundationPageAccess: vi.fn(),
    loadHiddenSampleSlugs: vi.fn(),
    isPublishedSampleSlug: vi.fn(),
  })
);
vi.mock("@/lib/foundation/page-access", () => ({ checkFoundationPageAccess }));
vi.mock("@/lib/sample-posts/hidden", () => ({ loadHiddenSampleSlugs }));
vi.mock("@/lib/sample-posts/catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof Catalogue>()),
  isPublishedSampleSlug,
}));

import { routeRequest } from "@/proxy-handler";
import { REWRITTEN_REQUEST_HEADER } from "@/lib/middleware/security-headers";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { host: "localhost:3000", ...headers },
  });
}

describe("proxy — display-only sample posts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof Catalogue>("@/lib/sample-posts/catalogue");
    // The committed catalogue is empty; "fish-braai" stands in for one entry.
    isPublishedSampleSlug.mockImplementation((slug: string) =>
      actual.isPublishedSampleSlug(slug, process.env, [
        {
          slug: "fish-braai",
          area: "event",
          category: "food_wine",
          title: "Fish braai on the beach",
          description: "A sample event post shown as an example of the site.",
          province: "KwaZulu-Natal",
          city: "Durban",
          videoKey: "media/samples/fish-braai.mp4",
          posterKey: "media/samples/fish-braai.webp",
        },
      ])
    );
    loadHiddenSampleSlugs.mockResolvedValue(new Set());
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("serves a committed sample while the switch is on and staff have not removed it", async () => {
    const response = await routeRequest(request("/sample/fish-braai"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(checkFoundationPageAccess).not.toHaveBeenCalled();
  });

  it.each(["/sample/not-a-sample", "/sample", "/sample/", "/sample/a/b", "/sample/..%2Fadmin"])(
    "answers unknown sample paths with a real 404 before streaming, without a read: %s",
    async (path) => {
      const response = await routeRequest(request(path));
      expect(response.status).toBe(404);
      expect(loadHiddenSampleSlugs).not.toHaveBeenCalled();
      expect(checkFoundationPageAccess).not.toHaveBeenCalled();
    }
  );

  it("hides every sample while the switch is off", async () => {
    vi.stubEnv("SAMPLE_POSTS_ENABLED", "");
    expect((await routeRequest(request("/sample/fish-braai"))).status).toBe(404);
    expect(loadHiddenSampleSlugs).not.toHaveBeenCalled();
  });

  it("answers a sample staff removed with a real 404", async () => {
    loadHiddenSampleSlugs.mockResolvedValue(new Set(["fish-braai"]));
    expect((await routeRequest(request("/sample/fish-braai"))).status).toBe(404);
  });

  it("fails closed: a 404 when the hide-list cannot be read", async () => {
    loadHiddenSampleSlugs.mockRejectedValue(new Error("unavailable"));
    expect((await routeRequest(request("/sample/fish-braai"))).status).toBe(404);
  });

  it("lets the rewritten 404 request through to the page's own not-found design", async () => {
    loadHiddenSampleSlugs.mockResolvedValue(new Set(["fish-braai"]));
    const response = await routeRequest(
      request("/sample/fish-braai", { [REWRITTEN_REQUEST_HEADER]: "1" })
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(loadHiddenSampleSlugs).not.toHaveBeenCalled();
  });

  it("leaves unrelated paths alone", async () => {
    const response = await routeRequest(request("/samples-and-more"));
    expect(response.status).not.toBe(404);
    expect(isPublishedSampleSlug).not.toHaveBeenCalled();
  });
});
