/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredModerationDecision } from "./restored-moderation-route";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  original = "22222222-2222-4222-8222-222222222222",
  nonce = "33333333-3333-4333-8333-333333333333",
  csrf = "c".repeat(64),
  rpc = vi.fn();
const fence = { expectedRevision: 7, claimGeneration: "9", claimNonce: nonce };
const body = () => ({
  itemId: id,
  area: "MZANSI_MARKET",
  contentType: "listing",
  decision: "approve",
  ...fence,
});
function request(input: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/content/decide", {
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
  rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "staff_review_post"
        ? { id, kind: "listing", area: "market", revision: 7, edit_of: null }
        : { id, status: "live", visible_until: "2026-12-01T00:00:00Z" },
  }));
});
afterEach(() => vi.unstubAllEnvs());
it("sends the represented revision and exact live lease to the native decision once", async () => {
  const response = await handleRestoredModerationDecision(request(body()), false);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, id, status: "live" });
  expect(rpc).toHaveBeenNthCalledWith(
    2,
    "moderate_post",
    {
      p_post_id: id,
      p_expected_revision: 7,
      p_decision: "approve",
      p_claim_generation: "9",
      p_claim_nonce: nonce,
    },
    { get: false }
  );
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("accepts the real merged acknowledgement for a live edit without inventing a revision", async () => {
  rpc.mockResolvedValueOnce({
    data: { id, kind: "listing", area: "market", revision: 7, edit_of: original },
    error: null,
  });
  rpc.mockResolvedValueOnce({
    data: { id, edit_of: original, status: "merged", post_revision: 14, price_only: false },
    error: null,
  });
  const response = await handleRestoredModerationDecision(
    request({ requestId: id, decision: "approve", ...fence }),
    true
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "merged", post_revision: 14 });
});
it("refuses a changed revision, program or original/edit identity before mutation", async () => {
  for (const input of [
    { ...body(), expectedRevision: 6 },
    { ...body(), area: "MZANSI_BUSINESS" },
    { requestId: id, decision: "approve", ...fence },
  ]) {
    rpc.mockClear();
    expect(
      (await handleRestoredModerationDecision(request(input), "requestId" in input)).status
    ).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
  }
});
it("requires the full lease, a meaningful rejection reason and CSRF without accepting actor assertions", async () => {
  for (const input of [
    { ...body(), claimNonce: undefined },
    { ...body(), decision: "reject", reason: "no" },
    { ...body(), actor_id: original },
  ])
    expect((await handleRestoredModerationDecision(request(input), false)).status).toBe(422);
  expect((await handleRestoredModerationDecision(request(body(), false), false)).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves native authority refusals and never replays an uncertain decision", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent second-factor verification required" },
  });
  const refused = await handleRestoredModerationDecision(request(body()), false);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ redirectUrl: "/staff/two-step" });
  rpc.mockClear();
  rpc
    .mockResolvedValueOnce({
      data: { id, kind: "listing", area: "market", revision: 7, edit_of: null },
      error: null,
    })
    .mockRejectedValueOnce(new Error("reply lost"));
  expect((await handleRestoredModerationDecision(request(body()), false)).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(2);
});
