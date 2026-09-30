import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    process.env.R2_ACCOUNT_ID = "account";
    process.env.R2_ACCESS_KEY_ID = "access";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_PUBLIC_BUCKET = "public-bucket";
    delete process.env.R2_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_MEDIA_URL;
    delete process.env.PLAYWRIGHT_TEST_MODE;
    delete process.env.PLAYWRIGHT_SUPABASE_MODE;
    delete (process.env as unknown as Record<string, unknown>).PUBLIC_BUCKET;
  });

  it("serves e2e-stub uploads from the local filesystem without hitting S3", async () => {
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    process.env.PLAYWRIGHT_SUPABASE_MODE = "stub";
    // Point the stub's public/e2e-media root at a temp dir with a known file.
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vmz-media-"));
    const mediaDir = path.join(tmpRoot, "public", "e2e-media", "media", "listing", "u1");
    await fs.mkdir(mediaDir, { recursive: true });
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile(path.join(mediaDir, "123-photo.png"), pngBytes);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    try {
      const res = await GET(createRequest(), {
        params: Promise.resolve({ key: ["media", "listing", "u1", "123-photo.png"] }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Content-Length")).toBe(String(pngBytes.length));
      // S3 must never be touched in stub mode.
      expect(mockSend).not.toHaveBeenCalled();
    } finally {
      cwdSpy.mockRestore();
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("returns 404 in e2e-stub mode when the local file is missing", async () => {
    process.env.PLAYWRIGHT_TEST_MODE = "1";
    process.env.PLAYWRIGHT_SUPABASE_MODE = "stub";
    const res = await GET(createRequest(), {
      params: Promise.resolve({
        key: ["media", "listing", "u1", `missing-${Date.now()}.png`],
      }),
    });
    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects invalid storage keys", async () => {
    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["..", "evil.svg"] }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("forces SVG downloads and adds defensive CSP", async () => {
    mockSend.mockResolvedValue({
      ContentType: "image/svg+xml",
      ETag: '"etag-1"',
      Body: {
        transformToWebStream: vi.fn().mockImplementation(
          () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([60, 115, 118, 103, 62]));
                controller.close();
              },
            })
        ),
      },
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "1730000-logo.svg"] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("prefers the extension MIME over stored object metadata (S3 path)", async () => {
    // A direct upload could have stored text/html on a .jpg key — serving it
    // inline would be stored XSS, so the extension mapping must win.
    mockSend.mockResolvedValue({
      ContentType: "text/html",
      ETag: '"etag-html"',
      Body: {
        transformToWebStream: vi.fn().mockImplementation(
          () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.close();
              },
            })
        ),
      },
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "1730000-photo.jpg"] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("prefers the extension MIME over stored object metadata (R2 binding path)", async () => {
    const obj = {
      key: "media/listing/abc/1730000-photo.jpg",
      size: 3,
      etag: '"etag-binding"',
      httpMetadata: { contentType: "text/html" },
      body: new ReadableStream(),
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    };
    vi.stubGlobal("env", {
      PUBLIC_BUCKET: {
        get: vi.fn().mockResolvedValue(obj),
        head: vi.fn().mockResolvedValue(obj),
      },
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "1730000-photo.jpg"] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
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

  it("streams images without buffering the whole R2 object", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const arrayBuffer = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    vi.stubGlobal("env", {
      PUBLIC_BUCKET: {
        get: async () => ({ size: bytes.length, etag: '"image"', body, arrayBuffer }),
        head: vi.fn(),
      },
    });
    const response = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "photo.jpg"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("releases the R2 body on a conditional cache hit", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("env", {
      PUBLIC_BUCKET: {
        get: async () => ({ size: 3, etag: '"image"', body: new ReadableStream({ cancel }) }),
        head: vi.fn(),
      },
    });
    const response = await GET(createRequest({ "if-none-match": '"image"' }), {
      params: Promise.resolve({ key: ["media", "photo.jpg"] }),
    });
    expect(response.status).toBe(304);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.headers.get("ETag")).toBe('"image"');
  });

  it("releases the S3 body on a conditional cache hit", async () => {
    const cancel = vi.fn();
    mockSend.mockResolvedValue({
      ETag: '"image"',
      Body: {
        transformToWebStream: () => new ReadableStream({ cancel }),
      },
    });
    const response = await GET(createRequest({ "if-none-match": '"image"' }), {
      params: Promise.resolve({ key: ["media", "photo.jpg"] }),
    });
    expect(response.status).toBe(304);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("selects a successful variant fallback and releases discarded streams", async () => {
    const discarded = vi.fn();
    mockSend.mockImplementation(async (command: { input: { Key: string } }) => {
      if (command.input.Key.endsWith(".jpg")) throw new Error("temporary storage failure");
      if (command.input.Key.endsWith(".jpeg") || command.input.Key.endsWith(".png")) {
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array([1, 2, 3]));
                },
                cancel: command.input.Key.endsWith(".png") ? discarded : undefined,
              }),
          },
        };
      }
      throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    });
    const response = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "photo.w400.webp"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(discarded).toHaveBeenCalledTimes(1);
    await response.body?.cancel();
  });

  it("briefly caches an original served while a responsive variant is missing", async () => {
    mockSend.mockImplementation(async (command: { input: { Key: string } }) => {
      if (command.input.Key.endsWith(".jpg")) {
        return {
          ContentType: "image/jpeg",
          Body: {
            transformToWebStream: vi.fn().mockImplementation(
              () =>
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                  },
                })
            ),
          },
        };
      }
      throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "photo.w400.webp"] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300");
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
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 429 when rate-limited", async () => {
    mockCheckLocalRateLimit.mockReturnValueOnce({ limited: true, retryAfter: 60 });

    const res = await GET(createRequest(), {
      params: Promise.resolve({ key: ["media", "listing", "abc", "photo.jpg"] }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
