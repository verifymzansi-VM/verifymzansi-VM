/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { getStaffDashboard, getStaffNavCounts } from "./staff-dashboard";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend accessed");
  }),
}));
const id = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
const overview = {
  version: 1,
  role: "admin",
  generated_at: "2026-11-03T12:00:00Z",
  counts: { reports: 3, content: 4, kyc: 5, business_kyc: 6, decisions: 7 },
  claims: [],
  platform: { jobs_waiting: 1, cost_alarms: 0, active_staff: 2 },
  restored_queues: {
    reports: { open: 3, oldest_at: null, breached: 1, claimed: 1 },
    content: { pending: 4, oldest_at: null, claimed: 1 },
    kyc: { pending: 5, oldest_at: null, high_risk: 1, claimed: 1 },
    business_kyc: { pending: 6, oldest_at: null, breached: 1, claimed: 1 },
    support: null,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({
    user: { id },
    account: { staff: { role: "admin" } },
    api: { rpc },
  } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>);
  rpc.mockResolvedValue({ data: overview, error: null });
});
it("loads restored staff cards and badges from the verified caller's API", async () => {
  expect(await getStaffDashboard(id)).toMatchObject({
    role: "admin",
    queues: overview.restored_queues,
    platform: null,
    decisions: null,
  });
  expect(await getStaffNavCounts(id)).toEqual({
    reports: 3,
    content: 4,
    kyc: 5,
    business_kyc: 6,
    decisions: 7,
  });
  expect(rpc).toHaveBeenCalledWith("get_staff_dashboard", {});
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("leaves an absent presentation contract unavailable instead of fabricating empty queues", async () => {
  rpc.mockResolvedValue({ data: { ...overview, restored_queues: undefined }, error: null });
  expect(await getStaffDashboard(id)).toBeNull();
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("refuses a caller change before querying and never falls back after a native refusal", async () => {
  expect(await getStaffDashboard("22222222-2222-4222-8222-222222222222")).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect(await getStaffDashboard(id)).toBeNull();
  expect(await getStaffNavCounts(id)).toEqual({});
  expect(createAdminClient).not.toHaveBeenCalled();
});
