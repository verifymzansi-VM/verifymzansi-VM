import { describe, expect, it } from "vitest";
import { getPlaywrightStubUserFromToken } from "./playwright-session";

describe("getPlaywrightStubUserFromToken", () => {
  it("returns null for malformed percent-encoded tokens instead of throwing", () => {
    expect(getPlaywrightStubUserFromToken("%")).toBeNull();
    expect(getPlaywrightStubUserFromToken("%E0%A4%A")).toBeNull();
    expect(getPlaywrightStubUserFromToken("persona%")).toBeNull();
  });

  it("returns null for tokens without the persona prefix", () => {
    expect(getPlaywrightStubUserFromToken("member")).toBeNull();
    expect(getPlaywrightStubUserFromToken(null)).toBeNull();
    expect(getPlaywrightStubUserFromToken(undefined)).toBeNull();
  });

  it("decodes a valid persona token", () => {
    const user = getPlaywrightStubUserFromToken("persona%3Averified-member");

    expect(user).not.toBeNull();
    expect(user?.persona).toBe("verified-member");
    expect(user?.email).toBe("verified-member@playwright.verifymzansi.test");
  });
});
