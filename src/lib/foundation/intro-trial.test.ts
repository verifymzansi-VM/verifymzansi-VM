/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { introTrialSchema, readIntroTrial, restoredTrialClaim } from "./intro-trial";

const running = {
  status: "running",
  starts_at: "2026-11-10T08:00:00+00:00",
  ends_at: "2026-11-17T08:00:00+00:00",
} as const;

describe("the member's free week", () => {
  it("reads the free week through the authenticated command", async () => {
    const rpc = vi.fn(async () => ({ data: running, error: null }));
    const api = { rpc } as unknown as FoundationAuthenticatedApi;
    await expect(readIntroTrial(api)).resolves.toEqual(running);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_intro_trial", {}, { get: false });
  });
  it("reports an unavailable read without its details", async () => {
    const api = {
      rpc: vi.fn(async () => ({ data: null, error: { code: "42501", message: "private" } })),
    } as unknown as FoundationAuthenticatedApi;
    await expect(readIntroTrial(api)).rejects.toThrow("Introductory trial is unavailable");
  });
  it("accepts dates only for a running week, in order", () => {
    for (const status of ["available", "awaiting_approval", "used", "unavailable"])
      expect(introTrialSchema.parse({ status, starts_at: null, ends_at: null }).status).toBe(
        status
      );
    for (const value of [
      { ...running, starts_at: null },
      { ...running, ends_at: null },
      { ...running, starts_at: running.ends_at, ends_at: running.starts_at },
      { status: "awaiting_approval", starts_at: running.starts_at, ends_at: running.ends_at },
      { status: "running", starts_at: null, ends_at: null },
      { ...running, extra: true },
      { ...running, status: "started" },
    ])
      expect(introTrialSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
  it("gives the dashboard card the running week with its end, or the week waiting for approval", () => {
    expect(restoredTrialClaim(running)).toEqual({
      id: "intro-trial",
      duration_days: 7,
      admin_granted: false,
      activated_at: running.starts_at,
      expires_at: running.ends_at,
      released_at: null,
      converted_at: null,
    });
    expect(
      restoredTrialClaim({ status: "awaiting_approval", starts_at: null, ends_at: null })
    ).toMatchObject({ duration_days: 7, activated_at: null, expires_at: null });
    for (const status of ["available", "used", "unavailable"] as const)
      expect(restoredTrialClaim({ status, starts_at: null, ends_at: null })).toBeNull();
  });
});
