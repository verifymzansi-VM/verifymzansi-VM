/** @vitest-environment node */
// The staff data-request queue reader used by /admin/dsar. The route handlers
// that change a request are covered in src/app/api/admin/dsar/foundation-routes.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { privacyRevision, readFrontendPrivacyQueue } from "./privacy-requests";

const staff = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const rules = [
  { request_type: "access", extension_days: 30, statutory: true },
  { request_type: "correction", extension_days: 30, statutory: true },
  { request_type: "deletion", extension_days: 0, statutory: true },
  { request_type: "objection", extension_days: 0, statutory: false },
];
function item(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
    type: "access",
    description: "Please send me a copy of my data.",
    status: "submitted",
    requester_email: "requester@example.invalid",
    identity_check: "session",
    identity_verified: true,
    revision: 1,
    created_at: "2026-11-01T08:00:00Z",
    received_at: "2026-11-01T08:00:00Z",
    due_by: "2026-12-01T08:00:00Z",
    extended_due_at: null,
    effective_due_at: "2026-12-01T08:00:00Z",
    legal_basis: "PAIA section 25",
    extension_reason: null,
    extension_notified_at: null,
    assigned_to: null,
    assignee_name: null,
    response_summary: null,
    completed_at: null,
    may_process: true,
    ...overrides,
  };
}
function queue(items: unknown[], total: number, overrides: Record<string, unknown> = {}) {
  return { actor_id: staff, items, total, overdue: 0, due_soon: 1, rules, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("readFrontendPrivacyQueue", () => {
  it("reads one view and page through one command", async () => {
    rpc.mockResolvedValue({ data: queue([item(1)], 1), error: null });
    const result = await readFrontendPrivacyQueue(api, staff, "open", 1);
    expect(result.items).toHaveLength(1);
    expect(result.rules).toHaveLength(4);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_frontend_privacy_queue",
      { p_view: "open", p_page: 1 },
      { get: false }
    );
  });

  it("requires each page to hold exactly the rows the total implies", async () => {
    const full = Array.from({ length: 25 }, (_, i) => item(i));
    rpc.mockResolvedValueOnce({ data: queue(full, 60), error: null });
    await expect(readFrontendPrivacyQueue(api, staff, "open", 2)).resolves.toMatchObject({
      total: 60,
    });
    rpc.mockResolvedValueOnce({ data: queue(full, 60), error: null });
    await expect(readFrontendPrivacyQueue(api, staff, "open", 3)).rejects.toMatchObject({
      status: 503,
    });
    rpc.mockResolvedValueOnce({ data: queue(full.slice(0, 10), 10), error: null });
    await expect(readFrontendPrivacyQueue(api, staff, "open", 1)).resolves.toMatchObject({
      total: 10,
    });
  });

  it("refuses a queue answered for another account", async () => {
    rpc.mockResolvedValue({
      data: queue([], 0, { actor_id: "33333333-3333-4333-8333-333333333333" }),
      error: null,
    });
    await expect(readFrontendPrivacyQueue(api, staff, "open", 1)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("refuses rows with unknown values or extra personal fields", async () => {
    for (const bad of [
      item(1, { status: "closed" }),
      item(1, { type: "erasure" }),
      item(1, { identity_check: "none" }),
      item(1, { requester_phone: "0820000000" }),
      item(1, { description: "x".repeat(3401) }),
    ]) {
      rpc.mockResolvedValueOnce({ data: queue([bad], 1), error: null });
      await expect(readFrontendPrivacyQueue(api, staff, "open", 1)).rejects.toMatchObject({
        status: 503,
      });
    }
  });

  it("requires all four deadline rules", async () => {
    rpc.mockResolvedValue({ data: queue([], 0, { rules: rules.slice(0, 3) }), error: null });
    await expect(readFrontendPrivacyQueue(api, staff, "open", 1)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("maps an expired staff second factor to the step-up prompt", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "verified authenticator app required" },
    });
    await expect(readFrontendPrivacyQueue(api, staff, "open", 1)).rejects.toMatchObject({
      status: 403,
      mfaRequired: true,
    });
  });
});

describe("privacyRevision", () => {
  it("accepts only whole revisions the database can still increase", () => {
    expect(privacyRevision.safeParse(1).success).toBe(true);
    expect(privacyRevision.safeParse(2147483646).success).toBe(true);
    for (const bad of [0, -1, 1.5, 2147483647, "1"])
      expect(privacyRevision.safeParse(bad).success).toBe(false);
  });
});
