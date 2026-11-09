/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { createFoundationEmailChanger, FoundationEmailChangeError } from "./email-change";

vi.mock("server-only", () => ({}));

const config = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  expectedProjectRef: "abcdefghijklmnopqrst",
  publishableKey: "sb_publishable_synthetic",
};
const subject = "00000000-0000-4000-8000-000000000001";
const token = "synthetic.verified.token";
const landing = "https://verifymzansi.com/auth/callback?backend=foundation&email_change=1";
const pending = () =>
  Response.json({
    id: subject,
    email: "current@example.invalid",
    new_email: "next@example.invalid",
  });

function changer(fetcher: typeof fetch) {
  return createFoundationEmailChanger(config, token, subject, fetcher);
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(FoundationEmailChangeError);
  return error as FoundationEmailChangeError;
}

describe("starting an email change with the member's own session", () => {
  it("asks Auth once, with the member's token and a challenge nobody can answer", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => pending());
    expect(await changer(fetcher)("next@example.invalid", landing)).toBe("requested");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    const target = new URL(String(url));
    expect(target.origin + target.pathname).toBe(`${config.url}/auth/v1/user`);
    expect(target.searchParams.get("redirect_to")).toBe(landing);
    expect(init).toMatchObject({
      method: "PUT",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    const headers = new Headers(init?.headers);
    // The publishable key and the member's session; never the secret key.
    expect(headers.get("apikey")).toBe(config.publishableKey);
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(["code_challenge", "code_challenge_method", "email"]);
    expect(body.email).toBe("next@example.invalid");
    expect(body.code_challenge_method).toBe("s256");
    expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses a fresh challenge for every request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => pending());
    const change = changer(fetcher);
    await change("next@example.invalid", landing);
    await change("next@example.invalid", landing);
    const [first, second] = fetcher.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).code_challenge
    );
    expect(first).not.toBe(second);
  });

  it("accepts Auth's wrapped user reply too", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ user: { id: subject, email: "current@example.invalid" } })
    );
    expect(await changer(fetcher)("next@example.invalid", landing)).toBe("requested");
  });

  it("reports an address changed at once (no confirmation at all)", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ id: subject, email: "Next@Example.invalid" })
    );
    expect(await changer(fetcher)("next@example.invalid", landing)).toBe("applied");
  });

  it.each([
    // Auth's reply to API version 2024-01-01, which the request asks for.
    ["email_exists (current reply)", { code: "email_exists", message: "PRIVATE_PROVIDER_DETAIL" }],
    [
      "email_exists (older reply)",
      { code: 422, error_code: "email_exists", msg: "PRIVATE_PROVIDER_DETAIL" },
    ],
    ["user_already_exists", { code: "user_already_exists", message: "PRIVATE_PROVIDER_DETAIL" }],
  ])("answers an address of another account (%s) like an accepted request", async (_l, reply) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(reply, { status: 422 }));
    expect(await changer(fetcher)("taken@example.invalid", landing)).toBe("requested");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("x-supabase-api-version")).toBe(
      "2024-01-01"
    );
  });

  it.each([
    [429, "over_email_send_rate_limit"],
    [400, "over_email_send_rate_limit"],
    [400, "over_request_rate_limit"],
    [429, "unexpected_failure"],
  ] as const)(
    "reports Auth's email limit refusal %s %s as limited, not as an error",
    async (status, code) => {
      for (const reply of [
        { code, message: "PRIVATE_PROVIDER_DETAIL" },
        { code: status, error_code: code, msg: "PRIVATE_PROVIDER_DETAIL" },
      ]) {
        const fetcher = vi.fn<typeof fetch>(async () => Response.json(reply, { status }));
        expect(await changer(fetcher)("next@example.invalid", landing)).toBe("limited");
      }
      const empty = vi.fn<typeof fetch>(async () => new Response(null, { status: 429 }));
      expect(await changer(empty)("next@example.invalid", landing)).toBe("limited");
    }
  );

  it.each([
    [403, "insufficient_aal", 403, "mfa_required"],
    [400, "email_address_invalid", 400, "invalid_email"],
    [401, "unexpected_failure", 401, "session"],
    [403, "bad_jwt", 401, "session"],
    [403, "session_not_found", 401, "session"],
    [404, "session_expired", 401, "session"],
    [400, "no_authorization", 401, "session"],
    [400, "validation_failed", 503, "unavailable"],
    [400, "email_address_not_authorized", 503, "unavailable"],
    [422, "conflict", 503, "unavailable"],
    [403, "user_sso_managed", 503, "unavailable"],
    [500, "unexpected_failure", 503, "unavailable"],
  ] as const)("maps Auth's %s %s to %s %s", async (status, code, answer, reason) => {
    for (const reply of [
      { code, message: "PRIVATE_PROVIDER_DETAIL" },
      { code: status, error_code: code, msg: "PRIVATE_PROVIDER_DETAIL" },
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(reply, { status }));
      const error = await refusal(changer(fetcher)("next@example.invalid", landing));
      expect(error.status).toBe(answer);
      expect(error.reason).toBe(reason);
      expect(error.message).not.toContain("PRIVATE_PROVIDER_DETAIL");
    }
  });

  it.each([
    ["a network failure", async () => Promise.reject(new TypeError("synthetic"))],
    ["an unreadable reply", async () => new Response("not json", { status: 200 })],
    ["another account's reply", async () => Response.json({ id: "someone-else" })],
    ["a reply without a user", async () => Response.json(null)],
  ])("treats %s as unavailable", async (_label, answer) => {
    const fetcher = vi.fn<typeof fetch>(answer);
    const error = await refusal(changer(fetcher)("next@example.invalid", landing));
    expect(error.status).toBe(503);
    expect(error.reason).toBe("unavailable");
  });

  it("refuses a connection that is not a foundation project", () => {
    expect(() =>
      createFoundationEmailChanger(
        { ...config, url: "https://tnygdgormnofpgjknlhr.supabase.co" },
        token,
        subject,
        vi.fn()
      )
    ).toThrow();
  });
});
