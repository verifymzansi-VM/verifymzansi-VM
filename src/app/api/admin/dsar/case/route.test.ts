import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AdminAccess from "@/lib/auth/admin-access";

const { guard, from, rpc, logAuditEvent, readStaffAccess } = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  logAuditEvent: vi.fn(),
  readStaffAccess: vi.fn(),
}));

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/auth/admin-access", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminAccess>()),
  readStaffAccessFromDb: readStaffAccess,
}));

import { POST } from "./route";

const STAFF = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/admin/dsar/case", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function updateReturns(rows: unknown[] | null, error: unknown = null) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["update", "eq", "in"]) q[m] = vi.fn(() => q);
  q.select = vi.fn(async () => ({ data: rows, error }));
  from.mockReturnValue(q);
  return q;
}

describe("POST /api/admin/dsar/case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({
      success: true,
      user: { id: STAFF },
      actorRole: "governance_controller",
    });
    readStaffAccess.mockResolvedValue({
      role: "governance_controller",
      mfaRequiredAfter: new Date(),
    });
  });

  it("needs dsar:manage", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    const res = await POST(request({ action: "assign", requestId: CASE_ID, assigneeId: STAFF }));
    expect(res.status).toBe(403);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ capability: "dsar:manage" }));
  });

  it("extends through the database rule with the server-verified actor", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, status: "extended", due: "2026-11-01T00:00:00Z" },
      error: null,
    });

    const res = await POST(
      request({ action: "extend", requestId: CASE_ID, reason: "Records are held in two systems" })
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("extend_dsar_deadline", {
      p_actor: STAFF,
      p_case: CASE_ID,
      p_reason: "Records are held in two systems",
    });
  });

  it("explains a refused extension", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "already_extended" }, error: null });
    const res = await POST(
      request({ action: "extend", requestId: CASE_ID, reason: "Records are held in two systems" })
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "already_extended" });
  });

  it("rejects a reason that is too short before calling the database", async () => {
    const res = await POST(request({ action: "extend", requestId: CASE_ID, reason: "busy" }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("assigns an open case and records it", async () => {
    const q = updateReturns([{ id: CASE_ID }]);

    const res = await POST(request({ action: "assign", requestId: CASE_ID, assigneeId: OTHER }));

    expect(res.status).toBe(200);
    expect(readStaffAccess).toHaveBeenCalledWith(OTHER);
    expect(q.update).toHaveBeenCalledWith({ assigned_to: OTHER });
    expect(q.in).toHaveBeenCalledWith("status", ["submitted", "identity_pending", "in_progress"]);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_assigned",
        targetId: CASE_ID,
        metadata: { assignee: OTHER },
      })
    );
  });

  it("refuses an assignee who cannot handle data requests", async () => {
    readStaffAccess.mockResolvedValue({ role: "moderator", mfaRequiredAfter: new Date() });
    const res = await POST(request({ action: "assign", requestId: CASE_ID, assigneeId: OTHER }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses to assign a closed case", async () => {
    updateReturns([]);
    const res = await POST(request({ action: "assign", requestId: CASE_ID, assigneeId: null }));
    expect(res.status).toBe(409);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
