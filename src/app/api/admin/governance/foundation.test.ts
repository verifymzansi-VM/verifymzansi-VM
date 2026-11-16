/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as appeal } from "./appeal/route";
import { POST as lift } from "./restrictions/lift/route";
import { POST as roles } from "./roles/route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({ checkSensitiveActionRateLimit: vi.fn() }));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const id = "00000000-0000-4000-8000-000000000001";
const staff = { accountId: "00000000-0000-4000-8000-000000000002", sessionId: "s" };
const answer = NextResponse.json({ ok: true });
const rpc = vi.fn();
const api = { rpc } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
const post = (path: string) =>
  new Request(`https://verifymzansi.com/api/admin/governance/${path}`, { method: "POST" });

async function optionsFor(route: (request: Request) => Promise<Response>, path: string) {
  await route(post(path));
  const options = vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
  expect(options.request).toBeInstanceOf(NextRequest);
  return options;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(answer);
  vi.mocked(checkSensitiveActionRateLimit).mockResolvedValue({ limited: false });
});

// handleFoundationOwnerRoute owns CSRF, sign-in and body limits (tested in
// src/lib/foundation/owner-route.test.ts); these cases cover each command.
describe("governance routes on foundation", () => {
  it("resolves an appeal and requires an end date only for a partial overturn", async () => {
    const options = await optionsFor(appeal, "appeal");
    expect(options).toMatchObject({ action: "admin:governance:appeal", maxBytes: 13500 });
    rpc.mockResolvedValue({
      data: { appeal_id: id, status: "overturned", restrictions_changed: 1 },
      error: null,
    });
    await expect(
      options.command(api, {
        appealId: id,
        status: "overturned",
        rationale: "The evidence was misread.",
        effectVersion: 2,
      })
    ).resolves.toEqual({ status: "overturned", appealId: id, restrictionsChanged: 1 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "resolve_frontend_appeal",
      {
        p_appeal: id,
        p_outcome: "overturned",
        p_reason: "The evidence was misread.",
        p_effect_version: 2,
      },
      { get: false }
    );
    const partial = { appealId: id, status: "partially_overturned", rationale: "Too long a ban." };
    await expect(options.command(api, partial)).rejects.toThrow();
    await expect(
      options.command(api, {
        appealId: id,
        status: "dismissed",
        rationale: "Nothing new was raised.",
        shortenTo: "2026-12-01T00:00:00Z",
      })
    ).rejects.toThrow();
  });

  it("lifts a restriction at the expected version", async () => {
    const options = await optionsFor(lift, "restrictions/lift");
    rpc.mockResolvedValue({ data: { restriction_id: id, status: "lifted" }, error: null });
    await expect(
      options.command(api, {
        restrictionId: id,
        expectedVersion: 3,
        reason: "Lifted after review.",
      })
    ).resolves.toEqual({ status: "lifted" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "lift_frontend_account_restriction",
      { p_restriction: id, p_expected_version: 3, p_reason: "Lifted after review." },
      { get: false }
    );
    await expect(options.command(api, { restrictionId: id, reason: "short" })).rejects.toThrow();
  });

  it("proposes and reviews role changes under the sensitive-action limit", async () => {
    const options = await optionsFor(roles, "roles");
    expect(options).toMatchObject({ action: "admin:role:review", requireCaller: true });
    rpc.mockResolvedValue({ data: { id, status: "proposed" }, error: null });
    await expect(
      options.command(
        api,
        {
          action: "propose",
          targetEmail: "mod@example.com",
          newRole: "governance_controller",
          reason: "Covers weekends",
        },
        staff
      )
    ).resolves.toEqual({ success: true, status: "proposed", decisionId: id });
    expect(checkSensitiveActionRateLimit).toHaveBeenCalledWith(
      staff.accountId,
      "admin:role:assign",
      5
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "propose_frontend_staff_role",
      { p_email: "mod@example.com", p_role: "governor", p_reason: "Covers weekends" },
      { get: false }
    );

    rpc.mockResolvedValue({ data: { id, status: "applied" }, error: null });
    await options.command(
      api,
      { action: "approve", decisionId: id, payloadVersion: 2, note: "Agreed" },
      staff
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "review_frontend_staff_role",
      { p_decision: id, p_action: "approve", p_version: 2, p_note: "Agreed" },
      { get: false }
    );
  });

  it("maps role refusals and the rate limit to clear errors", async () => {
    const options = await optionsFor(roles, "roles");
    const reject = { action: "reject", decisionId: id };
    for (const [error, status] of [
      [{ code: "PT404" }, 404],
      [{ code: "23514" }, 409],
      [{ message: "owner-approved administrator invitation required" }, 403],
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error });
      await expect(options.command(api, reject, staff)).rejects.toMatchObject({ status });
    }
    vi.mocked(checkSensitiveActionRateLimit).mockResolvedValueOnce({
      limited: true,
      degraded: true,
    });
    await expect(options.command(api, reject, staff)).rejects.toMatchObject({ status: 503 });
    await expect(options.command(api, reject)).rejects.toThrow("Verified role reviewer required");
  });
});
