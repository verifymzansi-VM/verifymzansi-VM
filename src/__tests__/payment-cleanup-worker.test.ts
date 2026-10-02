import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/payment-cleanup";

interface TestEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_API_KEY: string;
  PROCESSING_PAYMENT_STALE_MINUTES?: string;
}

const env: TestEnv = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  WORKER_API_KEY: "worker-key",
  PROCESSING_PAYMENT_STALE_MINUTES: "30",
};

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

describe("payment cleanup worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs authenticated provider reconciliation and preserves provider-backed rows when it fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/internal/payments/reconcile")) {
        expect(init).toMatchObject({
          method: "POST",
          redirect: "error",
          headers: { Authorization: "Bearer worker-key" },
        });
        return { ok: false, status: 503 } as Response;
      }
      if (url.includes("status=eq.pending"))
        return {
          ok: true,
          json: async () => [
            {
              id: "provider-backed",
              provider_payment_id: "request-1",
              provider_data: { expire_at: "2020-01-01T00:00:00Z" },
            },
          ],
        } as Response;
      return { ok: true, json: async () => [] } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await worker.scheduled!(
      { cron: "*/10 * * * *", scheduledTime: Date.now() },
      { ...env, APP_URL: "https://verifymzansi.com" },
      ctx
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://verifymzansi.com/api/internal/payments/reconcile"
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("expires stale pending payments and reconciles stale processing payments", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const method = _init?.method ?? "GET";

      if (method === "PATCH" && url.includes("/rest/v1/payments?id=eq.pending-1")) {
        expect(url).toContain("status=eq.pending");
        expect(_init?.headers).toMatchObject({ Prefer: "return=representation" });
        return { ok: true, json: async () => [{ id: "pending-1" }] } satisfies Partial<Response>;
      }

      if (method === "PATCH" && url.includes("/rest/v1/payments?id=eq.processing-complete")) {
        expect(url).toContain("status=eq.processing");
        expect(_init?.headers).toMatchObject({ Prefer: "return=representation" });
        return {
          ok: true,
          json: async () => [{ id: "processing-complete" }],
        } satisfies Partial<Response>;
      }

      if (method === "PATCH" && url.includes("/rest/v1/payments?id=eq.processing-failed")) {
        expect(url).toContain("status=eq.processing");
        expect(_init?.headers).toMatchObject({ Prefer: "return=representation" });
        return {
          ok: true,
          json: async () => [{ id: "processing-failed" }],
        } satisfies Partial<Response>;
      }

      if (url.includes("status=eq.pending")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "pending-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              provider_data: { expire_at: "2026-03-17T08:00:00.000Z" },
            },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("status=eq.processing")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "processing-complete",
              status: "processing",
              updated_at: "2026-03-17T08:10:00.000Z",
              provider_data: {
                processing_started_at: "2026-03-17T08:00:00.000Z",
                fulfillment_completed_at: "2026-03-17T08:05:00.000Z",
              },
            },
            {
              id: "processing-failed",
              status: "processing",
              updated_at: "2026-03-17T08:05:00.000Z",
              provider_data: {
                processing_started_at: "2026-03-17T08:00:00.000Z",
              },
            },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/notifications")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      if (url.includes("/rest/v1/audit_logs")) {
        return { ok: true, text: async () => "" } satisfies Partial<Response>;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      await worker.scheduled?.({ cron: "*/10 * * * *", scheduledTime: Date.now() }, env, ctx);
    } finally {
      vi.useRealTimers();
    }

    const paymentPatchCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/rest/v1/payments?id=eq.")
    );
    expect(paymentPatchCalls).toHaveLength(2);
    expect(paymentPatchCalls.some(([url]) => String(url).includes("processing-failed"))).toBe(
      false
    );

    const patchBodies = paymentPatchCalls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(patchBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "expired",
          provider_data: expect.objectContaining({
            cleanup_reconciliation_state: "expired_pending",
          }),
        }),
        expect.objectContaining({
          status: "complete",
          provider_data: expect.objectContaining({
            cleanup_reconciliation_state: "recovered_complete",
          }),
        }),
      ])
    );

    const auditCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/audit_logs")
    );
    expect(auditCall).toBeDefined();
    expect(JSON.parse(String(auditCall?.[1]?.body))).toMatchObject({
      action: "payment_cleanup_reconciliation",
      metadata: {
        expired_pending: 1,
        recovered_complete: 1,
        failed_stale_processing: 0,
        reconciliation_required: 1,
        expiry_notifications: 1,
      },
    });

    const notificationCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/notifications")
    );
    expect(notificationCall).toBeDefined();
  });

  it("skips cleanup counts and notifications when a status race updates zero rows", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const method = _init?.method ?? "GET";

      if (method === "PATCH" && url.includes("/rest/v1/payments?id=eq.pending-race")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      if (url.includes("status=eq.pending")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "pending-race",
              user_id: "user-1",
              provider_data: { expire_at: "2026-03-17T08:00:00.000Z" },
            },
          ],
        } satisfies Partial<Response>;
      }

      if (url.includes("status=eq.processing")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      await worker.scheduled?.({ cron: "*/10 * * * *", scheduledTime: Date.now() }, env, ctx);
    } finally {
      vi.useRealTimers();
    }

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/rest/v1/notifications"))
    ).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/rest/v1/audit_logs"))).toBe(
      false
    );
  });

  it("bounds every outbound Supabase request with an abort timeout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("status=eq.pending")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "pending-1",
              user_id: "user-1",
              provider_data: { expire_at: "2026-03-17T08:00:00.000Z" },
            },
          ],
        } satisfies Partial<Response>;
      }
      if (url.includes("status=eq.processing")) {
        return { ok: true, json: async () => [] } satisfies Partial<Response>;
      }
      if (url.includes("/rest/v1/payments?id=eq.")) {
        return { ok: true, json: async () => [{ id: "pending-1" }] } satisfies Partial<Response>;
      }
      return { ok: true, text: async () => "" } satisfies Partial<Response>;
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      await worker.scheduled?.({ cron: "*/10 * * * *", scheduledTime: Date.now() }, env, ctx);
    } finally {
      vi.useRealTimers();
    }

    // pending list, processing list, PATCH, notification, audit
    expect(fetchMock.mock.calls.length).toBe(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("rejects manual triggers when WORKER_API_KEY is unset or the key is wrong", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const unset = await worker.fetch!(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { Authorization: "Bearer " },
      }),
      { ...env, WORKER_API_KEY: "" },
      ctx
    );
    expect(unset.status).toBe(401);

    const wrong = await worker.fetch!(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { Authorization: "Bearer worker-kez" },
      }),
      env,
      ctx
    );
    expect(wrong.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
