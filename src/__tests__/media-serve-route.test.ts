import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockSend;
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

const { mockCheckLocalRateLimit } = vi.hoisted(() => ({
  mockCheckLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { GET } from "@/app/api/media/serve/[...key]/route";

function createRequest(headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

describe("GET /api/media/serve/[...key]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.R2_ACCOUNT_ID = "account";
    process.env.R2_ACCESS_KEY_ID = "access";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_PUBLIC_BUCKET = "public-bucket";
    delete process.env.R2_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_MEDIA_URL;
  });

  it("rejects invalid storage keys", async () => {
    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["..", "evil.svg"] }),
    });

    expect(res.status).toBe(400);
  });

  it("forces SVG downloads and adds defensive CSP", async () => {
    mockSend.mockResolvedValue({
      ContentType: "image/svg+xml",
      ETag: '"etag-1"',
      Body: {
        transformToByteArray: vi.fn().mockResolvedValue(new Uint8Array([60, 115, 118, 103, 62])),
      },
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "1730000-logo.svg"] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("returns partial content for ranged video requests", async () => {
    mockSend
      .mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: "video/mp4",
        ETag: '"etag-2"',
      })
      .mockResolvedValueOnce({
        Body: {
          transformToWebStream: vi.fn().mockReturnValue(new ReadableStream()),
        },
      });

    const res = await GET(createRequest({ range: "bytes=0-99" }), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "clip.mp4"] }),
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1024");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("redirects to R2_PUBLIC_URL when credentials are missing", async () => {
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "photo.jpg"] }),
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://cdn.example.com/media/listing/abc/photo.jpg");
  });

  it("returns 503 when credentials and fallback origins are missing", async () => {
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_MEDIA_URL;
    delete process.env.R2_ACCOUNT_ID;

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "photo.jpg"] }),
    });

    expect(res.status).toBe(503);
  });

  it("returns 429 when rate-limited", async () => {
    mockCheckLocalRateLimit.mockReturnValueOnce({ limited: true, retryAfter: 60 });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "photo.jpg"] }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
