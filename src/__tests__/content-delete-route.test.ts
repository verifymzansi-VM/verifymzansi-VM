import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: vi.fn().mockReturnValue(null) }));

import { POST } from "@/app/api/content/delete/route";
import { resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const ITEM_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

/**
 * Models `.delete().eq("id", ...).eq(ownerColumn, ...).select("id")`. The
 * route selects the deleted ids so it can detect RLS silently skipping the row.
 */
function createDeleteChain(deletedRows: Array<{ id: string }> = [{ id: ITEM_ID }]) {
  const select = vi.fn().mockResolvedValue({ data: deletedRows, error: null });
  const chain = { eq: vi.fn(), select };
  chain.eq.mockReturnValue(chain);
  return chain;
}

/** Models `admin.from("media_uploads").select("r2_key").eq("user_id", ...).in("r2_key", ...)`. */
function createOwnedMediaQuery(ownedKeys: string[]) {
  const inFn = vi.fn().mockResolvedValue({
    data: ownedKeys.map((r2_key) => ({ r2_key })),
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ in: inFn });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, in: inFn };
}

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/content/delete",
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? headers[name] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/content/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOwnerColumnCacheForTesting();
  });

  it("rejects cross-site delete attempts", async () => {
    const res = await POST(
      createRequest(
        {
          itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          area: "MZANSI_MARKET",
        },
        { origin: "https://evil.example" }
      )
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when the item cannot be found", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when the item belongs to a different owner", async () => {
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "listing-1", status: "live", owner_id: "user-2" },
          error: null,
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(403);
  });

  it("deletes owned content successfully", async () => {
    const deleteChain = createDeleteChain();
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "live", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(200);
    expect(deleteChain.eq).toHaveBeenCalledWith("id", ITEM_ID);
    expect(deleteChain.eq).toHaveBeenCalledWith("owner_id", "user-1");
    expect(deleteChain.select).toHaveBeenCalledWith("id");
    expect(mockLogAuditEvent).toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("returns 409 when row-level security deletes zero rows", async () => {
    const deleteChain = createDeleteChain([]);
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "listing-1",
              status: "live",
              owner_id: "user-1",
              photos: ["https://media.verifymzansi.com/media/listing/user-1/photo.jpg"],
            },
            error: null,
          }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await POST(createRequest({ itemId: ITEM_ID, area: "MZANSI_MARKET" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "This post cannot be deleted in its current state",
      code: "CONTENT_STATE",
    });
    expect(deleteChain.select).toHaveBeenCalledWith("id");
    // Nothing was deleted, so no media cleanup, claim release, or audit event.
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("queues public media cleanup when a user deletes a post", async () => {
    const cleanupInsert = vi.fn().mockResolvedValue({ error: null });
    const deleteChain = createDeleteChain();
    const ownedMedia = createOwnedMediaQuery([
      "media/listing/user-1/photo.jpg",
      "media/listing/user-1/video.mp4",
      "media/listing/user-1/thumb.jpg",
      "media/listing/user-1/logo.jpg",
    ]);
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "listing-1",
              status: "ended",
              owner_id: "user-1",
              photos: [
                "https://media.verifymzansi.com/media/listing/user-1/photo.jpg",
                "https://example.com/not-platform.jpg",
              ],
              videos: ["https://media.verifymzansi.com/media/listing/user-1/video.mp4"],
              video_thumbnail: "https://media.verifymzansi.com/media/listing/user-1/thumb.jpg",
              logo_url: "https://media.verifymzansi.com/media/listing/user-1/logo.jpg",
            },
            error: null,
          }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: cleanupInsert };
        }
        if (table === "media_uploads") {
          return { select: ownedMedia.select };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(200);

    // Cleanup is scoped to media the deleting owner actually uploaded.
    expect(ownedMedia.select).toHaveBeenCalledWith("r2_key");
    expect(ownedMedia.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(ownedMedia.in).toHaveBeenCalledWith(
      "r2_key",
      expect.arrayContaining([
        "media/listing/user-1/photo.jpg",
        "media/listing/user-1/video.mp4",
        "media/listing/user-1/thumb.jpg",
        "media/listing/user-1/logo.jpg",
      ])
    );

    // Raster images expand to their pre-generated responsive variants
    // (.w400/.w800/.w1600 .webp) so derived objects are cleaned up with the
    // original instead of leaking as orphans. Videos have no variants.
    const insertedRows = cleanupInsert.mock.calls[0]?.[0] as Array<{
      bucket: string;
      r2_key: string;
      reason: string;
    }>;
    const insertedKeys = insertedRows.map((row) => row.r2_key);

    const expectedOriginals = [
      "media/listing/user-1/photo.jpg",
      "media/listing/user-1/video.mp4",
      "media/listing/user-1/thumb.jpg",
      "media/listing/user-1/logo.jpg",
    ];
    for (const key of expectedOriginals) {
      expect(insertedKeys).toContain(key);
    }

    // Each raster original must also queue its three responsive variants.
    for (const raster of [
      "media/listing/user-1/photo.jpg",
      "media/listing/user-1/thumb.jpg",
      "media/listing/user-1/logo.jpg",
    ]) {
      const stem = raster.replace(/\.jpg$/, "");
      for (const width of [400, 800, 1600]) {
        expect(insertedKeys).toContain(`${stem}.w${width}.webp`);
      }
    }

    // The video must NOT expand to variants.
    expect(insertedKeys.filter((k) => k.startsWith("media/listing/user-1/video"))).toEqual([
      "media/listing/user-1/video.mp4",
    ]);

    // Every queued row is a public listing deletion.
    for (const row of insertedRows) {
      expect(row.bucket).toBe("public");
      expect(row.reason).toBe("listing_deleted");
    }
  });

  it("releases a rejected free-post claim after delete", async () => {
    const releaseMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "claim-1" },
      error: null,
    });
    const deleteChain = createDeleteChain();
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "rejected", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table === "free_posts_used") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                      select: vi.fn().mockReturnValue({
                        maybeSingle: releaseMaybeSingle,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(200);
    expect(mockCreateAdminClient().rpc).toHaveBeenCalledWith(
      "release_intro_trial",
      expect.objectContaining({ p_user_id: "user-1", p_reason: "rejected_deleted" })
    );
  });

  it("does not release a free-post claim for non-rejected deletes", async () => {
    const deleteChain = createDeleteChain();
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "live", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_MARKET",
      })
    );

    expect(res.status).toBe(200);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("deletes MZANSI_BUSINESS items using owner-column compatibility", async () => {
    const deleteChain = createDeleteChain();
    const releaseMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "claim-2" },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn((fields?: string) => {
            if (fields === "id, owner_id") {
              return {
                limit: vi.fn().mockResolvedValue({
                  error: { code: "42703", message: "column businesses.owner_id does not exist" },
                }),
              };
            }

            if (fields === "id, seller_id") {
              return {
                limit: vi.fn().mockResolvedValue({ error: null }),
              };
            }

            return {
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "business-1", status: "rejected", seller_id: "user-1" },
                error: null,
              }),
            };
          }),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "business-1", status: "rejected", seller_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table === "businesses") {
          return from(table);
        }
        if (table === "free_posts_used") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                      select: vi.fn().mockReturnValue({
                        maybeSingle: releaseMaybeSingle,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const res = await POST(
      createRequest({
        itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        area: "MZANSI_BUSINESS",
      })
    );

    expect(res.status).toBe(200);
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(deleteChain.eq).toHaveBeenCalledWith("seller_id", "user-1");
    expect(deleteChain.select).toHaveBeenCalledWith("id");
    expect(mockCreateAdminClient().rpc).toHaveBeenCalledWith(
      "release_intro_trial",
      expect.objectContaining({ p_user_id: "user-1", p_reason: "rejected_deleted" })
    );
  });

  it("only queues business_details.mall_photos for mall-store businesses", async () => {
    const cleanupInsert = vi.fn().mockResolvedValue({ error: null });
    const deleteChain = createDeleteChain();
    const ownedMedia = createOwnedMediaQuery([
      "media/business/user-1/logo.png",
      "media/business/user-1/mall-1.jpg",
    ]);
    const businessRow = {
      id: "business-1",
      status: "live",
      owner_id: "user-1",
      logo_url: "https://media.verifymzansi.com/media/business/user-1/logo.png",
      business_details: {
        type: "mall_store",
        mall_photos: [
          "https://media.verifymzansi.com/media/business/user-1/mall-1.jpg",
          // Referenced but uploaded by someone else: must not be queued.
          "https://media.verifymzansi.com/media/business/user-2/mall-2.jpg",
        ],
        // Arbitrary strings elsewhere in business_details are not media fields.
        menu_url: "https://media.verifymzansi.com/media/business/user-2/menu.jpg",
      },
    };
    const from = vi.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: businessRow, error: null }),
          delete: vi.fn().mockReturnValue(deleteChain),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateClient.mockResolvedValue({
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") return { insert: cleanupInsert };
        if (table === "media_uploads") return { select: ownedMedia.select };
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const res = await POST(createRequest({ itemId: ITEM_ID, area: "MZANSI_BUSINESS" }));

    expect(res.status).toBe(200);
    const candidateKeys = ownedMedia.in.mock.calls[0]?.[1] as string[];
    expect(candidateKeys).toEqual(
      expect.arrayContaining([
        "media/business/user-1/logo.png",
        "media/business/user-1/mall-1.jpg",
        "media/business/user-2/mall-2.jpg",
      ])
    );
    expect(candidateKeys).not.toContain("media/business/user-2/menu.jpg");
    expect(ownedMedia.eq).toHaveBeenCalledWith("user_id", "user-1");

    const insertedKeys = (cleanupInsert.mock.calls[0]?.[0] as Array<{ r2_key: string }>).map(
      (row) => row.r2_key
    );
    expect(insertedKeys).toContain("media/business/user-1/logo.png");
    expect(insertedKeys).toContain("media/business/user-1/mall-1.jpg");
    expect(insertedKeys.some((key) => key.includes("user-2"))).toBe(false);
  });
});
