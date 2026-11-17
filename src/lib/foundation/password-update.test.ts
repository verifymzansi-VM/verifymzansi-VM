/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import {
  createFoundationPasswordUpdater,
  createFoundationPasswordResetter,
  FoundationPasswordResetUncertainError,
} from "./password-update";
import { foundationPasswordUpdateSchema } from "./password-update-input";
vi.mock("server-only", () => ({}));
const config = {
  url: "https://gntzjtuncsyefujajmjy.supabase.co",
  expectedProjectRef: "gntzjtuncsyefujajmjy",
  publishableKey: "sb_publishable_synthetic",
};
const id = "00000000-0000-4000-8000-000000000001";

it("recovery omits the old password and revokes sessions only after one verified update", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const result = await createFoundationPasswordResetter(
    config,
    "verified-recovery-token",
    id,
    Math.floor(Date.now() / 1000),
    fetcher
  )("synthetic-next-password");
  expect(result).toEqual({ signOutComplete: true, alreadyCurrent: false });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    password: "synthetic-next-password",
  });
  expect(String(fetcher.mock.calls[1][0])).toBe(config.url + "/auth/v1/logout?scope=global");
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization")).toBe(
    "Bearer verified-recovery-token"
  );
});
it("expired recovery cannot send a password update", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createFoundationPasswordResetter(
      config,
      "token",
      id,
      Math.floor(Date.now() / 1000) - 3601,
      fetcher
    )("synthetic-next-password")
  ).rejects.toMatchObject({ status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps a committed reset distinct from an unavailable sign-out", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id }))
    .mockRejectedValueOnce(new Error("network unavailable"));
  await expect(
    createFoundationPasswordResetter(
      config,
      "token",
      id,
      Math.floor(Date.now() / 1000),
      fetcher
    )("synthetic-next-password")
  ).resolves.toEqual({ signOutComplete: false, alreadyCurrent: false });
  expect(fetcher.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
});
const reset = (fetcher: typeof fetch) =>
  createFoundationPasswordResetter(
    config,
    "token",
    id,
    Math.floor(Date.now() / 1000),
    fetcher
  )("synthetic-next-password");
const puts = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetcher.mock.calls.filter((call) => call[1]?.method === "PUT").length;
const signOuts = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetcher.mock.calls.filter((call) => String(call[0]).endsWith("/auth/v1/logout?scope=global"))
    .length;
it.each([
  ["no reply (timeout or dropped connection)", () => Promise.reject(new Error("timeout"))],
  ["a server error", async () => Response.json({ msg: "unavailable" }, { status: 500 })],
  ["an unreadable success reply", async () => new Response("not json", { status: 200 })],
  ["a success reply for another user", async () => Response.json({ id: "another-user" })],
] as const)(
  "signs every session out once when a sent reset has an unknown outcome: %s",
  async (_label, reply) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(reply)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const failure = await reset(fetcher).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FoundationPasswordResetUncertainError);
    expect(failure).toMatchObject({ status: 503, detail: "uncertain", signOutComplete: true });
    expect(puts(fetcher)).toBe(1);
    expect(signOuts(fetcher)).toBe(1);
  }
);
it("reports an unknown outcome whose sign-out also failed", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("timeout"))
    .mockRejectedValueOnce(new Error("still unavailable"));
  await expect(reset(fetcher)).rejects.toMatchObject({ signOutComplete: false });
  expect(puts(fetcher)).toBe(1);
});
it.each([
  // Auth's reply to API version 2024-01-01, which the request asks for.
  ["the current reply", { code: "same_password", message: "PRIVATE_PROVIDER_DETAIL" }],
  ["an older reply", { code: 422, error_code: "same_password", msg: "PRIVATE_PROVIDER_DETAIL" }],
])(
  "treats a repeat of the password already in force as the completed reset (%s)",
  async (_label, reply) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(reply, { status: 422 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(reset(fetcher)).resolves.toEqual({ signOutComplete: true, alreadyCurrent: true });
    expect(puts(fetcher)).toBe(1);
    expect(signOuts(fetcher)).toBe(1);
  }
);
it.each([
  ["weak_password", 422],
  ["insufficient_aal", 403],
  ["unexpected_refusal", 422],
  ["rate_limited", 429],
  ["bad_jwt", 401],
] as const)("keeps sessions after a clear refusal of the reset: %s", async (code, status) => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ code, message: "PRIVATE_PROVIDER_DETAIL" }, { status })
  );
  const failure = await reset(fetcher).catch((error: unknown) => error);
  expect(failure).not.toBeInstanceOf(FoundationPasswordResetUncertainError);
  expect(failure).toMatchObject({ detail: undefined });
  expect(signOuts(fetcher)).toBe(0);
  expect(puts(fetcher)).toBe(1);
});
// ── Change password (a signed-in member who knows the current password) ──
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  FOUNDATION_SUPABASE_SECRET_KEY: "sb_secret_synthetic_unit_only",
};
const memberCheck = {
  email: "member@example.invalid",
  authenticatorStepMissing: false,
  signedInAt: Math.floor(Date.now() / 1000) - 60,
};
/** An access token for the session the check's sign-in creates. */
const checkToken = (claims: Record<string, unknown> = { session_id: id.replace(/1$/, "9") }) =>
  [
    Buffer.from('{"alg":"ES256"}').toString("base64url"),
    Buffer.from(JSON.stringify({ sub: id, ...claims })).toString("base64url"),
    "unsigned_synthetic_unit_only",
  ].join(".");
