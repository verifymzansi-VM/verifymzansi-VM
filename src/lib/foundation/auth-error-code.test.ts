import { describe, expect, it } from "vitest";
import { authErrorCode } from "./auth-error-code";

describe("Auth's error code", () => {
  it.each([
    // The reply to API version 2024-01-01 (what the website asks for).
    [{ code: "same_password", message: "New password should be different" }, "same_password"],
    // Older replies: numeric code, string error_code.
    [{ code: 422, error_code: "email_exists", msg: "already registered" }, "email_exists"],
    [{ error_code: "weak_password" }, "weak_password"],
    [{ code: "", error_code: "insufficient_aal" }, "insufficient_aal"],
  ])("reads %j as %s", (body, code) => {
    expect(authErrorCode(body)).toBe(code);
  });

  it.each([null, undefined, "same_password", 42, [], {}, { code: 422 }, { error_code: 7 }])(
    "has no code for %j",
    (body) => {
      expect(authErrorCode(body)).toBeNull();
    }
  );
});
