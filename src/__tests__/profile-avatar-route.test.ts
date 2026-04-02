import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
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
  stripExifFromJpeg: vi.fn((buf: Uint8Array) => buf),
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

  it("uploads and persists the avatar URL", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.png" },
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: updateEq,
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          upload,
          getPublicUrl,
        }),
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["hello"], "avatar.png", { type: "image/png" }));

    const res = await POST(createRequest(formData));

    expect(res.status).toBe(200);
    expect(upload).toHaveBeenCalled();
    expect(updateEq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
