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
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "live", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue({
            eq: deleteEq,
          }),
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
    expect(deleteEq).toHaveBeenCalledWith("id", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(mockLogAuditEvent).toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("queues public media cleanup when a user deletes a post", async () => {
    const cleanupInsert = vi.fn().mockResolvedValue({ error: null });
    const deleteEq = vi.fn().mockReturnThis();
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
          delete: vi.fn().mockReturnValue({
            eq: deleteEq,
          }),
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
      from: vi.fn((table: string) => {
        if (table === "r2_cleanup_queue") {
          return { insert: cleanupInsert };
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
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "rejected", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue({
            eq: deleteEq,
          }),
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
    expect(releaseMaybeSingle).toHaveBeenCalled();
  });

  it("does not release a free-post claim for non-rejected deletes", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "listing-1", status: "live", owner_id: "user-1" },
            error: null,
          }),
          delete: vi.fn().mockReturnValue({
            eq: deleteEq,
          }),
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
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
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
          delete: vi.fn().mockReturnValue({
            eq: deleteEq,
          }),
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
    expect(deleteEq).toHaveBeenCalledWith("id", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(releaseMaybeSingle).toHaveBeenCalled();
  });
});
