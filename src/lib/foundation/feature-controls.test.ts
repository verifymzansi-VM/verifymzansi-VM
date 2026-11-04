/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  readFrontendFeatureConfig,
  readFrontendFeatureFlags,
  setFrontendFeatureFlag,
  parseFrontendFlagAcknowledgement,
} from "./feature-controls";
const { readNativeDisplayFlags, retiredFactory } = vi.hoisted(() => ({
  readNativeDisplayFlags: vi.fn(),
  retiredFactory: vi.fn(),
}));
vi.mock("./feature-controls-server", () => ({ readNativeDisplayFlags }));
vi.mock("../supabase/admin", () => ({ createAdminClient: retiredFactory }));
import {
  isFeatureEnabled,
  toggleFeatureFlag,
  updateFeatureFlagConfig,
} from "../services/feature-flags";
const actor = "11111111-1111-4111-8111-111111111111";
const flag = {
  id: "22222222-2222-4222-8222-222222222222",
  key: "kyc_evidence_desk",
  enabled: true,
  description: "Optional evidence desk",
  mode: "allowlist",
  rollout_percent: 0,
  allowlist_roles: ["admin", "moderator"],
  revision: 2,
  updated_at: "2026-11-04T22:00:00Z",
  updated_reason: "Reviewers only",
};
const rpc = vi.fn(),
  api = { rpc } as unknown as FoundationAuthenticatedApi;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
});
afterEach(() => vi.unstubAllEnvs());
it("evaluates current native display configuration using the supplied staff context and never falls back to retired storage", async () => {
  const { key, enabled, mode, rollout_percent, allowlist_roles } = flag;
  readNativeDisplayFlags.mockResolvedValue([
    { key, enabled, mode, rollout_percent, allowlist_roles },
  ]);
  expect(await isFeatureEnabled(key, { userId: actor, role: "admin" })).toBe(true);
  expect(await isFeatureEnabled(key, { userId: actor, role: "member" })).toBe(false);
  expect(await isFeatureEnabled(key)).toBe(false);
  expect(await isFeatureEnabled("staff_mfa_enforced", { role: "admin" })).toBe(false);
  readNativeDisplayFlags.mockRejectedValue(new Error("unavailable"));
  expect(await isFeatureEnabled(key, { role: "admin" })).toBe(false);
  expect(retiredFactory).not.toHaveBeenCalled();
  expect((await toggleFeatureFlag(key, false)).success).toBe(false);
  expect((await updateFeatureFlagConfig(key, { mode: "off" })).success).toBe(false);
});
it("does not grant percent-rollout access without an identity and respects the configured endpoints", async () => {
  readNativeDisplayFlags.mockResolvedValue([{ ...flag, mode: "percent", rollout_percent: 100 }]);
  expect(await isFeatureEnabled(flag.key)).toBe(false);
  expect(await isFeatureEnabled(flag.key, { userId: actor })).toBe(true);
  readNativeDisplayFlags.mockResolvedValue([{ ...flag, mode: "percent", rollout_percent: 0 }]);
  expect(await isFeatureEnabled(flag.key, { userId: actor })).toBe(false);
});
it("accepts only the current account's admin DTO and keeps service configuration free of audit/account data", async () => {
  rpc.mockResolvedValueOnce({ data: { account_id: actor, flags: [flag] }, error: null });
  expect(await readFrontendFeatureFlags(api, actor)).toEqual([flag]);
  rpc.mockResolvedValueOnce({ data: { account_id: flag.id, flags: [flag] }, error: null });
  await expect(readFrontendFeatureFlags(api, actor)).rejects.toThrow();
  const config = {
    key: flag.key,
    enabled: true,
    mode: flag.mode,
    rollout_percent: 0,
    allowlist_roles: flag.allowlist_roles,
  };
  await expect(
    readFrontendFeatureConfig({
      rpc: async () => ({ data: [{ ...config, updated_reason: "private reason" }], error: null }),
    } as never)
  ).rejects.toThrow();
});
it("sends the represented revision and normalized canary with no actor claim, then validates the exact acknowledgement", async () => {
  rpc.mockResolvedValue({ data: { account_id: actor, flags: [flag] }, error: null });
  expect(
    await setFrontendFeatureFlag(api, {
      key: flag.key,
      expectedRevision: 1,
      mode: "allowlist",
      allowlist_roles: ["moderator", "admin", "admin"],
      reason: "Reviewers only",
    })
  ).toEqual(flag);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "set_frontend_feature_flag",
    {
      p_key: flag.key,
      p_expected_revision: 1,
      p_mode: "allowlist",
      p_percent: 0,
      p_roles: ["admin", "moderator"],
      p_reason: "Reviewers only",
    },
    { get: false }
  );
  expect(parseFrontendFlagAcknowledgement({ success: true, flag }, flag.key, 1)).toEqual(flag);
  expect(() => parseFrontendFlagAcknowledgement({ success: true, flag }, flag.key, 2)).toThrow();
  rpc.mockResolvedValueOnce({
    data: { account_id: actor, flags: [{ ...flag, mode: "off", enabled: false }] },
    error: null,
  });
  await expect(
    setFrontendFeatureFlag(api, {
      key: flag.key,
      expectedRevision: 1,
      mode: "allowlist",
      reason: "Reviewers only",
      allowlist_roles: ["admin", "moderator"],
    })
  ).rejects.toThrow();
});
it("refuses unrepresented writes, unknown/mandatory controls, invented roles and caller authority before RPC", async () => {
  for (const value of [
    { key: flag.key, enabled: true },
    { key: "staff_mfa_enforced", expectedRevision: 1, enabled: false },
    { key: flag.key, expectedRevision: 1, mode: "percent", reason: "Test" },
    {
      key: flag.key,
      expectedRevision: 1,
      mode: "allowlist",
      reason: "Test",
      allowlist_roles: ["owner"],
    },
    { key: flag.key, expectedRevision: 1, enabled: true, actorId: actor },
  ])
    await expect(setFrontendFeatureFlag(api, value)).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
