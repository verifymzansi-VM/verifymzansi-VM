import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockGetR2ObjectBytes,
  mockDeleteFromR2,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockGetR2ObjectBytes: vi.fn(),
  mockDeleteFromR2: vi.fn(),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/storage", () => ({
  getR2ObjectBytes: mockGetR2ObjectBytes,
  deleteFromR2: mockDeleteFromR2,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn(() => null),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

import { POST } from "@/app/api/media/upload-complete/route";

const MP4_HEADER = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
]);

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    url: "http://localhost:3000/api/media/upload-complete",
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

function mockTrackedUpload(overrides: Record<string, unknown> = {}) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          bucket: "verifymzansi-public",
          r2_key: "media/listing/user-1/clip.mp4",
          url: "https://media.example.com/media/listing/user-1/clip.mp4",
          content_type: "video/mp4",
          file_size: MP4_HEADER.byteLength,
          area: "listing",
          ...overrides,
        },
        error: null,
      }),
    }),
  });
}

describe("POST /api/media/upload-complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockDeleteFromR2.mockResolvedValue(undefined);
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a direct R2 upload after verifying the stored object", async () => {
    mockTrackedUpload();
    mockGetR2ObjectBytes.mockResolvedValue({
      bytes: MP4_HEADER,
      contentType: "video/mp4",
      contentLength: MP4_HEADER.byteLength,
    });

    const res = await POST(
      createRequest({
        key: "media/listing/user-1/clip.mp4",
        publicUrl: "https://media.example.com/media/listing/user-1/clip.mp4",
        contentType: "video/mp4",
        size: MP4_HEADER.byteLength,
        area: "listing",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      publicUrl: "https://media.example.com/media/listing/user-1/clip.mp4",
    });
    expect(mockDeleteFromR2).not.toHaveBeenCalled();
  });

  it("rejects and cleans up when the request does not match the tracking row", async () => {
    mockTrackedUpload(); // tracking row declares video/mp4

    const res = await POST(
      createRequest({
        key: "media/listing/user-1/clip.mp4",
        publicUrl: "https://media.example.com/media/listing/user-1/clip.mp4",
        contentType: "video/webm",
        size: MP4_HEADER.byteLength,
        area: "listing",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "upload_metadata_mismatch",
    });
    expect(mockDeleteFromR2).toHaveBeenCalledWith(
      "verifymzansi-public",
      "media/listing/user-1/clip.mp4"
    );
    expect(mockGetR2ObjectBytes).not.toHaveBeenCalled();
  });

  it("rejects and cleans up direct uploads with invalid video bytes", async () => {
    mockTrackedUpload({ file_size: 12 });
    mockGetR2ObjectBytes.mockResolvedValue({
      bytes: new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
      contentType: "video/mp4",
      contentLength: 12,
    });

    const res = await POST(
      createRequest({
        key: "media/listing/user-1/clip.mp4",
        publicUrl: "https://media.example.com/media/listing/user-1/clip.mp4",
        contentType: "video/mp4",
        size: 12,
        area: "listing",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "uploaded_object_mime_mismatch",
    });
    expect(mockDeleteFromR2).toHaveBeenCalledWith(
      "verifymzansi-public",
      "media/listing/user-1/clip.mp4"
    );
  });

  it("rejects and cleans up direct uploads when bytes do not match declared type", async () => {
    mockTrackedUpload({ file_size: 12 });
    mockGetR2ObjectBytes.mockResolvedValue({
      bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]),
      contentType: "video/mp4",
      contentLength: 12,
    });

    const res = await POST(
      createRequest({
        key: "media/listing/user-1/clip.mp4",
        publicUrl: "https://media.example.com/media/listing/user-1/clip.mp4",
        contentType: "video/mp4",
        size: 12,
        area: "listing",
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "uploaded_object_mime_mismatch",
    });
    expect(mockDeleteFromR2).toHaveBeenCalledWith(
      "verifymzansi-public",
      "media/listing/user-1/clip.mp4"
    );
  });
});
