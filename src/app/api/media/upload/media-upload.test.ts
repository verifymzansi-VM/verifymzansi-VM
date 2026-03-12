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

function createFormDataRequest(files: File[]) {
  const formData = new FormData();
  formData.append("area", "listing");
  files.forEach((file) => formData.append("files", file));

  return {
    formData: async () => formData,
    headers: { get: vi.fn().mockReturnValue("127.0.0.1") },
  } as unknown as NextRequest;
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

    it("rate limits upload bursts", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 42 });

      const res = await uploadMedia(createFormDataRequest([]));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
    });

    it("should successfully upload valid files", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
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
        single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
      });

      const formData = new FormData();
      formData.append("area", "bad-area");
      formData.append(
        "files",
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "test.jpg", { type: "image/jpeg" })
      );

      const req = {
        formData: async () => formData,
        headers: { get: vi.fn().mockReturnValue("127.0.0.1") },
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
        single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
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
        single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
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
        single: vi.fn().mockResolvedValue({ data: { id: "profile-1" } }),
      });

      const file = new File(["hello"], "test.txt", { type: "text/plain" });
      const res = await uploadMedia(createFormDataRequest([file]));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.urls).toEqual([]);
      expect(data.errors).toEqual(['"test.txt": unsupported file type']);
    });
  });
});
