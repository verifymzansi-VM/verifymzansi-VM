import { describe, expect, it, vi } from "vitest";
import {
  getActiveFreePostUsage,
  claimFreePostSlot,
  releaseFreePostSlot,
  trialAvailabilityMessage,
} from "./free-posts";
describe("introductory trial client", () => {
  it("binds eligibility to the authenticated RPC, not a supplied user or category", async () => {
    const offer = {
      eligible: true,
      sevenDayAvailable: true,
      thirtyDayAvailable: true,
      remaining: 50,
      launchEnabled: true,
    };
    const rpc = vi.fn().mockResolvedValue({ data: offer, error: null });
    expect(await getActiveFreePostUsage({ rpc } as never, "ignored-user", "MZANSI_MARKET")).toEqual(
      { used: 0, remaining: 1, available: true, offer }
    );
    expect(rpc).toHaveBeenCalledWith("intro_trial_offer", { p_area: "MZANSI_MARKET" });
  });
  it("fails closed on database failure", async () => {
    await expect(
      getActiveFreePostUsage(
        { rpc: vi.fn().mockResolvedValue({ error: { message: "offline" } }) } as never,
        "u",
        "MZANSI_MARKET"
      )
    ).rejects.toThrow();
  });
  it.each([7, 30] as const)("reserves the selected %i days atomically", async (days) => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(
      await claimFreePostSlot({ rpc } as never, {
        userId: "u",
        area: "MZANSI_MARKET",
        contentId: "c",
        durationDays: days,
      })
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith("reserve_intro_trial", {
      p_user_id: "u",
      p_area: "MZANSI_MARKET",
      p_content_id: "c",
      p_duration_days: days,
    });
  });
  it("never falls back to an unprotected insert", async () => {
    await expect(
      claimFreePostSlot({ from: vi.fn() } as never, {
        userId: "u",
        area: "MZANSI_MARKET",
        contentId: "c",
      })
    ).rejects.toThrow();
  });
  it("releases through the service RPC without deleting history", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await releaseFreePostSlot({ rpc } as never, {
      userId: "u",
      area: "MZANSI_MARKET",
      contentId: "c",
      reason: "create_failed",
    });
    expect(rpc).toHaveBeenCalledWith(
      "release_intro_trial",
      expect.objectContaining({ p_reason: "create_failed" })
    );
  });
  it("uses truthful scarcity thresholds", () => {
    const offer = {
      eligible: true,
      sevenDayAvailable: true,
      thirtyDayAvailable: true,
      remaining: 50,
      launchEnabled: true,
    };
    expect(trialAvailabilityMessage(offer)).toBe("Limited 30-day free spaces available.");
    expect(trialAvailabilityMessage({ ...offer, remaining: 7 })).toContain("Only 7");
    expect(trialAvailabilityMessage({ ...offer, remaining: 0 })).toContain("fully allocated");
    expect(trialAvailabilityMessage({ ...offer, launchEnabled: false })).toContain("paused");
  });
});
