import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as uploadMedia } from "@/app/api/media/upload/route";
import { createClient } from "@/lib/supabase/server";
import { type NextRequest } from "next/server";
import { uploadToR2 } from "@/lib/services/storage";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/services/storage", () => ({
  generateStorageKey: vi.fn().mockReturnValue("mock-key"),
  uploadToR2: vi.fn(),
}));

function createFormDataRequest(files: File[]) {
  const formData = new FormData();
  formData.append("area", "listing");
  files.forEach((file) => formData.append("files", file));

  return {
    formData: async () => formData,
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
  });

  describe("POST /api/media/upload", () => {
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
  });
});
