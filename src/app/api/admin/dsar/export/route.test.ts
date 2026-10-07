import { beforeEach, describe, expect, it, vi } from "vitest";

const { guard, rateLimit, from, rpc, logAuditEvent } = vi.hoisted(() => ({
  guard: vi.fn(),
  rateLimit: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkSensitiveActionRateLimit: rateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent }));

import { POST } from "./route";

const STAFF = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const baseCase = {
  id: CASE_ID,
  type: "access",
  requester_email: "subject@example.com",
  identity_verified: true,
  identity_check: "session",
  description: "Please send my data",
  status: "in_progress",
  received_at: "2026-09-01T00:00:00Z",
  due_by: "2026-10-01T00:00:00Z",
  extended_due_at: null,
  legal_basis: "PAIA s25",
  subject_user_id: SUBJECT,
};

const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/admin/dsar/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * dsar_cases resolves via maybeSingle; every other table pages through
 * range(). `datasets` gives each table's full contents.
 */
function tables(
  datasets: Record<string, unknown[]>,
  dsarCase: unknown = baseCase,
  failing?: string
) {
  from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order"]) q[m] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: dsarCase, error: null }));
    // Private-table lookups (contact details, addresses) by id.
    q.in = vi.fn(async () => ({ data: datasets[table] ?? [], error: null }));
    q.range = vi.fn(async (fromRow: number, toRow: number) =>
      table === failing
        ? { data: null, error: { message: "timeout" } }
        : { data: (datasets[table] ?? []).slice(fromRow, toRow + 1), error: null }
    );
    return q;
  });
}

describe("POST /api/admin/dsar/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({
      success: true,
      user: { id: STAFF },
      actorRole: "governance_controller",
    });
    rateLimit.mockResolvedValue({ limited: false });
    rpc.mockResolvedValue({ data: null, error: null });
    tables({});
  });

  it("needs dsar:manage and a fresh second factor", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request({ requestId: CASE_ID }))).status).toBe(403);
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "dsar:manage", stepUp: true })
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the shared rate limiter refuses", async () => {
    rateLimit.mockResolvedValue({ limited: true, retryAfter: 60 });
    expect((await POST(request({ requestId: CASE_ID }))).status).toBe(429);
  });

  it("refuses to export before the requester's identity is verified", async () => {
    tables({}, { ...baseCase, identity_verified: false });
    const res = await POST(request({ requestId: CASE_ID }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "identity_unverified" });
  });

  it("pages through every record instead of stopping at a limit", async () => {
    const listings = Array.from({ length: 2345 }, (_, i) => ({ id: `listing-${i}` }));
    tables({ listings });

    const res = await POST(request({ requestId: CASE_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.listings).toHaveLength(2345);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("includes the subject's own contact details and addresses from the private tables", async () => {
    tables({
      businesses: [{ id: "b1", business_name: "Shop" }],
      business_private: [{ business_id: "b1", phone: "+27821111111", location_address: "1 Main" }],
      listings: [{ id: "l1", title: "Bike" }],
      listing_private: [{ listing_id: "l1", location_address: "3 Home St" }],
    });

    const body = await (await POST(request({ requestId: CASE_ID }))).json();

    expect(body.data.businesses[0]).toMatchObject({
      phone: "+27821111111",
      location_address: "1 Main",
    });
    expect(body.data.listings[0]).toMatchObject({ location_address: "3 Home St" });
  });

  it("does not identify other people", async () => {
    tables({
      contact_events: [
        { id: "c1", sender_user_id: OTHER, created_at: "x" },
        { id: "c2", sender_user_id: SUBJECT, created_at: "y" },
      ],
      audit_logs: [
        {
          actor_id: OTHER,
          actor_role: "moderator",
          action: "moderation_action",
          target_type: "account_profile",
          metadata: { note: "staff only" },
        },
        {
          actor_id: SUBJECT,
          actor_role: "member",
          action: "appeal_submitted",
          target_type: "decision",
          metadata: { appeal_id: "a1" },
        },
      ],
    });

    const body = await (await POST(request({ requestId: CASE_ID }))).json();

    expect(JSON.stringify(body)).not.toContain(OTHER);
    expect(JSON.stringify(body)).not.toContain(STAFF);
    expect(body.data.contactEvents).toEqual([
      { id: "c1", created_at: "x", sent_by_you: false },
      { id: "c2", created_at: "y", sent_by_you: true },
    ]);
    expect(body.data.auditLog[0]).toEqual({
      action: "moderation_action",
      target_type: "account_profile",
      by: "VerifyMzansi staff",
      created_at: undefined,
    });
    expect(body.data.auditLog[1].metadata).toEqual({ appeal_id: "a1" });
  });

  it("returns nothing when any dataset cannot be read completely", async () => {
    tables({ listings: [{ id: "l1" }] }, baseCase, "payments");
    const res = await POST(request({ requestId: CASE_ID }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: "export_incomplete" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("finds the subject by exact email when the case has no linked account", async () => {
    tables({}, { ...baseCase, subject_user_id: null });
    rpc.mockResolvedValue({ data: SUBJECT, error: null });

    const res = await POST(request({ requestId: CASE_ID }));

    expect(rpc).toHaveBeenCalledWith("auth_user_id_by_email", { p_email: "subject@example.com" });
    await expect(res.json()).resolves.toMatchObject({
      subject: { resolution: "exact_email_match" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dsar_exported", actorId: STAFF })
    );
  });

  it("returns 404 for an unknown case", async () => {
    tables({}, null);
    expect((await POST(request({ requestId: CASE_ID }))).status).toBe(404);
  });
});
