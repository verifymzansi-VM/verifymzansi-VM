import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const AFFILIATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const { mockCreateClient, mockCreateAdminClient, mockVerifyCapabilityRole, mockCheckStaffApiMfa } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockVerifyCapabilityRole: vi.fn(),
    mockCheckStaffApiMfa: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/auth/admin-access", () => ({
  verifyCapabilityRoleFromDb: mockVerifyCapabilityRole,
}));
vi.mock("@/lib/auth/staff-mfa-guard", () => ({ checkStaffApiMfa: mockCheckStaffApiMfa }));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkLocalRateLimit: () => ({ limited: false }) }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

let rpc: ReturnType<typeof vi.fn>;

function setup({ orgAdmin }: { orgAdmin: boolean }) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  });
  rpc = vi.fn(async (name: string) =>
    name === "is_organisation_admin" ? { data: orgAdmin, error: null } : { data: "ok", error: null }
  );
  const maybeSingle = vi.fn(async () => ({ data: { organisation_id: ORG_ID }, error: null }));
  mockCreateAdminClient.mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc,
  });
}

function request() {
  return new Request(`https://verifymzansi.com/api/organisations/${ORG_ID}/manage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "revoke",
      affiliationId: AFFILIATION_ID,
      reason: "Policy breach",
    }),
  });
}

const context = { params: Promise.resolve({ id: ORG_ID }) };

describe("POST /api/organisations/:id/manage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckStaffApiMfa.mockResolvedValue(null);
  });

  it("lets an organisation administrator act without staff checks", async () => {
    setup({ orgAdmin: true });
    const res = await POST(request(), context);
    expect(res.status).toBe(200);
    expect(mockVerifyCapabilityRole).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("org_revoke_affiliation", expect.anything());
  });

  it("requires staff MFA when commercial staff act on another organisation", async () => {
    setup({ orgAdmin: false });
    mockVerifyCapabilityRole.mockResolvedValue("governance_controller");
    mockCheckStaffApiMfa.mockResolvedValue(
      NextResponse.json({ code: "mfa_required" }, { status: 403 })
    );
    const res = await POST(request(), context);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "mfa_required" });
    expect(rpc).not.toHaveBeenCalledWith("org_revoke_affiliation", expect.anything());
  });

  it("rejects callers who are neither organisation admins nor current staff", async () => {
    setup({ orgAdmin: false });
    mockVerifyCapabilityRole.mockResolvedValue(null);
    const res = await POST(request(), context);
    expect(res.status).toBe(403);
    expect(mockVerifyCapabilityRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      "organisations:manage"
    );
    expect(rpc).not.toHaveBeenCalledWith("org_revoke_affiliation", expect.anything());
  });

  it("lets MFA-verified commercial staff act", async () => {
    setup({ orgAdmin: false });
    mockVerifyCapabilityRole.mockResolvedValue("admin");
    const res = await POST(request(), context);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("org_revoke_affiliation", expect.anything());
  });
});
