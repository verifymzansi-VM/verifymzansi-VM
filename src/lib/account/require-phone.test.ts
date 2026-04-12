import { describe, expect, it, vi } from "vitest";
import { hasPhoneNumber } from "@/lib/account/require-phone";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

describe("hasPhoneNumber", () => {
  it("returns true when account profile has a phone", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { phone: "+27821234567" } });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    const result = await hasPhoneNumber({ from } as never, "user-1");

    expect(result).toBe(true);
    expect(from).toHaveBeenCalledWith(ACCOUNT_PROFILE_TABLE);
    expect(select).toHaveBeenCalledWith("phone");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns false when phone is missing", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { phone: null } });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    await expect(hasPhoneNumber({ from } as never, "user-2")).resolves.toBe(false);
  });

  it("returns false when no account profile row exists", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    await expect(hasPhoneNumber({ from } as never, "user-3")).resolves.toBe(false);
  });
});
