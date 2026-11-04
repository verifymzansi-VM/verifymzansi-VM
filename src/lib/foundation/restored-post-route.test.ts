/** @vitest-environment node */
import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { handleRestoredPostMutation } from "./restored-post-route";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationAccountContext } from "./account-context";
import { createFoundationServiceApi } from "./service-api";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("./account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./marketplace-server", () => ({ restoredPublicDetail: vi.fn() }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture-client" }),
}));
const owner = "11111111-1111-4111-8111-111111111111",
  post = "22222222-2222-4222-8222-222222222222",
  receipt = "33333333-3333-4333-8333-333333333333",
  csrf = "c".repeat(64),
  rpc = vi.fn(),
  serviceRpc = vi.fn();
function body(extra = {}) {
  return {
    postRequestId: receipt,
    postingTerms: { version: "posting-v1", document_hash: "a".repeat(43) },
    termsAccepted: true,
    title: "Example native listing",
    description: "A sufficiently detailed native listing description.",
    price_zar: 10,
    category: "other_items",
    attributes: { brand: "Example" },
    province: "Gauteng",
    city: "Johannesburg",
    images: [`https://media.verifymzansi.com/media/${post}`],
    contactMethods: ["form"],
    ...extra,
  };
}
function request(value: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/listings", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${csrf}`,
      "content-type": "application/json",
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(readFoundationAccountContext).mockResolvedValue({ account_id: owner } as Awaited<
    ReturnType<typeof readFoundationAccountContext>
  >);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (res: NextResponse) => res,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(createFoundationServiceApi).mockReturnValue({
    rpc: serviceRpc,
  } as unknown as ReturnType<typeof createFoundationServiceApi>);
  serviceRpc.mockResolvedValue({ data: true, error: null });
  rpc.mockResolvedValue({
    data: { id: post, status: "pending_moderation", revision: 6, original_id: post, edit_of: null },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("binds validated form data to the verified owner and consumes one receipt once", async () => {
  const response = await handleRestoredPostMutation(
    request(body({ owner_id: post, role: "admin" })),
    "listings"
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: post, status: "pending_moderation" });
  const staged = serviceRpc.mock.calls[0][1];
  expect(staged.p_owner).toBe(owner);
  expect(staged.p_request).toBe(receipt);
  expect(staged.p_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(staged.p_payload).not.toHaveProperty("owner_id");
  expect(staged.p_payload).not.toHaveProperty("role");
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "consume_frontend_post_command",
    { p_request: receipt },
    { get: false }
  );
});
it("preserves the native verification refusal and performs no blind command retry", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", details: "posting_verification_required" },
  });
  const response = await handleRestoredPostMutation(request(body()), "listings");
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "verification_required" });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("validates fields and CSRF before staging a command", async () => {
  expect((await handleRestoredPostMutation(request(body(), false), "listings")).status).toBe(403);
  const invalid = await handleRestoredPostMutation(request(body({ title: "x" })), "listings");
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({
    issues: expect.arrayContaining([expect.objectContaining({ path: "title" })]),
  });
  expect(serviceRpc).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it("requires a loaded revision for an edit and stages the route's target only", async () => {
  expect((await handleRestoredPostMutation(request(body()), "listings", post)).status).toBe(422);
  expect(serviceRpc).not.toHaveBeenCalled();
  const response = await handleRestoredPostMutation(
    request(body({ expectedRevision: 9, termsAccepted: false, target_id: owner })),
    "listings",
    post
  );
  expect(response.status).toBe(200);
  expect(serviceRpc.mock.calls[0][1].p_payload).toMatchObject({
    target_id: post,
    expected_revision: 9,
    terms_accepted: false,
  });
});
it("returns an uncertain outcome without replaying either mutation", async () => {
  rpc.mockRejectedValue(new Error("response lost"));
  expect((await handleRestoredPostMutation(request(body()), "listings")).status).toBe(503);
  expect(serviceRpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(1);
});
