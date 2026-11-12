/** @vitest-environment node */
// The four staff data-request routes on the foundation backend (production):
// intake, case (assign/extend), decide and complete. Each must call exactly
// one native command with the caller's own session, never the retired
// clients, and turn refusals into the staff messages the restored page shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST as intake } from "./intake/route";
import { POST as caseAction } from "./case/route";
import { POST as decide } from "./decide/route";
import { POST as complete } from "./complete/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

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
vi.mock("@/lib/services/email", () => ({
  sendDsarRejectedEmail: vi.fn(() => {
    throw new Error("Retired email path used");
  }),
  sendDsarCompletedEmail: vi.fn(() => {
    throw new Error("Retired email path used");
  }),
}));

const staff = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const assignee = "44444444-4444-4444-8444-444444444444";
const csrf = "c".repeat(64);
const rpc = vi.fn();
const authenticate = vi.fn();
type Handler = (request: Request) => Promise<Response>;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://verifymzansi.com/api/admin/dsar/${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  authenticate.mockResolvedValue({ rpc });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    authenticateCaller: async () => ({ api: { rpc }, accountId: staff, sessionId: staff }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/dsar/intake", () => {
  const body = {
    type: "access",
    requesterEmail: "  Requester@Example.Invalid ",
    description: "Please send me a copy of my data.",
    intakeNote: "Arrived by post; identity to be checked by phone.",
  };

  it("records the request through one command and returns its reference", async () => {
    rpc.mockResolvedValue({
      data: { id: requestId, due_by: "2026-12-11T08:00:00Z" },
      error: null,
    });
    const response = await intake(
      post("intake", { ...body, receivedAt: "2026-11-11T08:00:00+02:00" })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      status: "created",
      requestId,
      reference: "DSAR-22222222",
      dueBy: "2026-12-11T08:00:00Z",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "record_frontend_privacy_intake",
      {
        p_type: "access",
        p_email: "requester@example.invalid",
        p_phone: null,
        p_description: body.description,
        p_note: body.intakeNote,
        p_received: "2026-11-11T08:00:00+02:00",
      },
      { get: false }
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin:dsar:intake", degradedMode: "block" })
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("leaves the received time to the database when none is given", async () => {
    rpc.mockResolvedValue({ data: { id: requestId, due_by: "2026-12-11T08:00:00Z" }, error: null });
    await intake(post("intake", { ...body, requesterPhone: "0820000000" }));
    const args = rpc.mock.calls[0][1];
    expect(args).not.toHaveProperty("p_received");
    expect(args.p_phone).toBe("0820000000");
  });

  it("refuses unknown fields, short notes and bad types before calling anything", async () => {
    for (const bad of [
      { ...body, subjectUserId: staff },
      { ...body, intakeNote: "short" },
      { ...body, type: "erasure" },
      { ...body, receivedAt: "yesterday" },
    ]) {
      const response = await intake(post("intake", bad));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ reason: "invalid_staff_command" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an answer that is not exactly the created case", async () => {
    rpc.mockResolvedValue({
      data: { id: requestId, due_by: "2026-12-11T08:00:00Z", requester_email: "x" },
      error: null,
    });
    expect((await intake(post("intake", body))).status).toBe(503);
  });
});

describe("POST /api/admin/dsar/case", () => {
  it("extends with the reason as the note and returns the new deadline", async () => {
    rpc.mockResolvedValue({
      data: { id: requestId, status: "extended", due: "2027-01-10T08:00:00Z" },
      error: null,
    });
    const response = await caseAction(
      post("case", {
        action: "extend",
        requestId,
        revision: 3,
        reason: "Large account history needs more time.",
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "extended", due: "2027-01-10T08:00:00Z" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "process_frontend_privacy_request",
      {
        p_case: requestId,
        p_revision: 3,
        p_action: "extend",
        p_note: "Large account history needs more time.",
      },
      { get: false }
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("assigns and unassigns without sending an assignee for unassign", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: requestId, status: "assigned", due: null },
      error: null,
    });
    const assigned = await caseAction(
      post("case", { action: "assign", requestId, revision: 3, assigneeId: assignee })
    );
    expect(await assigned.json()).toEqual({ status: "assigned" });
    expect(rpc.mock.calls[0][1]).toEqual({
      p_case: requestId,
      p_revision: 3,
      p_action: "assign",
      p_assignee: assignee,
    });

    rpc.mockResolvedValueOnce({
      data: { id: requestId, status: "unassigned", due: null },
      error: null,
    });
    const unassigned = await caseAction(
      post("case", { action: "assign", requestId, revision: 4, assigneeId: null })
    );
    expect(await unassigned.json()).toEqual({ status: "unassigned" });
    expect(rpc.mock.calls[1][1]).toEqual({ p_case: requestId, p_revision: 4, p_action: "assign" });
  });

  it("refuses a status other than the one the action produces", async () => {
    // Asked to assign, the database says "unassigned": the result is not trusted.
    rpc.mockResolvedValue({
      data: { id: requestId, status: "unassigned", due: null },
      error: null,
    });
    const response = await caseAction(
      post("case", { action: "assign", requestId, revision: 3, assigneeId: assignee })
    );
    expect(response.status).toBe(503);
  });

  it("refuses an extension without a new deadline, and other actions with one", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: requestId, status: "extended", due: null },
      error: null,
    });
    const extend = await caseAction(
      post("case", {
        action: "extend",
        requestId,
        revision: 3,
        reason: "Needs more time to check.",
      })
    );
    expect(extend.status).toBe(503);

    rpc.mockResolvedValueOnce({
      data: { id: requestId, status: "assigned", due: "2027-01-10T08:00:00Z" },
      error: null,
    });
    const assign = await caseAction(
      post("case", { action: "assign", requestId, revision: 3, assigneeId: assignee })
    );
    expect(assign.status).toBe(503);
  });

  it("requires a revision and refuses out-of-range ones", async () => {
    for (const revision of [undefined, 0, 2147483647, 1.5]) {
      const response = await caseAction(
        post("case", { action: "assign", requestId, assigneeId: null, revision })
      );
      expect(response.status).toBe(422);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/dsar/decide", () => {
  it.each([
    ["approve", "in_progress"],
    ["reject", "rejected"],
    ["verify_identity", "identity_verified"],
  ] as const)("sends %s and accepts only %s", async (decision, status) => {
    rpc.mockResolvedValue({ data: { id: requestId, status, due: null }, error: null });
    const response = await decide(
      post("decide", { requestId, revision: 2, decision, notes: "  Checked by phone.  " })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "process_frontend_privacy_request",
      { p_case: requestId, p_revision: 2, p_action: decision, p_note: "Checked by phone." },
      { get: false }
    );
  });

  it("does not send the retired rejection email itself", async () => {
    rpc.mockResolvedValue({ data: { id: requestId, status: "rejected", due: null }, error: null });
    expect(
      (await decide(post("decide", { requestId, revision: 2, decision: "reject" }))).status
    ).toBe(200);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a decision the restored page does not offer", async () => {
    const response = await decide(post("decide", { requestId, revision: 2, decision: "complete" }));
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/dsar/complete", () => {
  it("passes the deletion attestation and notes through to one command", async () => {
    rpc.mockResolvedValue({ data: { id: requestId, status: "completed", due: null }, error: null });
    const response = await complete(
      post("complete", {
        requestId,
        revision: 7,
        notes: "Export sent.",
        deletionAttestation: "Deleted the account and its posts on 11 November.",
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "completed" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "process_frontend_privacy_request",
      {
        p_case: requestId,
        p_revision: 7,
        p_action: "complete",
        p_note: "Export sent.",
        p_attestation: "Deleted the account and its posts on 11 November.",
      },
      { get: false }
    );
  });

  it("omits an empty attestation instead of sending a blank one", async () => {
    rpc.mockResolvedValue({ data: { id: requestId, status: "completed", due: null }, error: null });
    await complete(post("complete", { requestId, revision: 7, deletionAttestation: "   " }));
    expect(rpc.mock.calls[0][1]).toEqual({
      p_case: requestId,
      p_revision: 7,
      p_action: "complete",
    });
  });
});

describe("shared protections of the four routes", () => {
  const cases: Array<[string, Handler, unknown]> = [
    [
      "intake",
      intake,
      {
        type: "deletion",
        requesterEmail: "requester@example.invalid",
        description: "Please delete my account.",
        intakeNote: "Arrived by email from the account address.",
      },
    ],
    ["case", caseAction, { action: "assign", requestId, revision: 1, assigneeId: null }],
    ["decide", decide, { requestId, revision: 1, decision: "approve" }],
    ["complete", complete, { requestId, revision: 1 }],
  ];

  it.each(cases)(
    "%s refuses another site's origin before anything else",
    async (path, handler, body) => {
      const response = await handler(post(path, body, { origin: "https://evil.example" }));
      expect(response.status).toBe(403);
      expect(createFoundationRouteContext).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it.each(cases)("%s refuses a missing CSRF token", async (path, handler, body) => {
    const response = await handler(post(path, body, { "x-csrf-token": "d".repeat(64) }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(cases)("%s blocks when the rate limiter is degraded", async (path, handler, body) => {
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, degraded: true });
    const response = await handler(post(path, body));
    expect(response.status).toBe(503);
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: `admin:dsar:${path}`, degradedMode: "block" })
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(cases)("%s answers 429 when limited", async (path, handler, body) => {
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 30 });
    const response = await handler(post(path, body));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(cases)("%s asks a signed-out caller to sign in", async (path, handler, body) => {
    authenticate.mockRejectedValue(new FoundationSessionError(401));
    const response = await handler(post(path, body));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to manage data requests" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(cases)("%s refuses a body that is not JSON", async (path, handler) => {
    const response = await handler(post(path, "{not json"));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(cases)(
    "%s sends staff whose second factor expired to verify again",
    async (path, handler, body) => {
      rpc.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "staff second-factor verification expired" },
      });
      const response = await handler(post(path, body));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        reason: "staff_mfa_required",
        code: "step_up_required",
        redirectUrl: "/staff/two-step",
      });
    }
  );

  it.each(cases)(
    "%s reports other refusals without database detail",
    async (path, handler, body) => {
      for (const [code, status] of [
        ["42501", 403],
        ["PT409", 409],
        ["PT429", 429],
        ["22023", 422],
        ["XX000", 503],
      ] as const) {
        rpc.mockResolvedValueOnce({
          data: null,
          error: { code, message: `internal detail private.dsar_cases ${code}` },
        });
        const response = await handler(post(path, body));
        expect(response.status).toBe(status);
        expect(JSON.stringify(await response.json())).not.toContain("private.dsar_cases");
      }
    }
  );
});
