import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, getClaims } = vi.hoisted(() => ({ rpc: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { hasActiveStaffSession } from "./staff-session";
const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const supabase = { auth: { getClaims } } as never;
describe("live privileged sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClaims.mockResolvedValue({
      data: { claims: { sub: "staff-1", session_id: sessionId } },
      error: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });
  });
  it("accepts the authenticated user's existing session", async () => {
    expect(await hasActiveStaffSession(supabase, "staff-1")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("staff_session_is_active", {
      p_user: "staff-1",
      p_session: sessionId,
    });
  });
  it.each([false, null])("rejects revoked/missing session result %s", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await hasActiveStaffSession(supabase, "staff-1")).toBe(false);
  });
  it.each([
    { sub: "other", session_id: sessionId },
    { sub: "staff-1" },
    { sub: "staff-1", session_id: "bad" },
  ])("rejects mismatched or invalid claims %s", async (claims) => {
    getClaims.mockResolvedValue({ data: { claims }, error: null });
    expect(await hasActiveStaffSession(supabase, "staff-1")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed on signature verification failure", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("expired") });
    expect(await hasActiveStaffSession(supabase, "staff-1")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed on database failure", async () => {
    rpc.mockResolvedValue({ data: true, error: new Error("offline") });
    expect(await hasActiveStaffSession(supabase, "staff-1")).toBe(false);
    rpc.mockRejectedValue(new Error("offline"));
    expect(await hasActiveStaffSession(supabase, "staff-1")).toBe(false);
  });
});
