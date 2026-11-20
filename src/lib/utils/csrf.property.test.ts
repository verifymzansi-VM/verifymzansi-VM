/** @vitest-environment node */
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { enforceCsrfToken, generateCsrfToken } from "./csrf";
import { isValidCsrfToken, parseCsrfCookieHeader } from "./csrf-client";
import { enforceSameOriginMutation, evaluateSameOriginMutation } from "./mutation-origin";
import { recordSecurityEvent } from "@/lib/security/security-events";

// Property tests for the double-submit token and the origin check (see
// csrf.test.ts and mutation-origin.test.ts for named examples).

vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));

const SITE = "https://verifymzansi.com";
const hexToken = fc.stringMatching(/^[0-9a-fA-F]{64}$/);
/** Tokens of every kind, including a valid token with text before or after it. */
const anyToken = fc.oneof(
  hexToken,
  fc.string({ maxLength: 70 }),
  fc.stringMatching(/^[0-9a-f]{60,68}$/),
  fc
    .tuple(fc.string({ minLength: 1, maxLength: 3 }), hexToken)
    .map(([junk, token]) => junk + token),
  fc.tuple(hexToken, fc.string({ minLength: 1, maxLength: 3 })).map(([token, junk]) => token + junk)
);
/** The rule, written out independently of the code under test. */
const wellFormed = (token: string) => /^[0-9a-fA-F]{64}$/.test(token);
/** Other cookies a browser may send alongside the token. */
const otherCookies = fc.array(
  fc.tuple(fc.stringMatching(/^[a-z_]{1,10}$/), fc.stringMatching(/^[A-Za-z0-9%]{0,12}$/)),
  { maxLength: 4 }
);

function request(headers: Record<string, string>) {
  return new NextRequest(`${SITE}/api/profile/update`, { method: "POST", headers });
}

