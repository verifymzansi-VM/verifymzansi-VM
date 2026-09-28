import { beforeEach, describe, expect, it, vi } from "vitest";

const { guard, from, rpc, logAuditEvent } = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent }));

import { POST } from "./route";

const STAFF = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";

const valid = {
  type: "access",
  requesterEmail: "Someone@Example.com",
  description: "Please send me a copy of my data",
  intakeNote: "Emailed to privacy@; will ask for a certified ID copy",
};

const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/admin/dsar/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

let insert: ReturnType<typeof vi.fn>;

describe("POST /api/admin/dsar/intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({ success: true, user: { id: STAFF }, actorRole: "admin" });
    rpc.mockResolvedValue({ data: SUBJECT, error: null });
    insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({
          data: { id: CASE_ID, due_by: "2026-10-28T00:00:00Z" },
          error: null,
        }),
      }),
    }));
    from.mockReturnValue({ insert });
  });

  it("records an unverified manual case linked to the matching account", async () => {
    const res = await POST(request(valid));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      requestId: CASE_ID,
      reference: "DSAR-22222222",
      dueBy: "2026-10-28T00:00:00Z",
    });
    expect(rpc).toHaveBeenCalledWith("auth_user_id_by_email", { p_email: "someone@example.com" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "access",
        requester_email: "someone@example.com",
        identity_verified: false,
        identity_check: "manual",
        subject_user_id: SUBJECT,
        intake_by: STAFF,
        status: "submitted",
      })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_requested",
        metadata: expect.objectContaining({ channel: "manual_intake", linkedAccount: true }),
      })
    );
  });

  it("keeps the requester's words separate from the staff note", async () => {
    await POST(request(valid));
    const row = insert.mock.calls[0][0];
    expect(row.description).toContain("Please send me a copy of my data");
    expect(row.description).toContain("Intake note (staff): Emailed to privacy@");
  });

  it("uses the date the request arrived", async () => {
    const receivedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await POST(request({ ...valid, receivedAt }));
    expect(insert.mock.calls[0][0].received_at).toBe(receivedAt);
  });

  it("refuses a future or long-past received date", async () => {
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await POST(request({ ...valid, receivedAt: future }))).status).toBe(400);
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    expect((await POST(request({ ...valid, receivedAt: old }))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("needs a note on how identity will be checked", async () => {
    const res = await POST(request({ ...valid, intakeNote: "" }));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("records a case with no linked account when nobody matches", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await POST(request(valid));
    expect(insert.mock.calls[0][0].subject_user_id).toBeNull();
  });

  it("needs dsar:manage", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(valid))).status).toBe(403);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ capability: "dsar:manage" }));
    expect(insert).not.toHaveBeenCalled();
  });
});
