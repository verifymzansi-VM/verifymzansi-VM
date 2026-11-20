/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit, checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRIVACY_EXPORT_DATASET_SETS } from "@/lib/foundation/privacy-export-datasets";
import { snapshotDatasetNames } from "@/test/privacy-export-registry";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  checkSensitiveActionRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
const staff = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222",
  csrf = "c".repeat(64),
  rpc = vi.fn(),
  exportId = "33333333-3333-4333-8333-333333333333";
/** Datasets the live database exports: the registry of the committed snapshot,
 * which CI keeps in step with database/foundation/updates. */
const registry = snapshotDatasetNames();
/** One row in each named dataset. */
function datasets(names: readonly string[]) {
  return Object.fromEntries(names.map((name, i) => [name, [{ id: i }]]));
}
function exported(found: boolean, names: readonly string[]) {
  return {
    request_id: requestId,
    export_id: exportId,
    reference: "DSAR-22222222",
    generated_at: "2026-11-09T22:00:00Z",
    request_type: "access",
    received_at: "2026-11-01T08:00:00Z",
    due_by: "2026-12-01T08:00:00Z",
    account_found: found,
    datasets: datasets(names),
  };
}
function request() {
  return new NextRequest("https://verifymzansi.com/api/admin/dsar/export", {
    method: "POST",
    body: JSON.stringify({ requestId, revision: 4 }),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(checkSensitiveActionRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: async () => ({ api: { rpc }, accountId: staff, sessionId: staff }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());
const confirmed = {
  data: { request_id: requestId, export_id: exportId, confirmed_at: "2026-11-09T22:00:01Z" },
  error: null,
};
/** The database answers the prepare call with `prepared` and confirms. */
function database(prepared: unknown) {
  rpc.mockImplementation(async (name: string) =>
    name === "prepare_frontend_privacy_export" ? { data: prepared, error: null } : confirmed
  );
}
const confirmCalls = () =>
  rpc.mock.calls.filter(([name]) => name === "confirm_frontend_privacy_export");
it("downloads an export holding every dataset, confirmed after it was checked", async () => {
  database(exported(true, registry));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="dsar-export-22222222.json"'
  );
  const body = await response.json();
  expect(Object.keys(body.datasets).sort()).toEqual([...registry].sort());
  expect(body).not.toHaveProperty("export_id");
  expect(body.scope).toMatch(/^Account records in the listed datasets/);
  expect(rpc.mock.calls).toEqual([
    ["prepare_frontend_privacy_export", { p_case: requestId, p_revision: 4 }, { get: false }],
    [
      "confirm_frontend_privacy_export",
      { p_case: requestId, p_revision: 4, p_export: exportId },
      { get: false },
    ],
  ]);
  expect(checkSensitiveActionRateLimit).toHaveBeenCalledWith(staff, "admin:dsar:export");
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("refuses, unconfirmed, an export whose datasets are not exactly the reviewed ones", async () => {
  const [first, ...rest] = registry;
  for (const names of [
    rest,
    [...registry, "extra_set"],
    [...rest, `${first}_renamed`],
    [...rest, "profile_v2"].slice(0, registry.length),
  ]) {
    rpc.mockClear();
    database(exported(true, names));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("datasets");
    expect(confirmCalls()).toHaveLength(0);
  }
});
it("accepts any accepted set during a transition", () => {
  // The route accepts exactly the sets in privacy-export-datasets.ts; the
  // snapshot's registry is one of them (privacy-export-datasets.test.ts).
  expect(
    PRIVACY_EXPORT_DATASET_SETS.some(
      (set) => [...set].sort().join(",") === [...registry].sort().join(",")
    )
  ).toBe(true);
});
it("returns no datasets when no account matches the request", async () => {
  database(exported(false, []));
  expect((await POST(request())).status).toBe(200);
  expect(confirmCalls()).toHaveLength(1);
  rpc.mockClear();
  database(exported(false, registry));
  expect((await POST(request())).status).toBe(503);
  expect(confirmCalls()).toHaveLength(0);
});
it("hands nothing over when the confirmation fails", async () => {
  for (const answer of [
    { data: null, error: { code: "PT409", message: "prepared export required" } },
    { data: null, error: { code: "XX000", message: "connection lost" } },
    {
      data: { request_id: requestId, export_id: requestId, confirmed_at: "2026-11-09T22:00:01Z" },
      error: null,
    },
  ]) {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) =>
      name === "prepare_frontend_privacy_export"
        ? { data: exported(true, registry), error: null }
        : answer
    );
    const response = await POST(request());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).not.toHaveProperty("datasets");
  }
});
it("refuses an oversized export without confirming it", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT413", message: "too large" } });
  const response = await POST(request());
  expect(response.status).toBe(413);
  expect(confirmCalls()).toHaveLength(0);
});
