import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/retention-cleanup";

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

describe("retention cleanup worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips legal-hold KYC records while deleting actionable queue items", async () => {
    const privateDelete = vi.fn().mockResolvedValue(undefined);
    const publicDelete = vi.fn().mockResolvedValue(undefined);

    const env = {
      R2_PRIVATE: { delete: privateDelete },
      R2_PUBLIC: { delete: publicDelete },
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      WORKER_API_KEY: "worker-key",
    } as unknown as Parameters<NonNullable<typeof worker.scheduled>>[1];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/rest/v1/r2_cleanup_queue?processed_at=is.null")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "q-held",
              bucket: "verifymzansi-private",
              r2_key: "kyc/held.enc",
              reason: "approved_kyc_30d_purge",
            },
            {
              id: "q-delete",
              bucket: "private",
              r2_key: "kyc/delete.enc",
              reason: "approved_kyc_30d_purge",
            },
            {
              id: "q-public",
              bucket: "public",
              r2_key: "media/delete.jpg",
              reason: "content_removed",
            },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/kyc_artifacts?select=r2_key,user_id")) {
        return {
          ok: true,
          json: async () => [
            { r2_key: "kyc/held.enc", user_id: "user-held" },
            { r2_key: "kyc/delete.enc", user_id: "user-clear" },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/account_profiles?select=user_id&legal_hold=is.true")) {
        return {
          ok: true,
          json: async () => [{ user_id: "user-held" }],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/r2_cleanup_queue?id=in.(q-delete)")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/r2_cleanup_queue?id=in.(q-public)")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/media_uploads?confirmed_at=is.null")) {
        return {
          ok: true,
          json: async () => [],
        } satisfies Partial<Response>;
      }

      if (url.includes("/auth/v1/admin/users?page=1&per_page=200")) {
        return {
          ok: true,
          json: async () => ({
            users: [
              {
                id: "orphan-user-1",
                created_at: "2026-03-17T00:00:00.000Z",
                email: "orphan@example.com",
              },
            ],
          }),
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/account_profiles?select=user_id&user_id=in.")) {
        return {
          ok: true,
          json: async () => [],
        } satisfies Partial<Response>;
      }

      if (url.includes("/auth/v1/admin/users/orphan-user-1")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (
        url.includes("/rest/v1/listings?status=in.(live,active)") ||
        url.includes("/rest/v1/businesses?status=in.(live,active)") ||
        url.includes("/rest/v1/promotions?status=in.(live,active)")
      ) {
        return {
          ok: true,
          json: async () => [],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/free_posts_used?select=content_id")) {
        return {
          ok: true,
          json: async () => [],
        } satisfies Partial<Response>;
      }

      if (
        url.includes("/rest/v1/listings?select=id,photos") ||
        url.includes("/rest/v1/businesses?select=id,logo_url") ||
        url.includes("/rest/v1/promotions?select=id,photos")
      ) {
        return {
          ok: true,
          json: async () => [],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/audit_logs")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await worker.scheduled?.({ cron: "0 3 * * *", scheduledTime: Date.now() }, env, ctx);

    expect(privateDelete).toHaveBeenCalledWith(["kyc/delete.enc"]);
    expect(publicDelete).toHaveBeenCalledWith(["media/delete.jpg"]);

    const processedCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/rest/v1/r2_cleanup_queue?id=in.")
    );
    expect(processedCalls).toHaveLength(2);
    expect(processedCalls.some(([url]) => String(url).includes("q-held"))).toBe(false);

    const auditCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/audit_logs")
    );
    expect(auditCall).toBeDefined();
    expect(JSON.parse(String(auditCall?.[1]?.body))).toMatchObject({
      action: "retention_r2_cleanup",
      metadata: {
        held_skipped: 1,
        success: 2,
        failed: 0,
        orphan_auth_users_deleted: 1,
        deleted_expired_content: { listings: 0, businesses: 0, promotions: 0 },
      },
    });

    const authDeleteCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/auth/v1/admin/users/orphan-user-1")
    );
    expect(authDeleteCall).toBeDefined();

    const contentExpiryCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("status=in.(live,active)")
    );
    expect(contentExpiryCalls).toHaveLength(6);
    expect(
      contentExpiryCalls.some(([url]) =>
        String(url).includes("expires_at=not.is.null&expires_at=lte.")
      )
    ).toBe(true);
    expect(
      contentExpiryCalls.some(([url]) => String(url).includes("expires_at=is.null&created_at=lte."))
    ).toBe(true);
  });

  it("deletes expired posts and their public R2 media after the two-day grace period", async () => {
    const privateDelete = vi.fn().mockResolvedValue(undefined);
    const publicDelete = vi.fn().mockResolvedValue(undefined);

    const env = {
      R2_PRIVATE: { delete: privateDelete },
      R2_PUBLIC: { delete: publicDelete },
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      WORKER_API_KEY: "worker-key",
    } as unknown as Parameters<NonNullable<typeof worker.scheduled>>[1];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/rest/v1/r2_cleanup_queue?processed_at=is.null")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/media_uploads?confirmed_at=is.null")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/media_uploads?r2_key=in.")) {
        expect(init?.method).toBe("DELETE");
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (url.includes("/auth/v1/admin/users?page=1&per_page=200")) {
        return { ok: true, json: async () => ({ users: [] }) } satisfies Partial<Response>;
      }

      if (
        url.includes("/rest/v1/listings?status=in.(live,active)") ||
        url.includes("/rest/v1/businesses?status=in.(live,active)") ||
        url.includes("/rest/v1/promotions?status=in.(live,active)")
      ) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/free_posts_used?select=content_id")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/listings?select=id,photos")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "listing-1",
              photos: ["https://media.verifymzansi.com/listings/old-photo.jpg"],
              videos: ["https://media.verifymzansi.com/media/listing/user-1/video.mp4"],
              video_thumbnail: "/api/media/serve/media/listing/user-1/thumb.jpg",
              logo_url: "https://evil.example.com/not-ours.jpg",
            },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/businesses?select=id,logo_url")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "business-1",
              logo_url: "https://media.verifymzansi.com/business/logo.jpg",
              cover_photo: null,
              cover_video: null,
              video_thumbnail: null,
              gallery_photos: ["https://media-staging.verifymzansi.com/business/gallery.jpg"],
              business_details: {
                mall_photos: ["https://media.verifymzansi.com/business/mall.jpg"],
                mall_summary: "Do not delete https://media.verifymzansi.com/business/text.jpg",
                order_url: "https://media.verifymzansi.com/business/order.jpg",
                type: "mall_store",
              },
            },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/promotions?select=id,photos")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/content_edit_requests?")) {
        expect(init?.method).toBe("DELETE");
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/listings?id=in.") || url.includes("/rest/v1/businesses?id=in.")) {
        expect(init?.method).toBe("DELETE");
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/audit_logs")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await worker.scheduled?.({ cron: "0 3 * * *", scheduledTime: Date.now() }, env, ctx);

    expect(publicDelete).toHaveBeenCalledWith([
      "listings/old-photo.jpg",
      "media/listing/user-1/video.mp4",
      "media/listing/user-1/thumb.jpg",
    ]);
    expect(publicDelete).toHaveBeenCalledWith([
      "business/logo.jpg",
      "business/gallery.jpg",
      "business/mall.jpg",
    ]);

    const tableDeletes = fetchMock.mock.calls.filter(
      ([url, init]) =>
        init?.method === "DELETE" &&
        (String(url).includes("/rest/v1/listings?id=in.") ||
          String(url).includes("/rest/v1/businesses?id=in."))
    );
    expect(tableDeletes).toHaveLength(2);

    const auditCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/audit_logs")
    );
    expect(JSON.parse(String(auditCall?.[1]?.body))).toMatchObject({
      metadata: {
        deleted_expired_content: { listings: 1, businesses: 1, promotions: 0 },
      },
    });
  });
});
