/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { derivedEnquiryRequestId } from "@/lib/foundation/public-enquiry";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications";
import { sendContactFormNotification } from "@/lib/services/email";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { searchFoundationPresentedCards } from "@/lib/foundation/public-cards";

// The restored "Send an enquiry" dialog posts here. Production runs the
// foundation backend (the vitest default), so this route must reach
// api.submit_enquiry and never the old backend's clients or tables.

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: vi.fn(() => ({})) }));
vi.mock("@/lib/foundation/public-cards", () => ({ searchFoundationPresentedCards: vi.fn() }));
vi.mock("@/lib/utils/public-mutation-route", () => ({
  verifyPublicTurnstile: vi.fn(),
  enforcePublicMutationPrelude: vi.fn(() => {
    throw new Error("old-backend prelude must not run in foundation mode");
  }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "ip:synthetic" }),
}));
const { oldBackend } = vi.hoisted(() => ({
  oldBackend: (name: string) =>
    vi.fn(() => {
      throw new Error(`${name} must not be called in foundation mode`);
    }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: oldBackend("createAdminClient") }));
vi.mock("@/lib/supabase/server", () => ({ createClient: oldBackend("createClient") }));
vi.mock("@/lib/notifications", () => ({ createNotification: oldBackend("createNotification") }));
vi.mock("@/lib/services/email", () => ({
  sendContactFormNotification: oldBackend("sendContactFormNotification"),
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: oldBackend("logAuditEvent") }));

const account = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const post = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const csrf = "a".repeat(64);
const service = vi.fn(),
  authenticateCaller = vi.fn();
/** Exactly what content-enquiry-action.tsx sends for an event post. */
const dialog = {
  promotionId: post,
  message: "Is the market open on Sunday mornings?",
  buyerName: "Thabo Visitor",
  buyerEmail: "Visitor@Example.org",
  contactMethod: "form",
  turnstileToken: "synthetic-turnstile",
};

function request(
  body: unknown,
  { origin = "https://verifymzansi.com", withCsrf = true, raw = false } = {}
) {
  return new NextRequest("https://verifymzansi.com/api/contact", {
    method: "POST",
    body: raw ? String(body) : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      origin,
      ...(withCsrf ? { cookie: `vm_csrf=${csrf}`, "x-csrf-token": csrf } : {}),
    },
  });
}
/** The public card read for the post: its kind and stored form presentation. */
function cardsFor(kind: "listing" | "business" | "event", categoryDetails?: unknown) {
  return {
    items: [
      {
        id: post,
        kind,
        presentation: {
          frontend: {
            data: categoryDetails === undefined ? {} : { category_details: categoryDetails },
            media: [],
          },
        },
      },
    ],
  } as never;
}
const sent = () => service.mock.calls.map(([name, args]) => ({ name, args }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationRuntimeConnection).mockReturnValue({
    url: "https://gntzjtuncsyefujajmjy.supabase.co",
    expectedProjectRef: "gntzjtuncsyefujajmjy",
    publishableKey: "sb_publishable_synthetic",
  });
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(verifyPublicTurnstile).mockResolvedValue(null);
  service.mockResolvedValue({ data: { id: account, reused: false }, error: null });
  vi.mocked(createFoundationServiceApi).mockReturnValue({ rpc: service } as never);
  authenticateCaller.mockRejectedValue(new FoundationSessionError(401));
  vi.mocked(searchFoundationPresentedCards).mockResolvedValue(cardsFor("event"));
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: vi.fn(),
    authenticateCaller,
    respond: async (response: NextResponse) => {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});

