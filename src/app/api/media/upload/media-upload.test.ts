import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as uploadMedia } from "@/app/api/media/upload/route";
import { createClient } from "@/lib/supabase/server";
import { type NextRequest } from "next/server";
import { uploadToR2 } from "@/lib/services/storage";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/services/storage", () => ({
  generateStorageKey: vi.fn().mockReturnValue("mock-key"),
  uploadToR2: vi.fn(),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

function createFormDataRequest(files: File[], headers: Record<string, string> = {}) {
  const formData = new FormData();
  formData.append("area", "listing");
  files.forEach((file) => formData.append("files", file));

  return {
    formData: async () => formData,
    url: "http://localhost:3000/api/media/upload",
    nextUrl: new URL("http://localhost:3000/api/media/upload"),
    headers: {
      get: vi.fn((name: string) => {
        const normalizedName = name.toLowerCase();
        if (normalizedName in headers) {
          return headers[normalizedName];
        }

        if (normalizedName === "x-forwarded-for" || normalizedName === "x-real-ip") {
          return "127.0.0.1";
        }

        return null;
      }),
    },
  } as unknown as NextRequest;
}

/** Build a minimal WebP (RIFF) buffer with a VP8X chunk and an EXIF chunk. */
function buildWebpWithExif(): Uint8Array<ArrayBuffer> {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const chunks: number[] = [];
  const pushChunk = (type: string, data: number[]) => {
    chunks.push(...ascii(type));
    const len = data.length;
    chunks.push(len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >>> 24) & 0xff);
    chunks.push(...data);
    if (len % 2 === 1) chunks.push(0); // chunks are padded to even sizes
  };

  pushChunk("VP8X", [0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // flags: EXIF present
  pushChunk("EXIF", [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  pushChunk("VP8 ", [0x01, 0x02, 0x03, 0x04]); // fake image payload

  const body = [0x57, 0x45, 0x42, 0x50, ...chunks]; // "WEBP"
  const riffSize = body.length;
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    riffSize & 0xff,
    (riffSize >> 8) & 0xff,
    (riffSize >> 16) & 0xff,
    (riffSize >>> 24) & 0xff,
    ...body,
  ]);
}

describe("Media Upload Routes", () => {
  const mockSupabase = {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  });

  describe("POST /api/media/upload", () => {
    it("rejects unauthenticated uploads", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

      const res = await uploadMedia(createFormDataRequest([]));

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    });

    it("rejects cross-site upload attempts", async () => {
      const res = await uploadMedia(
        createFormDataRequest([], {
          origin: "https://evil.example",
        })
      );

      expect(res.status).toBe(403);
    });

    it("rate limits upload bursts", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 42 });

      const res = await uploadMedia(createFormDataRequest([]));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
    });

    it("should successfully upload valid files", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "media_uploads") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
        };
      });

      // Create a file with valid JPEG magic bytes (0xFF, 0xD8, 0xFF)
      const jpegHeader = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const file = new File([jpegHeader], "test.jpg", { type: "image/jpeg" });
      const req = createFormDataRequest([file]);

      vi.mocked(uploadToR2).mockResolvedValue({ url: "https://example.com/test.jpg" } as never);

      const res = await uploadMedia(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.urls).toEqual(["https://example.com/test.jpg"]);
    });

    it("rejects invalid upload areas", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
      });

      const formData = new FormData();
      formData.append("area", "bad-area");
      formData.append(
        "files",
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "test.jpg", { type: "image/jpeg" })
      );

      const req = {
        formData: async () => formData,
        url: "http://localhost:3000/api/media/upload",
        nextUrl: new URL("http://localhost:3000/api/media/upload"),
        headers: {
          get: vi.fn((name: string) =>
            name.toLowerCase() === "x-forwarded-for" ? "127.0.0.1" : null
          ),
        },
      } as unknown as NextRequest;

      const res = await uploadMedia(req);

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: expect.stringContaining("Invalid area. Must be one of:"),
      });
    });

    it("rejects empty uploads after filtering zero-byte files", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
      });

      const req = createFormDataRequest([new File([], "empty.jpg", { type: "image/jpeg" })]);
      const res = await uploadMedia(req);

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "No files provided" });
    });

    it("should block uploads exceeding MAX_FILES limits", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
      });

      const files = Array(11).fill(new File(["dummy content"], "test.jpg", { type: "image/jpeg" }));
      const req = createFormDataRequest(files);

      const res = await uploadMedia(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Maximum of 10 files allowed per upload");
    });

    it("returns per-file validation errors for unsupported uploads", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
      });

      const file = new File(["hello"], "test.txt", { type: "text/plain" });
      const res = await uploadMedia(createFormDataRequest([file]));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.urls).toEqual([]);
      expect(data.errors).toEqual(['"test.txt": unsupported file type']);
    });

    it("rejects mp4 uploads whose bytes are QuickTime/MOV", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "media_uploads") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
        };
      });

      const quickTimeHeader = new Uint8Array([
        0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
      ]);
      const file = new File([quickTimeHeader], "clip.mp4", { type: "video/mp4" });
      const res = await uploadMedia(createFormDataRequest([file]));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.errors).toEqual(['"clip.mp4": file content does not match declared video type']);
      expect(uploadToR2).not.toHaveBeenCalled();
    });

    it("rejects images whose bytes are a different image type", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "media_uploads") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
        };
      });

      // GIF89a magic bytes but declared (and extension-matched) as PNG —
      // cross-type image mismatches must be rejected just like videos.
      const gifHeader = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
      ]);
      const file = new File([gifHeader], "photo.png", { type: "image/png" });
      const res = await uploadMedia(createFormDataRequest([file]));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.errors).toEqual(['"photo.png": file content does not match declared type']);
      expect(uploadToR2).not.toHaveBeenCalled();
    });

    it("strips WebP EXIF chunks and records the post-strip size", async () => {
      const insert = vi.fn().mockResolvedValue({ error: null });
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "media_uploads") {
          return { insert };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
        };
      });

      const webpBytes = buildWebpWithExif();
      const file = new File([webpBytes], "photo.webp", { type: "image/webp" });
      vi.mocked(uploadToR2).mockResolvedValue({ url: "https://example.com/photo.webp" } as never);

      const res = await uploadMedia(createFormDataRequest([file]));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // The stored blob must be smaller than the original (EXIF chunk removed)
      const uploadArg = vi.mocked(uploadToR2).mock.calls[0][0] as unknown as {
        file: Blob;
        contentType: string;
      };
      expect(uploadArg.contentType).toBe("image/webp");
      const strippedSize = uploadArg.file.size;
      expect(strippedSize).toBeLessThan(webpBytes.byteLength);

      // Tracking row must record the post-strip size, not the client size
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_type: "image/webp",
          file_size: strippedSize,
        })
      );
    });
  });
});
