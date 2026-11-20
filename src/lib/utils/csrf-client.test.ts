/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureCsrfTokenReady,
  getCsrfTokenFromDocumentCookie,
  withCsrfHeaders,
} from "./csrf-client";

// How a page fetches a token when it has none (csrf.test.ts covers reading
// and repairing the token). Added with the mutation-testing trial
// (docs/testing/mutation-trial.md).

const TOKEN = "f6".repeat(32);
const answer = (ok: boolean, body: unknown) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body });

beforeEach(() => {
  document.head.innerHTML = "";
  document.cookie = "vm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});
afterEach(() => vi.unstubAllGlobals());

describe("ensureCsrfTokenReady", () => {
  it("asks this site for a fresh token, never a cached one, with its own cookies only", async () => {
    const fetcher = answer(true, { token: TOKEN });
    vi.stubGlobal("fetch", fetcher);
    await expect(ensureCsrfTokenReady()).resolves.toBe(TOKEN);
    expect(fetcher).toHaveBeenCalledWith("/api/csrf", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("ignores a token in a failed answer", async () => {
    vi.stubGlobal("fetch", answer(false, { token: TOKEN }));
    await expect(ensureCsrfTokenReady()).resolves.toBeNull();
    expect(document.querySelector('meta[name="csrf-token"]')).toBeNull();
  });

  it.each([[{ token: "not-a-token" }], [{ token: 42 }], [null], [{}]])(
    "ignores an answer without a well-formed token: %j",
    async (body) => {
      vi.stubGlobal("fetch", answer(true, body));
      await expect(ensureCsrfTokenReady()).resolves.toBeNull();
      expect(document.querySelector('meta[name="csrf-token"]')).toBeNull();
    }
  );

  it("answers null when the request fails or fetch is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(ensureCsrfTokenReady()).resolves.toBeNull();
    vi.stubGlobal("fetch", undefined);
    await expect(ensureCsrfTokenReady()).resolves.toBeNull();
  });
});

describe("getCsrfTokenFromDocumentCookie", () => {
  it("treats a token cookie that cannot be decoded as no token, as the server does", () => {
    expect(getCsrfTokenFromDocumentCookie(`vm_csrf=%; vm_csrf=${TOKEN}`)).toBeNull();
    expect(getCsrfTokenFromDocumentCookie(`a=1; vm_csrf=${TOKEN}`)).toBe(TOKEN);
  });
});

describe("withCsrfHeaders", () => {
  it("adds no token header when the page has no token", () => {
    const headers = withCsrfHeaders({ Accept: "application/json" });
    expect(headers.has("x-csrf-token")).toBe(false);
    expect(headers.get("accept")).toBe("application/json");
  });
});