describe("POST /api/contact on the foundation backend", () => {
  it("sends the dialog's fields to api.submit_enquiry once and answers success", async () => {
    const response = await POST(request({ ...dialog, buyerPhone: "071 234 5678" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(sent()).toHaveLength(1);
    const [{ name, args }] = sent();
    expect(name).toBe("submit_enquiry");
    expect(args).toEqual({
      p_request_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      p_post_id: post,
      p_buyer_email: "visitor@example.org",
      p_buyer_name: "Thabo Visitor",
      p_buyer_phone: "+27712345678",
      p_message: "Is the market open on Sunday mornings?",
    });
    // A signed-out visitor: no sender, rate limited per client.
    expect(args).not.toHaveProperty("p_sender");
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "ip:synthetic",
      action: "contact:send",
      degradedMode: "block",
    });
  });

  it("accepts the Market and Business dialogs' ids as the post id", async () => {
    const { promotionId: _event, ...rest } = dialog;
    expect((await POST(request({ ...rest, listingId: post }))).status).toBe(200);
    expect((await POST(request({ ...rest, businessId: post }))).status).toBe(200);
    expect(sent().map(({ args }) => args.p_post_id)).toEqual([post, post]);
  });

  it("binds the GoTrue-verified sender and rate limits per account, never from the body", async () => {
    authenticateCaller.mockResolvedValueOnce({ api: {}, accountId: account });
    const response = await POST(request({ ...dialog, sender: post, p_sender: post }));
    expect(response.status).toBe(200);
    expect(sent()[0].args.p_sender).toBe(account);
    expect(vi.mocked(checkRateLimit).mock.calls[0][0].key).toBe(account);
  });

  it("refuses a bad CAPTCHA with 400 before any session, limit or write", async () => {
    vi.mocked(verifyPublicTurnstile).mockResolvedValueOnce(
      Response.json({ error: "CAPTCHA verification failed" }, { status: 400 }) as never
    );
    const response = await POST(request(dialog));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "CAPTCHA verification failed" });
    expect(vi.mocked(verifyPublicTurnstile).mock.calls[0][1]).toBe("synthetic-turnstile");
    expect(authenticateCaller).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });

  it("answers 429 when rate limited and 503 when the limiter is degraded, writing nothing", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 30 });
    const limited = await POST(request(dialog));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    expect(await limited.json()).toEqual({ error: "Too many messages; try again later" });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, degraded: true });
    expect((await POST(request(dialog))).status).toBe(503);
    expect(service).not.toHaveBeenCalled();
  });

  it('answers 404 "Post not found" only when the database says the post is not public', async () => {
    service.mockResolvedValueOnce({
      data: null,
      error: { details: "post_unavailable", message: "post unavailable" },
    });
    const response = await POST(request(dialog));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Post not found", reason: "post_unavailable" });
  });

  it('never answers "not found" for a post when the database or service fails', async () => {
    const failures: Array<() => void> = [
      () => service.mockResolvedValueOnce({ data: null, error: { details: null, message: "x" } }),
      () => service.mockResolvedValueOnce({ data: null, error: { details: "PGRST116" } }),
      () => service.mockRejectedValueOnce(new Error("network")),
      () => service.mockResolvedValueOnce({ data: { unexpected: true }, error: null }),
      () =>
        vi.mocked(createFoundationServiceApi).mockImplementationOnce(() => {
          throw new Error("Foundation service binding is unavailable");
        }),
      () =>
        vi.mocked(createFoundationRouteContext).mockImplementationOnce(() => {
          throw new Error("Foundation connection is invalid");
        }),
      () => authenticateCaller.mockRejectedValueOnce(new FoundationSessionError(503)),
      () => authenticateCaller.mockRejectedValueOnce(new Error("Auth unreachable")),
    ];
    for (const arrange of failures) {
      arrange();
      const response = await POST(request(dialog));
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.error).toBe("Messages are temporarily unavailable");
      expect(JSON.stringify(body)).not.toMatch(/not found/i);
    }
  });

  it("maps the database's own refusals to the dialog's message", async () => {
    for (const [details, status, error] of [
      [
        "enquiries_disabled",
        403,
        "This poster isn't taking messages; use the contact options on the post",
      ],
      ["enquiry_limit", 429, "Too many messages; try again later"],
      ["own_post", 400, "You can't send a message about your own post"],
      ["sender_inactive", 403, "Your account can't send messages right now"],
      ["enquiry_invalid", 400, "Check the details and try again"],
    ] as const) {
      service.mockResolvedValueOnce({ data: null, error: { details, message: "internal text" } });
      const response = await POST(request(dialog));
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error).toBe(error);
      expect(JSON.stringify(body)).not.toContain("internal text");
    }
  });

  it("replays an identical enquiry under the same request id (stored once by the database)", async () => {
    service
      .mockResolvedValueOnce({ data: { id: account, reused: false }, error: null })
      .mockResolvedValueOnce({ data: { id: account, reused: true }, error: null });
    const first = await POST(request(dialog));
    const again = await POST(request({ ...dialog, turnstileToken: "another-token" }));
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(await again.json()).toEqual({ success: true });
    const [one, two] = sent().map(({ args }) => args.p_request_id);
    expect(two).toBe(one);
    // Different words, a different sender or another post are new enquiries.
    await POST(request({ ...dialog, message: `${dialog.message} Thanks.` }));
    authenticateCaller.mockResolvedValueOnce({ api: {}, accountId: account });
    await POST(request(dialog));
    await POST(request({ ...dialog, promotionId: account }));
    const ids = sent().map(({ args }) => args.p_request_id);
    expect(new Set(ids).size).toBe(4);
  });

  it("derives the request id from the compared fields and the UTC day", async () => {
    const command = {
      p_request_id: "00000000-0000-4000-8000-000000000000",
      p_post_id: post,
      p_buyer_email: "visitor@example.org",
      p_message: "Is the market open on Sunday mornings?",
    };
    const day = new Date("2026-11-08T08:00:00Z");
    const same = await derivedEnquiryRequestId(command, new Date("2026-11-08T23:59:59Z"));
    expect(await derivedEnquiryRequestId(command, day)).toBe(same);
    expect(await derivedEnquiryRequestId(command, new Date("2026-11-09T00:00:00Z"))).not.toBe(same);
    for (const change of [
      { p_buyer_name: "Thabo" },
      { p_buyer_phone: "+27712345678" },
      { p_sender: account },
      { p_buyer_email: "other@example.org" },
    ])
      expect(await derivedEnquiryRequestId({ ...command, ...change }, day)).not.toBe(same);
  });

  it("sends once more under a fresh id when another request holds the derived id", async () => {
    service
      .mockResolvedValueOnce({ data: null, error: { details: "enquiry_request_conflict" } })
      .mockResolvedValueOnce({ data: { id: account, reused: false }, error: null });
    const response = await POST(request(dialog));
    expect(response.status).toBe(200);
    const [first, second] = sent().map(({ args }) => args);
    expect(second.p_request_id).not.toBe(first.p_request_id);
    expect({ ...second, p_request_id: first.p_request_id }).toEqual(first);
    expect(service).toHaveBeenCalledTimes(2);
  });

  it("does not retry after an uncertain reply", async () => {
    service.mockRejectedValueOnce(new Error("timeout"));
    expect((await POST(request(dialog))).status).toBe(503);
    expect(service).toHaveBeenCalledTimes(1);
  });

  it("refuses before any write without origin, CSRF, valid JSON or valid fields", async () => {
    expect((await POST(request(dialog, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(request(dialog, { withCsrf: false }))).status).toBe(403);
    const invalidJson = await POST(request("{", { raw: true }));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: "Invalid JSON payload" });
    for (const body of [
      { ...dialog, turnstileToken: "" },
      { ...dialog, message: "short" },
      { ...dialog, promotionId: "not-a-uuid" },
      { ...dialog, listingId: post },
      { ...dialog, buyerPhone: "12345" },
      { ...dialog, buyerName: "Line\nbreak" },
      { ...dialog, message: `Hello there${String.fromCharCode(0)} is this available?` },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    const { buyerEmail: _email, ...withoutEmail } = dialog;
    const noEmail = await POST(request(withoutEmail));
    expect(noEmail.status).toBe(400);
    expect(await noEmail.json()).toEqual({
      error: "Provide a reply email so the recipient can respond.",
    });
    expect(service).not.toHaveBeenCalled();
  });

  it("never touches the old backend's clients, tables, notifications or email", async () => {
    await POST(request(dialog));
    service.mockResolvedValueOnce({ data: null, error: { details: "post_unavailable" } });
    await POST(request(dialog));
    await POST(request({ ...dialog, message: "x" }));
    for (const fn of [
      createAdminClient,
      createClient,
      createNotification,
      sendContactFormNotification,
    ])
      expect(fn).not.toHaveBeenCalled();
  });
});

