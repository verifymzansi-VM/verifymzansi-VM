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
const header = {
  request_id: requestId,
  export_id: exportId,
  reference: "DSAR-22222222",
  request_type: "access",
  received_at: "2026-11-01T08:00:00Z",
  due_by: "2026-12-01T08:00:00Z",
};
/** The prepare answer: names and row counts (one row each), no data. */
function prepared(found: boolean, names: readonly string[]) {
  return {
    ...header,
    account_found: found,
    digest: "a".repeat(64),
    datasets: Object.fromEntries(names.map((name) => [name, 1])),
  };
}
/** The confirm answer: one row in each named dataset. */
function exported(found: boolean, names: readonly string[]) {
  return {
    ...header,
    generated_at: "2026-11-09T22:00:00Z",
    account_found: found,
    datasets: Object.fromEntries(names.map((name, i) => [name, [{ id: i }]])),
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
/** The database answers prepare with `plan` and confirm with `delivered`
 * (by default the export of the same names). */
function database(plan: ReturnType<typeof prepared>, delivered?: unknown) {
  rpc.mockImplementation(async (name: string) =>
    name === "prepare_frontend_privacy_export"
      ? { data: plan, error: null }
      : {
          data: delivered ?? exported(plan.account_found, Object.keys(plan.datasets)),
          error: null,
        }
  );
}
const confirmCalls = () =>
  rpc.mock.calls.filter(([name]) => name === "confirm_frontend_privacy_export");
it("downloads the confirmed export after checking the prepared dataset names", async () => {
  database(prepared(true, registry));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="dsar-export-22222222.json"'
  );
  const body = await response.json();
  expect(Object.keys(body.datasets).sort()).toEqual([...registry].sort());
  expect(body.datasets[registry[0]]).toEqual([{ id: 0 }]);
  expect(body).not.toHaveProperty("export_id");
  expect(body).not.toHaveProperty("digest");
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
it("never confirms an export whose datasets are not exactly the reviewed ones", async () => {
  const [first, ...rest] = registry;
  for (const names of [rest, [...registry, "extra_set"], [...rest, `${first}_renamed`]]) {
    rpc.mockClear();
    database(prepared(true, names));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("datasets");
    expect(confirmCalls()).toHaveLength(0);
  }
});
it("refuses a prepare answer that carries rows instead of counts", async () => {
  database({ ...prepared(true, registry), datasets: exported(true, registry).datasets } as never);
  expect((await POST(request())).status).toBe(503);
  expect(confirmCalls()).toHaveLength(0);
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
  database(prepared(false, []));
  expect((await POST(request())).status).toBe(200);
  expect(confirmCalls()).toHaveLength(1);
  rpc.mockClear();
  database(prepared(false, registry));
  expect((await POST(request())).status).toBe(503);
  expect(confirmCalls()).toHaveLength(0);
});
it("hands nothing over, in its own words, when the confirmation fails", async () => {
  for (const [answer, status, message] of [
    [
      { data: null, error: { code: "PT409", message: "export changed since it was prepared" } },
      409,
      /changed or this export was already delivered\. Nothing was exported/,
    ],
    [
      { data: null, error: { code: "XX000", message: "connection lost" } },
      503,
      /could not be confirmed\. Nothing was exported/,
    ],
    [
      {
        data: null,
        error: { code: "42501", message: "recent second-factor verification required" },
      },
      403,
      /Nothing was exported/,
    ],
    // Rows that do not match the prepared counts, or another export id.
    [
      {
        data: {
          ...exported(true, registry),
          datasets: { ...exported(true, registry).datasets, [registry[0]]: [] },
        },
        error: null,
      },
      503,
      /could not be confirmed\. Nothing was exported/,
    ],
    [
      { data: { ...exported(true, registry), export_id: requestId }, error: null },
      503,
      /could not be confirmed\. Nothing was exported/,
    ],
  ] as const) {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) =>
      name === "prepare_frontend_privacy_export"
        ? { data: prepared(true, registry), error: null }
        : answer
    );
    const response = await POST(request());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).not.toHaveProperty("datasets");
    expect(body.error).toMatch(message);
  }
});
it("refuses an oversized or too frequent export without confirming it", async () => {
  for (const [code, status] of [
    ["PT413", 413],
    ["PT429", 429],
  ] as const) {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: { code, message: "refused" } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect((await response.json()).error).toMatch(/Nothing was exported/);
    expect(confirmCalls()).toHaveLength(0);
  }
});
