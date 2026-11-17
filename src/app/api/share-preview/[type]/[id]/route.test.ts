/** @vitest-environment node */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), rate: vi.fn() }));
// The foundation adapter's own reads are covered in marketplace-server.test.ts.
vi.mock("@/lib/foundation/marketplace-server", () => ({ restoredSharePreview: mocks.preview }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mocks.rate,
  getClientRateLimitKey: () => "203.0.113.1",
}));
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const request = new Request("http://localhost/api/share-preview/listing/" + id);
/** What restoredSharePreview returns for a public post. */
const post = {
  title: "Fixture",
  tourism: false,
  location_city: "Richards Bay",
  location_province: "KwaZulu-Natal",
  price_cents: null,
  video_thumbnail: null,
  has_video: false,
};
describe("public social image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rate.mockResolvedValue({ limited: false });
  });
  it("renders a video profile card with title, price and location", async () => {
    mocks.preview.mockResolvedValue({
      ...post,
      title: "Garden cottage in Richards Bay",
      has_video: true,
      price_cents: 85000,
    });
    const response = await GET(request, { params: Promise.resolve({ type: "listing", id }) });
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300");
    expect(mocks.preview).toHaveBeenCalledWith("listing", id);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    mkdirSync("output/desktop-profiles", { recursive: true });
    writeFileSync("output/desktop-profiles/share-card.png", bytes);
  }, 30000);
  it("returns no image for a private or unavailable profile", async () => {
    mocks.preview.mockResolvedValue(null);
    const response = await GET(request, { params: Promise.resolve({ type: "business", id }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.preview).toHaveBeenCalledWith("business", id);
  });
  it("asks for the event kind behind tourism and event links", async () => {
    mocks.preview.mockResolvedValue(null);
    await GET(request, { params: Promise.resolve({ type: "promotion", id }) });
    expect(mocks.preview).toHaveBeenCalledWith("event", id);
  });
  it("answers 503, not an error page or a cached 404, when the database read fails", async () => {
    mocks.preview.mockRejectedValue(new Error("Foundation public post unavailable"));
    const response = await GET(request, { params: Promise.resolve({ type: "listing", id }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
  });
  it("renders the owner's PNG poster in the share card", async () => {
    const originalOrigin = process.env.NEXT_PUBLIC_APP_URL;
    const poster = readFileSync("public/images/brand-shield-small.png");
    process.env.NEXT_PUBLIC_APP_URL = "https://share-preview.test";
    // Keep the real PNG renderer, with exactly one permitted synthetic image
    // request. No socket or external network service is needed by this test.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input !== "https://share-preview.test/images/poster.png")
        throw new Error("Unexpected share-preview image request");
      return new Response(new Uint8Array(poster), { headers: { "Content-Type": "image/png" } });
    });
    try {
      mocks.preview.mockResolvedValue({
        ...post,
        title: "Explore local places",
        has_video: true,
        video_thumbnail: "/images/poster.png",
      });
      const response = await GET(request, { params: Promise.resolve({ type: "listing", id }) });
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(fetchSpy).toHaveBeenCalledWith("https://share-preview.test/images/poster.png");
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.length).toBeGreaterThan(25000);
      writeFileSync("output/desktop-profiles/share-card-with-media.png", bytes);
    } finally {
      fetchSpy.mockRestore();
      if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = originalOrigin;
    }
  }, 30000);
  it("rejects invalid kinds and ids before touching data", async () => {
    expect(
      (await GET(request, { params: Promise.resolve({ type: "__proto__", id }) })).status
    ).toBe(404);
    expect(
      (await GET(request, { params: Promise.resolve({ type: "listing", id: "bad" }) })).status
    ).toBe(404);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it.each([
    { degraded: false, status: 429 },
    { degraded: true, status: 503 },
  ])(
    "blocks render work with status $status when quota is unavailable",
    async ({ degraded, status }) => {
      mocks.rate.mockResolvedValue({ limited: true, degraded, retryAfter: 42 });
      const response = await GET(request, { params: Promise.resolve({ type: "listing", id }) });
      expect(response.status).toBe(status);
      expect(response.headers.get("Retry-After")).toBe("42");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.preview).not.toHaveBeenCalled();
      expect(mocks.rate).toHaveBeenCalledWith({
        key: "203.0.113.1",
        action: "share-preview:render",
        degradedMode: "block",
      });
    }
  );
});
