import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
import Page from "./page";

// Hidden until it works on the live backend (SHOW_STAFF_TRIALS).
describe("free posts and trials page while hidden", () => {
  beforeEach(() => {
    staffGuard.reset();
    staffGuard.as("admin", "admin-1");
    vi.clearAllMocks();
  });
  it("sends staff to the staff home without reading anything", async () => {
    await expect(
      Page({ searchParams: Promise.resolve({ account: "member@example.com" }) })
    ).rejects.toThrow("redirect:/admin");
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("trials:manage");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it("keeps its staff guard", async () => {
    staffGuard.deny("capability");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/admin");
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("trials:manage");
    expect(rpc).not.toHaveBeenCalled();
  });
});
