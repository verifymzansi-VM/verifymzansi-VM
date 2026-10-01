import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
const { getUser, capability, rpc, from } = vi.hoisted(() => ({
  getUser: vi.fn(),
  capability: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("@/lib/auth/admin-access", () => ({ verifyCapabilityFromDb: capability }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
import Page from "./page";

describe("free-post account search page", () => {
  beforeEach(() => {
    staffGuard.reset();
    staffGuard.as("admin", "admin-1");
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    capability.mockResolvedValue(true);
    rpc.mockResolvedValue({ data: [], error: null });
    // Every query builder call chains; awaiting it yields an empty result.
    const query: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "then"
            ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
            : () => query,
      }
    );
    from.mockReturnValue(query);
  });
  it("uses the authenticated admin for email lookup and passes the result to the form", async () => {
    const account = {
      user_id: "member-1",
      display_name: "Same Name",
      email: "member@example.com",
      remaining: 2,
    };
    rpc.mockImplementation(async (name: string) => ({
      data: name === "search_free_post_accounts" ? [account] : [],
      error: null,
    }));
    const page = await Page({ searchParams: Promise.resolve({ account: " member@example.com " }) });
    expect(rpc).toHaveBeenCalledWith("search_free_post_accounts", {
      p_actor_id: "admin-1",
      p_search: "member@example.com",
    });
    const [, management] = page.props.children as Array<{ props: { accounts: unknown } }>;
    expect(management?.props.accounts).toEqual([account]);
  });
  it("does not search or expose accounts without verified capability", async () => {
    staffGuard.deny("capability");
    await expect(
      Page({ searchParams: Promise.resolve({ account: "member@example.com" }) })
    ).rejects.toThrow("redirect:/admin");
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("trials:manage");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it("fails closed if account lookup fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Database offline" } });
    await expect(
      Page({ searchParams: Promise.resolve({ account: "member@example.com" }) })
    ).rejects.toThrow("Unable to search accounts");
  });
});
