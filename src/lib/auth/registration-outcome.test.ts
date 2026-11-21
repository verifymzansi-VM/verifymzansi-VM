import { describe, expect, it } from "vitest";
import { registrationOutcome } from "./registration-outcome";

describe("registrationOutcome", () => {
  it("leaves the invite-only words to the sign-in page's box (no repeated toast)", () => {
    expect(
      registrationOutcome({
        ok: true,
        inviteOnly: true,
        message: "VerifyMzansi is open by invitation for now.",
      })
    ).toEqual({ redirect: "/login?registered=invite", toast: null });
  });

  it("keeps the 'Account created!' toast for an open sign-up", () => {
    expect(registrationOutcome({ ok: true, inviteOnly: false })).toEqual({
      redirect: "/login?registered=true",
      toast: {
        title: "Account created!",
        description: "Check your email to confirm, then complete your account verification.",
      },
    });
  });

  it.each([null, "yes", { inviteOnly: "true" }, {}])(
    "treats any other answer as an open sign-up (%s)",
    (result) => {
      expect(registrationOutcome(result).redirect).toBe("/login?registered=true");
    }
  );
});
