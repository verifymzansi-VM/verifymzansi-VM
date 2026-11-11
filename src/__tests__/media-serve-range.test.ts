// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Byte ranges and photo/video recognition for keys made by the live backend
// (`media/<uuid>`, no file extension): the type comes from the stored object.

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockSend;
  },
  GetObjectCommand: class {
    readonly command = "get";
    constructor(public input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class {
    readonly command = "head";
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

const VIDEO_KEY = ["media", "3f2a9c1e-1b2c-4d5e-8f90-123456789abc"];
const SIZE = 4_000_000;

type SentCommand = { command: "get" | "head"; input: Record<string, unknown> };

function createRequest(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

function serve(key: string[], headers: Record<string, string> = {}) {
  return GET(createRequest(headers), { params: Promise.resolve({ key }) });
}

function body(bytes = [1, 2, 3]) {
  return {
    transformToWebStream: vi.fn().mockImplementation(
      () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        })
    ),
  };
}

/** An S3 bucket holding one object with the given stored type. */
function storedObject(contentType: string, size = SIZE, etag = '"etag-video"') {
  mockSend.mockImplementation(async (sent: SentCommand) => {
    if (sent.command === "head")
      return { ContentLength: size, ContentType: contentType, ETag: etag };
    return { ContentLength: size, ContentType: contentType, ETag: etag, Body: body() };
  });
}

function sentCommands(): SentCommand[] {
  return mockSend.mock.calls.map(([sent]) => sent as SentCommand);
}

describe("GET /api/media/serve for keys without a file extension", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
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

  describe("S3 path (production today)", () => {
    it("answers Range: bytes=0-1023 on a stored video with 206 and only those bytes", async () => {
      storedObject("video/mp4");
      const res = await serve(VIDEO_KEY, { range: "bytes=0-1023" });

      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe(`bytes 0-1023/${SIZE}`);
      expect(res.headers.get("Content-Length")).toBe("1024");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(res.headers.get("Content-Type")).toBe("video/mp4");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("ETag")).toBe('"etag-video"');
      expect(sentCommands()).toEqual([
        {
          command: "head",
          input: { Bucket: "public-bucket", Key: "media/3f2a9c1e-1b2c-4d5e-8f90-123456789abc" },
        },
        {
          command: "get",
          input: {
            Bucket: "public-bucket",
            Key: "media/3f2a9c1e-1b2c-4d5e-8f90-123456789abc",
            Range: "bytes=0-1023",
          },
        },
      ]);
    });

    it("answers suffix and open-ended ranges with the route's own bounds", async () => {
      storedObject("video/webm");
      const suffix = await serve(VIDEO_KEY, { range: "bytes=-500" });
      expect(suffix.status).toBe(206);
      expect(suffix.headers.get("Content-Range")).toBe(`bytes ${SIZE - 500}-${SIZE - 1}/${SIZE}`);
      expect(suffix.headers.get("Content-Type")).toBe("video/webm");

      const open = await serve(VIDEO_KEY, { range: "bytes=100-" });
      expect(open.status).toBe(206);
      expect(open.headers.get("Content-Range")).toBe(`bytes 100-${SIZE - 1}/${SIZE}`);
      expect(open.headers.get("Content-Length")).toBe(String(SIZE - 100));

      const past = await serve(VIDEO_KEY, { range: "bytes=0-999999999999" });
      expect(past.headers.get("Content-Range")).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);

      const ranges = sentCommands()
        .filter((sent) => sent.command === "get")
        .map((sent) => sent.input.Range);
      expect(ranges).toEqual([
        `bytes=${SIZE - 500}-${SIZE - 1}`,
        `bytes=100-${SIZE - 1}`,
        `bytes=0-${SIZE - 1}`,
      ]);
    });

    it("streams a stored video whole, with Accept-Ranges, when no Range is sent", async () => {
      storedObject("video/mp4");
      const res = await serve(VIDEO_KEY);

      expect(res.status).toBe(200);
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(res.headers.get("Content-Type")).toBe("video/mp4");
      expect(res.headers.get("Content-Range")).toBeNull();
      expect(sentCommands().map((sent) => sent.command)).toEqual(["get"]);
      expect(sentCommands()[0].input.Range).toBeUndefined();
    });

    it("refuses an unsatisfiable or malformed range with 416 and reads no bytes", async () => {
      storedObject("video/mp4");
      for (const range of [`bytes=${SIZE}-`, "bytes=-0", "bytes=9-3", "bytes=abc"]) {
        mockSend.mockClear();
        const res = await serve(VIDEO_KEY, { range });
        expect(res.status, range).toBe(416);
        expect(res.headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
        expect(res.headers.get("Accept-Ranges")).toBe("bytes");
        // A refusal must never be kept by a cache.
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        expect(sentCommands().map((sent) => sent.command)).toEqual(["head"]);
      }
    });

    it("sends the whole video for several ranges, an unknown unit or a stale If-Range", async () => {
      storedObject("video/mp4");
      const cases: Record<string, string>[] = [
        { range: "bytes=0-1,5-6" },
        { range: "items=0-1" },
        { range: "bytes=0-1023", "if-range": '"older"' },
      ];
      for (const headers of cases) {
        mockSend.mockClear();
        const res = await serve(VIDEO_KEY, headers);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Range")).toBeNull();
        expect(res.headers.get("Accept-Ranges")).toBe("bytes");
        const get = sentCommands().find((sent) => sent.command === "get");
        expect(get?.input.Range).toBeUndefined();
      }
    });

    it("honours If-Range with the current ETag", async () => {
      storedObject("video/mp4");
      const res = await serve(VIDEO_KEY, { range: "bytes=0-9", "if-range": '"etag-video"' });
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe(`bytes 0-9/${SIZE}`);
    });

    it("serves a stored photo whole, without byte ranges", async () => {
      storedObject("image/jpeg", 3);
      const res = await serve(["media", "11111111-2222-4333-8444-555555555555"], {
        range: "bytes=0-1",
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Accept-Ranges")).toBeNull();
      expect(res.headers.get("Content-Range")).toBeNull();
      expect(sentCommands().find((sent) => sent.command === "get")?.input.Range).toBeUndefined();
    });

    it("does not read stored metadata first for a known photo extension", async () => {
      storedObject("text/html", 3);
      const res = await serve(["media", "listing", "abc", "photo.jpg"], { range: "bytes=0-1" });
      expect(res.status).toBe(200);
      // The extension still wins over stored metadata.
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(sentCommands().map((sent) => sent.command)).toEqual(["get"]);
    });

    it("answers 404 when a ranged request names a missing object", async () => {
      mockSend.mockRejectedValue(Object.assign(new Error("not found"), { name: "NotFound" }));
      const res = await serve(VIDEO_KEY, { range: "bytes=0-1" });
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("forces a download for a stored SVG even without the extension", async () => {
      storedObject("image/svg+xml", 3);
      const res = await serve(["media", "11111111-2222-4333-8444-555555555555"]);
      expect(res.headers.get("Content-Disposition")).toContain("attachment");
      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    });

    it("falls back to a download type when the stored type is empty", async () => {
      storedObject("", 3);
      const res = await serve(VIDEO_KEY, { range: "bytes=0-1" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(res.headers.get("Accept-Ranges")).toBeNull();
    });

    it("never takes a type from the object prototype for odd extensions", async () => {
      storedObject("image/png", 3);
      for (const name of ["x.constructor", "x.__proto__", "x.hasOwnProperty"]) {
        const res = await serve(["media", name]);
        expect(res.status, name).toBe(200);
        expect(res.headers.get("Content-Type"), name).toBe("image/png");
      }
    });

    it("keeps key checks and the rate limit ahead of any range work", async () => {
      storedObject("video/mp4");
      const invalid = await serve(["private", "3f2a9c1e-1b2c-4d5e-8f90-123456789abc"], {
        range: "bytes=0-1",
      });
      expect(invalid.status).toBe(400);
      const traversal = await serve(["media", "..", "secret"], { range: "bytes=0-1" });
      expect(traversal.status).toBe(400);

      mockCheckLocalRateLimit.mockReturnValueOnce({ limited: true, retryAfter: 30 });
      const limited = await serve(VIDEO_KEY, { range: "bytes=0-1" });
      expect(limited.status).toBe(429);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("R2 binding path", () => {
    function bindingWith(contentType: string, size = SIZE) {
      const head = vi.fn().mockResolvedValue({
        key: VIDEO_KEY.join("/"),
        size,
        etag: "etag-r2",
        httpMetadata: { contentType },
      });
      const get = vi.fn().mockImplementation(async () => ({
        key: VIDEO_KEY.join("/"),
        size,
        etag: "etag-r2",
        httpMetadata: { contentType },
        body: new ReadableStream(),
        arrayBuffer: vi.fn(),
      }));
      vi.stubGlobal("env", { PUBLIC_BUCKET: { head, get } });
      return { head, get };
    }

    it("reads only the requested bytes from R2", async () => {
      const { get } = bindingWith("video/mp4");
      const res = await serve(VIDEO_KEY, { range: "bytes=0-1023" });

      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe(`bytes 0-1023/${SIZE}`);
      expect(res.headers.get("Content-Length")).toBe("1024");
      expect(res.headers.get("Content-Type")).toBe("video/mp4");
      expect(get).toHaveBeenCalledWith(VIDEO_KEY.join("/"), {
        range: { offset: 0, length: 1024 },
      });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("turns a suffix range into an offset and length", async () => {
      const { get } = bindingWith("video/webm");
      const res = await serve(VIDEO_KEY, { range: "bytes=-500" });
      expect(res.status).toBe(206);
      expect(get).toHaveBeenCalledWith(VIDEO_KEY.join("/"), {
        range: { offset: SIZE - 500, length: 500 },
      });
    });

    it("refuses an unsatisfiable range without reading the object", async () => {
      const { get } = bindingWith("video/mp4");
      const res = await serve(VIDEO_KEY, { range: `bytes=${SIZE + 1}-` });
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
      expect(get).not.toHaveBeenCalled();
    });

    it("streams a stored video whole with Accept-Ranges when no Range is sent", async () => {
      const { head, get } = bindingWith("video/mp4");
      const res = await serve(VIDEO_KEY);
      expect(res.status).toBe(200);
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(head).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledWith(VIDEO_KEY.join("/"));
    });

    it("serves a stored photo whole even when a range is asked for", async () => {
      const { get } = bindingWith("image/webp", 3);
      const res = await serve(VIDEO_KEY, { range: "bytes=0-1" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Accept-Ranges")).toBeNull();
      expect(get).toHaveBeenCalledWith(VIDEO_KEY.join("/"));
    });
  });

  describe("local foundation test copy", () => {
    const WEBM = [0x1a, 0x45, 0xdf, 0xa3, ...Array.from({ length: 60 }, (_, index) => index)];
    const JPEG = [0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 20 }, (_, index) => index)];
    let root: string;
    let restoreCwd: () => void;

    beforeEach(async () => {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      root = await fs.mkdtemp(path.join(os.tmpdir(), "vmz-media-range-"));
      const media = path.join(root, "public", "e2e-media", "media");
      await fs.mkdir(media, { recursive: true });
      await fs.writeFile(path.join(media, VIDEO_KEY[1]), Buffer.from(WEBM));
      await fs.writeFile(
        path.join(media, "11111111-2222-4333-8444-555555555555"),
        Buffer.from(JPEG)
      );
      const spy = vi.spyOn(process, "cwd").mockReturnValue(root);
      restoreCwd = () => spy.mockRestore();
      vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
      vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
      vi.stubEnv("FOUNDATION_PROJECT_REF", "local-foundation");
      vi.stubEnv("FOUNDATION_SUPABASE_URL", "http://127.0.0.1:55443");
    });

    afterEach(async () => {
      restoreCwd();
      vi.unstubAllEnvs();
      const fs = await import("node:fs/promises");
      await fs.rm(root, { recursive: true, force: true });
    });

    it("recognises a video by its bytes and answers byte ranges", async () => {
      const res = await serve(VIDEO_KEY, { range: "bytes=0-15" });
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Type")).toBe("video/webm");
      expect(res.headers.get("Content-Range")).toBe(`bytes 0-15/${WEBM.length}`);
      expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(WEBM.slice(0, 16));

      const tail = await serve(VIDEO_KEY, { range: "bytes=-4" });
      expect(Array.from(new Uint8Array(await tail.arrayBuffer()))).toEqual(WEBM.slice(-4));

      const refused = await serve(VIDEO_KEY, { range: `bytes=${WEBM.length}-` });
      expect(refused.status).toBe(416);
      expect(refused.headers.get("Content-Range")).toBe(`bytes */${WEBM.length}`);

      const whole = await serve(VIDEO_KEY);
      expect(whole.status).toBe(200);
      expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("serves a photo whole with its own type", async () => {
      const res = await serve(["media", "11111111-2222-4333-8444-555555555555"], {
        range: "bytes=0-1",
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Accept-Ranges")).toBeNull();
    });
  });
});
