import { describe, expect, it, vi } from "vitest";
import { userOwnsBusiness } from "@/lib/account/owned-business";
import { applyOwnerFilter, getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";

vi.mock("@/lib/account/compat", () => ({
  applyOwnerFilter: vi.fn(),
  getOwnerColumn: vi.fn(),
  withOwnerColumn: vi.fn(),
}));

describe("userOwnsBusiness", () => {
  it("returns true when businessId is not provided", async () => {
    const client = { from: vi.fn() };

    await expect(userOwnsBusiness(client as never, "user-1", null)).resolves.toBe(true);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns true when matching business row exists", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "biz-1" }, error: null });
    const filteredQuery = { maybeSingle };
    const eq = vi.fn().mockReturnValue({});
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(getOwnerColumn).mockResolvedValueOnce("owner_id");
    vi.mocked(withOwnerColumn).mockReturnValueOnce("id, owner_id");
    vi.mocked(applyOwnerFilter).mockReturnValueOnce(filteredQuery as never);

    await expect(userOwnsBusiness({ from } as never, "user-1", "biz-1")).resolves.toBe(true);

    expect(getOwnerColumn).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("businesses");
    expect(select).toHaveBeenCalledWith("id, owner_id");
    expect(eq).toHaveBeenCalledWith("id", "biz-1");
  });

  it("throws when ownership lookup returns an error", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "lookup failed" } });
    const filteredQuery = { maybeSingle };
    const eq = vi.fn().mockReturnValue({});
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(getOwnerColumn).mockResolvedValueOnce("owner_id");
    vi.mocked(withOwnerColumn).mockReturnValueOnce("id, owner_id");
    vi.mocked(applyOwnerFilter).mockReturnValueOnce(filteredQuery as never);

    await expect(userOwnsBusiness({ from } as never, "user-1", "biz-1")).rejects.toThrow(
      "lookup failed"
    );
  });
});
