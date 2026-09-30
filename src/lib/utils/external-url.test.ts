import { describe, expect, it } from "vitest";
import { isValidUserEnteredUrl, normalizeUserEnteredUrl } from "./external-url";

describe("normalizeUserEnteredUrl", () => {
  it("removes whitespace typed by mobile keyboards", () => {
    expect(normalizeUserEnteredUrl(" https:// www.example.co.za ")).toBe(
      "https://www.example.co.za"
    );
  });

  it("adds https:// to bare domains people commonly type", () => {
    expect(normalizeUserEnteredUrl("www.example.co.za")).toBe("https://www.example.co.za");
    expect(normalizeUserEnteredUrl("facebook.com/mypage")).toBe("https://facebook.com/mypage");
    expect(normalizeUserEnteredUrl("maps.app.goo.gl/abc123")).toBe(
      "https://maps.app.goo.gl/abc123"
    );
  });

  it("leaves explicit schemes and non-URLs alone", () => {
    expect(normalizeUserEnteredUrl("http://example.co.za")).toBe("http://example.co.za");
    expect(normalizeUserEnteredUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeUserEnteredUrl("not-a-url")).toBe("not-a-url");
    expect(normalizeUserEnteredUrl("")).toBe("");
  });
});

describe("isValidUserEnteredUrl", () => {
  it("accepts bare domains and rejects words", () => {
    expect(isValidUserEnteredUrl("www.example.co.za")).toBe(true);
    expect(isValidUserEnteredUrl("not-a-url")).toBe(false);
  });
});
