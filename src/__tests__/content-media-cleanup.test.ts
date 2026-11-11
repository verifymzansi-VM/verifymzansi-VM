import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent, mockCheckRateLimit } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
    mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  }));

const mockDeleteOwned = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("@/lib/content/delete-owned", () => ({ deleteOwnedContent: mockDeleteOwned }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  checkLocalRateLimit: vi.fn().mockReturnValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/utils/api", () => ({
  parseAndValidateRouteParams: vi.fn(
    (
      params: unknown,
      schema: {
        safeParse: (value: unknown) => { success: boolean; data?: unknown };
      }
    ) => {
      const parsed = schema.safeParse(params);
      if (!parsed.success) {
        return {
          success: false as const,
          response: NextResponse.json({ error: "Invalid route params" }, { status: 400 }),
        };
      }

      return {
        success: true as const,
        data: parsed.data,
      };
    }
  ),
}));

import { DELETE as deleteBusiness } from "@/app/api/businesses/[id]/route";

const USER_ID = "user-1";
const VALID_UUID = "00000000-0000-0000-0000-000000000001";

function createRequest(url: string, method: string, body?: unknown): NextRequest {
  return {
    method,
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
  } as unknown as NextRequest;
}

/**
 * Expand an expected cleanup-row array to include the derived responsive
 * variant rows for image keys. queuePublicMediaCleanup now queues each image's
 * `.w400/.w800/.w1600.webp` variants alongside the original so they are
 * deleted together; videos and non-images are unchanged. Order matches the
 * implementation: each image key is immediately followed by its variants.
 */
const VARIANT_WIDTHS = [400, 800, 1600] as const;
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

function withVariants(
  rows: Array<{ bucket: string; r2_key: string; reason: string }>
): Array<{ bucket: string; r2_key: string; reason: string }> {
  return rows.flatMap((row) => {
    const ext = row.r2_key.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTS.has(ext) || /\.w\d+\.webp$/.test(row.r2_key)) return [row];
    const stem = row.r2_key.slice(0, row.r2_key.lastIndexOf("."));
    return [
      row,
      ...VARIANT_WIDTHS.map((w) => ({
        bucket: row.bucket,
        r2_key: `${stem}.w${w}.webp`,
        reason: row.reason,
      })),
    ];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOwnerColumnCacheForTesting();
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, email: "seller@example.com" } },
      }),
    },
  });
  mockCheckRateLimit.mockResolvedValue({ limited: false });
});

function createAuthenticatedClient(from?: (table: string) => unknown) {
  return {
    ...(from ? { from: vi.fn(from) } : {}),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, email: "seller@example.com" } },
      }),
    },
  };
}

function createOwnerColumnSelect(base: Record<string, unknown>) {
  return vi.fn((fields?: string) => {
    if (fields === "id, owner_id") {
      return {
        limit: vi.fn().mockResolvedValue({ error: null }),
      };
    }

    return base;
  });
}

/**
 * Models `admin.from("media_uploads").select("r2_key").eq("user_id", ...).in("r2_key", keys)`.
 * queuePublicMediaCleanup only queues keys the content owner uploaded; this
 * double reports every requested key as owned by the queried user.
 */
function createOwnedMediaUploads() {
  const inFn = vi.fn(async (_column: string, keys: string[]) => ({
    data: keys.map((r2_key) => ({ r2_key })),
    error: null,
  }));
  const eq = vi.fn().mockReturnValue({ in: inFn });
  const select = vi.fn().mockReturnValue({ eq });
  return { table: { select }, select, eq, in: inFn };
}

// DELETE /api/businesses/[id] has no foundation path yet: it still runs the
// retired backend's owner delete (src/app/api/_lib/create-owned-content-delete-route.ts).
describe("business delete media cleanup queueing", () => {
  it("returns 404 when the user does not own the business being deleted", async () => {
    mockCreateClient.mockResolvedValue(
      createAuthenticatedClient((table: string) => {
        if (table === "businesses") {
          const builder = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          };
          return {
            ...builder,
            select: createOwnerColumnSelect(builder),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      })
    );

    const res = await deleteBusiness(
      createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}`, "DELETE"),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(res.status).toBe(404);
  });

  it("queues deleted business media after a successful delete", async () => {
    const queueInsert = vi.fn().mockResolvedValue({ error: null });
    const ownedMedia = createOwnedMediaUploads();
    mockCreateClient.mockResolvedValue(
      createAuthenticatedClient((table: string) => {
        if (table === "businesses") {
          const builder = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: VALID_UUID,
                owner_id: USER_ID,
                status: "draft",
                logo_url: "https://media.verifymzansi.com/business/logo.jpg",
                cover_photo: "https://media.verifymzansi.com/business/cover.jpg",
                cover_video: "https://media.verifymzansi.com/business/cover.mp4",
                video_thumbnail: "https://media.verifymzansi.com/business/thumb.jpg",
                gallery_photos: ["https://media.verifymzansi.com/business/gallery-1.jpg"],
              },
            }),
            // delete → eq(id) → eq(owner) → select("id") reports the deleted row.
            delete: vi.fn().mockReturnValue(
              (() => {
                const chain = {
                  eq: vi.fn(),
                  select: vi.fn().mockResolvedValue({ data: [{ id: VALID_UUID }], error: null }),
                };
                chain.eq.mockReturnValue(chain);
                return chain;
              })()
            ),
          };
          return {
            ...builder,
            select: createOwnerColumnSelect(builder),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      })
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: queueInsert };
        }
        if (table === "media_uploads") {
          return ownedMedia.table;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await deleteBusiness(
      createRequest(`http://localhost:3000/api/businesses/${VALID_UUID}`, "DELETE"),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );

    expect(await res.json()).toEqual({ success: true });
    // Only media the content owner uploaded is eligible for cleanup.
    expect(ownedMedia.select).toHaveBeenCalledWith("r2_key");
    expect(ownedMedia.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(queueInsert).toHaveBeenCalledWith(
      withVariants([
        {
          bucket: "public",
          r2_key: "business/logo.jpg",
          reason: "business_deleted",
        },
        {
          bucket: "public",
          r2_key: "business/cover.jpg",
          reason: "business_deleted",
        },
        {
          bucket: "public",
          r2_key: "business/cover.mp4",
          reason: "business_deleted",
        },
        {
          bucket: "public",
          r2_key: "business/thumb.jpg",
          reason: "business_deleted",
        },
        {
          bucket: "public",
          r2_key: "business/gallery-1.jpg",
          reason: "business_deleted",
        },
      ])
    );
  });
});
