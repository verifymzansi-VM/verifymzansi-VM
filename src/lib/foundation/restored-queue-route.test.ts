/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredQueueAction } from "./restored-queue-route";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  nonce = "33333333-3333-4333-8333-333333333333",
  csrf = "c".repeat(64),
  rpc = vi.fn();
const lease = {
  claim_generation: "8",
  claim_nonce: nonce,
  claim_expires_at: "2026-11-04T17:00:00Z",
};
const foreign = {
  id,
  subject: "case",
  queue: "kyc",
  item_type: "verification_step",
  mine: false,
  holder_name: "another moderator",
  generation: null,
  nonce: null,
  expires_at: lease.claim_expires_at,
  revision: 3,
  edit_of: null,
};
function request(input: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/queue", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());
it.each(["content", "kyc"])(
  "claims %s through the bounded native command and reports its actual lease length",
  async (queue) => {
    const isCase = queue === "kyc";
    rpc.mockResolvedValue({
      data: {
        items: [
          isCase
            ? { ...lease, case_id: id, version: 3 }
            : { ...lease, subject: "post", id, renewals_left: 4, revision: 3, edit_of: null },
        ],
        lease_minutes: isCase ? 30 : 15,
      },
      error: null,
    });
    const response = await handleRestoredQueueAction(
      request({ action: "claim", queue, limit: 10 })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claimed: 1,
      message: expect.stringContaining(isCase ? "30 minutes" : "15 minutes"),
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "claim_frontend_staff_items",
      { p_queue: queue, p_limit: 10 },
      { get: false }
    );
  }
);
it("keeps renew/release-all as one native transaction with no automatic replay", async () => {
  rpc.mockResolvedValueOnce({ data: { renewed: 2 }, error: null });
  expect((await handleRestoredQueueAction(request({ action: "renew" }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "control_my_frontend_staff_claims",
    { p_action: "renew" },
    { get: false }
  );
  rpc.mockClear();
  rpc.mockRejectedValueOnce(new Error("lost response"));
  expect((await handleRestoredQueueAction(request({ action: "release" }))).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("refuses release of another person's claim before a mutation", async () => {
  rpc.mockResolvedValue({
    data: { account_id: actor, own_count: 0, items: [foreign] },
    error: null,
  });
  expect(
    (
      await handleRestoredQueueAction(
        request({ action: "release", itemType: "verification_step", itemId: id })
      )
    ).status
  ).toBe(409);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("lets native governance free the typed evidence claim without disclosing its holder's secret", async () => {
  rpc
    .mockResolvedValueOnce({
      data: { account_id: actor, own_count: 0, items: [foreign] },
      error: null,
    })
    .mockResolvedValueOnce({ data: { id, status: "released" }, error: null });
  const response = await handleRestoredQueueAction(
    request({
      action: "reassign",
      itemType: "verification_step",
      itemId: id,
      to: null,
      reason: "Independent handoff",
    })
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenNthCalledWith(
    2,
    "reassign_frontend_staff_claim",
    { p_type: "verification_step", p_id: id, p_to: null, p_reason: "Independent handoff" },
    { get: false }
  );
  expect(JSON.stringify(await response.json())).not.toContain(nonce);
});
it("rejects incomplete subjects, unbounded claims, forged roles and CSRF before any RPC", async () => {
  for (const input of [
    { action: "release", itemId: id },
    { action: "claim", queue: "content", limit: 26 },
    { action: "renew", role: "admin" },
  ])
    expect((await handleRestoredQueueAction(request(input))).status).toBe(422);
  expect((await handleRestoredQueueAction(request({ action: "renew" }, false))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("fails closed when foreign lease secrets or the wrong queue kind appear in a reply", async () => {
  rpc.mockResolvedValueOnce({
    data: { account_id: actor, own_count: 0, items: [{ ...foreign, nonce }] },
    error: null,
  });
  expect(
    (
      await handleRestoredQueueAction(
        request({ action: "release", itemType: "verification_step", itemId: id })
      )
    ).status
  ).toBe(503);
  rpc.mockResolvedValueOnce({
    data: { items: [{ ...lease, case_id: id, version: 3 }], lease_minutes: 15 },
    error: null,
  });
  expect(
    (await handleRestoredQueueAction(request({ action: "claim", queue: "content" }))).status
  ).toBe(503);
});
