/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET } from "./status/route";
import { POST } from "./location/manual/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
const owner = "11111111-1111-4111-8111-111111111111",
  at = "2026-11-04T00:00:00Z",
  csrf = "c".repeat(64),
  rpc = vi.fn();
let confirmed = false;
// A case staff sent back, as the identity review stores it (or null).
let returned: { reason: string; decision: "rejected" | "needs_resubmission" } | null = null;
const caseId = "22222222-2222-4222-8222-222222222222";
function snapshot() {
  return {
    version: 1,
    account_id: owner,
    generated_at: at,
    verification: {
      case_id: returned ? caseId : null,
      version: returned ? 2 : null,
      verified: false,
      phone_verified: false,
      locality_confirmed: confirmed,
      submission_pending: false,
      return_reason: returned?.reason ?? null,
    },
    profile_facts: {
      legal_name_locked_at: null,
      phone_changed_at: null,
      phone_verified_at: null,
      identity_reviewed_at: null,
      location_province: confirmed ? "Gauteng" : null,
      location_city: confirmed ? "Johannesburg" : null,
      location_confirmed_at: confirmed ? at : null,
    },
    counts: {
      active_listings: 0,
      active_events: 0,
      rejected_listings: 0,
      pending_listings: 0,
      expiring_listings: 0,
      expiring_events: 0,
      businesses: 0,
      tourism_businesses: 0,
    },
    unread_leads: 0,
    unread_notifications: 0,
    organisation_admin_count: 0,
    posts: [],
    recent_leads: [],
    paid_plans: [],
  };
}
function request(body?: unknown, valid = true) {
  return new NextRequest(
    "https://verifymzansi.com/api/verification" + (body ? "/location/manual" : "/status"),
    body
      ? {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            origin: "https://verifymzansi.com",
            "content-type": "application/json",
            cookie: `vm_csrf=${csrf}`,
            ...(valid ? { "x-csrf-token": csrf } : {}),
          },
        }
      : {}
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  confirmed = false;
  returned = null;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(readFoundationAccountContext).mockResolvedValue({ account_id: owner } as Awaited<
    ReturnType<typeof readFoundationAccountContext>
  >);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_my_frontend_verification_uploads") return { data: [], error: null };
    if (name === "get_my_frontend_identity_state")
      return {
        data: {
          account_id: owner,
          case_id: returned ? caseId : null,
          case_version: returned ? 2 : null,
          reason: returned?.reason ?? null,
          decision: returned?.decision ?? null,
          identity_reviewed_at: null,
          id_document_uploaded_at: null,
          selfie_uploaded_at: null,
        },
        error: null,
      };
    if (name === "confirm_verification_locality") {
      confirmed = true;
      return {
        data: {
          status: "approved",
          assurance: "self_declared",
          province_id: "gp",
          city_id: "gp_johannesburg",
          reused: false,
        },
        error: null,
      };
    }
    if (name === "get_my_dashboard") return { data: snapshot(), error: null };
    throw new Error(`Unexpected native verification command: ${name}`);
  });
});
afterEach(() => vi.unstubAllEnvs());
it("reports canonical facts without granting verification from metadata or inventing completed steps", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    accountVerificationStatus: "incomplete",
    overallStatus: "incomplete",
    steps: [],
  });
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("maps the preserved location form to canonical IDs and reports self-declared assurance", async () => {
  const response = await POST(request({ province: "Gauteng", city: "Johannesburg" }));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "confirm_verification_locality",
    { p_province: "gp", p_city: "gp_johannesburg" },
    { get: false }
  );
  expect(await response.json()).toMatchObject({
    success: true,
    accountVerificationStatus: "incomplete",
    steps: [
      {
        step_type: "location",
        status: "approved",
        reviewed_at: at,
        location_province: "Gauteng",
        location_city: "Johannesburg",
        metadata: { location_assurance: "self_declared" },
      },
    ],
  });
});
it("rejects mismatched locations, claimed authority and missing CSRF before mutating", async () => {
  expect((await POST(request({ province: "Gauteng", city: "Cape Town" }))).status).toBe(400);
  expect(
    (await POST(request({ province: "Gauteng", city: "Johannesburg", user_id: owner }))).status
  ).toBe(400);
  expect((await POST(request({ province: "Gauteng", city: "Johannesburg" }, false))).status).toBe(
    403
  );
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves the native confirmed-locality lock instead of overwriting it", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
  expect((await POST(request({ province: "Gauteng", city: "Johannesburg" }))).status).toBe(403);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("shows the reviewer's explanation and reason code on both identity steps of a returned case", async () => {
  const note =
    "Please retake your photo in even light without glare. Keep the camera steady and make sure the details are sharp.";
  returned = { reason: `Retake requested (blurry_image): ${note}`, decision: "needs_resubmission" };
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.steps).toEqual([
    expect.objectContaining({
      step_type: "id_doc",
      status: "needs_resubmission",
      reason_code: "blurry_image",
      reason_note: note,
    }),
    expect.objectContaining({
      step_type: "selfie",
      status: "needs_resubmission",
      reason_code: "blurry_image",
      reason_note: note,
    }),
  ]);
  expect(JSON.stringify(body)).not.toContain("Retake requested");
  expect(body.steps[0]).not.toHaveProperty("rejection_reason");
});
it("shows a rejected case's explanation, and a reason in another form as written", async () => {
  returned = {
    reason: "Rejected (mismatch): The name does not match the ID.",
    decision: "rejected",
  };
  let body = await (await GET(request())).json();
  expect(body.steps[0]).toMatchObject({
    status: "rejected",
    reason_code: "mismatch",
    reason_note: "The name does not match the ID.",
  });
  returned = { reason: "Synthetic return written another way", decision: "needs_resubmission" };
  body = await (await GET(request())).json();
  expect(body.steps[0]).toMatchObject({
    reason_code: null,
    reason_note: "Synthetic return written another way",
  });
});
