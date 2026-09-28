import { beforeEach, describe, expect, it, vi } from "vitest";

const { guard, rpc, getUserById, updateUserById, rateLimit, reportCriticalIncident } = vi.hoisted(
  () => ({
    guard: vi.fn(),
    rpc: vi.fn(),
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
    rateLimit: vi.fn(),
    reportCriticalIncident: vi.fn(),
  })
);

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, auth: { admin: { getUserById, updateUserById } } }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({ checkSensitiveActionRateLimit: rateLimit }));
vi.mock("@/lib/utils/alerts", () => ({ reportCriticalIncident }));

import { POST } from "./route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const DECISION_ID = "33333333-3333-4333-8333-333333333333";

const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/admin/governance/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const propose = {
  action: "propose",
  targetEmail: "target@example.com",
  newRole: "moderator",
  reason: "Joining the verification team",
};

function rpcReturns(results: Record<string, unknown>) {
  rpc.mockImplementation(async (fn: string) => ({ data: results[fn], error: null }));
}

describe("POST /api/admin/governance/roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({ success: true, user: { id: ADMIN_ID }, actorRole: "admin" });
    rateLimit.mockResolvedValue({ limited: false });
    getUserById.mockResolvedValue({
      data: { user: { id: TARGET_ID, app_metadata: { provider: "email", role: "member" } } },
      error: null,
    });
    updateUserById.mockResolvedValue({ error: null });
  });

  it("requires role:review with a recent second factor", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(propose))).status).toBe(403);
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "role:review", stepUp: true })
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the sensitive rate limit refuses", async () => {
    rateLimit.mockResolvedValue({ limited: true, retryAfter: 30 });
    expect((await POST(request(propose))).status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith(ADMIN_ID, "admin:role:assign", 5);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("proposes a promotion with the verified actor, without changing auth metadata", async () => {
    rpcReturns({
      auth_user_id_by_email: TARGET_ID,
      propose_staff_role_change: {
        ok: true,
        status: "proposed",
        decision_id: DECISION_ID,
        target_user_id: TARGET_ID,
        previous_role: "member",
        new_role: "moderator",
      },
    });

    const response = await POST(request({ ...propose, actorId: "attacker" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "proposed", decisionId: DECISION_ID });
    expect(rpc).toHaveBeenCalledWith("propose_staff_role_change", {
      p_actor: ADMIN_ID,
      p_target: TARGET_ID,
      p_role: "moderator",
      p_reason: "Joining the verification team",
    });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("returns 404 without calling the RPC when no account uses the email", async () => {
    rpcReturns({ auth_user_id_by_email: null });
    expect((await POST(request(propose))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalledWith("propose_staff_role_change", expect.anything());
  });

  it("syncs the auth metadata hint once a change is applied, keeping other keys", async () => {
    rpcReturns({
      approve_staff_role_change: {
        ok: true,
        status: "applied",
        decision_id: DECISION_ID,
        target_user_id: TARGET_ID,
        previous_role: "member",
        new_role: "moderator",
      },
    });

    const response = await POST(
      request({ action: "approve", decisionId: DECISION_ID, payloadVersion: 1 })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_staff_role_change", {
      p_actor: ADMIN_ID,
      p_decision: DECISION_ID,
      p_payload_version: 1,
      p_note: null,
    });
    expect(updateUserById).toHaveBeenCalledWith(TARGET_ID, {
      app_metadata: { provider: "email", role: "moderator" },
    });
    expect(await response.json()).toMatchObject({ status: "applied", metadataSynced: true });
  });

  it("reports but does not fail when the committed change cannot sync metadata", async () => {
    rpcReturns({
      propose_staff_role_change: {
        ok: true,
        status: "applied",
        decision_id: DECISION_ID,
        target_user_id: TARGET_ID,
        previous_role: "moderator",
        new_role: "member",
      },
      auth_user_id_by_email: TARGET_ID,
    });
    updateUserById.mockResolvedValue({ error: { message: "auth down" } });

    const response = await POST(request({ ...propose, newRole: "member" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "applied", metadataSynced: false });
    expect(rpc).toHaveBeenCalledWith("enqueue_operation_job", {
      p_key: `auth_metadata_sync:${TARGET_ID}:${DECISION_ID}`,
      p_kind: "auth_metadata_sync",
      p_payload: { user_id: TARGET_ID, role: "member" },
      p_decision: DECISION_ID,
    });
    expect(reportCriticalIncident).toHaveBeenCalledWith(
      "GovernanceRoles",
      expect.stringContaining("metadata sync failed"),
      expect.objectContaining({ userId: TARGET_ID, decisionId: DECISION_ID })
    );
  });

  it.each([
    ["not_independent", 403],
    ["self_change", 400],
    ["pending_exists", 409],
    ["expired", 410],
    ["stale", 409],
    ["forbidden", 403],
  ])("maps the %s refusal to %i without touching metadata", async (error, status) => {
    rpcReturns({ reject_staff_role_change: { ok: false, error } });
    const response = await POST(request({ action: "reject", decisionId: DECISION_ID }));
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(error);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("explains the last-admin protection", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "auth_user_id_by_email"
        ? { data: TARGET_ID, error: null }
        : { data: null, error: { message: "The last active admin cannot be removed" } }
    );
    const response = await POST(request({ ...propose, newRole: "member" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("last active admin");
  });

  it("hides unexpected database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation secret_table missing" } });
    const response = await POST(
      request({ action: "approve", decisionId: DECISION_ID, payloadVersion: 1 })
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret_table");
  });

  it("rejects malformed bodies before any database call", async () => {
    expect((await POST(request({ action: "propose", targetEmail: "nope" }))).status).toBe(400);
    expect((await POST(request({ ...propose, reason: "no" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
