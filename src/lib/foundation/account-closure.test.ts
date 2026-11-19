import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { accountClosureRefusal, closeMyAccount } from "./account-closure";
import { foundationLatestSignIn } from "./sign-in-claims";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import {
  ACCOUNT_CLOSURE_UNKNOWN_OUTCOME,
  accountClosureDates,
  accountErasureDeadline,
  confirmsAccountClosure,
} from "@/lib/account/account-closure";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const account = "5f0c2b1e-7a3d-4c8e-9b6f-1d2e3f4a5b6c";
const NOW = Date.parse("2026-11-17T10:00:00Z");
const nowSeconds = NOW / 1000;
/** A caller whose verified session carries this `amr` (owner-route.ts). */
const callerWith = (amr: unknown) => ({
  accountId: account,
  signedInAt: foundationLatestSignIn(amr, nowSeconds),
});
const fresh = callerWith([{ method: "password", timestamp: nowSeconds - 60 }]);
const closed = {
  status: "closed",
  closed_at: "2026-11-17T10:00:00+00:00",
  erase_after: "2026-12-17T10:00:00+00:00",
  request_id: "6a1d3c2f-8b4e-4d9f-a0b1-2c3d4e5f6a7b",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
});

const close = (caller = fresh, input: unknown = { confirmation: "DELETE" }) =>
  closeMyAccount(api, input, caller, NOW).catch((e: unknown) => accountClosureRefusal(e) ?? e);

/** What the route answers when the command fails with this database error. */
async function refusalFor(error: { code: string; details?: string; message?: string }) {
  rpc.mockResolvedValueOnce({ data: null, error });
  return close();
}

