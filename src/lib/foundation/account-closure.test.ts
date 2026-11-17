import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { accountClosureRefusal, closeMyAccount } from "./account-closure";
import {
  accountClosureDates,
  accountErasureDeadline,
  confirmsAccountClosure,
} from "@/lib/account/account-closure";

const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const closed = {
  status: "closed",
  closed_at: "2026-11-17T10:00:00+00:00",
  erase_after: "2026-12-17T10:00:00+00:00",
  request_id: "5f0c2b1e-7a3d-4c8e-9b6f-1d2e3f4a5b6c",
};

beforeEach(() => {
  vi.resetAllMocks();
});

/** What the route answers when the command fails with this database error. */
async function refusalFor(error: { code: string; details?: string; message?: string }) {
  rpc.mockResolvedValueOnce({ data: null, error });
  const thrown = await closeMyAccount(api, { confirmation: "DELETE" }).catch((e: unknown) => e);
  return accountClosureRefusal(thrown);
}

describe("closeMyAccount", () => {
  it("closes the caller's account once and reports the erasure dates", async () => {
    rpc.mockResolvedValueOnce({ data: closed, error: null });
    await expect(closeMyAccount(api, { confirmation: "DELETE" })).resolves.toEqual({
      status: "closed",
      closedAt: closed.closed_at,
      eraseAfter: closed.erase_after,
      eraseBy: "2026-12-24T10:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("close_my_account", {}, { get: false });
  });

  it.each([
    [{}],
    [{ confirmation: "" }],
    [{ confirmation: "DELETED" }],
    [{ confirmation: "DELETE", currentPassword: "secret" }],
    [{ confirmation: "DELETE", account: "someone-else" }],
    [null],
  ])("refuses %j without calling the database", async (input) => {
    const thrown = await closeMyAccount(api, input).catch((e: unknown) => e);
    expect(accountClosureRefusal(thrown)).toEqual({
      status: 422,
      error: "Type DELETE to confirm.",
      reason: "confirmation_required",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the member to sign in again when the sign-in is older than 15 minutes", async () => {
    expect(
      await refusalFor({
        code: "42501",
        details: "recent_sign_in_required",
        message: "sign in again to close the account",
      })
    ).toEqual({
      status: 401,
      error: "For your safety, sign in again, then delete your account within 15 minutes.",
      reason: "recent_sign_in_required",
      code: "reauthentication_required",
    });
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
      error: "Sign in again to delete your account.",
      reason: "session_required",
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

  it("says nothing changed when sign-in could not be blocked or a session ended", async () => {
    for (const message of ["sign-in could not be blocked", "sessions could not be ended"])
      expect(await refusalFor({ code: "55000", message })).toMatchObject({
        status: 503,
        reason: "closure_incomplete",
      });
  });

  it("leaves any other failure to the route's generic answer", async () => {
    expect(await refusalFor({ code: "XX000", message: "boom" })).toBeNull();
    expect(await refusalFor({ code: "PT404", message: "other" })).toBeNull();
  });

  it("refuses an acknowledgement it cannot read", async () => {
    rpc.mockResolvedValueOnce({ data: { ...closed, status: "open" }, error: null });
    const thrown = await closeMyAccount(api, { confirmation: "DELETE" }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect(accountClosureRefusal(thrown)).toBeNull();
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
