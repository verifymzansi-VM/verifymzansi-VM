import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckRateLimit,
  mockStripExifFromJpeg,
  mockStripMetadataFromPng,
  mockStripMetadataFromWebp,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  mockStripExifFromJpeg: vi.fn((buf: Uint8Array) => buf),
  mockStripMetadataFromPng: vi.fn((buf: Uint8Array) => buf),
  mockStripMetadataFromWebp: vi.fn((buf: Uint8Array) => buf),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/file-validation", () => ({
  validateBufferIntegrity: vi.fn(() => ({
    valid: true,
    detectedMime: "image/png",
    mismatch: false,
  })),
}));
vi.mock("@/lib/utils/malware-scan", () => ({
  scanForMalware: vi.fn(() => ({ safe: true })),
}));
vi.mock("@/lib/utils/exif-strip", () => ({
  stripExifFromJpeg: mockStripExifFromJpeg,
  stripMetadataFromPng: mockStripMetadataFromPng,
  stripMetadataFromWebp: mockStripMetadataFromWebp,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: vi.fn().mockReturnValue(null) }));

import { POST } from "@/app/api/profile/avatar/route";

function createRequest(formData: FormData, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    formData: async () => formData,
    url: "http://localhost:3000/api/profile/avatar",
    nextUrl: new URL("http://localhost:3000/api/profile/avatar"),
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/profile/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
  });

  it("rejects cross-site avatar uploads", async () => {
    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.png", { type: "image/png" }));

    const res = await POST(createRequest(formData, { origin: "https://evil.example" }));

    expect(res.status).toBe(403);
  });

  it("rejects unsupported file types", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.txt", { type: "text/plain" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(400);
  });

  it("rate limits authenticated avatar uploads by user id", async () => {
    mockCheckRateLimit
      .mockResolvedValueOnce({ limited: false })
      .mockResolvedValueOnce({ limited: true, retryAfter: 30 });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.png", { type: "image/png" }));

    const res = await POST(createRequest(formData));

    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(1, {
      key: "127.0.0.1",
      action: "profile:avatar",
    });
    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(2, {
      key: "user-1",
      action: "profile:avatar",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("uploads and persists the avatar URL", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.png" },
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({ update }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          upload,
          remove,
          getPublicUrl,
        }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.png", { type: "image/png" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(200);
    expect(mockCheckRateLimit).toHaveBeenNthCalledWith(2, {
      key: "user-1",
      action: "profile:avatar",
    });
    expect(upload).toHaveBeenCalled();
    // PNG metadata must be stripped before upload
    expect(mockStripMetadataFromPng).toHaveBeenCalled();
    // Stale variants with other extensions are cleaned up best-effort
    expect(remove).toHaveBeenCalledWith(["user-1/avatar.jpg", "user-1/avatar.webp"]);
    // The persisted URL carries a cache-busting version param
    expect(update).toHaveBeenCalledWith({
      avatar_url: expect.stringMatching(/^https:\/\/cdn\.example\.com\/avatar\.png\?v=\d+$/),
    });
    expect(updateEq).toHaveBeenCalledWith("user_id", "user-1");
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      avatarUrl: expect.stringContaining("?v="),
    });
  });

  it("strips EXIF from JPEG avatars and removes stale png/webp variants", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.jpg" },
    });
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({ update }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          upload,
          remove,
          getPublicUrl,
        }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.jpg", { type: "image/jpeg" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(200);
    expect(mockStripExifFromJpeg).toHaveBeenCalled();
    expect(mockStripMetadataFromPng).not.toHaveBeenCalled();
    expect(mockStripMetadataFromWebp).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(["user-1/avatar.png", "user-1/avatar.webp"]);
  });

  it("strips metadata from WebP avatars", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.webp" },
    });
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({ update }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          upload,
          remove,
          getPublicUrl,
        }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.webp", { type: "image/webp" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(200);
    expect(mockStripMetadataFromWebp).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(["user-1/avatar.jpg", "user-1/avatar.png"]);
  });
});
