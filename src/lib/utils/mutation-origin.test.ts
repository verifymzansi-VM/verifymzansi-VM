import { describe, expect, it, vi } from "vitest";
import { evaluateSameOriginMutation, enforceSameOriginMutation } from "./mutation-origin";

function createRequestLike(url: string, headers: Record<string, string | null | undefined> = {}) {
  return {
    url,
    headers: {
      get(name: string) {
        return headers[name] ?? null;
      },
    } as unknown as Headers,
    nextUrl: { pathname: new URL(url).pathname },
  };
}

describe("mutation-origin", () => {
  it("allows same-origin browser requests", () => {
    const request = createRequestLike("https://verifymzansi.com/api/profile/update", {
      origin: "https://verifymzansi.com",
    });

    expect(evaluateSameOriginMutation(request)).toEqual({
      allowed: true,
      reason: "same-origin",
    });
  });

  it("rejects foreign browser origins", () => {
    const request = createRequestLike("https://verifymzansi.com/api/profile/update", {
      origin: "https://evil.example",
    });

    expect(evaluateSameOriginMutation(request)).toMatchObject({
      allowed: false,
      reason: "cross-site-origin",
      status: 403,
    });
  });

  it("allows non-browser callers with no origin metadata", () => {
    const request = createRequestLike("https://verifymzansi.com/api/profile/update");

    expect(evaluateSameOriginMutation(request)).toEqual({
      allowed: true,
      reason: "non-browser",
    });
  });

  it("rejects cross-site fetch metadata without an origin", async () => {
    const request = createRequestLike("https://verifymzansi.com/api/profile/update", {
      "sec-fetch-site": "cross-site",
    });
    const warn = vi.fn();

    const response = enforceSameOriginMutation(request, { warn });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "Cross-site requests are not allowed",
    });
    expect(warn).toHaveBeenCalled();
  });

  it("rejects when origin header is syntactically invalid", () => {
    const request = createRequestLike("https://verifymzansi.com/api/update", {
      origin: "not-a-valid-url",
    });

    const result = evaluateSameOriginMutation(request);
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: "invalid-origin" });
  });
});
