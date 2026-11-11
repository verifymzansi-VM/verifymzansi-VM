/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
const { native } = vi.hoisted(() => ({ native: vi.fn() }));
vi.mock("../../scripts/lib/foundation-runtime-readiness", () => ({
  verifyFoundationRuntime: native,
}));
import { inspectConfiguredSupabaseSchema } from "../../scripts/preflight-check";
beforeEach(() => {
  vi.clearAllMocks();
  native.mockResolvedValue(undefined);
});
it("checks the provisioned native contracts and isolation without querying retired public tables", async () => {
  const environment = { FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy" };
  await expect(inspectConfiguredSupabaseSchema(environment)).resolves.toBeUndefined();
  expect(native).toHaveBeenCalledExactlyOnceWith(environment, true);
});
it("passes a native contract failure on", async () => {
  native.mockRejectedValueOnce(new Error("Native contract drift"));
  await expect(inspectConfiguredSupabaseSchema({})).rejects.toThrow("Native contract drift");
});
