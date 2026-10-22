import type * as ImageReencodeModule from "@/lib/utils/image-reencode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit, mockReencodeImage, mockWarn } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
    mockReencodeImage: vi.fn(async (buf: Uint8Array) => buf),
    mockWarn: vi.fn(),
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
vi.mock("@/lib/utils/image-reencode", async (importOriginal) => ({
  ...(await importOriginal<typeof ImageReencodeModule>()),
  reencodeImage: mockReencodeImage,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: mockWarn, error: vi.fn() }),
}));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: vi.fn().mockReturnValue(null) }));

import { POST } from "@/app/api/profile/avatar/route";
import { ImageReencodeError } from "@/lib/utils/image-reencode";

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

  it("rejects an oversized streamed body with a false length before storage", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    const request = createRequest(new FormData(), {
      "content-type": "multipart/form-data; boundary=b",
      "content-length": "1",
    });
    const cancel = vi.fn();
    Object.defineProperty(request, "body", {
      value: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(3 * 1024 * 1024));
        },
        cancel,
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
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

  it.each([null, { message: "storage unavailable" }])(
    "uploads and persists the avatar URL with cleanup error %j",
    async (cleanupError) => {
      const upload = vi.fn().mockResolvedValue({ error: null });
      const remove = vi.fn().mockResolvedValue({ data: [], error: cleanupError });
      const getPublicUrl = vi.fn().mockReturnValue({
        data: { publicUrl: "https://cdn.example.com/avatar.png" },
      });
      const updateEq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq: updateEq });
      const userScopedFrom = vi.fn();
      const adminFrom = vi.fn().mockReturnValue({ update });

      mockCreateClient.mockResolvedValue({
        from: userScopedFrom,
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        },
      });
      // The avatar_url profile write goes through the admin client.
      mockCreateAdminClient.mockReturnValue({
        from: adminFrom,
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
      // The PNG is re-encoded (metadata and hidden bytes dropped) before upload
      expect(mockReencodeImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png");
      // Stale variants with other extensions are cleaned up best-effort
      expect(remove).toHaveBeenCalledWith(["user-1/avatar.jpg", "user-1/avatar.webp"]);
      expect(updateEq.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
      if (cleanupError)
        expect(mockWarn).toHaveBeenCalledWith(
          "Failed to remove stale avatar variants",
          expect.objectContaining({ error: cleanupError.message })
        );
      // The persisted URL carries a cache-busting version param
      expect(update).toHaveBeenCalledWith({
        avatar_url: expect.stringMatching(/^https:\/\/cdn\.example\.com\/avatar\.png\?v=\d+$/),
      });
      expect(updateEq).toHaveBeenCalledWith("user_id", "user-1");
      expect(adminFrom).toHaveBeenCalledWith("account_profiles");
      expect(userScopedFrom).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        avatarUrl: expect.stringContaining("?v="),
      });
    }
  );

  it("returns 500 when the admin avatar_url write fails", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: "db down" } }),
    });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ error: null }),
          remove,
          getPublicUrl: vi.fn().mockReturnValue({
            data: { publicUrl: "https://cdn.example.com/avatar.png" },
          }),
        }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.png", { type: "image/png" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Failed to save avatar" });
    expect(update).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("re-encodes JPEG avatars and removes stale png/webp variants", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.jpg" },
    });
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
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
    expect(mockReencodeImage).toHaveBeenCalledTimes(1);
    expect(mockReencodeImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/jpeg");
    expect(remove).toHaveBeenCalledWith(["user-1/avatar.png", "user-1/avatar.webp"]);
    expect(update).toHaveBeenCalledWith({ avatar_url: expect.stringContaining("avatar.jpg?v=") });
  });

  it("re-encodes WebP avatars", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.webp" },
    });
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
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
    expect(mockReencodeImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/webp");
    expect(remove).toHaveBeenCalledWith(["user-1/avatar.jpg", "user-1/avatar.png"]);
    expect(update).toHaveBeenCalledWith({ avatar_url: expect.stringContaining("avatar.webp?v=") });
  });

  it.each([
    ["unavailable", 503],
    ["undecodable", 400],
  ] as const)("refuses the avatar when re-encoding is %s", async (code, status) => {
    const upload = vi.fn();
    mockReencodeImage.mockRejectedValueOnce(new ImageReencodeError(code, "failed"));
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      storage: { from: vi.fn().mockReturnValue({ upload }) },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.png", { type: "image/png" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(status);
    expect(upload).not.toHaveBeenCalled();
  });
});
