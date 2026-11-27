/** @vitest-environment node */
import { NextRequest, type NextResponse } from "next/server";
import { it, beforeEach, afterEach, expect, vi } from "vitest";
import { handleRestoredPostAction } from "./restored-post-actions";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  op = "22222222-2222-4222-8222-222222222222",
  csrf = "c".repeat(64),
  rpc = vi.fn();
function request(extra = {}, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/content/delete", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify({
      itemId: id,
      area: "MZANSI_MARKET",
      contentType: "listing",
      operationId: op,
      expectedRevision: 9,
      ...extra,
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({ data: { id, status: "deleted", success: true }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("sends only the represented post, revision, intent and program to the owner-bound command once", async () => {
  const response = await handleRestoredPostAction(request(), "delete");
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "execute_my_frontend_post_action",
    {
      p_request: op,
      p_post: id,
      p_expected_revision: 9,
      p_action: "delete",
      p_kind: "listing",
      p_area: "market",
    },
    { get: false }
  );
});
it("rejects missing revisions, forged subjects and CSRF before any command", async () => {
  expect(
    (await handleRestoredPostAction(request({ expectedRevision: undefined }), "delete")).status
  ).toBe(422);
  expect((await handleRestoredPostAction(request({ owner_id: id }), "delete")).status).toBe(422);
  expect((await handleRestoredPostAction(request({}, false), "delete")).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves ownership and stale/funding refusals without replaying an uncertain write", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect((await handleRestoredPostAction(request(), "delete")).status).toBe(403);
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  expect((await handleRestoredPostAction(request(), "delete")).status).toBe(409);
  rpc.mockRejectedValueOnce(new Error("reply lost"));
  expect((await handleRestoredPostAction(request(), "delete")).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(3);
});
it("explains a staff hold the same way for every owner action", async () => {
  const held = {
    status: 409,
    body: {
      error:
        "This post is hidden while our team reviews it. You can't republish, sell or delete it until the review is finished.",
      reason: "staff_visibility_hold",
    },
  };
  const reply = async (response: Response) => ({
    status: response.status,
    body: await response.json(),
  });
  for (const mode of ["delete", "resubmit"] as const) {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PT423" } });
    expect(await reply(await handleRestoredPostAction(request(), mode))).toEqual(held);
  }
  for (const action of ["deactivate", "mark_sold", "reactivate"]) {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PT423" } });
    const response = await handleRestoredPostAction(
      request({ itemId: undefined, id, action }),
      "lifecycle"
    );
    expect(await reply(response)).toEqual(held);
  }
  expect(rpc).toHaveBeenCalledTimes(5);
});
it("explains that a reported post can be hidden but not deleted until staff have looked", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: {
      code: "PT409",
      details: "post_report_open",
      message: "a reported post cannot be deleted",
    },
  });
  const response = await handleRestoredPostAction(request(), "delete");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Someone reported this post. You can hide it now, and delete it once our team has looked at the report.",
    reason: "post_report_open",
  });
  // Any other conflict keeps the general reload message.
  rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409", details: "post changed" } });
  expect((await (await handleRestoredPostAction(request(), "delete")).json()).reason).toBe(
    "post_changed"
  );
});
it("says when resubmitting waits for the current posting terms (the dashboard links to Edit)", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "PT409", details: "posting_terms_required" },
  });
  const response = await handleRestoredPostAction(request(), "resubmit");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Review and accept the current posting terms before continuing",
    reason: "posting_terms_required",
  });
});
