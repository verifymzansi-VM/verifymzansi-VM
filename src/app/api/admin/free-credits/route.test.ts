/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { freeCreditRefusal } from "@/lib/foundation/free-credits";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const rpc = vi.fn();
const api = { rpc } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
const ID = "6f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";
const ENDS = "2026-12-22T13:00:00.123456+00:00";
const GIVE = {
  action: "give",
  email: " thandi@example.co.za ",
  posts: 2,
  days: 30,
  reason: "Recruited at the market day",
};

async function options() {
  await POST(
    new NextRequest("https://verifymzansi.com/api/admin/free-credits", { method: "POST" })
  );
  return vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
}

/** What the route answers for a command failure, through its own refusal map. */
async function refusalFor(error: unknown, input: unknown = GIVE) {
  const route = await options();
  rpc.mockResolvedValueOnce({ data: null, error });
  try {
    await route.command(api, input);
  } catch (thrown) {
    return route.refusal(thrown);
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(NextResponse.json({ ok: true }));
});

// handleFoundationOwnerRoute owns same-origin, CSRF, the per-client rate
// limit, sign-in and body limits (src/lib/foundation/owner-route.test.ts).
describe("POST /api/admin/free-credits", () => {
  it("is a guarded write with its own rate-limit bucket", async () => {
    expect(await options()).toMatchObject({
      action: "admin:free-credits",
      mutate: true,
      refusal: freeCreditRefusal,
    });
  });

  it("gives through api.give_free_credit and returns the end", async () => {
    const route = await options();
    rpc.mockResolvedValue({ data: { id: ID, posts: 2, ends_at: ENDS }, error: null });
    await expect(route.command(api, GIVE)).resolves.toEqual({ id: ID, posts: 2, endsAt: ENDS });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "give_free_credit",
      {
        p_email: "thandi@example.co.za",
        p_posts: 2,
        p_days: 30,
        p_reason: "Recruited at the market day",
      },
      { get: false }
    );
  });

  it("extends through api.extend_free_credit", async () => {
    const route = await options();
    rpc.mockResolvedValue({ data: { id: ID, posts: 1, ends_at: ENDS }, error: null });
    await expect(
      route.command(api, { action: "extend", id: ID, days: 7, reason: " Still recruiting " })
    ).resolves.toEqual({ id: ID, posts: 1, endsAt: ENDS });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "extend_free_credit",
      { p_credit_id: ID, p_days: 7, p_reason: "Still recruiting" },
      { get: false }
    );
  });

  it("refuses out-of-range fields with that field's message before calling the database", async () => {
    const route = await options();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...GIVE, posts: 0 }, "free_credit_posts_invalid"],
      [{ ...GIVE, posts: 7 }, "free_credit_posts_invalid"],
      [{ ...GIVE, days: 0 }, "free_credit_days_invalid"],
      [{ ...GIVE, days: 31 }, "free_credit_days_invalid"],
      [{ ...GIVE, days: 1.5 }, "free_credit_days_invalid"],
      [{ ...GIVE, reason: "abcd" }, "free_credit_reason_required"],
      [{ ...GIVE, reason: "a".repeat(201) }, "free_credit_reason_required"],
      [{ ...GIVE, email: "a\u0000b@c.co" }, "free_credit_member_not_found"],
      [
        { action: "extend", id: ID, days: 31, reason: "Still recruiting" },
        "free_credit_days_invalid",
      ],
    ];
    for (const [input, reason] of cases) {
      const thrown = await route.command(api, input).catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(z.ZodError);
      expect(route.refusal(thrown)).toMatchObject({ status: 422, reason });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses other actions, extra fields and a bad gift id as an unreadable request", async () => {
    const route = await options();
    for (const input of [
      { ...GIVE, action: "grant" },
      { ...GIVE, area: "market" },
      { action: "extend", id: "not-a-uuid", days: 5, reason: "Still recruiting" },
      "not an object",
    ]) {
      const thrown = await route.command(api, input).catch((error: unknown) => error);
      expect(route.refusal(thrown)).toEqual({
        status: 422,
        error: "This request could not be read. Reload the page and try again.",
        reason: "free_credit_request_invalid",
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("words each database refusal by its reason", async () => {
    const cases: Array<[string, string, number]> = [
      ["PT409", "free_credit_member_not_found", 404],
      ["PT409", "free_credit_identity_required", 409],
      ["PT409", "free_credit_active", 409],
      ["42501", "staff_review_required", 403],
      ["42501", "staff_same_identity", 403],
      ["22023", "free_credit_posts_invalid", 422],
      ["22023", "free_credit_days_invalid", 422],
      ["22023", "free_credit_reason_required", 422],
      ["22023", "free_credit_not_found", 404],
      ["PT409", "free_credit_closed", 409],
    ];
    for (const [code, details, status] of cases)
      expect(await refusalFor({ code, message: "free credits: refused", details })).toMatchObject({
        status,
        reason: details,
      });
  });

  it("sends staff to verify again on a stale authenticator code", async () => {
    expect(
      await refusalFor({ code: "42501", message: "recent second-factor verification required" })
    ).toMatchObject({
      status: 403,
      reason: "staff_mfa_required",
      code: "step_up_required",
      redirectUrl: "/staff/two-step",
    });
  });

  it("refuses non-admins with a plain message", async () => {
    expect(await refusalFor({ code: "42501", message: "capability not granted" })).toEqual({
      status: 403,
      error: "Only admins can give free credits.",
      reason: "free_credit_not_allowed",
    });
  });

  it("leaves unknown failures to the route's generic answer", async () => {
    expect(await refusalFor({ code: "XX000", message: "boom" })).toBeNull();
  });
});