describe("the double-submit token", () => {
  it("passes exactly when cookie and header are the same 64-hex-digit token", () => {
    fc.assert(
      fc.property(anyToken, fc.option(anyToken, { nil: undefined }), (cookie, header) => {
        const headers: Record<string, string> = { cookie: `vm_csrf=${encodeURIComponent(cookie)}` };
        if (header !== undefined) headers["x-csrf-token"] = header;
        const refused = enforceCsrfToken(request(headers)) !== null;
        const expected = wellFormed(cookie) && header === cookie;
        expect(isValidCsrfToken(cookie)).toBe(wellFormed(cookie));
        expect(refused).toBe(!expected);
      }),
      { numRuns: 500 }
    );
  });

  it("is found among any other cookies, in any position", () => {
    fc.assert(
      fc.property(hexToken, otherCookies, otherCookies, (token, before, after) => {
        const cookies = [...before, ["vm_csrf", token], ...after].map(
          ([name, value]) => `${name}=${value}`
        );
        const header = cookies.join("; ");
        // The first vm_csrf cookie wins; the generated names can include it.
        if (before.some(([name]) => name === "vm_csrf")) return;
        expect(parseCsrfCookieHeader(header, "vm_csrf")).toBe(token);
        expect(enforceCsrfToken(request({ cookie: header, "x-csrf-token": token }))).toBeNull();
      })
    );
  });

  it("is never read from a cookie whose name only contains the token's name", () => {
    fc.assert(
      fc.property(
        hexToken,
        fc.constantFrom("xvm_csrf", "vm_csrf2", "vm_csrf_old", "VM_CSRF"),
        (token, name) => {
          expect(parseCsrfCookieHeader(`${name}=${token}`, "vm_csrf")).toBeNull();
          expect(
            enforceCsrfToken(request({ cookie: `${name}=${token}`, "x-csrf-token": token }))
          ).not.toBeNull();
        }
      )
    );
  });

  it("new tokens are always valid and differ", () => {
    const tokens = Array.from({ length: 200 }, generateCsrfToken);
    for (const token of tokens) expect(isValidCsrfToken(token)).toBe(true);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("the origin check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(recordSecurityEvent).mockClear();
  });

  it("allows this site's own origin from any page", () => {
    fc.assert(
      fc.property(fc.webPath(), (path) => {
        const decision = evaluateSameOriginMutation(
          request({ origin: SITE, referer: `${SITE}${path}` })
        );
        expect(decision.allowed).toBe(true);
      })
    );
  });

  it("refuses any other origin, whatever fetch metadata says", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ withQueryParameters: false, withFragments: false }),
        fc.constantFrom(undefined, "same-origin", "same-site", "cross-site", "none"),
        (url, site) => {
          const origin = new URL(url).origin;
          if (origin === SITE) return;
          const headers: Record<string, string> = { origin };
          if (site) headers["sec-fetch-site"] = site;
          expect(evaluateSameOriginMutation(request(headers))).toEqual({
            allowed: false,
            status: 403,
            error: "Cross-site requests are not allowed",
            reason: "cross-site-origin",
          });
        }
      )
    );
  });

  it("allows the configured site address and the address the request came to, and nothing else", () => {
    // A preview or workers.dev address serves the same pages as the configured one.
    const host = fc.domain().filter((name) => name !== "verifymzansi.com");
    fc.assert(
      fc.property(host, host, (served, other) => {
        vi.stubEnv("NEXT_PUBLIC_APP_URL", SITE);
        const at = (origin: string) =>
          evaluateSameOriginMutation(
            new NextRequest(`https://${served}/api/profile/update`, {
              method: "POST",
              headers: { origin },
            })
          ).allowed;
        expect(at(SITE)).toBe(true);
        expect(at(`https://${served}`)).toBe(true);
        if (other !== served) expect(at(`https://${other}`)).toBe(false);
      })
    );
  });

  it("records each refusal for monitoring, with its reason", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          [{ origin: "https://other-site.example" }, "cross-site-origin"] as const,
          [{ origin: "null" }, "invalid-origin"] as const,
          [{ "sec-fetch-site": "cross-site" }, "cross-site-fetch"] as const,
          [{ "sec-fetch-site": "none" }, "cross-site-fetch"] as const
        ),
        ([headers, reason]) => {
          vi.mocked(recordSecurityEvent).mockClear();
          const warn = vi.fn();
          const response = enforceSameOriginMutation(request({ ...headers }), { warn });
          expect(response?.status).toBe(403);
          expect(recordSecurityEvent).toHaveBeenCalledWith(
            expect.objectContaining({ event: "request.origin_rejected", reason })
          );
          const sent = headers as Record<string, string | undefined>;
          expect(warn).toHaveBeenCalledWith("Rejected state-changing request with invalid origin", {
            path: "/api/profile/update",
            reason,
            origin: sent.origin,
            secFetchSite: sent["sec-fetch-site"],
          });
          // Callers without a logger are refused the same way.
          expect(enforceSameOriginMutation(request({ ...headers }))?.status).toBe(403);
        }
      )
    );
  });

  it("refuses an origin header that is not a URL", () => {
    // An empty header (after the trimming every header gets) counts as absent.
    const header = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((value) => value.trim() !== "");
    fc.assert(
      fc.property(header, (origin) => {
        let parsed: string | null = null;
        try {
          parsed = new URL(origin).origin;
        } catch {
          // Not a URL.
        }
        if (parsed === SITE) return;
        expect(evaluateSameOriginMutation(request({ origin }))).toMatchObject({
          allowed: false,
          status: 403,
        });
      })
    );
    expect(evaluateSameOriginMutation(request({ origin: "null" }))).toEqual({
      allowed: false,
      status: 403,
      error: "Invalid request origin",
      reason: "invalid-origin",
    });
  });

  it("without an origin, allows only same-origin or same-site fetch metadata (or none at all)", () => {
    expect(evaluateSameOriginMutation(request({}))).toEqual({
      allowed: true,
      reason: "non-browser",
    });
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom("same-origin", "same-site", "cross-site", "none", "Same-Origin"),
          fc.string({ maxLength: 12 })
        ),
        (site) => {
          const decision = evaluateSameOriginMutation(request({ "sec-fetch-site": site }));
          const header = site.trim();
          if (header === "") return;
          const allowed = header === "same-origin" || header === "same-site";
          expect(decision).toEqual(
            allowed
              ? { allowed: true, reason: "same-site-fetch" }
              : {
                  allowed: false,
                  status: 403,
                  error: "Cross-site requests are not allowed",
                  reason: "cross-site-fetch",
                }
          );
        }
      )
    );
  });
});
