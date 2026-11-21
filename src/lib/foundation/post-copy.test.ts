/** @vitest-environment node */
import { NextRequest, type NextResponse } from "next/server";
import { it, beforeEach, afterEach, expect, vi, describe } from "vitest";
import { handlePostCopy, readMyCopyDrafts } from "./post-copy";
import { readStaffCopyFacts } from "./staff-copy-facts";
import { createFoundationRouteContext } from "./request-route";
import { checkRateLimit } from "../utils/rate-limit";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const switches = vi.hoisted(() => ({ SHOW_POST_COPY: true }));
vi.mock("../hidden-features", () => switches);
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));

const id = "11111111-1111-4111-8111-111111111111",
  draft = "33333333-3333-4333-8333-333333333333",
  op = "22222222-2222-4222-8222-222222222222",
  csrf = "c".repeat(64),
  rpc = vi.fn();
function request(body: unknown = { operationId: op }, valid = true) {
  return new NextRequest(`https://verifymzansi.com/api/listings/${id}/copy`, {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  switches.SHOW_POST_COPY = true;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({
    data: { id: draft, source_id: id, status: "draft", revision: 1 },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/listings/[id]/copy", () => {
  it("asks the owner-bound command for one copy and answers the draft", async () => {
    const response = await handlePostCopy(request(), id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: draft, revision: 1 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "copy_my_post",
      { p_post: id, p_request: op },
      { get: false }
    );
  });

  it("is not there while the switch is off", async () => {
    switches.SHOW_POST_COPY = false;
    expect((await handlePostCopy(request(), id)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses forged input and a missing CSRF token before any command", async () => {
    expect((await handlePostCopy(request({ operationId: op, owner_id: id }), id)).status).toBe(422);
    expect((await handlePostCopy(request({}), id)).status).toBe(422);
    expect((await handlePostCopy(request(undefined, false), id)).status).toBe(403);
    expect((await handlePostCopy(request(), "not-a-post")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains each refusal of the database", async () => {
    const cases: Array<[string, number, string]> = [
      ["42501", 404, "post_not_found"],
      ["PT402", 403, "package_required"],
      ["PT423", 409, "staff_visibility_hold"],
      ["PT429", 429, "draft_limit"],
      ["22023", 422, "invalid_post_action"],
      ["PT409", 409, "post_changed"],
    ];
    for (const [code, status, reason] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      const response = await handlePostCopy(request(), id);
      expect(response.status).toBe(status);
      expect((await response.json()).reason).toBe(reason);
    }
  });

  it("says why a post cannot be copied", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        details: "copy_source_invalid",
        message: "only a submitted Market listing can be copied",
      },
    });
    const response = await handlePostCopy(request(), id);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reason: "copy_source_invalid",
      error: "Only a Market listing that has been sent for review can be copied.",
    });
  });

  it("does not trust a reply about another post", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: draft, source_id: draft, status: "draft", revision: 1 },
      error: null,
    });
    expect((await handlePostCopy(request(), id)).status).toBe(503);
  });
});

describe("readStaffCopyFacts", () => {
  const api = { rpc } as unknown as FoundationAuthenticatedApi;
  const facts = {
    post_id: draft,
    copied_from: { id, title: "Demo bakkie", status: "live" },
  };

  it("reads the facts of the claimed posts", async () => {
    rpc.mockResolvedValueOnce({ data: { items: [facts] }, error: null });
    const read = await readStaffCopyFacts(api, [draft]);
    expect(rpc).toHaveBeenCalledWith(
      "get_frontend_staff_copy_facts",
      { p_posts: [draft] },
      { get: false }
    );
    expect(read.get(draft)).toEqual({ copied_from: facts.copied_from });
  });

  it("leaves the hint out when the read fails or is malformed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await readStaffCopyFacts(api, [draft])).size).toBe(0);
    rpc.mockResolvedValueOnce({ data: { items: [{ ...facts, extra: 1 }] }, error: null });
    expect((await readStaffCopyFacts(api, [draft])).size).toBe(0);
  });

  it("reads nothing with the switch off or no claimed post", async () => {
    expect((await readStaffCopyFacts(api, [])).size).toBe(0);
    switches.SHOW_POST_COPY = false;
    expect((await readStaffCopyFacts(api, [draft])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("readMyCopyDrafts", () => {
  const api = { rpc } as unknown as FoundationAuthenticatedApi;

  it("reads the member's unfinished copies and their deletion dates", async () => {
    rpc.mockResolvedValueOnce({
      data: { items: [{ id: draft, deletes_at: "2026-12-05T10:00:00+00:00" }] },
      error: null,
    });
    const drafts = await readMyCopyDrafts(api);
    expect(rpc).toHaveBeenCalledWith("list_my_copy_drafts", {}, { get: false });
    expect(drafts.get(draft)).toBe("2026-12-05T10:00:00+00:00");
  });

  it("reads nothing with the switch off, and shows nothing when the read fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await readMyCopyDrafts(api)).size).toBe(0);
    switches.SHOW_POST_COPY = false;
    expect((await readMyCopyDrafts(api)).size).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
