/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import {
  buildStaffIdentityContextCommand,
  buildStaffIdentityHistoryCommand,
  parseStaffIdentityContext,
  parseStaffIdentityHistory,
  readStaffIdentityContext,
  readStaffIdentityHistory,
} from "./staff-identity";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = (n = 1, role = "authenticated") =>
  [
    Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role, sub: id(n), session_id: id(n + 100), exp: 1 })).toString(
      "base64url"
    ),
    "unsigned_synthetic_unit_only",
  ].join(".");
const config = {
  url: "http://127.0.0.1:55441",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
const instant = "2026-10-16T05:00:00.123456+00:00";
const history = () => ({
  case_id: id(10),
  case_version: 3,
  claim_generation: "9007199254740993",
  claim_nonce: id(11),
  claim_expires_at: instant,
  identities: [
    {
      identity_fact_id: id(12),
      submission_id: id(13),
      reviewed_at: instant,
      identity_is_current: false,
    },
  ],
  next_cursor: null,
});
const context = () => ({
  case_id: id(10),
  case_version: 3,
  submission_id: id(13),
  risk_score: 20,
  recipe: "manual-id-selfie-v1",
  id_artifact_id: id(14),
  selfie_artifact_id: id(15),
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

it("preserves caller JWTs per connection and performs one uncached audited POST with actor-free args", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(history()));
  const a = createFoundationAuthenticatedApi(config, token(1), fetcher);
  const b = createFoundationAuthenticatedApi(config, token(2), fetcher);
  const [first] = await Promise.all([
    readStaffIdentityHistory(a, { owner_id: id(20) }),
    readStaffIdentityHistory(b, { owner_id: id(21) }),
  ]);
  expect(Object.keys(a)).toEqual(["rpc"]);
  expect(first.claim_generation).toBe("9007199254740993");
  expect(first.identities[0].reviewed_at).toBe(instant);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [index, [_request, init]] of fetcher.mock.calls.entries()) {
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${token(index + 1)}`);
    expect(headers.get("apikey")).toBe(config.publishableKey);
    expect(headers.get("content-profile")).toBe("api");
    expect(headers.has("cookie")).toBe(false);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ p_owner: id(index + 20) });
  }
});

it.each([
  "sb_secret_synthetic",
  "not-jwt",
  token(1, "service_role"),
  token(1, "anon"),
  "e30.e30.c2ln",
])("rejects wrong token shape/role before a request %#", (value) => {
  const fetcher = vi.fn<typeof fetch>();
  expect(() => createFoundationAuthenticatedApi(config, value, fetcher)).toThrow(
    "A current authenticated caller token is required"
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("strict history inputs preserve complete cursor pairs and reject actor/session and partial cursor injection", () => {
  const cursor = { before_time: instant, before_id: id(12) };
  expect(buildStaffIdentityHistoryCommand({ owner_id: id(20), cursor })).toEqual({
    p_owner: id(20),
    p_before_time: instant,
    p_before_id: id(12),
  });
  for (const value of [
    { owner_id: id(20), actor_id: id(1) },
    { owner_id: id(20), session_id: id(1) },
    { owner_id: id(20), cursor: { before_time: instant } },
    { owner_id: id(20), cursor: { before_id: id(12) } },
    { owner_id: id(20), cursor: { ...cursor, extra: true } },
    { owner_id: id(20), cursor: { ...cursor, before_time: "2026-02-30T05:00:00Z" } },
  ])
    expect(() => buildStaffIdentityHistoryCommand(value)).toThrow(
      "Invalid foundation identity history request"
    );
});

it("rejects numeric/noncanonical/overflow generations, extra sensitive fields and malformed history", () => {
  const good = history();
  for (const value of [
    { ...good, claim_generation: 9007199254740992 },
    { ...good, claim_generation: "01" },
    { ...good, claim_generation: "9223372036854775808" },
    { ...good, claim_generation: "1e3" },
    { ...good, identity_hmac: "private" },
    { ...good, identities: [{ ...good.identities[0], number_ciphertext: "private" }] },
    { ...good, identities: [good.identities[0], good.identities[0]] },
    { ...good, next_cursor: { before_time: instant, before_id: id(12) } },
    {
      ...good,
      identities: Array.from({ length: 21 }, (_, n) => ({
        ...good.identities[0],
        identity_fact_id: id(n + 40),
      })),
    },
    { ...good, claim_expires_at: "2026-10-16 05:00:00+00" },
  ])
    expect(() => parseStaffIdentityHistory(value)).toThrow("Invalid foundation identity history");
  expect(
    parseStaffIdentityHistory({ ...good, claim_generation: "9223372036854775807" }).claim_generation
  ).toBe("9223372036854775807");
});

it("preserves a20-row continuation boundary with microseconds and rejects a misbound cursor", () => {
  const items = Array.from({ length: 20 }, (_, n) => ({
    identity_fact_id: id(n + 40),
    submission_id: id(n + 70),
    reviewed_at: instant,
    identity_is_current: false,
  }));
  const page = {
    ...history(),
    identities: items,
    next_cursor: { before_time: instant, before_id: items[19].identity_fact_id },
  };
  expect(parseStaffIdentityHistory(page).next_cursor).toEqual(page.next_cursor);
  expect(() =>
    parseStaffIdentityHistory({
      ...page,
      next_cursor: { ...page.next_cursor, before_id: items[18].identity_fact_id },
    })
  ).toThrow();
  expect(() =>
    parseStaffIdentityHistory({
      ...page,
      next_cursor: { ...page.next_cursor, before_time: instant.replace("123456", "123000") },
    })
  ).toThrow();
});

it("context strictly binds case, claim text and nonce and excludes private evidence", async () => {
  const input = { case_id: id(10), claim_generation: "9007199254740993", claim_nonce: id(11) };
  expect(buildStaffIdentityContextCommand(input)).toEqual({
    p_case: id(10),
    p_claim_generation: input.claim_generation,
    p_claim_nonce: id(11),
  });
  const fetcher = vi.fn<typeof fetch>(async () => response(context()));
  expect(
    await readStaffIdentityContext(
      createFoundationAuthenticatedApi(config, token(), fetcher),
      input
    )
  ).toEqual(context());
  for (const value of [
    { ...context(), object_key: "private" },
    { ...context(), recipe: "unknown" },
    { ...context(), selfie_artifact_id: id(14) },
  ])
    expect(() => parseStaffIdentityContext(value)).toThrow();
  expect(() => buildStaffIdentityContextCommand({ ...input, actor_id: id(1) })).toThrow();
  const wrong = vi.fn<typeof fetch>(async () => response({ ...context(), case_id: id(99) }));
  await expect(
    readStaffIdentityContext(createFoundationAuthenticatedApi(config, token(), wrong), input)
  ).rejects.toThrow("Invalid foundation identity review context");
});

it.each([403, 503])(
  "does not retry staff failures or expose server diagnostics at %i",
  async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({ code: "42501", message: "private session diagnostic" }, status)
    );
    await expect(
      readStaffIdentityHistory(createFoundationAuthenticatedApi(config, token(), fetcher), {
        owner_id: id(20),
      })
    ).rejects.toThrow(/^Foundation identity history unavailable$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);

it("rejects invalid command input before invoking the SDK", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    readStaffIdentityHistory(createFoundationAuthenticatedApi(config, token(), fetcher), {
      owner_id: id(20),
      aal: "aal2",
    })
  ).rejects.toThrow("Invalid foundation identity history request");
  expect(fetcher).not.toHaveBeenCalled();
});
