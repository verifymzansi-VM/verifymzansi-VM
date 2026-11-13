import { beforeEach, describe, expect, it, vi } from "vitest";

const { readNativeDisplayFlags, readNativeAdminFlags } = vi.hoisted(() => ({
  readNativeDisplayFlags: vi.fn(),
  readNativeAdminFlags: vi.fn(),
}));
vi.mock("@/lib/foundation/feature-controls-server", () => ({
  readNativeDisplayFlags,
  readNativeAdminFlags,
}));

import { getAllFeatureFlags, isFeatureEnabled } from "@/lib/services/feature-flags";

const FLAG = "kyc_evidence_desk";
type Row = {
  enabled: boolean;
  mode: string | null;
  rollout_percent: number | null;
  allowlist_roles: string[] | null;
};
const serve = (row: Row) => readNativeDisplayFlags.mockResolvedValue([{ key: FLAG, ...row }]);

describe("Feature Flags — Canary Evaluation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mode=off always returns false", async () => {
    serve({ enabled: false, mode: "off", rollout_percent: 0, allowlist_roles: [] });
    expect(await isFeatureEnabled(FLAG)).toBe(false);
    expect(await isFeatureEnabled(FLAG, { userId: "u1" })).toBe(false);
    expect(await isFeatureEnabled(FLAG, { role: "admin" })).toBe(false);
  });

  it("mode=on always returns true", async () => {
    serve({ enabled: true, mode: "on", rollout_percent: 0, allowlist_roles: [] });
    expect(await isFeatureEnabled(FLAG)).toBe(true);
    expect(await isFeatureEnabled(FLAG, { userId: "u1" })).toBe(true);
  });

  it("mode=percent is deterministic and needs an identifier", async () => {
    serve({ enabled: false, mode: "percent", rollout_percent: 50, allowlist_roles: [] });
    const first = await isFeatureEnabled(FLAG, { userId: "user-abc" });
    expect(await isFeatureEnabled(FLAG, { userId: "user-abc" })).toBe(first);
    expect(await isFeatureEnabled(FLAG)).toBe(false);
  });

  it("mode=percent at 100% includes everyone and at 0% excludes everyone", async () => {
    serve({ enabled: false, mode: "percent", rollout_percent: 100, allowlist_roles: [] });
    expect(await isFeatureEnabled(FLAG, { bucketKey: "any" })).toBe(true);
    serve({ enabled: false, mode: "percent", rollout_percent: 0, allowlist_roles: [] });
    expect(await isFeatureEnabled(FLAG, { userId: "any-user" })).toBe(false);
  });

  it("mode=percent without a percentage denies", async () => {
    serve({ enabled: false, mode: "percent", rollout_percent: null, allowlist_roles: [] });
    expect(await isFeatureEnabled(FLAG, { userId: "any-user" })).toBe(false);
  });

  it("mode=allowlist grants only listed roles", async () => {
    serve({
      enabled: false,
      mode: "allowlist",
      rollout_percent: 0,
      allowlist_roles: ["admin", "moderator"],
    });
    expect(await isFeatureEnabled(FLAG, { role: "admin" })).toBe(true);
    expect(await isFeatureEnabled(FLAG, { role: "moderator" })).toBe(true);
    expect(await isFeatureEnabled(FLAG, { role: "seller" })).toBe(false);
    expect(await isFeatureEnabled(FLAG)).toBe(false);
  });

  it("null mode falls back to the enabled boolean", async () => {
    serve({ enabled: true, mode: null, rollout_percent: null, allowlist_roles: null });
    expect(await isFeatureEnabled(FLAG)).toBe(true);
    serve({ enabled: false, mode: null, rollout_percent: null, allowlist_roles: null });
    expect(await isFeatureEnabled(FLAG)).toBe(false);
  });

  it("reads other keys, missing flags and failed reads as off", async () => {
    serve({ enabled: true, mode: "on", rollout_percent: 0, allowlist_roles: [] });
    expect(await isFeatureEnabled("kyc_v2_flow")).toBe(false);
    readNativeDisplayFlags.mockResolvedValue([]);
    expect(await isFeatureEnabled(FLAG)).toBe(false);
    readNativeDisplayFlags.mockRejectedValue(new Error("down"));
    expect(await isFeatureEnabled(FLAG)).toBe(false);
  });

  it("lists every flag from the foundation admin read", async () => {
    readNativeAdminFlags.mockResolvedValue([{ key: FLAG }]);
    await expect(getAllFeatureFlags()).resolves.toEqual([{ key: FLAG }]);
  });
});