describe("POST /api/contact on the foundation backend: business enquiry choice", () => {
  const { promotionId: _event, ...rest } = dialog;
  const business = { ...rest, businessId: post };

  it("refuses with 403 when the business turned the enquiry form off, writing nothing", async () => {
    vi.mocked(searchFoundationPresentedCards).mockResolvedValue(
      cardsFor("business", { contact_methods: ["call", "whatsapp"] })
    );
    const response = await POST(request(business));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        "This recipient has not enabled enquiries. Please use the contact options on the post.",
      reason: "enquiries_disabled",
    });
    expect(service).not.toHaveBeenCalled();
    expect(vi.mocked(searchFoundationPresentedCards).mock.calls[0][1]).toEqual({
      post_id: post,
      offset: 0,
      limit: 1,
    });
  });

  it("sends when the business offers the form or in-app messages, or never chose", async () => {
    for (const details of [
      { contact_methods: ["call", "form"] },
      { contact_methods: ["in_app"] },
      { customer_access: { methods: ["online"] } },
      undefined,
    ]) {
      vi.mocked(searchFoundationPresentedCards).mockResolvedValueOnce(
        cardsFor("business", details)
      );
      expect((await POST(request(business))).status).toBe(200);
    }
    expect(service).toHaveBeenCalledTimes(4);
  });

  it("leaves non-business posts and posts without a public card to the database", async () => {
    vi.mocked(searchFoundationPresentedCards).mockResolvedValueOnce(
      cardsFor("event", { contact_methods: ["call"] })
    );
    expect((await POST(request(dialog))).status).toBe(200);
    vi.mocked(searchFoundationPresentedCards).mockResolvedValueOnce({ items: [] } as never);
    service.mockResolvedValueOnce({ data: null, error: { details: "post_unavailable" } });
    expect((await POST(request(business))).status).toBe(404);
  });

  it("answers 503 and writes nothing when the business choice cannot be read", async () => {
    vi.mocked(searchFoundationPresentedCards).mockRejectedValueOnce(new Error("outage"));
    const response = await POST(request(business));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Messages are temporarily unavailable");
    expect(service).not.toHaveBeenCalled();
  });
});