const signedIn = (accessToken = checkToken(), user: unknown = { id }) =>
  Response.json({ access_token: accessToken, refresh_token: "synthetic-refresh", user });
type Reply = () => Promise<Response>;
/** Local Auth: the check's sign-in, its sign-out, and the update itself. */
function auth({
  token = async () => signedIn(),
  logout = async () => new Response(null, { status: 204 }),
  user = async () => Response.json({ id }),
}: { token?: Reply; logout?: Reply; user?: Reply } = {}) {
  return vi.fn<typeof fetch>(async (url) => {
    const { pathname } = new URL(String(url));
    if (pathname === "/auth/v1/token") return token();
    if (pathname === "/auth/v1/logout") return logout();
    if (pathname === "/auth/v1/user") return user();
    throw new Error("unexpected Auth request");
  });
}
const sent = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, path: string) =>
  fetcher.mock.calls.filter((call) => new URL(String(call[0])).pathname === path);
const change = (
  fetcher: typeof fetch,
  check: {
    email: string | undefined;
    authenticatorStepMissing: boolean;
    signedInAt: number | null;
  } = memberCheck,
  charge: () => Promise<void> = async () => {},
  environment: NodeJS.ProcessEnv = env
) =>
  createFoundationPasswordUpdater(
    config,
    "synthetic-verified-token",
    id,
    fetcher,
    check,
    environment
  )("synthetic-current", "synthetic-next-password", charge);

