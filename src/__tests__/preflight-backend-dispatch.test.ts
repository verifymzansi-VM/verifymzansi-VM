/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
const { native, source } = vi.hoisted(() => ({ native: vi.fn(), source: vi.fn() }));
vi.mock("../../scripts/lib/foundation-runtime-readiness", () => ({
  verifyFoundationRuntime: native,
}));
vi.mock("../../scripts/check-supabase-schema", () => ({ verifySupabaseSchema: source }));
import { inspectConfiguredSupabaseSchema } from "../../scripts/preflight-check";
beforeEach(() => {
  vi.clearAllMocks();
  native.mockResolvedValue(undefined);
  source.mockResolvedValue({ ok: true, missingTables: [], otherErrors: [] });
});
it("checks the provisioned native contracts and isolation without querying retired public tables", async () => {
  const environment = {
    NEXT_PUBLIC_DATA_BACKEND: "foundation",
    FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy",
  };
  expect(await inspectConfiguredSupabaseSchema(environment)).toEqual({
    backend: "foundation",
    result: null,
  });
  expect(native).toHaveBeenCalledExactlyOnceWith(environment, true);
  expect(source).not.toHaveBeenCalled();
});
it("defaults to the native backend and never falls back after contract failure", async () => {
  native.mockRejectedValueOnce(new Error("Native contract drift"));
  await expect(inspectConfiguredSupabaseSchema({})).rejects.toThrow("Native contract drift");
  expect(source).not.toHaveBeenCalled();
});
it("retains the isolated source fixture check only for explicit source mode", async () => {
  const result = await inspectConfiguredSupabaseSchema({
    NEXT_PUBLIC_DATA_BACKEND: "source",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-key",
  });
  expect(result.backend).toBe("source");
  expect(source).toHaveBeenCalledExactlyOnceWith({
    url: "http://127.0.0.1:54321",
    serviceRoleKey: "synthetic-local-key",
  });
  expect(native).not.toHaveBeenCalled();
});
it("refuses invalid backend or missing fixture configuration before contacting either database", async () => {
  await expect(
    inspectConfiguredSupabaseSchema({ NEXT_PUBLIC_DATA_BACKEND: "unknown" })
  ).rejects.toThrow();
  await expect(
    inspectConfiguredSupabaseSchema({ NEXT_PUBLIC_DATA_BACKEND: "source" })
  ).rejects.toThrow();
  expect(native).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
});
