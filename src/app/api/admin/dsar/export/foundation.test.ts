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
const NOTHING = /Nothing was exported/;
const UNCERTAIN = /^The export may have been recorded\. Check the request history/;
const header = {
  request_id: requestId,
  export_id: exportId,
  reference: "DSAR-22222222",
  request_type: "access",
  received_at: "2026-11-01T08:00:00Z",
  due_by: "2026-12-01T08:00:00Z",
};
/** The prepare answer: dataset names only. */
function prepared(found: boolean, names: readonly string[]) {
  return { ...header, account_found: found, datasets: [...names] };
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
function request(body: unknown = { requestId, revision: 4 }) {
  return new NextRequest("https://verifymzansi.com/api/admin/dsar/export", {
    method: "POST",
    body: JSON.stringify(body),
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
  rpc.mockReset();
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
 * (by default the export of the same names). Either may be a whole answer
 * ({ data, error }) or a function that throws. */
function database(
  plan: unknown,
  delivered?: unknown,
  options: { prepareAnswer?: unknown; confirmAnswer?: unknown; confirmThrows?: boolean } = {}
) {
  rpc.mockImplementation(async (name: string) => {
    if (name === "prepare_frontend_privacy_export")
      return options.prepareAnswer ?? { data: plan, error: null };
    if (options.confirmThrows) throw new TypeError("fetch failed");
    if (options.confirmAnswer) return options.confirmAnswer;
    const p = plan as { account_found: boolean; datasets: string[] };
    return { data: delivered ?? exported(p.account_found, p.datasets), error: null };
  });
}
const confirmCalls = () =>
  rpc.mock.calls.filter(([name]) => name === "confirm_frontend_privacy_export");
async function refusal(response: Response) {
  const body = await response.json();
  expect(body).not.toHaveProperty("datasets");
  return { status: response.status, error: String(body.error) };
}

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

it("never confirms when the prepared names are not exactly the reviewed ones", async () => {
  const [first, ...rest] = registry;
  for (const names of [
    rest,
    [...registry, "extra_set"],
    [...rest, `${first}_renamed`],
    [...rest, "__proto__"],
    [...rest, first, first].slice(1),
  ]) {
    rpc.mockReset();
    database(prepared(true, names));
    const { status, error } = await refusal(await POST(request()));
    expect(status).toBe(503);
    expect(error).toMatch(NOTHING);
    expect(confirmCalls()).toHaveLength(0);
  }
  // Counts or rows in the prepare answer are not accepted either.
  rpc.mockReset();
  database({ ...prepared(true, registry), datasets: exported(true, registry).datasets });
  expect((await refusal(await POST(request()))).status).toBe(503);
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
  rpc.mockReset();
  database(prepared(false, registry));
  expect((await POST(request())).status).toBe(503);
  expect(confirmCalls()).toHaveLength(0);
});

it("says nothing was exported for every refusal before or by the database", async () => {
  const cases: Array<[string, () => void, number]> = [
    [
      "stale revision at prepare",
      () =>
        database(null, undefined, {
          prepareAnswer: { data: null, error: { code: "PT409", message: "represented" } },
        }),
      409,
    ],
    [
      "own request at prepare",
      () =>
        database(null, undefined, {
          prepareAnswer: {
            data: null,
            error: { code: "42501", message: "another staff member must export your request" },
          },
        }),
      403,
    ],
    [
      "too large at prepare",
      () =>
        database(null, undefined, {
          prepareAnswer: {
            data: { request_id: requestId, export_id: exportId, refused: "too_large" },
            error: null,
          },
        }),
      413,
    ],
    [
      "hourly limit at prepare",
      () =>
        database(null, undefined, {
          prepareAnswer: { data: null, error: { code: "PT429", message: "limit" } },
        }),
      429,
    ],
    [
      "prepare unreachable",
      () =>
        database(null, undefined, {
          prepareAnswer: { data: null, error: { code: "", message: "fetch failed" } },
        }),
      503,
    ],
    [
      "changed at confirm",
      () =>
        database(prepared(true, registry), undefined, {
          confirmAnswer: {
            data: { request_id: requestId, export_id: exportId, refused: "changed" },
            error: null,
          },
        }),
      409,
    ],
    [
      "too large at confirm",
      () =>
        database(prepared(true, registry), undefined, {
          confirmAnswer: {
            data: { request_id: requestId, export_id: exportId, refused: "too_large" },
            error: null,
          },
        }),
      413,
    ],
    [
      "second factor expired at confirm",
      () =>
        database(prepared(true, registry), undefined, {
          confirmAnswer: {
            data: null,
            error: { code: "42501", message: "recent second-factor verification required" },
          },
        }),
      403,
    ],
    [
      "already confirmed",
      () =>
        database(prepared(true, registry), undefined, {
          confirmAnswer: {
            data: null,
            error: { code: "PT409", message: "export already confirmed" },
          },
        }),
      409,
    ],
  ];
  for (const [label, arrange, status] of cases) {
    rpc.mockReset();
    arrange();
    const answer = await refusal(await POST(request()));
    expect(answer.status, label).toBe(status);
    expect(answer.error, label).toMatch(NOTHING);
  }
  // A malformed request and the route's own protection say so too.
  rpc.mockReset();
  const invalid = await refusal(await POST(request({ requestId: "nope", revision: 4 })));
  expect(invalid.status).toBe(422);
  expect(invalid.error).toMatch(NOTHING);
  vi.mocked(checkSensitiveActionRateLimit).mockResolvedValueOnce({ limited: true });
  const limited = await refusal(await POST(request()));
  expect(limited.status).toBe(429);
  expect(limited.error).toMatch(NOTHING);
  expect(rpc).not.toHaveBeenCalled();
});

it("words a failure after the confirmation may have committed as uncertain", async () => {
  const wrongRows = exported(true, registry);
  const protoRows = JSON.parse(
    JSON.stringify(wrongRows).replace(`"${registry[0]}":`, '"__proto__":')
  ) as unknown;
  for (const [label, arrange] of [
    [
      "transport error",
      () =>
        database(prepared(true, registry), undefined, {
          confirmAnswer: { data: null, error: { code: "", message: "fetch failed" } },
        }),
    ],
    ["rejected call", () => database(prepared(true, registry), undefined, { confirmThrows: true })],
    [
      "another export id",
      () => database(prepared(true, registry), { ...wrongRows, export_id: requestId }),
    ],
    [
      "a missing dataset",
      () =>
        database(prepared(true, registry), {
          ...wrongRows,
          datasets: exported(true, registry.slice(1)).datasets,
        }),
    ],
    ["a dataset named __proto__", () => database(prepared(true, registry), protoRows)],
  ] as const) {
    rpc.mockReset();
    arrange();
    const answer = await refusal(await POST(request()));
    expect(answer.status, label).toBe(502);
    expect(answer.error, label).toMatch(UNCERTAIN);
    expect(answer.error, label).not.toMatch(NOTHING);
  }
});
