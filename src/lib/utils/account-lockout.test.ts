import { describe, it, expect, beforeEach } from "vitest";
import {
  checkAccountLockout,
  recordFailedLogin,
  clearLockout,
  _resetForTesting,
} from "./account-lockout";

describe("account-lockout", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("allows login with no prior failures", () => {
    expect(checkAccountLockout("user@example.com")).toEqual({ locked: false });
  });

  it("allows login after fewer than 5 failures", () => {
    for (let i = 0; i < 4; i++) {
      recordFailedLogin("user@example.com");
    }
    expect(checkAccountLockout("user@example.com")).toEqual({ locked: false });
  });

  it("locks account after 5 failed attempts", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedLogin("user@example.com");
    }
    const result = checkAccountLockout("user@example.com");
    expect(result.locked).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("normalizes email to lowercase", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedLogin("User@Example.COM");
    }
    expect(checkAccountLockout("user@example.com").locked).toBe(true);
  });

  it("clears lockout on successful login", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedLogin("user@example.com");
    }
    expect(checkAccountLockout("user@example.com").locked).toBe(true);

    clearLockout("user@example.com");
    expect(checkAccountLockout("user@example.com")).toEqual({ locked: false });
  });

  it("tracks different accounts independently", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedLogin("locked@example.com");
    }
    recordFailedLogin("other@example.com");

    expect(checkAccountLockout("locked@example.com").locked).toBe(true);
    expect(checkAccountLockout("other@example.com").locked).toBe(false);
  });
});
