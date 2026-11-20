/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureCsrfTokenReady,
  getCsrfTokenFromDocumentCookie,
  withCsrfHeaders,
} from "./csrf-client";

// The browser half of the CSRF helpers when it runs on the server (during
// server rendering there is no page, cookie or token): it answers "no token"
// without touching the network. Added with the mutation-testing trial
// (docs/testing/mutation-trial.md).

afterEach(() => vi.unstubAllGlobals());

describe("on the server", () => {
  it("has no token and never fetches one", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(getCsrfTokenFromDocumentCookie()).toBeNull();
    await expect(ensureCsrfTokenReady()).resolves.toBeNull();
    expect(withCsrfHeaders().has("x-csrf-token")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
