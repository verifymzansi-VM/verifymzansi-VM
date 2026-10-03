/** @vitest-environment node */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: vi.fn(), eq: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const request = new Request("http://localhost/api/share-preview/listing/" + id);
describe("public social image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => {
        mocks.eq(...args);
        return query;
      },
      or: () => query,
      maybeSingle: mocks.row,
    };
    mocks.from.mockReturnValue(query);
  });
  it("renders a video profile card with title, price and location", async () => {
    mocks.row.mockResolvedValue({
      data: {
        title: "Garden cottage in Richards Bay",
        videos: ["/video.mp4"],
        price_cents: 85000,
        location_city: "Richards Bay",
        location_province: "KwaZulu-Natal",
      },
    });
    const response = await GET(request, { params: Promise.resolve({ type: "listing", id }) });
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(mocks.eq).toHaveBeenCalledWith("status", "live");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    mkdirSync("output/desktop-profiles", { recursive: true });
    writeFileSync("output/desktop-profiles/share-card.png", bytes);
  }, 30000);
  it("returns no image for a private or unavailable profile", async () => {
    mocks.row.mockResolvedValue({ data: null });
    expect((await GET(request, { params: Promise.resolve({ type: "business", id }) })).status).toBe(
      404
    );
  });
  it("renders the owner's PNG poster in the share card", async () => {
    const originalOrigin = process.env.NEXT_PUBLIC_APP_URL;
    let requested = false;
    const server = createServer((_request, response) => {
      requested = true;
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(readFileSync("public/images/brand-shield-small.png"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      mocks.row.mockResolvedValue({
        data: {
          title: "Explore local places",
          videos: ["/video.mp4"],
          video_thumbnail: "/images/poster.png",
          location_city: "Richards Bay",
          location_province: "KwaZulu-Natal",
        },
      });
      const response = await GET(request, { params: Promise.resolve({ type: "listing", id }) });
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(requested).toBe(true);
      expect(bytes.length).toBeGreaterThan(25000);
      writeFileSync("output/desktop-profiles/share-card-with-media.png", bytes);
    } finally {
      if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = originalOrigin;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30000);
  it("rejects invalid kinds and ids before touching data", async () => {
    expect(
      (await GET(request, { params: Promise.resolve({ type: "__proto__", id }) })).status
    ).toBe(404);
    expect(
      (await GET(request, { params: Promise.resolve({ type: "listing", id: "bad" }) })).status
    ).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
