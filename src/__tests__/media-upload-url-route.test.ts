import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockGenerateStorageKey,
  mockGeneratePresignedUploadUrl,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGenerateStorageKey: vi.fn(),
  mockGeneratePresignedUploadUrl: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/services/storage", () => ({
  generateStorageKey: mockGenerateStorageKey,
  generatePresignedUploadUrl: mockGeneratePresignedUploadUrl,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { POST } from "@/app/api/media/upload-url/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/media/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGenerateStorageKey.mockReturnValue("media/listing/user-1/video.mp4");
    mockGeneratePresignedUploadUrl.mockResolvedValue("https://upload.example.com/signed");
  });

  it("rate limits abusive callers", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 90 });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await POST(
      createRequest({
        filename: "clip.mp4",
        contentType: "video/mp4",
        size: 1024,
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("90");
  });

  it("returns a safe profile lookup failure", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "permission denied" },
        }),
      }),
    });

    const res = await POST(
      createRequest({
        filename: "clip.mp4",
        contentType: "video/mp4",
        size: 1024,
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to verify account profile" });
  });

  it("validates upload-url request bodies", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
      }),
    });

    const res = await POST(
      createRequest({
        filename: "",
        contentType: "text/plain",
        size: -1,
        area: "invalid",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("rejects filename and content-type mismatches", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
      }),
    });

    const res = await POST(
      createRequest({
        filename: "clip.mov",
        contentType: "video/mp4",
        size: 2048,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toEqual(
      expect.objectContaining({
        filename: "filename extension must match video/mp4",
      })
    );
  });

  it("rejects unsupported quicktime uploads", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
      }),
    });

    const res = await POST(
      createRequest({
        filename: "clip.mov",
        contentType: "video/quicktime",
        size: 2048,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("video/mp4, video/webm");
  });

  it("rejects dangerous filename characters", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
      }),
    });

    const res = await POST(
      createRequest({
        filename: "../clip.mp4",
        contentType: "video/mp4",
        size: 2048,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toEqual(
      expect.objectContaining({
        filename: "filename contains invalid characters",
      })
    );
  });

  it("returns a signed upload URL for valid requests", async () => {
    process.env.R2_PUBLIC_URL = "https://media.verifymzansi.com";
    const insert = vi.fn().mockResolvedValue({ error: null });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn((table: string) => {
        if (table === "media_uploads") {
          return { insert };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
        };
      }),
    });

    const res = await POST(
      createRequest({
        filename: "clip.mp4",
        contentType: "video/mp4",
        size: 2048,
        area: "listing_video",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      uploadUrl: "https://upload.example.com/signed",
      key: "media/listing/user-1/video.mp4",
      publicUrl: "https://media.verifymzansi.com/media/listing/user-1/video.mp4",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        r2_key: "media/listing/user-1/video.mp4",
        url: "https://media.verifymzansi.com/media/listing/user-1/video.mp4",
        content_type: "video/mp4",
        file_size: 2048,
        area: "listing_video",
      })
    );
  });
});
