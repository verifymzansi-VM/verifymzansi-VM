import { describe, expect, it, vi } from "vitest";
import { getTrialAddonBlock } from "./trial-addon-access";
describe("trial add-on funding guard", () => {
  it.each([
    [{ data: { id: "trial" }, error: null }, 403],
    [{ data: null, error: { message: "offline" } }, 503],
    [{ data: null, error: null }, null],
  ] as const)("checks unconverted entitlement before any payment", async (result, status) => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.is.mockReturnValue(chain);
    const block = await getTrialAddonBlock(
      { from: vi.fn().mockReturnValue(chain) } as never,
      "post-id"
    );
    expect(block?.status ?? null).toBe(status);
    expect(chain.eq).toHaveBeenCalledWith("content_id", "post-id");
    expect(chain.is).toHaveBeenCalledWith("converted_at", null);
  });
});