describe("POST /api/contact on the foundation backend: limits and races", () => {
  it("replays the first answer when an identical request wins the race for the request id", async () => {
    service
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "23505",
          details: "Key (request_id)=(x) already exists.",
          message: "duplicate key value violates unique constraint enquiries_request_id_key",
        },
      })
      .mockResolvedValueOnce({ data: { id: account, reused: true }, error: null });
    const response = await POST(request(dialog));
    expect(response.status).toBe(200);
    const [first, second] = sent().map(({ args }) => args);
    expect(second).toEqual(first);
  });

  it("does not retry other unique violations", async () => {
    service.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", details: "Key (dedupe_key)=(x) already exists.", message: "dup" },
    });
    expect((await POST(request(dialog))).status).toBe(503);
    expect(service).toHaveBeenCalledTimes(1);
  });

  it("refuses a body over 8192 bytes and a CAPTCHA token over 4096 characters", async () => {
    const big = await POST(request({ ...dialog, padding: "x".repeat(8200) }));
    expect(big.status).toBe(400);
    const token = await POST(request({ ...dialog, turnstileToken: "t".repeat(4097) }));
    expect(token.status).toBe(400);
    expect(await token.json()).toEqual({ error: "Complete the CAPTCHA" });
    expect(verifyPublicTurnstile).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });
});