it("confirms the current password by a sign-in for the session's own address, ends that session, then updates once", async () => {
  const fetcher = auth();
  const charge = vi.fn(async () => {});
  await expect(change(fetcher, memberCheck, charge)).resolves.toBeUndefined();
  expect(charge).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
    config.url + "/auth/v1/token?grant_type=password",
    config.url + "/auth/v1/logout?scope=local",
    config.url + "/auth/v1/user",
  ]);
  const [, checkInit] = fetcher.mock.calls[0];
  expect(checkInit).toMatchObject({
    method: "POST",
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
  });
  // The secret key lets the sign-in skip Auth's CAPTCHA (as password setup does).
  const checkHeaders = new Headers(checkInit?.headers);
  expect(checkHeaders.get("apikey")).toBe(env.FOUNDATION_SUPABASE_SECRET_KEY);
  expect(checkHeaders.get("authorization")).toBe(`Bearer ${env.FOUNDATION_SUPABASE_SECRET_KEY}`);
  expect(JSON.parse(String(checkInit?.body))).toEqual({
    email: memberCheck.email,
    password: "synthetic-current",
  });
  // Only the check's own session is ended, with its own token.
  const [, logoutInit] = fetcher.mock.calls[1];
  expect(logoutInit?.method).toBe("POST");
  expect(new Headers(logoutInit?.headers).get("authorization")).toBe(`Bearer ${checkToken()}`);
  expect(new Headers(logoutInit?.headers).get("apikey")).toBe(config.publishableKey);
  // The update still uses the member's own verified token and asks Auth to
  // check the current password too.
  const [, init] = fetcher.mock.calls[2];
  expect(init).toMatchObject({
    method: "PUT",
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
  });
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-verified-token");
  expect(new Headers(init?.headers).get("x-supabase-api-version")).toBe("2024-01-01");
  expect(JSON.parse(String(init?.body))).toEqual({
    password: "synthetic-next-password",
    current_password: "synthetic-current",
  });
});
it.each([
  // Auth's reply to API version 2024-01-01, and an older one.
  ["the current reply", { code: "invalid_credentials", message: "PRIVATE_PROVIDER_DETAIL" }],
  ["an older reply", { error: "invalid_grant", error_code: "invalid_credentials" }],
])(
  "refuses a wrong current password before any update, whatever Auth's own setting (%s)",
  async (_label, reply) => {
    const fetcher = auth({ token: async () => Response.json(reply, { status: 400 }) });
    await expect(change(fetcher)).rejects.toMatchObject({
      status: 400,
      reason: "current_password",
    });
    expect(sent(fetcher, "/auth/v1/token")).toHaveLength(1);
    expect(sent(fetcher, "/auth/v1/logout")).toHaveLength(0);
    expect(sent(fetcher, "/auth/v1/user")).toHaveLength(0);
  }
);
it("asks for the authenticator step before any password check, as Auth does", async () => {
  const fetcher = auth();
  const charge = vi.fn(async () => {});
  await expect(
    change(fetcher, { ...memberCheck, authenticatorStepMissing: true }, charge)
  ).rejects.toMatchObject({ status: 403, reason: "mfa_required" });
  expect(charge).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  ["signed in over 24 hours ago", Math.floor(Date.now() / 1000) - 24 * 3600 - 60],
  ["with no sign-in on record", null],
] as const)(
  "asks a session %s to sign in again before any password check, as Auth's secure setting does",
  async (_label, signedInAt) => {
    const fetcher = auth();
    const charge = vi.fn(async () => {});
    await expect(change(fetcher, { ...memberCheck, signedInAt }, charge)).rejects.toMatchObject({
      status: 401,
      reason: "reauthentication",
    });
    expect(charge).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it("checks a session signed in just under 24 hours ago", async () => {
  const fetcher = auth();
  const signedInAt = Math.floor(Date.now() / 1000) - 24 * 3600 + 60;
  await expect(change(fetcher, { ...memberCheck, signedInAt })).resolves.toBeUndefined();
  expect(sent(fetcher, "/auth/v1/token")).toHaveLength(1);
});
it("asks for the authenticator step first when both rules apply, as Auth does", async () => {
  const fetcher = auth();
  await expect(
    change(fetcher, { ...memberCheck, authenticatorStepMissing: true, signedInAt: null })
  ).rejects.toMatchObject({ status: 403, reason: "mfa_required" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("spends the check budget before the sign-in and stops when it is spent", async () => {
  const fetcher = auth();
  const spent = new Error("budget spent");
  await expect(change(fetcher, memberCheck, async () => Promise.reject(spent))).rejects.toBe(spent);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  ["no secret key", memberCheck, {}],
  ["a malformed secret key", memberCheck, { FOUNDATION_SUPABASE_SECRET_KEY: "eyJ.legacy" }],
  ["no verified address", { ...memberCheck, email: undefined }, env],
  ["an empty verified address", { ...memberCheck, email: "" }, env],
] as const)("fails closed without checking or updating: %s", async (_label, check, environment) => {
  const fetcher = auth();
  const charge = vi.fn(async () => {});
  await expect(
    change(fetcher, check, charge, environment as NodeJS.ProcessEnv)
  ).rejects.toMatchObject({ status: 503, reason: "unavailable" });
  expect(charge).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [
    "Auth's rate limit",
    // Per network address: the website's, not the member's attempts.
    async () => Response.json({ code: "over_request_rate_limit" }, { status: 429 }),
    503,
  ],
  [
    "a CAPTCHA refusal",
    async () => Response.json({ code: "captcha_failed" }, { status: 400 }),
    503,
  ],
  [
    "an unconfirmed address",
    async () => Response.json({ code: "email_not_confirmed" }, { status: 400 }),
    503,
  ],
  ["a banned account", async () => Response.json({ code: "user_banned" }, { status: 400 }), 503],
  ["a server error", async () => Response.json({}, { status: 500 }), 503],
  ["an unreadable refusal", async () => new Response("not json", { status: 400 }), 503],
  ["no reply", async () => Promise.reject(new Error("timeout")), 503],
] as const)(
  "does not update when the check cannot confirm the password: %s",
  async (_label, token, status) => {
    const fetcher = auth({ token });
    await expect(change(fetcher)).rejects.toMatchObject({ status, reason: "unavailable" });
    expect(sent(fetcher, "/auth/v1/token")).toHaveLength(1);
    expect(sent(fetcher, "/auth/v1/user")).toHaveLength(0);
  }
);
it.each([
  ["another user", () => signedIn(checkToken(), { id: "another-user" })],
  ["no user", () => signedIn(checkToken(), null)],
] as const)(
  "ends the check's session but does not update when it signed in %s",
  async (_label, reply) => {
    const fetcher = auth({ token: async () => reply() });
    await expect(change(fetcher)).rejects.toMatchObject({ status: 503, reason: "unavailable" });
    expect(sent(fetcher, "/auth/v1/logout")).toHaveLength(1);
    expect(sent(fetcher, "/auth/v1/user")).toHaveLength(0);
  }
);
it.each([
  ["no reply", async () => Promise.reject(new Error("timeout"))],
  ["a refusal", async () => Response.json({}, { status: 500 })],
] as const)(
  "still updates (which signs other sessions out) when ending the check's session fails: %s",
  async (_label, logout) => {
    const fetcher = auth({ logout });
    await expect(change(fetcher)).resolves.toBeUndefined();
    expect(sent(fetcher, "/auth/v1/logout")).toHaveLength(1);
    expect(sent(fetcher, "/auth/v1/user")).toHaveLength(1);
  }
);
it.each([
  ["no session id (Auth would sign every session out)", checkToken({})],
  ["a malformed session id", checkToken({ session_id: "not-a-session" })],
  ["an unreadable token", "not-a-token"],
] as const)("never sends a sign-out for a check token with %s", async (_label, accessToken) => {
  const fetcher = auth({ token: async () => signedIn(accessToken) });
  await expect(change(fetcher)).resolves.toBeUndefined();
  expect(sent(fetcher, "/auth/v1/logout")).toHaveLength(0);
  expect(sent(fetcher, "/auth/v1/user")).toHaveLength(1);
});
it.each([
  ["current_password_invalid", 400, "current_password"],
  ["current_password_required", 400, "current_password"],
  ["insufficient_aal", 403, "mfa_required"],
  ["reauthentication_needed", 401, "reauthentication"],
  ["weak_password", 400, "password_policy"],
  ["same_password", 400, "password_policy"],
] as const)("keeps Auth's own refusal %s closed without retry", async (code, status, reason) => {
  // Auth's reply to API version 2024-01-01 (`code`), and an older one (`error_code`).
  for (const reply of [
    { code, message: "PRIVATE_PROVIDER_DETAIL" },
    { code: 400, error_code: code, msg: "PRIVATE_PROVIDER_DETAIL" },
  ]) {
    const fetcher = auth({ user: async () => Response.json(reply, { status: 400 }) });
    await expect(change(fetcher)).rejects.toMatchObject({ status, reason });
    expect(sent(fetcher, "/auth/v1/user")).toHaveLength(1);
  }
});
it("does not acknowledge a mismatched provider user", async () => {
  const fetcher = auth({ user: async () => Response.json({ id: "another-user" }) });
  await expect(change(fetcher)).rejects.toMatchObject({ status: 503 });
});
it("accepts the provider's explicit user response envelope", async () => {
  const fetcher = auth({ user: async () => Response.json({ user: { id } }) });
  await expect(change(fetcher)).resolves.toBeUndefined();
});
it("never signs the member out from a password change, even when its outcome is unknown", async () => {
  const fetcher = auth({ user: async () => Response.json({}, { status: 502 }) });
  await expect(change(fetcher)).rejects.toMatchObject({
    status: 503,
    reason: "unavailable",
    detail: "uncertain",
  });
  expect(sent(fetcher, "/auth/v1/user")).toHaveLength(1);
  // Only the check's own session was ended (scope local), never the member's.
  const logouts = sent(fetcher, "/auth/v1/logout");
  expect(logouts.map((call) => String(call[0]))).toEqual([
    config.url + "/auth/v1/logout?scope=local",
  ]);
  expect(new Headers(logouts[0][1]?.headers).get("authorization")).toBe(`Bearer ${checkToken()}`);
});
it("does not retry an ambiguous network failure", async () => {
  const fetcher = auth({ user: async () => Promise.reject(new Error("network failure")) });
  await expect(change(fetcher)).rejects.toMatchObject({ status: 503 });
  expect(sent(fetcher, "/auth/v1/user")).toHaveLength(1);
});
it("rejects actor selectors, short or identical passwords, and confirmation mismatches", () => {
  const valid = {
    currentPassword: "synthetic-current",
    newPassword: "synthetic-next-password",
    confirmNewPassword: "synthetic-next-password",
  };
  expect(foundationPasswordUpdateSchema.safeParse(valid).success).toBe(true);
  for (const value of [
    { ...valid, owner_id: id },
    { ...valid, newPassword: "short", confirmNewPassword: "short" },
    { ...valid, confirmNewPassword: "different" },
    { ...valid, newPassword: valid.currentPassword, confirmNewPassword: valid.currentPassword },
  ])
    expect(foundationPasswordUpdateSchema.safeParse(value).success).toBe(false);
});