describe("closeMyAccount", () => {
  it("closes the caller's account once and reports the erasure dates", async () => {
    rpc.mockResolvedValueOnce({ data: closed, error: null });
    await expect(close()).resolves.toEqual({
      status: "closed",
      closedAt: closed.closed_at,
      eraseAfter: closed.erase_after,
      eraseBy: "2026-12-24T10:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("close_my_account", {}, { get: false });
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: account,
      action: "account:delete",
      degradedMode: "block",
    });
  });

  it("accepts a Google sign-in from the last 15 minutes", async () => {
    rpc.mockResolvedValueOnce({ data: closed, error: null });
    const google = callerWith([{ method: "oauth", timestamp: nowSeconds - 14 * 60 }]);
    await expect(close(google)).resolves.toMatchObject({ status: "closed" });
  });

  it.each([
    ["a reset link", [{ method: "recovery", timestamp: nowSeconds - 10 }]],
    ["a magic link", [{ method: "magiclink", timestamp: nowSeconds - 10 }]],
    ["an emailed code", [{ method: "otp", timestamp: nowSeconds - 10 }]],
    ["an invite", [{ method: "invite", timestamp: nowSeconds - 10 }]],
    ["an email change link", [{ method: "email_change", timestamp: nowSeconds - 10 }]],
    [
      "an authenticator step after an old password sign-in",
      [
        { method: "password", timestamp: nowSeconds - 3600 },
        { method: "totp", timestamp: nowSeconds - 10 },
      ],
    ],
    [
      "a reset link after an old password sign-in",
      [
        { method: "password", timestamp: nowSeconds - 16 * 60 },
        { method: "recovery", timestamp: nowSeconds - 10 },
      ],
    ],
    ["a password sign-in 16 minutes ago", [{ method: "password", timestamp: nowSeconds - 960 }]],
    ["no sign-in record", undefined],
  ])("sends a session opened by %s to sign in again, before the database", async (_, amr) => {
    expect(await close(callerWith(amr))).toEqual({
      status: 401,
      error: "For your safety, sign in again, then delete your account within 15 minutes.",
      reason: "recent_sign_in_required",
      code: "reauthentication_required",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("limits each account as well as each client, before the database", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 30 });
    expect(await close()).toMatchObject({ status: 429, reason: "rate_limited", retryAfter: 30 });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: false, degraded: true });
    expect(await close()).toMatchObject({ status: 503, reason: "limiter" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ confirmation: "" }],
    [{ confirmation: "DELETED" }],
    [{ confirmation: "DELETE", currentPassword: "secret" }],
    [{ confirmation: "DELETE", account: "someone-else" }],
    [null],
  ])("refuses %j without calling the database", async (input) => {
    expect(await close(fresh, input)).toEqual({
      status: 422,
      error: "Type DELETE to confirm.",
      reason: "confirmation_required",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("passes on the database's own sign-in check", async () => {
    expect(
      await refusalFor({
        code: "42501",
        details: "recent_sign_in_required",
        message: "sign in again to close the account",
      })
    ).toMatchObject({ status: 401, code: "reauthentication_required" });
  });

  it("explains that a staff account is closed only after its roles end", async () => {
    expect(
      await refusalFor({
        code: "42501",
        details: "staff_account",
        message: "a staff account is closed only after its roles end",
      })
    ).toMatchObject({ status: 409, reason: "staff_account" });
  });

  it("asks for a fresh sign-in when the session is gone or unconfirmed", async () => {
    expect(
      await refusalFor({ code: "42501", message: "live confirmed member session required" })
    ).toEqual({
      status: 401,
      error:
        "Your session has ended or your email address is not confirmed. If you just deleted your account, it is closed; otherwise confirm your email address, sign in again and try again.",
      reason: "session_required",
      code: "session_required",
    });
  });

  it("says when the account no longer exists", async () => {
    expect(
      await refusalFor({
        code: "PT404",
        details: "account_unavailable",
        message: "account not found",
      })
    ).toMatchObject({ status: 404, reason: "account_unavailable" });
  });

  it("says nothing changed when the database answered with any other error", async () => {
    for (const error of [
      { code: "55000", message: "sign-in could not be blocked" },
      { code: "55000", message: "sessions could not be ended" },
      { code: "57014", message: "canceling statement due to statement timeout" },
      { code: "PGRST202", message: "function not found" },
    ])
      expect(await refusalFor(error)).toEqual({
        status: 503,
        error: "Your account could not be closed. Nothing was changed; try again in a few minutes.",
        reason: "closure_failed",
      });
  });

  it("never says 'not closed' when the answer was lost", async () => {
    const unknown = {
      status: 503,
      error: ACCOUNT_CLOSURE_UNKNOWN_OUTCOME,
      reason: "outcome_unknown",
      code: "outcome_unknown",
    };
    // No reply (supabase-js reports a failed fetch without a code).
    expect(await refusalFor({ code: "", message: "TypeError: fetch failed" })).toEqual(unknown);
    // A gateway error page instead of a database answer.
    expect(await refusalFor({ code: "502", message: "Bad Gateway" })).toEqual(unknown);
    // The call itself threw.
    rpc.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await close()).toEqual(unknown);
    // Answered without an error but unreadable.
    rpc.mockResolvedValueOnce({ data: { ...closed, erase_after: "soon" }, error: null });
    expect(await close()).toEqual(unknown);
    expect(ACCOUNT_CLOSURE_UNKNOWN_OUTCOME).toBe(
      "We couldn't confirm whether your account was closed. Try signing in: if you can't, it was closed. Contact support if unsure."
    );
  });
});

describe("account closure dates", () => {
  it("erases 30 days after closing and is due 7 days after that", () => {
    const { eraseAfter, eraseBy } = accountClosureDates(new Date("2026-11-17T10:00:00Z"));
    expect(eraseAfter.toISOString()).toBe("2026-12-17T10:00:00.000Z");
    expect(eraseBy.toISOString()).toBe("2026-12-24T10:00:00.000Z");
    expect(accountErasureDeadline(eraseAfter)).toEqual(eraseBy);
  });

  it("accepts the typed word in any case with outer spaces only", () => {
    expect(confirmsAccountClosure(" delete ")).toBe(true);
    expect(confirmsAccountClosure("DELETE")).toBe(true);
    expect(confirmsAccountClosure("DEL ETE")).toBe(false);
    expect(confirmsAccountClosure("")).toBe(false);
  });
});
